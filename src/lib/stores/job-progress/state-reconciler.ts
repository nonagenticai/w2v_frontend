// State reconciler: arbitrates between SSE/WS event stream and REST polling.
// THIS IS THE BUG FIX — prevents stale polling from reverting stage progress.
// Plain .ts — no runes.

import type { RunStatusLite, RunStatus } from '$lib/types/runs';
import type { StageState, StageProgressStatus, RunWsMessage } from './types.js';

const VALID_STAGE_STATUSES = new Set<string>([
	'pending',
	'running',
	'completed',
	'failed',
	'skipped',
	// Orchestrator PR #706: a stranded pending/running stage is terminalized to
	// 'cancelled' when the run hard-fails. Missing here it was coerced to
	// 'pending' → a permanently-spinning stage row.
	'cancelled'
]);

export function isStageStatus(s: string): s is StageProgressStatus {
	return VALID_STAGE_STATUSES.has(s);
}

const STATUS_RANK: Record<string, number> = {
	pending: 0,
	running: 1,
	completed: 2,
	skipped: 2,
	failed: 3,
	// Terminal, same rank as 'failed': the monotonic-progress guard must be able
	// to advance a running stage into 'cancelled', or a poll carrying the
	// terminalized status would be discarded while the live stream is authoritative.
	cancelled: 3
};

/** How long (ms) a recent live event keeps the SSE/WS authoritative. */
const WS_AUTHORITY_WINDOW_MS = 30_000;

/**
 * Stage statuses that count as "done" for progress purposes — the stage will
 * never do more work. A cancelled stage is included: the run terminalized it,
 * so leaving it out pins progress below 100% forever.
 *
 * Single source of truth — `progressFromStages()` is the only progress
 * computation in the job-progress module (job-progress-state.svelte.ts imports
 * it rather than keeping a second copy; the duplicate is what let 'cancelled'
 * slip through in two places at once).
 */
export const DONE_STAGE_STATUSES = new Set<StageProgressStatus>([
	'completed',
	'skipped',
	'cancelled'
]);

export function isStageDone(status: StageProgressStatus): boolean {
	return DONE_STAGE_STATUSES.has(status);
}

/** Compute progress from a stage list as done / total. */
export function progressFromStages(stages: StageState[]): number {
	if (stages.length === 0) return 0;
	const done = stages.filter((s) => isStageDone(s.status)).length;
	return done / stages.length;
}

function durationMs(startedAt: string | null, completedAt: string | null): number | null {
	if (!startedAt || !completedAt) return null;
	const start = Date.parse(startedAt);
	const end = Date.parse(completedAt);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	const delta = end - start;
	return delta >= 0 ? delta : null;
}

export class StateReconciler {
	/**
	 * Merge polling data into current stages.
	 * When SSE/WS is authoritative (connected + recent events <30 s),
	 * polling can only ADVANCE stages forward (higher rank), never regress.
	 * When live stream is not authoritative, polling has full override.
	 */
	mergePollingData(
		currentStages: StageState[],
		pollingDetail: RunStatusLite,
		wsConnected: boolean,
		lastWsEventTime: number
	): {
		stages: StageState[];
		jobStatus: RunStatus;
		currentStage: string | null;
		progress: number;
		error: string | null;
	} {
		const wsAuthoritative = wsConnected && Date.now() - lastWsEventTime < WS_AUTHORITY_WINDOW_MS;

		const stageOutputs = pollingDetail.stage_outputs ?? [];

		// Build a lookup from the polling response.
		const pollStageMap = new Map(stageOutputs.map((s) => [s.stage_name, s]));

		// Authoritative stage list comes from the run's stage_outputs (only
		// the stages this run actually executes). Falling back to the
		// existing stages list keeps mid-flight UIs from blanking when an
		// early poll returns an empty array.
		const activeStageNames =
			stageOutputs.length > 0
				? stageOutputs.map((s) => s.stage_name)
				: currentStages.map((s) => s.name);

		const mergedStages: StageState[] = activeStageNames.map((name) => {
			const pollStage = pollStageMap.get(name);
			const current = currentStages.find((s) => s.name === name);

			const rawPollStatus = pollStage?.status ?? 'pending';
			const pollStatus: StageProgressStatus = isStageStatus(rawPollStatus)
				? rawPollStatus
				: 'pending';
			const currentStatus = current?.status ?? 'pending';

			let finalStatus: StageProgressStatus;
			if (wsAuthoritative) {
				const pollRank = STATUS_RANK[pollStatus] ?? 0;
				const currentRank = STATUS_RANK[currentStatus] ?? 0;
				finalStatus = pollRank > currentRank ? pollStatus : currentStatus;
			} else {
				finalStatus = pollStatus;
			}

			// StageOutputResponse no longer ships duration_seconds — derive it
			// from started_at / completed_at when both are present.
			const pollDuration = pollStage
				? durationMs(pollStage.started_at, pollStage.completed_at)
				: null;
			const dMs = pollDuration ?? current?.durationMs ?? null;

			return {
				name,
				status: finalStatus,
				durationMs: dMs,
				artifactPrefix:
					finalStatus === 'completed' ? `output/${name}` : (current?.artifactPrefix ?? null),
				subStep: current?.subStep ?? null
			};
		});

		return {
			stages: mergedStages,
			jobStatus: pollingDetail.status,
			currentStage: pollingDetail.current_stage,
			progress: progressFromStages(mergedStages),
			error: pollingDetail.error ?? null
		};
	}

	/**
	 * Apply a single live event to current stages.
	 * Live events always apply — they are real-time and authoritative.
	 */
	applyWsEvent(currentStages: StageState[], msg: RunWsMessage): StageState[] {
		// Clone so we don't mutate in place (Svelte needs new array reference).
		const stages = currentStages.map((s) => ({ ...s }));

		const stageName = msg.stage_name ?? null;

		switch (msg.event) {
			case 'stage_started': {
				if (stageName) {
					const idx = stages.findIndex((s) => s.name === stageName);
					if (idx !== -1) {
						stages[idx] = { ...stages[idx], status: 'running', subStep: null };
					}
				}
				break;
			}
			case 'stage_completed': {
				if (stageName) {
					const idx = stages.findIndex((s) => s.name === stageName);
					if (idx !== -1) {
						stages[idx] = {
							...stages[idx],
							status: 'completed',
							durationMs: msg.duration_seconds
								? msg.duration_seconds * 1000
								: stages[idx].durationMs,
							artifactPrefix: `output/${stageName}`,
							subStep: null
						};
					}
				}
				break;
			}
			case 'stage_failed': {
				if (stageName) {
					const idx = stages.findIndex((s) => s.name === stageName);
					if (idx !== -1) {
						stages[idx] = { ...stages[idx], status: 'failed' };
					}
				}
				break;
			}
			// Terminal, and NOT 'completed' — a skipped stage produced no output, so
			// it must not get an artifactPrefix. `subStep` is cleared for the same
			// reason 'stage_completed' clears it: the stage is done, so a leftover
			// "scraping page 3" would keep rendering under a terminal badge.
			case 'stage_skipped': {
				if (stageName) {
					const idx = stages.findIndex((s) => s.name === stageName);
					if (idx !== -1) {
						stages[idx] = { ...stages[idx], status: 'skipped', subStep: null };
					}
				}
				break;
			}
			// Published only by the reconnect catch-up snapshot — cancellation is a
			// DB-level sweep (`bulk_cancel_non_terminal`) with no live publisher. A
			// stage that never ran; same no-artifact / no-subStep reasoning.
			case 'stage_cancelled': {
				if (stageName) {
					const idx = stages.findIndex((s) => s.name === stageName);
					if (idx !== -1) {
						stages[idx] = { ...stages[idx], status: 'cancelled', subStep: null };
					}
				}
				break;
			}
			// run_completed / run_cancelled are handled at the orchestrator level
			// (they update jobStatus, not individual stages — except run_failed may
			// mark a stage when stage_name is included).
			case 'run_failed': {
				if (stageName) {
					const idx = stages.findIndex((s) => s.name === stageName);
					if (idx !== -1) {
						stages[idx] = { ...stages[idx], status: 'failed' };
					}
				}
				break;
			}
		}

		return stages;
	}
}

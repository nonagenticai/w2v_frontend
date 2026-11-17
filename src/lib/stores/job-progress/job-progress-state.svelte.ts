// Thin orchestrator: reactive state + wires transports to reconciler.
// .svelte.ts — uses Svelte 5 runes.
//
// Studio v3: this class drives a single Run (formerly "pipeline job"). The
// public field `jobId` is preserved as the run identifier so consumers in
// $lib/components/jobs and src/routes do not have to be touched in the
// same PR; new code should prefer the alias `runId` (same value).

import type { RunDetail, RunStatus, RunStatusLite } from '$lib/types/runs';
import type {
	StageState,
	StageProgressStatus,
	ConnectionStatus,
	StreamMode,
	LogEntry,
	RunWsMessage
} from './types.js';
import { SseTransport } from './sse-transport.svelte.js';
import { SvelteDate } from 'svelte/reactivity';
import { PollingTransport } from './polling-transport.svelte.js';
import { StateReconciler, isStageStatus, progressFromStages } from './state-reconciler.js';
import { FlushScheduler } from './flush-scheduler.js';
import { failureMessage } from '$lib/utils/run-actions';

// Live events whose effect must reach the UI immediately (the status badge /
// e2e poll waits on these) — they bypass the rAF coalescing via flushNow().
const TERMINAL_EVENTS = new Set(['run_completed', 'run_failed', 'run_cancelled']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// Safety-net poll cadence while the live SSE stream is active. The stream +
// idle watchdog already deliver every status change, so this is a backstop for
// silently-dropped SSE — it can be slow. It now hits the lightweight
// /runs/{id}/status (flat payload), so even the fast fallback is cheap.
const POLL_SLOW_MS = 30_000;
const POLL_FAST_MS = 5_000; // fallback when live stream is down

export class JobProgressState {
	// -- Reactive state --
	/** Run id (kept under the historic name `jobId` for consumer compatibility). */
	readonly jobId: string;
	/** Alias of jobId — preferred name in new v3 code. */
	readonly runId: string;
	stages = $state<StageState[]>([]);
	currentStage = $state<string | null>(null);
	progress = $state(0);
	error = $state<string | null>(null);
	/** The orchestrator's structural failure_class, when the run detail carries
	 *  one. The live `run_failed` event does not, so it stays null until a
	 *  RunDetail is hydrated. */
	failureClass: string | null = null;
	jobStatus = $state<RunStatus>('pending');
	connectionStatus = $state<ConnectionStatus>('disconnected');
	streamMode = $state<StreamMode>('none');
	logs = $state<LogEntry[]>([]);
	outputUrl = $state<string | null>(null);
	/**
	 * HTTP status when the run became permanently unreachable mid-session
	 * (404 = belongs to another workspace / deleted; 401/403 = session lost).
	 * Non-null means: stop streaming, render an "unavailable" state instead of
	 * a "reconnect" affordance. Distinct from a transient `connectionStatus`
	 * drop, which is reconnectable.
	 */
	accessError = $state<number | null>(null);

	/**
	 * Optional consumer hook fired for every live event before this class's
	 * own switch updates state. The v1 channel forwarded a wider event set
	 * (verbatim_item_placed / lesson_completed / project_completed / …) into
	 * per-resource stores; the v3 /api/runs/{id}/events stream is currently
	 * limited to run + stage lifecycle events. The hook stays in place so
	 * that re-introducing those events on the run channel later is a
	 * one-line change in message-normalizer.ts.
	 */
	onExtraEvent: ((msg: RunWsMessage) => void) | null = null;

	// -- Derived --
	progressPercent = $derived(Math.round(this.progress * 100));

	completedCount = $derived(this.stages.filter((s) => s.status === 'completed').length);

	isTerminal = $derived(
		this.jobStatus === 'completed' || this.jobStatus === 'failed' || this.jobStatus === 'cancelled'
	);

	/** The run can't be loaded under the current session — show an error, not a retry. */
	unavailable = $derived(this.accessError !== null);

	// -- Private --
	private sseTransport: SseTransport | null = null;
	private pollTransport: PollingTransport | null = null;
	private reconciler = new StateReconciler();

	// --- Live-event coalescing ---
	// Incoming SSE/poll updates are buffered and applied in a single flush per
	// animation frame so a burst of events can't chain back-to-back renders into
	// a main-thread wedge. Terminal events flush synchronously (badge must be
	// immediate). See flush-scheduler.ts.
	private pendingMsgs: RunWsMessage[] = [];
	private pendingPoll: RunStatusLite | null = null;
	private readonly scheduler = new FlushScheduler(() => this.flushPending());

	// --- Activity-log de-duplication across SSE (re)connects ---
	// Every (re)connect of `GET /runs/{id}/events` replays a catch-up snapshot
	// (orchestrator `api/routes/runs/events.py::_build_run_event_snapshot`):
	// `run_started`, then `stage_started` + the terminal stage event for EVERY
	// non-pending stage, then the run's terminal/paused event. Without a guard the
	// whole history re-appeared in the log, stamped with the reconnect second.
	//
	// Lifecycle facts are NOT one-shot: a stage re-runs inside the same run
	// (dag_executor timeout-resume / `max_stage_attempts`; pause mid-stage then
	// resume re-runs it and re-publishes `run_started`). So a LIVE event is always
	// logged, however many times its (event, stage) was seen before. Suppression
	// is scoped to the snapshot only:
	//   1. `replay: true` (orchestrator marker on snapshot frames) → never logged.
	//   2. Servers without the marker: a frame that ARRIVES within
	//      CATCH_UP_WINDOW_MS of a stream (re)open AND restates an (event, stage)
	//      already in the log (or proven by the loader) is treated as snapshot.
	//      Once a server has sent `replay: true`, rule 2 is off for good.
	// State still applies from every frame; only the LOG line is suppressed.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a non-reactive ledger is intended; nothing renders it.
	private readonly seenLifecycle = new Set<string>();
	/** Frames that arrived inside a catch-up window (tagged at arrival, not at flush). */
	private readonly catchUpMsgs = new WeakSet<RunWsMessage>();
	/** `Date.now()` of the latest stream open; null before the first open. */
	private streamOpenedAt: number | null = null;
	/** The server marks snapshot frames itself — the arrival-window heuristic is not needed. */
	private serverMarksReplay = false;

	/** Whether a lifecycle event earns an Activity-Log line (see the ledger above). */
	private shouldLog(msg: RunWsMessage): boolean {
		if (msg.replay === true) {
			this.serverMarksReplay = true;
			return false;
		}
		const key = lifecycleKey(msg.event, msg.stage_name);
		const restatement =
			!this.serverMarksReplay && this.catchUpMsgs.has(msg) && this.seenLifecycle.has(key);
		this.seenLifecycle.add(key);
		return !restatement;
	}

	constructor(runId: string) {
		this.runId = runId;
		this.jobId = runId;
		// Start empty — hydrateFromDetail() populates with actual stages from the API,
		// avoiding a flicker where stages appear then shrink to the active subset.
		this.stages = [];
	}

	// -- Hydrate from REST API response (initial load — no reconciler) --

	hydrateFromDetail(detail: RunDetail): void {
		this.jobStatus = detail.status;
		this.currentStage = detail.current_stage;
		this.error = detail.error ?? null;
		this.failureClass = detail.failure_class ?? null;

		const stageOutputs = detail.stage_outputs ?? [];

		if (stageOutputs.length > 0) {
			this.stages = stageOutputs.map((s) => {
				const status: StageProgressStatus = isStageStatus(s.status) ? s.status : 'pending';
				return {
					name: s.stage_name,
					status,
					durationMs: durationMs(s.started_at, s.completed_at),
					artifactPrefix: status === 'completed' ? `output/${s.stage_name}` : null,
					subStep: null
				};
			});
		} else if (this.stages.length === 0) {
			// Brand-new run: BE has not yet seeded stage_outputs. The reconciler
			// will fill the list on the first poll/event.
			this.stages = [];
		}

		// RunDetail no longer ships progress_pct — derive from stages.
		this.progress = computeProgress(this.stages);

		// Seed the ledger with what the loader snapshot already proves, so the FIRST
		// connect's catch-up replay does not log "Run started" / "Stage X started" at
		// page-open time for history that already happened. Only frames inside the
		// catch-up window consult it; live events log regardless.
		const seen = (event: string, stage?: string | null) =>
			this.seenLifecycle.add(lifecycleKey(event, stage));
		if (detail.status !== 'pending') seen('run_started');
		if (detail.status === 'paused' && detail.current_stage) {
			seen('run_paused', detail.current_stage);
		}
		for (const s of stageOutputs) {
			if (s.status === 'pending') continue;
			seen('stage_started', s.stage_name);
			if (s.status !== 'running') seen(`stage_${s.status}`, s.stage_name);
		}

		// Generate synthetic log entries from stage_outputs on first load.
		if (this.logs.length === 0 && stageOutputs.length > 0) {
			const fallbackTime = detail.created_at ?? new SvelteDate().toISOString();
			const synthLogs: LogEntry[] = [];
			for (const stage of stageOutputs) {
				if (stage.status === 'completed') {
					const dMs = durationMs(stage.started_at, stage.completed_at);
					const dStr = dMs != null ? ` in ${(dMs / 1000).toFixed(1)}s` : '';
					synthLogs.push({
						timestamp: stage.completed_at ?? stage.started_at ?? fallbackTime,
						level: 'info',
						message: `Stage "${stage.stage_name}" completed${dStr}`,
						stage: stage.stage_name
					});
				} else if (stage.status === 'running') {
					synthLogs.push({
						timestamp: stage.started_at ?? fallbackTime,
						level: 'info',
						message: `Stage "${stage.stage_name}" running...`,
						stage: stage.stage_name
					});
				} else if (stage.status === 'failed' && stage.error) {
					synthLogs.push({
						timestamp: stage.completed_at ?? stage.started_at ?? fallbackTime,
						level: 'error',
						message: `Stage "${stage.stage_name}" failed: ${stage.error}`,
						stage: stage.stage_name
					});
				}
			}
			if (detail.error) {
				// The run fails AFTER its last stage does, so stamp it with the run's
				// own end time (or the latest stage end) — never created_at, which put
				// "Run failed" before the stage failure that caused it.
				const latestStageEnd = stageOutputs
					.map((s) => s.completed_at)
					.filter((t): t is string => !!t)
					.sort()
					.at(-1);
				synthLogs.push({
					timestamp: detail.completed_at ?? latestStageEnd ?? fallbackTime,
					level: 'error',
					message: this.runFailedLogMessage(detail.current_stage),
					stage: detail.current_stage ?? undefined
				});
			}
			this.logs = synthLogs;
			if (this.logs.length > 500) this.logs = this.logs.slice(-500);
		}
	}

	// -- Connect: starts live stream + slow polling safety net --

	connect(): void {
		if (this.isTerminal) return;

		// Idempotent: dispose any pre-existing transport so we don't end up
		// with two transports forwarding to the same handleWsMessage
		// (duplicate logs / duplicate stage updates / phantom reconnect timers
		// held alive by the orphaned transport's onclose closure).
		this.sseTransport?.disconnect();
		this.sseTransport = null;

		// SSE-first: open the run-event SSE immediately and let polling sit
		// behind it as the safety net.
		this.startSseFallback();
		this.syncConnectionState();

		// Start slow polling alongside the live stream
		this.startPolling(POLL_SLOW_MS);
	}

	disconnect(): void {
		// Drop any buffered live updates and cancel the pending coalesced flush —
		// the stream is going away (terminal state already applied synchronously,
		// or the page is unmounting).
		this.scheduler.cancel();
		this.pendingMsgs = [];
		this.pendingPoll = null;
		this.sseTransport?.disconnect();
		this.sseTransport = null;
		this.stopPolling();
		this.connectionStatus = 'disconnected';
		this.streamMode = 'none';
	}

	// -- Polling (public API preserved for backward compat) --

	startPolling(intervalMs = POLL_FAST_MS): void {
		this.stopPolling();
		this.pollTransport = new PollingTransport(
			this.runId,
			(detail) => this.handlePollData(detail),
			(status) => this.handlePermanentError(status)
		);
		this.pollTransport.start(intervalMs);
		this.syncConnectionState();
	}

	/**
	 * Re-check the server NOW instead of waiting for the next safety-net tick.
	 * For the moments a page is most likely to be stale: the tab becoming
	 * visible again (background tabs throttle timers and the stream may have
	 * been dropped while the laptop slept) or the network coming back. No-op on
	 * a terminal run. If the transports are gone while the run is still live
	 * (they never should be), they are re-opened.
	 */
	resync(): void {
		if (this.isTerminal || this.accessError !== null) return;
		if (this.jobStatus !== 'running' && this.jobStatus !== 'pending') return;
		if (!this.pollTransport) {
			this.connect();
			return;
		}
		void this.pollTransport.pollNow();
	}

	stopPolling(): void {
		this.pollTransport?.stop();
		this.pollTransport = null;
		this.syncConnectionState();
	}

	// -- Private: live event handling --

	// Transport entry point: buffer the event and coalesce the reactive flush to
	// one per frame. Terminal events flush immediately so the badge is instant.
	private handleWsMessage(msg: RunWsMessage): void {
		if (this.streamOpenedAt !== null && Date.now() - this.streamOpenedAt <= CATCH_UP_WINDOW_MS) {
			this.catchUpMsgs.add(msg);
		}
		this.pendingMsgs.push(msg);
		if (TERMINAL_EVENTS.has(msg.event)) this.scheduler.flushNow();
		else this.scheduler.request();
	}

	// Polling entry point: keep only the latest snapshot (older ones are
	// superseded) and coalesce; a terminal status flushes immediately.
	private handlePollData(detail: RunStatusLite): void {
		this.pendingPoll = detail;
		if (TERMINAL_STATUSES.has(detail.status)) this.scheduler.flushNow();
		else this.scheduler.request();
	}

	// Drain all buffered events + the latest poll snapshot in one synchronous
	// pass → Svelte batches every mutation into a single render.
	private flushPending(): void {
		const msgs = this.pendingMsgs;
		const poll = this.pendingPoll;
		this.pendingMsgs = [];
		this.pendingPoll = null;
		for (const msg of msgs) this.applyWsMessage(msg);
		// The poll snapshot is applied AFTER the buffered events, but it may be
		// OLDER than them: it is buffered until the next frame, and a hidden tab
		// runs no frames, so a 30s-old "running" snapshot can sit here while the
		// live stream delivers every later stage event and then `run_completed`.
		// Applying it last used to roll the finished run back to the snapshot's
		// "running · 81%" — after `run_completed` had already torn down every
		// transport, so nothing ever corrected it (run 01a17e6f, 2026-10-27).
		// `applyPollData`'s terminal latch drops it; a terminal snapshot still
		// applies.
		if (poll) this.applyPollData(poll);
	}

	private applyWsMessage(msg: RunWsMessage): void {
		this.syncConnectionState();

		// Terminal latch. Once the run is completed/failed/cancelled, no
		// non-terminal live input may move it back (a late or out-of-order
		// `stage_started` used to flip the badge to "running" again). Restarting a
		// terminal run always spawns a NEW run id — and therefore a new instance —
		// so nothing legitimate ever needs to leave a terminal state here.
		if (this.isTerminal && !TERMINAL_EVENTS.has(msg.event)) return;

		// Forward to the consumer hook first so external stores see every
		// message, including ones the switch below doesn't recognise.
		this.onExtraEvent?.(msg);

		const now = msg.timestamp ?? new SvelteDate().toISOString();

		// Apply stage changes through the reconciler, but only commit a new array
		// reference (which forces a re-render of the whole stage list) when a stage
		// actually changed. An SSE reconnect replays the full event history, so
		// most replayed events are no-ops — committing them anyway re-rendered the
		// run page on every replayed event, the exact churn that pegged the
		// renderer on a CPU-starved CI runner.
		const nextStages = this.reconciler.applyWsEvent(this.stages, msg);
		if (!stagesEqual(this.stages, nextStages)) {
			this.stages = nextStages;
			this.progress = computeProgress(nextStages);
		}

		// Handle run-level state + logs
		switch (msg.event) {
			case 'run_started': {
				this.jobStatus = 'running';
				if (this.shouldLog(msg)) this.addLog('info', 'Run started', undefined, now);
				break;
			}
			case 'stage_started': {
				if (msg.stage_name) {
					this.currentStage = msg.stage_name;
					this.jobStatus = 'running';
					if (this.shouldLog(msg)) {
						this.addLog('info', `Stage "${msg.stage_name}" started`, msg.stage_name, now);
					}
				}
				break;
			}
			case 'stage_completed': {
				if (msg.stage_name && this.shouldLog(msg)) {
					const durStr = msg.duration_seconds ? ` in ${msg.duration_seconds.toFixed(1)}s` : '';
					this.addLog('info', `Stage "${msg.stage_name}" completed${durStr}`, msg.stage_name, now);
				}
				break;
			}
			case 'stage_failed': {
				if (msg.stage_name && this.shouldLog(msg)) {
					this.addLog(
						'error',
						`Stage "${msg.stage_name}" failed: ${msg.error ?? 'Unknown error'}`,
						msg.stage_name,
						now
					);
				}
				break;
			}
			// The skip REASON is the only account the run gives of why a stage
			// produced nothing (`dag_executor` emits it under `reason`, not
			// `error`). Without this line the badge flipped to 'skipped' with no
			// explanation anywhere in the UI.
			case 'stage_skipped': {
				if (msg.stage_name && this.shouldLog(msg)) {
					this.addLog(
						'warn',
						`Stage "${msg.stage_name}" skipped: ${msg.reason ?? 'no reason given'}`,
						msg.stage_name,
						now
					);
				}
				break;
			}
			case 'stage_cancelled': {
				if (msg.stage_name && this.shouldLog(msg)) {
					const why = msg.error ? `: ${msg.error}` : '';
					this.addLog('warn', `Stage "${msg.stage_name}" cancelled${why}`, msg.stage_name, now);
				}
				break;
			}
			case 'run_paused': {
				this.jobStatus = 'paused';
				// The BE names the checkpoint that tripped the gate on this event.
				// Adopt it: otherwise currentStage keeps whatever `stage_started`
				// fired last — which, for a concurrent wave, can be a sibling that
				// skipped — until the next safety-net poll (up to 30s of the pause
				// banner pointing at the wrong stage).
				if (msg.stage_name) this.currentStage = msg.stage_name;
				if (this.shouldLog(msg)) {
					this.addLog('info', 'Run paused', msg.stage_name ?? undefined, now);
				}
				break;
			}
			case 'run_completed': {
				this.jobStatus = 'completed';
				this.progress = 1;
				this.addLog('info', 'Run completed successfully', undefined, now);
				this.disconnect();
				break;
			}
			case 'run_failed': {
				this.jobStatus = 'failed';
				this.error = msg.error ?? 'Unknown error';
				this.addLog(
					'error',
					this.runFailedLogMessage(msg.stage_name),
					msg.stage_name ?? undefined,
					now
				);
				this.disconnect();
				break;
			}
			case 'run_cancelled': {
				this.jobStatus = 'cancelled';
				this.addLog('warn', 'Run cancelled', undefined, now);
				this.disconnect();
				break;
			}
		}
	}

	/**
	 * The person-facing "Run failed" line. Routed through the failure_class
	 * mapping (run-actions.ts) — never the raw error, which is an exception dump
	 * carrying internal service URLs and exception class names. The raw text
	 * stays on `this.error` for the run page's redacted technical-details view.
	 */
	private runFailedLogMessage(stage: string | null | undefined): string {
		return `Run failed: ${failureMessage(this.failureClass, stage).title}`;
	}

	// -- Private: Polling data handling --

	private applyPollData(detail: RunStatusLite): void {
		// Terminal latch (see applyWsMessage): a non-terminal snapshot is stale
		// once the run is known to be finished.
		if (this.isTerminal && !TERMINAL_STATUSES.has(detail.status)) return;
		const wsConnected = this.sseTransport?.connectionStatus === 'connected';
		const lastWsEventTime = this.sseTransport?.lastEventTime ?? 0;

		const merged = this.reconciler.mergePollingData(
			this.stages,
			detail,
			wsConnected,
			lastWsEventTime
		);

		// Only commit changed fields. The safety-net poll fires every 30s (5s when
		// the live stream is down) and usually returns an UNCHANGED snapshot
		// mid-stage; committing a fresh stages array each time forced a full
		// re-render on every poll for nothing. Assigning an equal primitive to a
		// rune is already a no-op, but the stages array is a new reference each
		// poll, so it needs an explicit equality guard.
		if (!stagesEqual(this.stages, merged.stages)) this.stages = merged.stages;
		if (this.jobStatus !== merged.jobStatus) this.jobStatus = merged.jobStatus;
		if (this.currentStage !== merged.currentStage) this.currentStage = merged.currentStage;
		if (this.progress !== merged.progress) this.progress = merged.progress;
		if (this.error !== merged.error) this.error = merged.error;

		if (this.isTerminal) {
			this.stopPolling();
		}
	}

	// -- Private: live stream (SSE) lifecycle --

	private startSseFallback(): void {
		if (this.isTerminal || this.sseTransport) return;
		this.sseTransport = new SseTransport(this.runId, (msg) => this.handleWsMessage(msg), {
			onConnect: () => this.handleSseConnect(),
			onDisconnect: () => this.handleSseDisconnect(),
			onReconnect: () => this.handleSseReconnect(),
			onPermanentError: (status) => this.handlePermanentError(status)
		});
		this.sseTransport.connect();
	}

	// -- Private: permanent (non-reconnectable) failure --

	private handlePermanentError(status: number): void {
		// Either transport can report this; only act on the first.
		if (this.accessError !== null) return;
		// Tear down every transport + poll timer (disconnect() resets
		// connectionStatus to 'disconnected'), then mark 'failed' so the UI
		// renders the unavailable state rather than a reconnect affordance.
		this.disconnect();
		this.accessError = status;
		this.connectionStatus = 'failed';
		this.addLog(
			'error',
			`Live updates unavailable (HTTP ${status}) — this run may belong to a different workspace.`
		);
	}

	private handleSseConnect(): void {
		this.streamOpenedAt = Date.now();
		this.syncConnectionState();
		this.addLog('info', 'SSE stream connected');
	}

	private handleSseReconnect(): void {
		this.streamOpenedAt = Date.now();
		this.syncConnectionState();
		this.addLog('info', 'SSE stream reconnected');
	}

	private handleSseDisconnect(): void {
		this.syncConnectionState();
		this.addLog('warn', 'SSE stream disconnected');
	}

	private syncConnectionState(): void {
		const sseStatus = this.sseTransport?.connectionStatus ?? 'disconnected';

		if (sseStatus === 'connected') {
			this.connectionStatus = 'connected';
			this.streamMode = 'sse';
			return;
		}

		if (sseStatus === 'connecting') {
			this.connectionStatus = 'connecting';
			this.streamMode = 'polling';
			return;
		}

		if (sseStatus === 'failed') {
			this.connectionStatus = 'failed';
			this.streamMode = this.pollTransport ? 'polling' : 'none';
			return;
		}

		this.connectionStatus = 'disconnected';
		this.streamMode = this.pollTransport ? 'polling' : 'none';
	}

	// -- Private: Log helper --

	private addLog(
		level: LogEntry['level'],
		message: string,
		stage?: string,
		timestamp?: string
	): void {
		// Collapse immediately-consecutive identical entries. A run that pauses
		// and resumes re-emits "Run started" (and an SSE reconnect can replay a
		// burst of identical stage lines); appending each verbatim spammed the
		// Activity Log with repeats that carry no new information.
		const last = this.logs[this.logs.length - 1];
		if (last && last.level === level && last.message === message && last.stage === stage) {
			return;
		}
		this.logs = [
			...this.logs,
			{ timestamp: timestamp ?? new SvelteDate().toISOString(), level, message, stage }
		];
		if (this.logs.length > 500) this.logs = this.logs.slice(-500);
	}
}

// ---- File-scoped helpers ----

/** How long after a stream (re)open an unmarked frame may be a catch-up snapshot restatement. */
const CATCH_UP_WINDOW_MS = 1500;

function lifecycleKey(event: string, stage?: string | null): string {
	return `${event}|${stage ?? ''}`;
}

function durationMs(startedAt: string | null, completedAt: string | null): number | null {
	if (!startedAt || !completedAt) return null;
	const start = Date.parse(startedAt);
	const end = Date.parse(completedAt);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	const delta = end - start;
	return delta >= 0 ? delta : null;
}

// Cheap structural compare of the stage list so an unchanged reconciler result
// (replayed SSE event / idle poll) doesn't commit a new array reference and
// force a re-render. Compares only the fields the UI renders.
function stagesEqual(a: StageState[], b: StageState[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (
			x.name !== y.name ||
			x.status !== y.status ||
			x.durationMs !== y.durationMs ||
			x.artifactPrefix !== y.artifactPrefix ||
			x.subStep !== y.subStep
		) {
			return false;
		}
	}
	return true;
}

// Progress lives in ONE place — state-reconciler.progressFromStages() — so the
// poll-merge path and this class can never disagree about which statuses count
// as done (they did: 'cancelled' had to be added twice).
const computeProgress = progressFromStages;

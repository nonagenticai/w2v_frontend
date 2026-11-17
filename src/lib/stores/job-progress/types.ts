// Shared types for the job-progress module.
// Plain .ts file — no runes allowed here.
//
// Studio v3 (PR #43): the orchestrator emits per-run events on
// GET /api/runs/{id}/events (see $lib/stores/run-events.ts) — this module's
// transports decode those into RunWsMessage and let the reconciler advance
// the StageState[] view. The wire shape (event/run_id/stage_name/timestamp)
// matches RunEvent in $lib/types/runs exactly; this internal type extends
// it with optional convenience fields (duration_seconds, error, current_stage)
// so the reconciler can promote SSE deltas without re-fetching detail.

import type { RunStatus, RunEventName } from '$lib/types/runs';

// 'cancelled' — orchestrator PR #706: stages stranded pending/running when a run
// hard-fails are swept to a terminal 'cancelled' (they never ran).
export type StageProgressStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'skipped'
	| 'cancelled';

export interface StageState {
	/** Free-form stage name. Studio v3 stages are blueprint-driven; the FE no
	 * longer pins to a static stage enum because every blueprint defines its
	 * own ordered set. */
	name: string;
	status: StageProgressStatus;
	durationMs: number | null;
	artifactPrefix: string | null;
	subStep: string | null;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';
export type StreamMode = 'none' | 'ws' | 'sse' | 'polling';

export interface LogEntry {
	timestamp: string;
	level: 'info' | 'warn' | 'error';
	message: string;
	stage?: string;
}

/**
 * Internal envelope passed from transports → orchestrator → reconciler.
 *
 * Wire shape mirrors RunEvent (snake_case run_id / stage_name) so the SSE
 * transport can pass parsed events through with minimal massaging. The
 * optional fields (duration_seconds, error, current_stage, progress_pct)
 * are populated when the BE includes them in `data` — see
 * src/api/schemas.py::RunEvent.
 */
export interface RunWsMessage {
	// `stage_skipped` / `stage_cancelled` are in the orchestrator's RunEventName
	// (src/api/schemas/_shared.py) but not yet in the hand-written FE mirror in
	// $lib/types/runs — widen here so this module stays honest about the wire
	// while that mirror is updated separately (it is shared with run-events.ts).
	event: RunEventName | 'stage_skipped' | 'stage_cancelled';
	run_id: string;
	stage_name?: string | null;
	status?: RunStatus | null;
	timestamp?: string;
	duration_seconds?: number | null;
	error?: string | null;
	progress_pct?: number | null;
	current_stage?: string | null;
	data?: Record<string, unknown> | null;
	/** Why a stage was skipped. `stage_skipped` carries `reason` (not `error`) —
	 *  it mirrors the live publish site `dag_executor.emit("stage_skipped",
	 *  stage_name=…, reason=…)`, and the catch-up snapshot replays the persisted
	 *  reason under the same key. It is the only explanation the run offers. */
	reason?: string | null;
	/** Set by the orchestrator on catch-up snapshot frames replayed on (re)connect:
	 *  the event restates current state rather than reporting a transition now.
	 *  Consumers apply its state but must not announce it (no log line). */
	replay?: boolean | null;
}

// Run / Stage / SSE types — wire-aligned (snake_case) to BE
// `src/api/schemas.py`. REST shapes are re-exported from the auto-generated
// openapi types so the wire contract is the single source of truth.
//
// SSE-only types (RunEvent, RunEventName) stay hand-written because the
// per-run event stream is not modelled as an OpenAPI response — the
// `/api/runs/{id}/events` route returns `EventSourceResponse`. They mirror
// `RunEvent` / `RunEventName` in `src/api/schemas.py` exactly (snake_case).

import type { components } from '$lib/api/types.gen';

type Schemas = components['schemas'];

export type RunSummary = Schemas['RunSummary'];
export type RunDetail = Schemas['RunDetail'];
export type RunStart = Schemas['RunStart'];
export type StageOutputResponse = Schemas['StageOutputResponse'];
export type RunUsageResponse = Schemas['RunUsageResponse'];
export type RunUsageTotal = Schemas['RunUsageTotal'];

export type RunStatus = RunSummary['status'];
export type StageOutputStatus = StageOutputResponse['status'];

// Lightweight live-status poll shape — GET /api/runs/{id}/status. The
// run-monitor's safety-net poll uses this instead of the full RunDetail so the
// payload doesn't grow (and saturate the browser main thread) as stages complete
// on long multi-stage runs. Re-exported from the generated openapi types so the
// wire contract stays the single source of truth.
export type StageStatusLite = Schemas['StageStatusLite'];
export type RunStatusLite = Schemas['RunStatusLite'];

export type RunEventName =
	| 'stage_started'
	| 'stage_completed'
	| 'stage_failed'
	// Both are NAMED frames the orchestrator really emits — `stage_skipped` live
	// from dag_executor.py:170 (with a `reason`), and both from runs/events.py
	// on the reconnect catch-up replay. They are in the backend's own
	// `RunEventName` (src/api/schemas/_shared.py); omitting them here is what let
	// two hand-copied listener lists drop them on the floor.
	| 'stage_skipped'
	| 'stage_cancelled'
	| 'run_started'
	| 'run_paused'
	| 'run_completed'
	| 'run_failed'
	| 'run_cancelled';

export interface RunEvent {
	event: RunEventName;
	run_id: string;
	stage_name: string | null;
	status: RunStatus | null;
	timestamp: string;
	data: Record<string, unknown>;
	/** Top-level on a `stage_skipped` frame (routes/runs/events.py:71-74) — the
	 *  human reason the DAG skipped the stage. Deliberately NOT inside `data`,
	 *  and deliberately `reason` not `error`: it mirrors the live publish site
	 *  `dag_executor.emit("stage_skipped", …, reason=…)`. */
	reason?: string;
}

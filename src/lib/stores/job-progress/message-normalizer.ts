import type { RunWsMessage } from './types.js';

// Module-level counter incremented every time normalizeRunMessage rejects a
// payload (unrecognised event, missing run_id, malformed shape). Exposed so
// operators can spot upstream shape-drift in production without enabling
// verbose console logging. Read via getDroppedEventCount().
let droppedEventCount = 0;

export function getDroppedEventCount(): number {
	return droppedEventCount;
}

// Allow-list of events that flow through the run event channel. Must stay in
// sync with RunEventName in $lib/types/runs — anything not listed here is
// silently dropped by normalizeRunMessage and never reaches
// JobProgressState.handleWsMessage / onExtraEvent.
//
// Studio v3 cleanup (B.2): the v1 pipeline channel emitted a much wider
// surface (annotation_*, verbatim_item_*, lesson_completed,
// curriculum_design_completed, deliverable_completed, project_completed,
// stage_paused_for_review). Those events have not yet been re-wired onto
// the v3 /api/runs/{id}/events stream. Consumers (annotation list,
// verbatim placement indicators) currently rely on resource-scoped SSE
// (projects-events.ts, annotations.svelte.ts) and on polling — not on
// JobProgressState.onExtraEvent. If/when the orchestrator restores those
// events on the run channel, extend RUN_EVENTS + RunEventName together.
//
// `stage_skipped` / `stage_cancelled` complete the terminal-stage vocabulary.
// The orchestrator publishes `stage_skipped` live (dag_executor._run_stage)
// and both of them on the reconnect catch-up snapshot
// (runs/events.py::_stage_terminal_event), so a stage that skipped or was
// swept to cancelled reaches a terminal badge instead of sitting on
// running/pending until the 30s safety-net poll.
//
// `state_sync` was removed: the orchestrator has NO emitter for it anywhere in
// `src/` (verified against origin/main), and the job it was invented for —
// bringing a reconnecting client up to date — is done properly by the catch-up
// snapshot, which replays real `run_started` / `stage_*` / terminal `run_*`
// events. Keeping it meant a branch in three files that could never fire.
export const RUN_EVENTS = new Set([
	'run_started',
	'run_paused',
	'run_completed',
	'run_failed',
	'run_cancelled',
	'stage_started',
	'stage_completed',
	'stage_failed',
	'stage_skipped',
	'stage_cancelled'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeRunMessage(raw: unknown): RunWsMessage | null {
	if (!isRecord(raw)) {
		droppedEventCount++;
		if (import.meta.env.DEV) console.warn('SSE/WS event dropped (not a record):', raw);
		return null;
	}

	// RunEvent puts the per-event payload under `data`; fall back to `payload`
	// for transport oddities or future shape drift.
	const data = isRecord(raw.data) ? raw.data : null;
	const payload = isRecord(raw.payload) ? raw.payload : null;
	const merged = {
		...(payload ?? {}),
		...(data ?? {}),
		...raw
	};

	const eventName =
		typeof merged.event === 'string'
			? merged.event
			: typeof raw.type === 'string'
				? raw.type
				: null;
	if (!eventName || !RUN_EVENTS.has(eventName)) {
		droppedEventCount++;
		if (import.meta.env.DEV) {
			console.warn('SSE/WS event dropped (unrecognised event name):', eventName, raw);
		}
		return null;
	}

	const runId = typeof merged.run_id === 'string' ? merged.run_id : null;
	if (!runId) {
		droppedEventCount++;
		if (import.meta.env.DEV) console.warn('SSE/WS event dropped (no run_id):', raw);
		return null;
	}

	return {
		...(merged as unknown as RunWsMessage),
		event: eventName as RunWsMessage['event'],
		run_id: runId
	};
}

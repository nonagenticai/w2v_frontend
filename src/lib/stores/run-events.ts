// Per-run SSE subscription. Subscribes to GET /api/runs/{id}/events and
// dispatches every named RunEvent ("stage_started", "stage_completed",
// "stage_failed", "run_started", "run_completed", "run_failed",
// "run_cancelled", "run_paused") to the supplied callback.
//
// Auth: cookie/Keycloak pattern. Reconnect + connection-status reporting
// come from $lib/stores/sse-subscription (shared with projects-events).

import type { RunEvent, RunEventName } from '$lib/types/runs';
import { subscribeSse, type SseConnectionStatus } from './sse-subscription.js';

export interface RunEventsHandle {
	close(): void;
}

const EVENT_NAMES: RunEventName[] = [
	'stage_started',
	'stage_completed',
	'stage_failed',
	'stage_skipped',
	'stage_cancelled',
	'run_started',
	'run_paused',
	'run_completed',
	'run_failed',
	'run_cancelled'
];

function parseEvent(event: MessageEvent<string>): RunEvent | null {
	const data = event.data;
	if (typeof data !== 'string') return null;
	try {
		return JSON.parse(data) as RunEvent;
	} catch (err) {
		// A malformed SSE frame is dropped, but during a hung run a silent drop
		// looks identical to "no progress" — surface it in dev for debugging.
		if (import.meta.env.DEV) console.warn('Dropped unparseable run event:', err);
		return null;
	}
}

export function subscribeRunEvents(
	runId: string,
	onEvent: (event: RunEvent) => void,
	onStatusChange?: (status: SseConnectionStatus) => void
): RunEventsHandle {
	const dispatch = (event: MessageEvent<string>) => {
		const parsed = parseEvent(event);
		if (parsed) onEvent(parsed);
	};
	const listeners: Record<string, (event: MessageEvent<string>) => void> = {};
	for (const name of EVENT_NAMES) {
		listeners[name] = dispatch;
	}

	return subscribeSse({
		url: `/api/runs/${runId}/events`,
		listeners,
		onStatusChange
	});
}

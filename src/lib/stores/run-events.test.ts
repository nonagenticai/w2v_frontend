import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscribeRunEvents } from './run-events.js';
import type { RunEvent } from '$lib/types/runs';

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
	url: string;
	listeners: Record<string, Listener[]> = {};
	closed = false;

	constructor(url: string) {
		this.url = url;
		FakeEventSource.lastInstance = this;
	}

	addEventListener(name: string, listener: Listener): void {
		(this.listeners[name] ??= []).push(listener);
	}

	close(): void {
		this.closed = true;
	}

	dispatch(name: string, data: unknown): void {
		const event = { data: JSON.stringify(data) } as MessageEvent<string>;
		for (const listener of this.listeners[name] ?? []) listener(event);
	}

	static lastInstance: FakeEventSource | null = null;
}

const realEventSource = globalThis.EventSource;

beforeEach(() => {
	(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
	FakeEventSource.lastInstance = null;
});

afterEach(() => {
	(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = realEventSource;
});

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const NOW = '2026-05-09T00:00:00Z';

describe('subscribeRunEvents', () => {
	it('subscribes to /api/runs/{id}/events', () => {
		const handle = subscribeRunEvents(RUN_ID, () => {});
		expect(FakeEventSource.lastInstance?.url).toBe(`/api/runs/${RUN_ID}/events`);
		handle.close();
	});

	it('forwards each named event to the callback parsed as RunEvent', () => {
		const seen: RunEvent[] = [];
		const handle = subscribeRunEvents(RUN_ID, (e) => seen.push(e));
		const es = FakeEventSource.lastInstance!;

		const started: RunEvent = {
			event: 'stage_started',
			run_id: RUN_ID,
			stage_name: 'brief_intake',
			status: null,
			timestamp: NOW,
			data: {}
		};
		es.dispatch('stage_started', started);

		const completed: RunEvent = {
			event: 'run_completed',
			run_id: RUN_ID,
			stage_name: null,
			status: 'completed',
			timestamp: NOW,
			data: {}
		};
		es.dispatch('run_completed', completed);

		expect(seen).toEqual([started, completed]);
		handle.close();
		expect(es.closed).toBe(true);
	});

	it('ignores non-JSON payloads silently', () => {
		const seen: RunEvent[] = [];
		const handle = subscribeRunEvents(RUN_ID, (e) => seen.push(e));
		const es = FakeEventSource.lastInstance!;

		// Manually emit a malformed payload (bypass JSON.stringify in dispatch).
		const event = { data: 'not-json' } as MessageEvent<string>;
		for (const l of es.listeners.stage_started ?? []) l(event);

		expect(seen).toHaveLength(0);
		handle.close();
	});

	// `stage_skipped` / `stage_cancelled` are real NAMED frames the orchestrator
	// emits (dag_executor.py:170 live, runs/events.py:66-79 on the reconnect
	// catch-up replay). `EVENT_NAMES` here is a SECOND hand-copied mirror of the
	// backend union — the same drift that dropped them on the job-progress path.
	it('forwards stage_skipped and stage_cancelled — both are named backend frames', () => {
		const seen: RunEvent[] = [];
		const handle = subscribeRunEvents(RUN_ID, (e) => seen.push(e));
		const es = FakeEventSource.lastInstance!;

		const skipped: RunEvent = {
			event: 'stage_skipped',
			run_id: RUN_ID,
			stage_name: 'narrate',
			status: null,
			timestamp: NOW,
			data: {},
			reason: 'no narration in the brief'
		};
		es.dispatch('stage_skipped', skipped);

		const cancelled: RunEvent = {
			event: 'stage_cancelled',
			run_id: RUN_ID,
			stage_name: 'render',
			status: null,
			timestamp: NOW,
			data: {}
		};
		es.dispatch('stage_cancelled', cancelled);

		expect(seen).toEqual([skipped, cancelled]);
		handle.close();
	});

	it('close() is idempotent', () => {
		const handle = subscribeRunEvents(RUN_ID, () => {});
		handle.close();
		handle.close();
		expect(FakeEventSource.lastInstance?.closed).toBe(true);
	});
});

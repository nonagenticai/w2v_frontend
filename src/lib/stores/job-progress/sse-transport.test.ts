import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return { ...actual, runs: { get: vi.fn() } };
});

import { runs, ApiError } from '$lib/api';
import { SseTransport } from './sse-transport.svelte.js';
import type { RunDetail } from '$lib/types/runs';

const getMock = vi.mocked(runs.get);

// Minimal EventSource stand-in: tests drive onerror + readyState directly.
class FakeEventSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static lastInstance: FakeEventSource | null = null;

	readyState = FakeEventSource.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((e: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	// Records addEventListener registrations so a test can assert WHICH named
	// events the transport subscribes to. A real EventSource fires `onmessage`
	// only for unnamed (`event: message`) frames, so a name missing from this
	// map is an event the app can never observe.
	listeners: Record<string, Array<(e: MessageEvent<string>) => void>> = {};

	constructor(public url: string) {
		FakeEventSource.lastInstance = this;
	}
	addEventListener(name: string, listener: (e: MessageEvent<string>) => void): void {
		(this.listeners[name] ??= []).push(listener);
	}
	close(): void {
		this.readyState = FakeEventSource.CLOSED;
	}
	/** JSON-stringify the payload and invoke each listener registered for `name`. */
	dispatch(name: string, data: unknown): void {
		const event = { data: JSON.stringify(data) } as MessageEvent<string>;
		for (const listener of this.listeners[name] ?? []) listener(event);
	}
	/** Simulate the browser closing the stream then firing onerror. */
	failClosed(): void {
		this.readyState = FakeEventSource.CLOSED;
		this.onerror?.();
	}
}

describe('SseTransport permanent-error classification', () => {
	const original = globalThis.EventSource;

	beforeEach(() => {
		getMock.mockReset();
		FakeEventSource.lastInstance = null;
		// @ts-expect-error — swap in the fake for the duration of the test.
		globalThis.EventSource = FakeEventSource;
	});

	afterEach(() => {
		globalThis.EventSource = original;
	});

	it('reports permanent + does not reconnect when the probe 404s', async () => {
		getMock.mockRejectedValue(new ApiError(404, 'Not Found', 'run not found'));
		const onPermanent = vi.fn();
		const t = new SseTransport('r1', vi.fn(), { onPermanentError: onPermanent });
		t.connect();

		// Stream never opened, then closes on first error → triggers classify probe.
		FakeEventSource.lastInstance!.failClosed();
		await vi.waitFor(() => expect(onPermanent).toHaveBeenCalledExactlyOnceWith(404));

		expect(t.connectionStatus).toBe('failed');
		t.disconnect();
	});

	it('does NOT report permanent when the probe succeeds (transient SSE drop)', async () => {
		getMock.mockResolvedValue({ id: 'r1', status: 'running' } as unknown as RunDetail);
		const onPermanent = vi.fn();
		const t = new SseTransport('r1', vi.fn(), { onPermanentError: onPermanent });
		t.connect();

		FakeEventSource.lastInstance!.failClosed();
		// Let the probe resolve and schedule a reconnect instead of failing.
		await vi.waitFor(() => expect(t.connectionStatus).toBe('connecting'));
		expect(onPermanent).not.toHaveBeenCalled();
		t.disconnect();
	});

	it('does NOT report permanent on a 500 probe (server error, retryable)', async () => {
		getMock.mockRejectedValue(new ApiError(500, 'x', 'boom'));
		const onPermanent = vi.fn();
		const t = new SseTransport('r1', vi.fn(), { onPermanentError: onPermanent });
		t.connect();

		FakeEventSource.lastInstance!.failClosed();
		await vi.waitFor(() => expect(getMock).toHaveBeenCalled());
		expect(onPermanent).not.toHaveBeenCalled();
		t.disconnect();
	});
});

// The orchestrator publishes `stage_skipped` (live, dag_executor) and
// `stage_cancelled` (reconnect catch-up snapshot) as NAMED SSE frames
// (`src/api/sse.py` yields `{"event": <name>, ...}`). EventSource fires
// `onmessage` ONLY for unnamed frames, so a name absent from attachHandlers'
// addEventListener list is silently unobservable — the badge stays on
// running/pending until the 30s safety-net poll, and a reconnect drops the
// replayed event all over again.
describe('SseTransport named-event subscriptions', () => {
	const original = globalThis.EventSource;
	const RUN_ID = 'r1';

	beforeEach(() => {
		getMock.mockReset();
		FakeEventSource.lastInstance = null;
		// @ts-expect-error — swap in the fake for the duration of the test.
		globalThis.EventSource = FakeEventSource;
	});

	afterEach(() => {
		globalThis.EventSource = original;
	});

	it('subscribes to every event name the orchestrator publishes', () => {
		const t = new SseTransport(RUN_ID, vi.fn());
		t.connect();
		const es = FakeEventSource.lastInstance!;
		for (const name of [
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
		]) {
			expect(es.listeners[name]?.length, `no listener for ${name}`).toBeGreaterThan(0);
		}
		t.disconnect();
	});

	it('delivers a named stage_skipped frame to the consumer with its reason', () => {
		const onMessage = vi.fn();
		const t = new SseTransport(RUN_ID, onMessage);
		t.connect();
		FakeEventSource.lastInstance!.dispatch('stage_skipped', {
			event: 'stage_skipped',
			run_id: RUN_ID,
			stage_name: 'demo_video_gen',
			reason: 'no footage captured'
		});
		expect(onMessage).toHaveBeenCalledTimes(1);
		expect(onMessage.mock.calls[0][0]).toMatchObject({
			event: 'stage_skipped',
			stage_name: 'demo_video_gen',
			reason: 'no footage captured'
		});
		t.disconnect();
	});

	it('delivers a named stage_cancelled frame to the consumer', () => {
		const onMessage = vi.fn();
		const t = new SseTransport(RUN_ID, onMessage);
		t.connect();
		FakeEventSource.lastInstance!.dispatch('stage_cancelled', {
			event: 'stage_cancelled',
			run_id: RUN_ID,
			stage_name: 'encode_master'
		});
		expect(onMessage).toHaveBeenCalledTimes(1);
		expect(onMessage.mock.calls[0][0]).toMatchObject({
			event: 'stage_cancelled',
			stage_name: 'encode_master'
		});
		t.disconnect();
	});
});

// The orchestrator heartbeat is a NAMED `ping` frame every ~15s of silence
// (`src/api/sse.py`). The transport never listened for it, so the idle watchdog
// (180s threshold) measured only RUN events: any stage that ran >3 min with
// nothing to report tore down a healthy stream every ~4 min and re-opened it,
// and every re-open replays the catch-up snapshot into the Activity Log.
describe('SseTransport heartbeat keeps a quiet-but-live stream open', () => {
	const original = globalThis.EventSource;

	beforeEach(() => {
		vi.useFakeTimers();
		FakeEventSource.lastInstance = null;
		// @ts-expect-error — swap in the fake for the duration of the test.
		globalThis.EventSource = FakeEventSource;
	});

	afterEach(() => {
		vi.useRealTimers();
		globalThis.EventSource = original;
	});

	it('does not idle-rebuild while pings keep arriving with no run events', () => {
		const onDisconnect = vi.fn();
		const t = new SseTransport('r1', vi.fn(), { onDisconnect });
		t.connect();
		const first = FakeEventSource.lastInstance!;
		first.readyState = FakeEventSource.OPEN;
		first.onopen?.();

		// Ten minutes of a long stage: the server says nothing but `ping`.
		for (let i = 0; i < 40; i++) {
			vi.advanceTimersByTime(15_000);
			first.dispatch('ping', {});
		}

		expect(FakeEventSource.lastInstance).toBe(first);
		expect(onDisconnect).not.toHaveBeenCalled();
		expect(t.connectionStatus).toBe('connected');
		t.disconnect();
	});

	it('still rebuilds a stream that delivers nothing at all (zombie)', () => {
		const onDisconnect = vi.fn();
		const t = new SseTransport('r1', vi.fn(), { onDisconnect });
		t.connect();
		const first = FakeEventSource.lastInstance!;
		first.onopen?.();

		vi.advanceTimersByTime(240_000);

		expect(FakeEventSource.lastInstance).not.toBe(first);
		expect(onDisconnect).toHaveBeenCalledTimes(1);
		t.disconnect();
	});
});

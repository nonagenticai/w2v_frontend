import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	subscribeSse,
	type SseConnectionStatus,
	type SseSubscriptionHandle
} from './sse-subscription.js';

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
	static OPEN = 1;
	static CLOSED = 2;

	url: string;
	readyState = FakeEventSource.OPEN;
	listeners: Record<string, Listener[]> = {};
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;

	static instances: FakeEventSource[] = [];

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
		queueMicrotask(() => this.onopen?.());
	}

	addEventListener(name: string, listener: Listener): void {
		(this.listeners[name] ??= []).push(listener);
	}

	close(): void {
		this.closed = true;
	}

	emit(name: string, data: unknown): void {
		const event = { data: JSON.stringify(data) } as MessageEvent<string>;
		for (const l of this.listeners[name] ?? []) l(event);
	}

	failPermanent(): void {
		this.readyState = FakeEventSource.CLOSED;
		this.onerror?.();
	}

	failTransient(): void {
		// Browser keeps readyState=OPEN/CONNECTING and retries internally.
		this.onerror?.();
	}
}

const realEventSource = globalThis.EventSource;

beforeEach(() => {
	(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
	FakeEventSource.instances = [];
	vi.useFakeTimers();
});

afterEach(() => {
	(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = realEventSource;
	vi.useRealTimers();
});

describe('subscribeSse', () => {
	it('opens an EventSource at the supplied URL with the given listeners', async () => {
		const seen: string[] = [];
		const handle = subscribeSse({
			url: '/api/test/events',
			listeners: {
				ping: (e) => seen.push(e.data)
			}
		});

		await vi.runOnlyPendingTimersAsync();
		expect(FakeEventSource.instances).toHaveLength(1);
		const es = FakeEventSource.instances[0];
		expect(es.url).toBe('/api/test/events');

		es.emit('ping', { msg: 'ok' });
		expect(seen).toEqual(['{"msg":"ok"}']);

		handle.close();
		expect(es.closed).toBe(true);
	});

	it('reports connecting -> connected on open', async () => {
		const statuses: SseConnectionStatus[] = [];
		const handle = subscribeSse({
			url: '/api/test/events',
			listeners: {},
			onStatusChange: (s) => statuses.push(s)
		});

		await vi.runOnlyPendingTimersAsync();
		expect(statuses).toEqual(['connecting', 'connected']);

		handle.close();
	});

	it('schedules an exponential-backoff reconnect after permanent failure', async () => {
		const statuses: SseConnectionStatus[] = [];
		const handle: SseSubscriptionHandle = subscribeSse({
			url: '/api/test/events',
			listeners: {},
			onStatusChange: (s) => statuses.push(s)
		});

		await vi.runOnlyPendingTimersAsync();
		expect(FakeEventSource.instances).toHaveLength(1);

		FakeEventSource.instances[0].failPermanent();

		// Disconnected status is set immediately; reconnect is scheduled.
		expect(statuses).toContain('disconnected');
		expect(FakeEventSource.instances).toHaveLength(1);

		// Advance past the initial backoff (200ms base + jitter up to 25%)
		await vi.advanceTimersByTimeAsync(500);
		expect(FakeEventSource.instances).toHaveLength(2);

		// New ES auto-opens, status flips back through connecting -> connected.
		await vi.runOnlyPendingTimersAsync();
		expect(statuses[statuses.length - 1]).toBe('connected');

		handle.close();
	});

	it('does NOT reconnect when caller closes the handle mid-backoff', async () => {
		const handle = subscribeSse({ url: '/api/test/events', listeners: {} });

		await vi.runOnlyPendingTimersAsync();
		FakeEventSource.instances[0].failPermanent();

		handle.close();
		await vi.advanceTimersByTimeAsync(60_000);

		// Only the original instance ever existed.
		expect(FakeEventSource.instances).toHaveLength(1);
	});

	it('invokes onBeforeReconnect prior to opening the next ES', async () => {
		const refresh = vi.fn().mockResolvedValue(undefined);
		const handle = subscribeSse({
			url: '/api/test/events',
			listeners: {},
			onBeforeReconnect: refresh
		});

		await vi.runOnlyPendingTimersAsync();
		FakeEventSource.instances[0].failPermanent();

		await vi.advanceTimersByTimeAsync(500);
		expect(refresh).toHaveBeenCalled();
		expect(FakeEventSource.instances).toHaveLength(2);

		handle.close();
	});

	it('gives up after RECONNECT_MAX_ATTEMPTS and reports failed', async () => {
		const statuses: SseConnectionStatus[] = [];
		// Stub the EventSource ctor so each new instance never opens and
		// fails permanently — that way the attempts counter is not reset
		// between reconnect attempts.
		class FailingEs {
			static OPEN = 1;
			static CLOSED = 2;
			readyState = FailingEs.CLOSED;
			url: string;
			onopen: (() => void) | null = null;
			onerror: (() => void) | null = null;
			addEventListener(): void {}
			close(): void {}
			constructor(url: string) {
				this.url = url;
				queueMicrotask(() => this.onerror?.());
			}
		}
		(globalThis as unknown as { EventSource: unknown }).EventSource = FailingEs;

		const handle = subscribeSse({
			url: '/api/test/events',
			listeners: {},
			onStatusChange: (s) => statuses.push(s)
		});

		// Drive the reconnect ladder past the cap (RECONNECT_MAX_ATTEMPTS=10).
		for (let i = 0; i < 12; i++) {
			await vi.advanceTimersByTimeAsync(60_000);
		}

		expect(statuses).toContain('failed');
		handle.close();
	});

	it('returns a no-op handle when EventSource is unavailable', () => {
		const original = globalThis.EventSource;
		// @ts-expect-error narrowing for the gate
		delete globalThis.EventSource;
		try {
			const handle = subscribeSse({ url: '/api/test/events', listeners: {} });
			handle.close();
			handle.close(); // idempotent
		} finally {
			globalThis.EventSource = original;
		}
	});
});

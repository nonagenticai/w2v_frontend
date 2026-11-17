import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep the real ApiError (PollingTransport does `instanceof ApiError`) but stub
// the network calls. The transport polls the lightweight `getStatus`; `get` is
// only hit as the rollout-gap fallback when the status route 404s.
vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return { ...actual, runs: { get: vi.fn(), getStatus: vi.fn() } };
});

import { runs, ApiError } from '$lib/api';
import { PollingTransport } from './polling-transport.svelte.js';
import type { RunDetail, RunStatusLite } from '$lib/types/runs';

const statusMock = vi.mocked(runs.getStatus);
const getMock = vi.mocked(runs.get);

function status(): RunStatusLite {
	// Only the shape consumers touch; cast keeps the test focused.
	return { id: 'r1', status: 'running', stage_outputs: [] } as unknown as RunStatusLite;
}

// The full GET returns RunDetail; the fallback forwards it as a RunStatusLite
// superset. Cast keeps the heavy-shape mock focused on the fields under test.
function fullDetail(): RunDetail {
	return { id: 'r1', status: 'running', stage_outputs: [] } as unknown as RunDetail;
}

describe('PollingTransport permanent-error handling', () => {
	beforeEach(() => {
		statusMock.mockReset();
		getMock.mockReset();
	});

	it('forwards data from the lightweight status endpoint on success', async () => {
		statusMock.mockResolvedValueOnce(status());
		const onData = vi.fn();
		const onPermanent = vi.fn();
		const t = new PollingTransport('r1', onData, onPermanent);

		await t.pollNow();

		expect(statusMock).toHaveBeenCalledOnce();
		expect(getMock).not.toHaveBeenCalled();
		expect(onData).toHaveBeenCalledOnce();
		expect(onPermanent).not.toHaveBeenCalled();
	});

	it.each([401, 403])('stops + reports permanently on ApiError(%i)', async (s) => {
		statusMock.mockRejectedValue(new ApiError(s, 'x', 'gone'));
		const onData = vi.fn();
		const onPermanent = vi.fn();
		const t = new PollingTransport('r1', onData, onPermanent);

		await t.pollNow();

		expect(onPermanent).toHaveBeenCalledExactlyOnceWith(s);
		expect(getMock).not.toHaveBeenCalled(); // non-404 → no fallback probe
		expect(onData).not.toHaveBeenCalled();

		// stop() ran — a subsequent poll is a no-op even if the API recovers.
		statusMock.mockResolvedValueOnce(status());
		await t.pollNow();
		expect(onData).not.toHaveBeenCalled();
	});

	it('treats a 404 as permanent only when the full GET also 404s (run truly gone)', async () => {
		statusMock.mockRejectedValue(new ApiError(404, 'x', 'gone'));
		getMock.mockRejectedValue(new ApiError(404, 'x', 'gone'));
		const onData = vi.fn();
		const onPermanent = vi.fn();
		const t = new PollingTransport('r1', onData, onPermanent);

		await t.pollNow();

		expect(getMock).toHaveBeenCalledOnce(); // disambiguation probe ran
		expect(onPermanent).toHaveBeenCalledExactlyOnceWith(404);
		expect(onData).not.toHaveBeenCalled();
	});

	it('falls back to the full detail when the status route is missing (404 but run exists)', async () => {
		// Orchestrator predates GET /runs/{id}/status: status 404s, full GET works.
		statusMock.mockRejectedValueOnce(new ApiError(404, 'x', 'no route'));
		getMock.mockResolvedValueOnce(fullDetail());
		const onData = vi.fn();
		const onPermanent = vi.fn();
		const t = new PollingTransport('r1', onData, onPermanent);

		await t.pollNow();
		expect(onPermanent).not.toHaveBeenCalled();
		expect(onData).toHaveBeenCalledOnce();

		// Having flipped, subsequent polls go straight to the full detail.
		getMock.mockResolvedValueOnce(fullDetail());
		await t.pollNow();
		expect(getMock).toHaveBeenCalledTimes(2);
		expect(statusMock).toHaveBeenCalledOnce(); // not retried after the flip
	});

	it('keeps retrying (no permanent signal) on a transient/network error', async () => {
		statusMock.mockRejectedValueOnce(new Error('network down'));
		const onData = vi.fn();
		const onPermanent = vi.fn();
		const t = new PollingTransport('r1', onData, onPermanent);

		await t.pollNow();
		expect(onPermanent).not.toHaveBeenCalled();

		// Next tick recovers and delivers data — transport was never stopped.
		statusMock.mockResolvedValueOnce(status());
		await t.pollNow();
		expect(onData).toHaveBeenCalledOnce();
	});

	it('does not treat a non-permanent 4xx/5xx as permanent', async () => {
		statusMock.mockRejectedValueOnce(new ApiError(500, 'x', 'boom'));
		const onPermanent = vi.fn();
		const t = new PollingTransport('r1', vi.fn(), onPermanent);

		await t.pollNow();
		expect(onPermanent).not.toHaveBeenCalled();
	});
});

describe('PollingTransport scheduling — no overlap, backoff, jitter, abort', () => {
	beforeEach(() => {
		statusMock.mockReset();
		getMock.mockReset();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	/** A GET that only settles when the test says so — the shape of a struggling
	 *  orchestrator, which is exactly when this transport is the active one. */
	function deferred<T>() {
		let resolve!: (v: T) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	it('never has two GETs in flight, however far the server overruns the interval', async () => {
		// ⛔ THE FENCE for W7-4. Restore `setInterval` and this reds instantly: the
		// timer fires on the wall clock regardless of the outstanding request, so a
		// server answering slower than the interval collects one queued duplicate
		// GET per tick — from every open tab — at the exact moment it is least able
		// to serve them. This is the SSE FALLBACK; it engages when things are
		// already bad, so it must shed load rather than add it.
		const slow = deferred<RunStatusLite>();
		statusMock.mockReturnValueOnce(slow.promise);
		const t = new PollingTransport('r1', vi.fn(), vi.fn());
		t.start(1_000);

		// Ten intervals' worth of wall clock pass while the first GET hangs.
		await vi.advanceTimersByTimeAsync(10_000);
		expect(statusMock).toHaveBeenCalledOnce();

		slow.resolve(status());
		await vi.advanceTimersByTimeAsync(0);
		// Only once it answered is the next one armed.
		expect(statusMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(statusMock.mock.calls.length).toBeGreaterThan(1);
		t.stop();
	});

	it('an external pollNow() during an in-flight poll reuses it instead of stacking a GET', async () => {
		const slow = deferred<RunStatusLite>();
		statusMock.mockReturnValueOnce(slow.promise);
		const t = new PollingTransport('r1', vi.fn(), vi.fn());

		const a = t.pollNow();
		const b = t.pollNow();
		expect(a).toBe(b);
		expect(statusMock).toHaveBeenCalledOnce();

		slow.resolve(status());
		await a;
	});

	it('backs off exponentially on consecutive failures and caps out', async () => {
		// Without the cap+multiplier a failing orchestrator keeps being polled at
		// the healthy-path rate forever.
		const t = new PollingTransport('r1', vi.fn(), vi.fn());
		statusMock.mockRejectedValue(new Error('network down'));
		t.start(1_000);

		expect(t.currentDelayMs).toBe(1_000);
		await vi.advanceTimersByTimeAsync(1_500);
		expect(t.currentDelayMs).toBe(2_000);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.currentDelayMs).toBe(4_000);

		// Cap: 1s doubling can only reach 120s, never overshoot it.
		for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(200_000);
		expect(t.currentDelayMs).toBe(120_000);
		t.stop();
	});

	it('returns to the healthy-path interval floor after one success', async () => {
		// Backoff that never releases would leave a recovered run updating every
		// two minutes.
		const t = new PollingTransport('r1', vi.fn(), vi.fn());
		statusMock.mockRejectedValueOnce(new Error('blip'));
		statusMock.mockRejectedValueOnce(new Error('blip'));
		t.start(1_000);
		await vi.advanceTimersByTimeAsync(1_500);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(t.currentDelayMs).toBe(4_000);

		statusMock.mockResolvedValue(status());
		await vi.advanceTimersByTimeAsync(6_000);
		expect(t.currentDelayMs).toBe(1_000);
		t.stop();
	});

	it('jitters every delay, so N tabs do not land in the same slot forever', async () => {
		// Un-jittered, every tab opened off one navigation polls in lockstep and
		// the orchestrator sees a sawtooth instead of flat load.
		const spy = vi.spyOn(globalThis.Math, 'random');
		const seen: number[] = [];
		const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
			fn: () => void,
			ms?: number
		) => {
			seen.push(ms ?? 0);
			return 0 as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout);

		spy.mockReturnValue(0);
		new PollingTransport('r1', vi.fn(), vi.fn()).start(10_000);
		spy.mockReturnValue(1);
		new PollingTransport('r2', vi.fn(), vi.fn()).start(10_000);

		timeoutSpy.mockRestore();
		expect(seen).toEqual([8_000, 12_000]); // base 10s ±20%
	});

	it('aborts the in-flight GET on stop() so teardown does not leak a request', async () => {
		// The onDestroy → disconnect() path. Without the AbortController the GET
		// keeps a socket and its response body alive on a page the operator left.
		let seenSignal: AbortSignal | undefined;
		const hang = deferred<RunStatusLite>();
		statusMock.mockImplementation((_id: string, opts?: { signal?: AbortSignal }) => {
			seenSignal = opts?.signal;
			return hang.promise;
		});
		const onData = vi.fn();
		const t = new PollingTransport('r1', onData, vi.fn());
		void t.pollNow();
		expect(seenSignal?.aborted).toBe(false);

		t.stop();
		expect(seenSignal?.aborted).toBe(true);

		// And a late answer is still not written back onto the disposed instance.
		hang.resolve(status());
		await vi.advanceTimersByTimeAsync(0);
		expect(onData).not.toHaveBeenCalled();
	});
});

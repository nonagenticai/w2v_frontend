// REST polling transport with adaptive intervals.
// .svelte.ts for consistency — no runes needed, but allows future additions.

import { runs, ApiError } from '$lib/api';
import type { RunStatusLite } from '$lib/types/runs';

// A run that 404s (belongs to another tenant / was deleted) or 401/403s
// (session lost) will never become reachable by retrying — polling it on a
// timer just floods the network tab. Treat these as permanent and stop.
const PERMANENT_STATUSES = new Set([401, 403, 404]);

/**
 * Ceiling on the backed-off delay. Past this the poll has stopped being a
 * safety net and is just keeping a dead tab warm; the SSE transport owns
 * recovery, and a run that finished while we were backed off is picked up on
 * the next tick regardless.
 */
const MAX_BACKOFF_MS = 120_000;

/**
 * ±20% spread applied to EVERY delay, not only the backed-off ones.
 *
 * The un-jittered case is the dangerous one: every tab that opened a run page
 * off the same navigation lands its poll in the same 30s slot forever, so the
 * orchestrator sees a spike-and-idle sawtooth instead of a flat load. Jitter is
 * what smears N tabs across the window.
 */
const JITTER_RATIO = 0.2;

/** Multiplier per consecutive failure: 1×, 2×, 4×, … up to MAX_BACKOFF_MS. */
const BACKOFF_FACTOR = 2;

export class PollingTransport {
	private readonly runId: string;
	private readonly onData: (detail: RunStatusLite) => void;
	private readonly onPermanentError: ((status: number) => void) | null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;
	/** Healthy-path floor — the interval the consumer asked for. Backoff only
	 *  ever multiplies this; a recovered poll returns exactly to it. */
	private baseIntervalMs = 0;
	private consecutiveFailures = 0;
	/**
	 * The in-flight poll, if any. This is what makes the loop non-overlapping:
	 * `pollNow()` hands back the SAME promise to a second caller instead of
	 * issuing a second GET, and the scheduler only arms the next timer once this
	 * has settled.
	 */
	private inFlight: Promise<void> | null = null;
	/** Aborts the in-flight GET on `stop()`. Fresh per request. */
	private abort: AbortController | null = null;
	// The safety-net poll hits the lightweight GET /runs/{id}/status. If that
	// route 404s while the full GET /runs/{id} still resolves, the orchestrator
	// hasn't rolled out the status endpoint yet — fall back to the heavy detail
	// (its extra fields are ignored downstream) instead of falsely marking the
	// run "unavailable". Once flipped, stay on the full detail for this run.
	private useLiteStatus = true;

	constructor(
		runId: string,
		onData: (detail: RunStatusLite) => void,
		onPermanentError?: (status: number) => void
	) {
		this.runId = runId;
		this.onData = onData;
		this.onPermanentError = onPermanentError ?? null;
	}

	/**
	 * Self-scheduling loop, NOT `setInterval`.
	 *
	 * ⛔ THE FENCE. This is the SSE fallback: it engages exactly when the
	 * orchestrator is already struggling. A bare `setInterval` fires on the
	 * wall clock regardless of whether the previous GET has answered, so a pod
	 * that has slowed to 40s-per-response accumulates a queue of duplicate
	 * in-flight GETs from EVERY open tab — the client amplifies load precisely
	 * when the server can least absorb it. Awaiting the previous response before
	 * arming the next timer makes one tab cost at most one in-flight request no
	 * matter how slow the server gets, and the failure backoff then actively
	 * sheds load instead of holding it constant.
	 */
	start(intervalMs: number): void {
		this.stop();
		this.stopped = false;
		this.baseIntervalMs = intervalMs;
		this.consecutiveFailures = 0;
		// First poll lands one interval out, matching the old setInterval
		// semantics — `connect()` already seeds the view from its own fetch, so an
		// immediate poll here would just double that request.
		this.scheduleNext();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		// Teardown must not leave a GET holding a socket (and its response body)
		// open on a page the operator has already left. The `stopped` guard below
		// still covers late delivery for anything already past the await.
		this.abort?.abort(new Error('polling_stopped'));
		this.abort = null;
	}

	/** Change the healthy-path interval. Re-arms only if the loop is running. */
	setInterval(intervalMs: number): void {
		if (this.timer || this.inFlight) {
			this.stop();
			this.start(intervalMs);
		} else {
			this.baseIntervalMs = intervalMs;
		}
	}

	/** The delay the NEXT tick will use, before jitter. Exposed for tests and for
	 *  a consumer that wants to surface "retrying in …". */
	get currentDelayMs(): number {
		const scaled = this.baseIntervalMs * BACKOFF_FACTOR ** this.consecutiveFailures;
		return Math.min(MAX_BACKOFF_MS, scaled);
	}

	private jittered(delayMs: number): number {
		const spread = delayMs * JITTER_RATIO;
		return Math.max(0, Math.round(delayMs - spread + Math.random() * spread * 2));
	}

	private scheduleNext(): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.pollNow().then(() => this.scheduleNext());
		}, this.jittered(this.currentDelayMs));
	}

	private async fetchStatus(signal: AbortSignal): Promise<RunStatusLite> {
		if (!this.useLiteStatus) return runs.get(this.runId, { signal });
		try {
			return await runs.getStatus(this.runId, { signal });
		} catch (e) {
			// A 404 on the status route is ambiguous: the run is gone, OR the
			// orchestrator predates the endpoint. Disambiguate with one full GET;
			// if that resolves, the endpoint just isn't deployed — switch to it.
			if (e instanceof ApiError && e.status === 404) {
				// re-throws a real 404 → permanent
				const full = await runs.get(this.runId, { signal });
				this.useLiteStatus = false;
				return full;
			}
			throw e;
		}
	}

	/**
	 * Poll once. Concurrency-safe: while a poll is in flight this returns that
	 * same promise rather than issuing a second GET, so an external caller
	 * (a manual "refresh", a visibility handler) can never stack requests on top
	 * of the loop's own.
	 */
	pollNow(): Promise<void> {
		if (this.inFlight) return this.inFlight;
		const run = this.runOnce().finally(() => {
			this.inFlight = null;
		});
		this.inFlight = run;
		return run;
	}

	private async runOnce(): Promise<void> {
		const abort = new AbortController();
		this.abort = abort;
		try {
			const detail = await this.fetchStatus(abort.signal);
			// Guard against late delivery: if stop() ran (page unmount or
			// JobProgressState.disconnect) while the GET was in flight, don't
			// write stale data back onto a disposed instance.
			if (this.stopped) return;
			this.consecutiveFailures = 0;
			this.onData(detail);
		} catch (e) {
			if (this.stopped) return;
			// A permanent 4xx will never resolve by retrying — stop the timer
			// and let the consumer surface an "unavailable" state instead of
			// hammering the endpoint forever.
			if (e instanceof ApiError && PERMANENT_STATUSES.has(e.status)) {
				this.stop();
				this.onPermanentError?.(e.status);
				return;
			}
			// Transient failure — back off before the next tick. A developer
			// debugging a hung job should still see the failure in console.
			this.consecutiveFailures += 1;
			if (import.meta.env.DEV) console.warn('Run polling failed:', e);
		} finally {
			if (this.abort === abort) this.abort = null;
		}
	}
}

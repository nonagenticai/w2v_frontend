// Shared SSE connection mechanics for the two EventSource clients in this repo:
//   - the generic `subscribeSse()` helper (`sse-subscription.ts`), used by
//     run-events.ts + projects-events.ts, and
//   - the run-progress `SseTransport` (`job-progress/sse-transport.svelte.ts`),
//     owned by JobProgressState's WS-fallback ladder.
//
// The two keep their own control flow and message handling (SseTransport bakes
// in run-message normalization + a REST-probe permanent-error classifier +
// runes state; the generic helper routes arbitrary named events to callbacks).
// But the reconnect/idle-watchdog TUNING and the backoff math were duplicated —
// with a "mirrors the tuning in the other file" comment as the only link, a
// manual-sync hazard. Those shared mechanics live here so they can't drift.

/** Backoff ceiling — a reconnect never waits longer than this. */
export const RECONNECT_MAX_MS = 30_000;
/** Give up (status `failed`) after this many consecutive reconnect attempts. */
export const RECONNECT_MAX_ATTEMPTS = 10;

// Idle watchdog: the orchestrator SSE emits a `ping` every ~15s on every
// channel, and Cloudflare's tunnel silently drops idle SSE at ~100s WITHOUT
// firing `onerror` (readyState stays OPEN). A stream that goes fully silent for
// 3 minutes is a half-open zombie the browser's built-in retry never noticed —
// the watchdog tears it down and rebuilds.
export const IDLE_WATCHDOG_INTERVAL_MS = 30_000;
export const IDLE_WATCHDOG_THRESHOLD_MS = 180_000;

/**
 * Exponential backoff capped at {@link RECONNECT_MAX_MS}, plus 25% jitter.
 *
 * `baseMs` is per-client (the generic helper reconnects faster than the run
 * transport), so it stays a parameter. The jitter prevents thundering-herd
 * reconnects when many tabs resume simultaneously (e.g. laptop wake from sleep).
 */
export function nextBackoffDelay(attempts: number, baseMs: number): number {
	const base = Math.min(baseMs * 2 ** attempts, RECONNECT_MAX_MS);
	return base + base * 0.25 * Math.random();
}

export interface IdleWatchdog {
	/** Begin polling. Idempotent — a second call while running is a no-op. */
	start(): void;
	/** Stop polling. Safe to call when not running. */
	stop(): void;
}

/**
 * A restartable idle watchdog. Every `intervalMs`, if the elapsed time since
 * `getLastActivity()` exceeds `thresholdMs`, it invokes `onIdle` (which should
 * tear down + rebuild the stream). The caller owns activity bookkeeping (each
 * received event, including the server `ping` heartbeat, should advance the
 * value `getLastActivity` returns).
 */
export function createIdleWatchdog(opts: {
	getLastActivity: () => number;
	onIdle: () => void;
	intervalMs?: number;
	thresholdMs?: number;
}): IdleWatchdog {
	const intervalMs = opts.intervalMs ?? IDLE_WATCHDOG_INTERVAL_MS;
	const thresholdMs = opts.thresholdMs ?? IDLE_WATCHDOG_THRESHOLD_MS;
	let timer: ReturnType<typeof setInterval> | null = null;
	return {
		start(): void {
			if (timer !== null) return;
			timer = setInterval(() => {
				if (Date.now() - opts.getLastActivity() > thresholdMs) opts.onIdle();
			}, intervalMs);
		},
		stop(): void {
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
		}
	};
}

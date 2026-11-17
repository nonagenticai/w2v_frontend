// Generic SSE subscription with reconnect, exponential backoff, and a
// connection-status callback. Used by run-events.ts + projects-events.ts.
//
// Why this exists: bare `new EventSource(url)` relies on the browser's
// built-in retry, which (a) doesn't re-attach cookies/JWT after auth
// expiry, (b) gives up entirely once the browser marks readyState=CLOSED,
// and (c) doesn't surface "we're trying to reconnect" to the UI. The
// existing job-progress SseTransport solves the same problem for the
// run-progress consumer; this is the parallel solution for the lighter
// per-resource subscribers that don't need runes-state.
//
// The transport class in $lib/stores/job-progress/sse-transport.svelte.ts
// is *intentionally not* shared here: it bakes in run-specific message
// normalisation + idle-watchdog tuning calibrated for run streams. This
// helper stays generic so projects-events.ts and run-events.ts can route
// arbitrary named events to consumer callbacks.

import { browser } from '$app/environment';
import { withActiveTenant } from '$lib/api/client';
import { RECONNECT_MAX_ATTEMPTS, createIdleWatchdog, nextBackoffDelay } from './sse-shared.js';

export type SseConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface SseSubscriptionOptions {
	/** Absolute or `/api/...`-relative URL to subscribe to. */
	url: string;
	/** Map of named-event listeners. Each is called with the parsed JSON payload. */
	listeners: Record<string, (event: MessageEvent<string>) => void>;
	/**
	 * Optional connection-status callback so the UI can render
	 * "reconnecting…" affordances without us reaching into a store.
	 */
	onStatusChange?: (status: SseConnectionStatus) => void;
	/**
	 * Optional hook to refresh the session before reconnecting. Returned
	 * promise must resolve when the cookie/JWT is fresh. Useful when the
	 * SSE was rejected because the bearer expired.
	 */
	onBeforeReconnect?: () => Promise<void> | void;
}

export interface SseSubscriptionHandle {
	close(): void;
}

// Per-client reconnect floor — the generic subscribers reconnect faster than
// the run transport. The ceiling, attempt cap, backoff math, and idle-watchdog
// tuning are shared in ./sse-shared.ts.
const RECONNECT_BASE_MS = 200;

export function subscribeSse(opts: SseSubscriptionOptions): SseSubscriptionHandle {
	// During SSR there is no EventSource — return a no-op handle. The
	// browser-side `load` re-evaluates and opens the real subscription.
	if (!browser || typeof EventSource === 'undefined') {
		return { close: () => {} };
	}

	let es: EventSource | null = null;
	let closed = false;
	let attempts = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let lastActivity = Date.now();

	const setStatus = (s: SseConnectionStatus): void => {
		opts.onStatusChange?.(s);
	};

	const bumpActivity = (): void => {
		lastActivity = Date.now();
	};

	const clearReconnectTimer = (): void => {
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	};

	// Force-reconnect a half-open zombie stream (see sse-shared.ts for why the
	// browser's built-in retry never notices). `bumpActivity` arms a fresh window
	// for the reconnecting socket so the watchdog doesn't immediately re-fire.
	const watchdog = createIdleWatchdog({
		getLastActivity: () => lastActivity,
		onIdle: () => {
			if (closed) return;
			if (es) {
				es.close();
				es = null;
			}
			bumpActivity();
			setStatus('connecting');
			scheduleReconnect();
		}
	});

	const open = (): void => {
		if (closed) return;
		setStatus('connecting');
		try {
			// EventSource can't set X-Active-Tenant-Id — carry a super-admin's
			// scope-switch as the active_tenant query param (re-read per (re)open).
			es = new EventSource(withActiveTenant(opts.url));
		} catch {
			setStatus('failed');
			return;
		}
		es.onopen = () => {
			attempts = 0;
			bumpActivity();
			setStatus('connected');
		};
		for (const [name, listener] of Object.entries(opts.listeners)) {
			// Bump the idle watchdog on every received event before dispatching.
			es.addEventListener(name, bumpActivity);
			es.addEventListener(name, listener as EventListener);
		}
		// The server's heartbeat keeps the stream alive even when no domain
		// events flow — count it as activity so the watchdog doesn't reconnect a
		// healthy-but-quiet stream.
		es.addEventListener('ping', bumpActivity);
		es.onerror = () => {
			if (closed) return;
			const isPermanent = es?.readyState === EventSource.CLOSED;
			if (es) {
				es.close();
				es = null;
			}
			if (!isPermanent) {
				// Browser is auto-retrying — let it. Surface state and wait.
				setStatus('connecting');
				return;
			}
			scheduleReconnect();
		};
	};

	const scheduleReconnect = (): void => {
		if (closed) return;
		if (attempts >= RECONNECT_MAX_ATTEMPTS) {
			setStatus('failed');
			return;
		}
		setStatus('disconnected');
		const delay = nextBackoffDelay(attempts, RECONNECT_BASE_MS);
		attempts += 1;
		clearReconnectTimer();
		reconnectTimer = setTimeout(async () => {
			if (closed) return;
			if (opts.onBeforeReconnect) {
				try {
					await opts.onBeforeReconnect();
				} catch {
					// If the auth refresh failed we still try to reconnect —
					// the server's 401 will land us back in this branch and
					// retry exponentially.
				}
			}
			open();
		}, delay);
	};

	open();
	watchdog.start();

	return {
		close() {
			if (closed) return;
			closed = true;
			clearReconnectTimer();
			watchdog.stop();
			if (es) {
				es.close();
				es = null;
			}
			setStatus('disconnected');
		}
	};
}

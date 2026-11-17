// EventSource (SSE) transport used as a fallback when WebSocket is unavailable.
// .svelte.ts — uses Svelte 5 runes for reactive state.
//
// Studio v3: hits GET /api/runs/{id}/events directly. The same wire shape is
// also consumed by $lib/stores/run-events.ts (the per-resource subscription
// that the route uses). Both paths can coexist; this transport is owned by
// JobProgressState's WS-fallback ladder.

import { runs, ApiError } from '$lib/api';
import { withActiveTenant } from '$lib/api/client';
import {
	RECONNECT_MAX_ATTEMPTS,
	createIdleWatchdog,
	nextBackoffDelay,
	type IdleWatchdog
} from '../sse-shared.js';
import type { ConnectionStatus, RunWsMessage } from './types.js';
import { normalizeRunMessage, RUN_EVENTS } from './message-normalizer.js';

// EventSource hides the HTTP status of a failed handshake. When the stream
// never opens we probe the REST endpoint once to tell a permanent 4xx
// (tenant 404 / lost session — never reconnectable) apart from a transient
// network blip (worth the backoff ladder).
const PERMANENT_STATUSES = new Set([401, 403, 404]);

// Reconnect floor for the run transport — slower than the generic subscribers.
// The ceiling, attempt cap, backoff math, and idle-watchdog tuning are shared
// in ../sse-shared.ts (Cloudflare drops idle SSE at ~100s without firing
// onerror, so a 3-min-silent stream is a zombie the watchdog rebuilds).
const RECONNECT_BASE_MS = 1000;

export class SseTransport {
	connectionStatus = $state<ConnectionStatus>('disconnected');
	lastEventTime = $state<number>(0);

	private es: EventSource | null = null;
	private destroyed = false;
	private hadOpen = false;
	private disconnectSignaled = false;
	private classifying = false;
	private readonly idleWatchdog: IdleWatchdog;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempts = 0;
	// Consecutive idle-watchdog rebuilds with NO event in between.
	// Deliberately NOT `reconnectAttempts`: that resets in `onopen`, and a zombie
	// stream opens perfectly well — it just never delivers. Only a real MESSAGE
	// clears this one, which is the property that distinguishes a live stream
	// from an open pipe with nothing in it.
	private consecutiveIdleRebuilds = 0;

	private readonly runId: string;
	private readonly onMessage: (msg: RunWsMessage) => void;
	private onConnect: (() => void) | null = null;
	private onDisconnect: (() => void) | null = null;
	private onReconnect: (() => void) | null = null;
	private onPermanentError: ((status: number) => void) | null = null;

	constructor(
		runId: string,
		onMessage: (msg: RunWsMessage) => void,
		callbacks?: {
			onConnect?: () => void;
			onDisconnect?: () => void;
			onReconnect?: () => void;
			onPermanentError?: (status: number) => void;
		}
	) {
		this.runId = runId;
		this.onMessage = onMessage;
		this.onConnect = callbacks?.onConnect ?? null;
		this.onDisconnect = callbacks?.onDisconnect ?? null;
		this.onReconnect = callbacks?.onReconnect ?? null;
		this.onPermanentError = callbacks?.onPermanentError ?? null;
		this.idleWatchdog = createIdleWatchdog({
			getLastActivity: () => this.lastEventTime,
			onIdle: () => this.rebuildOnIdle()
		});
	}

	connect(): void {
		if (this.destroyed) return;
		this.lastEventTime = Date.now();
		this.openEventSource();
		if (this.es) this.idleWatchdog.start();
	}

	disconnect(): void {
		this.destroyed = true;
		this.idleWatchdog.stop();
		this.stopReconnect();
		if (this.es) {
			this.es.close();
			this.es = null;
		}
		this.connectionStatus = 'disconnected';
	}

	private stopReconnect(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private async classifyThenReconnect(): Promise<void> {
		if (this.destroyed || this.classifying) return;
		this.classifying = true;
		try {
			await runs.get(this.runId);
			// Endpoint is reachable — the SSE failure was transient. Resume the
			// normal backoff ladder.
			if (!this.destroyed) this.scheduleReconnect();
		} catch (e) {
			if (e instanceof ApiError && PERMANENT_STATUSES.has(e.status)) {
				// Permanent — do NOT reconnect; surface it to the consumer.
				this.stopReconnect();
				this.connectionStatus = 'failed';
				this.onPermanentError?.(e.status);
			} else if (!this.destroyed) {
				this.scheduleReconnect();
			}
		} finally {
			this.classifying = false;
		}
	}

	private scheduleReconnect(): void {
		if (this.destroyed) return;
		if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
			this.connectionStatus = 'failed';
			return;
		}
		this.stopReconnect();
		const delay = nextBackoffDelay(this.reconnectAttempts, RECONNECT_BASE_MS);
		this.reconnectAttempts++;
		this.connectionStatus = 'connecting';
		this.reconnectTimer = setTimeout(() => {
			if (this.destroyed) return;
			this.openEventSource();
		}, delay);
	}

	// Invoked by the shared idle watchdog when the stream has been silent past
	// the threshold (see ../sse-shared.ts). Tear down the zombie and rebuild.
	private rebuildOnIdle(): void {
		if (this.destroyed) return;
		const idleFor = Date.now() - this.lastEventTime;
		// ⚠️ This used to call `openEventSource()` directly, bypassing the
		// `RECONNECT_MAX_ATTEMPTS` check in `scheduleReconnect`. A stream that
		// stays OPEN but silent forever therefore rebuilt every watchdog tick
		// indefinitely and never reached `failed` — so the UI showed "connected"
		// over a dead stream, permanently, while quietly re-opening an
		// EventSource every 180s.
		if (this.consecutiveIdleRebuilds >= RECONNECT_MAX_ATTEMPTS) {
			if (this.es) {
				this.es.close();
				this.es = null;
			}
			this.connectionStatus = 'failed';
			if (import.meta.env.DEV) {
				console.warn(`SSE idle-rebuilt ${this.consecutiveIdleRebuilds}x with no event — giving up`);
			}
			return;
		}
		this.consecutiveIdleRebuilds++;
		if (import.meta.env.DEV) {
			console.warn(`SSE idle for ${idleFor}ms — rebuilding connection`);
		}
		if (this.es) {
			this.es.close();
			this.es = null;
		}
		// Re-arm onerror-style disconnect signal so the consumer's onReconnect
		// callback fires after the rebuilt stream opens.
		if (!this.disconnectSignaled) {
			this.disconnectSignaled = true;
			this.onDisconnect?.();
		}
		// Reset last event time before re-opening so we don't loop the watchdog
		// while the new EventSource handshakes.
		this.lastEventTime = Date.now();
		this.openEventSource();
	}

	private openEventSource(): void {
		if (this.destroyed) return;
		this.connectionStatus = 'connecting';
		// EventSource can't set X-Active-Tenant-Id — carry a super-admin's
		// scope-switch as the active_tenant query param so cross-tenant run
		// streams resolve instead of 404-ing back to the admin's own tenant.
		const url = withActiveTenant(`/api/runs/${encodeURIComponent(this.runId)}/events`);
		try {
			this.es = new EventSource(url);
		} catch (e) {
			if (import.meta.env.DEV) console.warn('SSE construction failed:', e);
			this.connectionStatus = 'failed';
			return;
		}
		this.attachHandlers();
	}

	private attachHandlers(): void {
		if (!this.es) return;
		const handleMessage = (event: MessageEvent<string>) => {
			try {
				const parsed = JSON.parse(event.data) as unknown;
				const msg = normalizeRunMessage(parsed);
				if (msg && msg.run_id === this.runId) {
					this.lastEventTime = Date.now();
					// A real event proves the stream is alive, so the zombie count
					// starts over. Reset here and NOT in `onopen` — see the field.
					this.consecutiveIdleRebuilds = 0;
					this.onMessage(msg);
				}
			} catch (e) {
				if (import.meta.env.DEV) console.warn('Failed to parse SSE message:', e);
			}
		};
		// The orchestrator heartbeat (`src/api/sse.py` yields `{"event": "ping"}`
		// every ~15s of pub/sub silence). It is a NAMED frame, so `onmessage` never
		// sees it, and it carries no run_id, so `handleMessage` would drop it anyway.
		// Without this listener `lastEventTime` only advanced on real run events: any
		// stage that ran >180s with nothing to report tripped the idle watchdog, which
		// tore down a perfectly healthy stream ("SSE stream disconnected" every ~4
		// min) and re-opened it — and every re-open replays the whole catch-up
		// snapshot. A ping proves bytes are flowing, which is exactly what the
		// watchdog measures (a zombie delivers no ping), so it also clears the
		// zombie counter.
		const handlePing = () => {
			this.lastEventTime = Date.now();
			this.consecutiveIdleRebuilds = 0;
		};
		this.es.onopen = () => {
			const wasReconnect = this.hadOpen && this.disconnectSignaled;
			this.hadOpen = true;
			this.disconnectSignaled = false;
			this.reconnectAttempts = 0;
			this.connectionStatus = 'connected';
			if (wasReconnect) {
				this.onReconnect?.();
			} else {
				this.onConnect?.();
			}
		};
		// EventSource fires `onmessage` ONLY for unnamed (`event: message`) frames.
		// The orchestrator names every frame it publishes (`src/api/sse.py` yields
		// `{"event": <name>, ...}`), so a name missing from this list is an event
		// the app can never observe — the badge sits on running/pending until the
		// 30s safety-net poll, and a reconnect drops the replayed event again.
		// This list must stay in lockstep with the orchestrator's `RunEventName`
		// (`src/api/schemas/_shared.py`) and with RUN_EVENTS in
		// ./message-normalizer.ts. `message-normalizer.test.ts` pins that union.
		this.es.onmessage = handleMessage;
		for (const name of RUN_EVENTS) {
			this.es.addEventListener(name, handleMessage as EventListener);
		}
		this.es.addEventListener('ping', handlePing);
		this.es.onerror = () => {
			if (this.destroyed) return;
			if (!this.disconnectSignaled) {
				this.disconnectSignaled = true;
				this.onDisconnect?.();
			}
			if (this.es?.readyState === EventSource.CLOSED) {
				// Stream never opened (no prior 'onopen') on the first failure:
				// classify once via a REST probe so a permanent tenant-404 / lost
				// session stops cold instead of riding the backoff ladder and
				// flooding /events. Otherwise take over with exponential backoff.
				if (!this.hadOpen && this.reconnectAttempts === 0) {
					void this.classifyThenReconnect();
					return;
				}
				// Browser gave up on its built-in retry. Take over with our own
				// exponential backoff instead of marking 'failed' and going dark.
				this.scheduleReconnect();
				return;
			}
			this.connectionStatus = 'connecting';
		};
	}
}

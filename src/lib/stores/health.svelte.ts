// Health status polling (Svelte 5 runes).
//
// This module owns the PROBE and therefore depends on $lib/api. The mutable
// state lives in the leaf ./health-state.svelte.ts so that network-layer
// modules (services/keycloak.ts, stores/auth.svelte.ts) can flip health status
// without importing this file — which would close an import cycle back through
// $lib/api. See health-state.svelte.ts for the why.
//
// Import the api/health module directly rather than the $lib/api barrel: the
// barrel drags in ~20 modules for one export, and every one of them is a chance
// to reintroduce the cycle.

import { health } from '$lib/api/health.js';
import { browser } from '$app/environment';
import {
	getHealthStatus,
	isPolling,
	markBackendDown,
	setHealthStatus,
	setPollTimer,
	stopHealthPolling,
	type HealthStatus
} from './health-state.svelte.js';

// Re-exported so existing consumers (+layout.svelte, ShellLayout, Header,
// routes/+page.ts) keep importing from '$lib/stores/health.svelte.js'
// unchanged. Only the network-layer modules must reach for the leaf directly.
export { getHealthStatus, markBackendDown, stopHealthPolling };
export type { HealthStatus };

const POLL_INTERVAL = 30_000; // 30s

async function check(): Promise<HealthStatus> {
	try {
		// Probe readiness (/health/ready → orchestrator readyz: DB + Redis
		// reachability), not bare liveness (/health, which always returns
		// {"status":"ok"} and so can't distinguish healthy from degraded).
		// A 200 means deps are reachable → healthy.
		await health.ready();
		setHealthStatus('healthy');
		return 'healthy';
	} catch (err) {
		// readyz answers 503 when the server is up but a dependency (DB/Redis)
		// is unreachable, or the proxy answers 503 when the backend itself is
		// unreachable — surface both as 'degraded' (the edge responded, the
		// service is impaired). A thrown fetch / network error / other status
		// means we couldn't reach the service at all → 'down'. Read `.status`
		// structurally rather than via `instanceof ApiError` — cheap, and it
		// does not care which module finished evaluating first.
		const errStatus =
			err && typeof err === 'object' && 'status' in err
				? Number((err as { status: unknown }).status)
				: 0;
		const next: HealthStatus = errStatus === 503 ? 'degraded' : 'down';
		setHealthStatus(next);
		return next;
	}
}

/**
 * Start the health poll. Called once from +layout.svelte's onMount.
 *
 * Deliberately NOT run at module scope. A module-load probe made the store's
 * first status depend on ESM evaluation order, which is how the import cycle
 * this module used to sit in turned a healthy backend into a "Backend
 * unavailable" screen. Idempotent, and re-armable after stopHealthPolling().
 */
export function startHealthPolling(): void {
	if (!browser || isPolling()) return;
	void check();
	setPollTimer(setInterval(check, POLL_INTERVAL));
}

/**
 * Re-probe the backend on demand. Used by the "Retry" button on the
 * Backend-unavailable screen. Returns the resolved status so callers can
 * react (e.g. trigger a route re-load on recovery).
 */
export function recheckHealth(): Promise<HealthStatus> {
	return check();
}

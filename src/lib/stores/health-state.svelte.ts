// Health status state (Svelte 5 runes) — LEAF MODULE.
//
// This file must NOT import from $lib/api, $lib/services, or anything that
// transitively reaches them. It is deliberately a leaf so that modules in the
// network layer (api/client.ts → services/keycloak.ts, stores/auth.svelte.ts)
// can flip health state without creating an import cycle back into
// health.svelte.ts, which owns the probe and therefore does depend on $lib/api.
//
// That cycle was a real production bug: under `vite dev` the entry point into
// it varied per load, and when the $lib/api barrel was entered first the
// `health` binding was still in the TDZ when the module-load probe ran. The
// throw was caught and mapped to 'down', so the app rendered "Backend
// unavailable" against a healthy backend on ~5 of 6 warm dev loads.

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

let status = $state<HealthStatus>('unknown');

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

export function getHealthStatus(): HealthStatus {
	return status;
}

/** Set by the probe in health.svelte.ts. Not part of the public store API. */
export function setHealthStatus(next: HealthStatus): void {
	status = next;
}

/**
 * Mark the backend as down without waiting for the next poll. Called from the
 * auth store when /auth/me returns 5xx / network-fails so the UI flips to
 * "Backend unavailable" immediately instead of sitting in a blank logged-in
 * shell for up to 30s until the next poll catches up.
 */
export function markBackendDown(): void {
	status = 'down';
}

/** True while a poll timer is armed. Used to keep startHealthPolling idempotent. */
export function isPolling(): boolean {
	return pollIntervalId !== null;
}

/** Hand the live timer handle to this module so stopHealthPolling can clear it. */
export function setPollTimer(id: ReturnType<typeof setInterval>): void {
	pollIntervalId = id;
}

// Logout calls this so the timer doesn't keep firing /api/health after the
// page is otherwise idle. Without it the interval lives for the lifetime of
// the document, which leaks one outbound request per 30s post-logout.
// Clearing the handle also re-arms startHealthPolling, so a re-login restarts
// the poll rather than leaving it permanently stopped.
export function stopHealthPolling(): void {
	if (pollIntervalId !== null) {
		clearInterval(pollIntervalId);
		pollIntervalId = null;
	}
}

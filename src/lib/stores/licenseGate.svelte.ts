// src/lib/stores/licenseGate.svelte.ts
//
// Authoritative, app-scoped LICENSE GATE for the w2v product — the single
// source of truth for "is this workspace's license valid, expiring, or
// blocked?". Fed by the backend `GET /api/license/status` (which derives the
// real state from the licenses service: active / expiring_soon / expired /
// revoked / none / not_onboarded, plus the expiry date).
//
// Ported from fr (`fr/frontend/src/lib/stores/licenseGate.svelte.ts`); see
// `fr/frontend/LICENSE_STATE_PATTERN.md`. Ships gate-OFF: while
// `W2V_LICENSE_GATE_ENABLED` is false the backend returns `state:'active'`, so
// this gate is fully inert in prod until George flips the flag.
//
// The backend is the real enforcer. This store lets the SPA render an accurate
// experience on top of that: a hard-block renewal screen for expired/revoked/
// none, and a non-blocking "expiring soon" banner — instead of a broken shell
// or raw error toasts.
//
// Two signals feed it:
//   1. A polled GET /api/license/status (on login + on an interval/visibility).
//   2. `handleForbidden()` — called by the API client when a request returns a
//      license-required 402/403 (or a 403 TENANT_NOT_ONBOARDED), so a
//      mid-session expiry blocks immediately even before the next poll.

import { api } from '$lib/api/client';
import { TENANT_NOT_ONBOARDED_MESSAGE } from '$lib/api/onboarding';

export type LicenseGateState =
	| 'active'
	| 'expiring_soon'
	| 'expired'
	| 'revoked'
	| 'none'
	| 'not_onboarded'
	| 'unknown';

export interface LicenseStatusResponse {
	appKey: string;
	gateEnabled: boolean;
	hasLicense: boolean;
	state: LicenseGateState;
	expiresAt: string | null;
	daysRemaining: number | null;
	planCode: string | null;
}

const BLOCKED_STATES: ReadonlySet<LicenseGateState> = new Set([
	'expired',
	'revoked',
	'none',
	'not_onboarded'
]);

export class LicenseGate {
	status = $state<LicenseStatusResponse | null>(null);
	isLoading = $state(false);
	/** Set when a live request returned a license-required 402/403 (mid-session). */
	forcedBlocked = $state(false);
	lastChecked = $state<Date | null>(null);

	state = $derived<LicenseGateState>(this.status?.state ?? 'unknown');
	expiresAt = $derived<string | null>(this.status?.expiresAt ?? null);
	daysRemaining = $derived<number | null>(this.status?.daysRemaining ?? null);
	planCode = $derived<string | null>(this.status?.planCode ?? null);

	/** Expiring within the warning window — show a non-blocking banner. */
	isExpiringSoon = $derived(this.state === 'expiring_soon');

	/**
	 * Hard-block the UI: a license-required response was seen, OR the polled
	 * state is a terminal non-entitled state. `unknown` (transient upstream
	 * error) does NOT block — the per-request gate is the backstop, so a
	 * licenses blip can't lock out an entitled user.
	 */
	isBlocked = $derived(this.forcedBlocked || BLOCKED_STATES.has(this.state));

	/** Human-readable reason, used by the block screen. */
	get statusMessage(): string {
		switch (this.state) {
			case 'expired':
				return this.expiresAt
					? `Your license expired on ${formatDate(this.expiresAt)}.`
					: 'Your license has expired.';
			case 'revoked':
				return 'Your license has been revoked.';
			case 'none':
				return 'No active license for this workspace.';
			case 'not_onboarded':
				return TENANT_NOT_ONBOARDED_MESSAGE;
			case 'expiring_soon':
				return this.daysRemaining != null
					? `Your license expires in ${this.daysRemaining} day${this.daysRemaining === 1 ? '' : 's'}.`
					: 'Your license is expiring soon.';
			case 'active':
				return 'Your license is active.';
			default:
				return 'License status is temporarily unavailable.';
		}
	}

	/** Fetch the authoritative status. Never throws. */
	async load(): Promise<void> {
		this.isLoading = true;
		try {
			const body = await api.get<LicenseStatusResponse>('/license/status');
			this.status = body;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned, never mutated: the new-object assignment is already reactive, so a plain Date is correct (SvelteDate only matters for in-place mutation).
			this.lastChecked = new Date();
			// A successful refresh that reports an entitled state clears a stale
			// forced-block (e.g. the license was just renewed).
			if (!BLOCKED_STATES.has(body.state)) {
				this.forcedBlocked = false;
			}
		} catch {
			// Non-OK (401 pre-auth) / network error → leave prior state; do NOT
			// hard-block on a transient blip. The route auth gate handles 401.
		} finally {
			this.isLoading = false;
		}
	}

	async refresh(): Promise<void> {
		await this.load();
	}

	/**
	 * Called by the API client on a license-required 402/403. Blocks the UI
	 * immediately, then refreshes to resolve the precise reason (expired vs
	 * revoked vs none) for an accurate message.
	 */
	handleForbidden(): void {
		this.forcedBlocked = true;
		void this.load();
	}

	clear(): void {
		this.status = null;
		this.forcedBlocked = false;
		this.lastChecked = null;
	}
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString();
	} catch {
		return iso;
	}
}

/**
 * Where the "Renew" CTA points. Defaults to the in-app renew page; set
 * `VITE_LICENSE_RENEW_URL` (e.g. the future portal e-commerce URL) to redirect
 * renewals out of the app — one knob, ports to every frontend / n8n node.
 */
export const LICENSE_RENEW_URL: string =
	(import.meta.env.VITE_LICENSE_RENEW_URL as string | undefined) || '/license-upgrade';

export const licenseGate = new LicenseGate();

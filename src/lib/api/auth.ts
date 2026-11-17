/**
 * Auth API client — fetches user detail from the orchestrator.
 * The actual login/logout flow is driven by Keycloak (see $lib/services/keycloak).
 */

import { api, ApiError, bootstrapGet } from './client.js';
import type { MemberRole, MyTenant, PendingInvite } from './tenancy.js';

export interface AuthMeUser {
	sub: string;
	email: string | null;
	name: string;
	preferred_username: string;
	roles: string[];
	/**
	 * The tenant this session acts in. `null` (P2, `W2V_TENANCY_SOURCE=membership`)
	 * means the caller has NO usable workspace → the SPA routes to /no-workspace.
	 * Undefined on the Keycloak-only / dev fallback (no backend answer yet).
	 */
	tenant_id?: string | null;
	/** Membership role in `tenant_id`; null for no membership / a super_admin acting into a foreign tenant / claim mode. */
	role?: MemberRole | string | null;
	/** Every ACTIVE membership — feeds the tenant switcher. */
	memberships?: MyTenant[];
	/**
	 * Pending invites addressed to the caller's VERIFIED email. `/auth/me` accepts
	 * nothing — the caller joins explicitly via `tenancy.acceptInviteById`.
	 */
	pending_invites?: PendingInvite[];
	/**
	 * Raw opaque license token echoed back by /auth/me for license-token callers.
	 * `null` on the JWT path (Keycloak login → no opaque license token to forward)
	 * and on the dev-mode fallback. The auth store calls `setLicenseToken()` with
	 * this value so subsequent S2S calls can forward `X-Tenant-Id: Bearer <token>`.
	 */
	license_token: string | null;
	/**
	 * The `X-Active-Tenant-Id` the backend REFUSED for this request (unknown,
	 * suspended or deleted tenant). /auth/me still answers — as if no tenant
	 * were requested — so the SPA can drop the stale choice. Null/absent when
	 * nothing was refused (or on an orchestrator that predates the field).
	 */
	active_tenant_refused?: string | null;
}

export const auth = {
	/** Fetch current user from backend /auth/me (uses whatever token is on the client).
	 * Uses bootstrapGet because this runs *inside* initAuth() — awaiting the
	 * auth-ready gate here would deadlock on initAuth's own promise. */
	async me(): Promise<AuthMeUser | null> {
		try {
			return await bootstrapGet<AuthMeUser>('/auth/me');
		} catch (err) {
			// A real 401 means "not logged in" → null, so the caller renders the
			// login screen. Everything else (5xx, network failure, parse error)
			// means the backend is unreachable, NOT that the user is logged out.
			// Re-throw so `fetchUser()` can flip the health store to "backend
			// down" instead of silently rendering an empty logged-in shell.
			if (err instanceof ApiError && err.status === 401) {
				return null;
			}
			throw err;
		}
	},

	/** Best-effort backend logout. Keycloak redirect logout is handled by the auth store.
	 * The client-side teardown that actually ends the session lives in
	 * `clearUser()` (`$lib/stores/auth.svelte.ts`): it clears the HttpOnly
	 * `kc_token`/`license_token` cookies via `DELETE /auth/cookie`, flushes every
	 * per-user cache, and then redirects through `keycloak.logout()`. This used to
	 * also call a `clearAuthToken()` no-op, which cleared nothing — `Authorization`
	 * is read fresh from Keycloak per request and never stored. */
	async logout(): Promise<void> {
		try {
			await api.post<unknown>('/auth/logout');
		} catch {
			// Stateless — just discard client-side
		}
	}
};

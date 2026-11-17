// Auth store (Svelte 5 runes) — Keycloak-driven.
// Public surface (fetchUser, clearUser, getUser, isLoading, isAuthenticated)
// is preserved so callers like `+layout.svelte` keep working unchanged.

import { browser } from '$app/environment';
import { auth as authApi, type AuthMeUser } from '$lib/api/auth.js';
import {
	ApiError,
	clearLicenseToken,
	getActiveTenantId,
	isActiveTenantRefusal,
	setLicenseToken
} from '$lib/api/client.js';
// Leaf state module, NOT health.svelte.js: this file is reachable from
// $lib/api/client.ts, so importing the probe module would close an import
// cycle.
import { markBackendDown } from '$lib/stores/health-state.svelte.js';
import { isIdPlaceholder } from '$lib/utils/display-name';
import { invalidate as invalidateProjects } from '$lib/stores/projects.svelte.js';
import { invalidate as invalidateDrafts } from '$lib/stores/drafts.svelte.js';
import { invalidateAll as invalidateVerbatim } from '$lib/stores/verbatim.svelte.js';
import { invalidate as invalidateElements } from '$lib/stores/elements.svelte.js';
import { invalidate as invalidateAnnotations } from '$lib/stores/annotations.svelte.js';
import { invalidate as invalidateCheckpoints } from '$lib/stores/checkpoints.svelte.js';
import { wizard } from '$lib/stores/wizard.svelte.js';
import {
	getToken,
	getUserInfo,
	initKeycloak,
	isAuthenticated as kcIsAuthenticated,
	isBypassed,
	keycloak,
	logout as kcLogout
} from '$lib/services/keycloak.js';
import { toastError, toastWarning } from '$lib/stores/toast.svelte.js';
import { hasTenantAdmin } from '$lib/utils/auth-guards.js';

// One-shot guard: warn the user at most once per session that the cross-origin
// auth cookie couldn't be set (else a flaky /auth/cookie would toast repeatedly).
let cookieSyncWarned = false;

// HttpOnly cookie issuance — see src/routes/auth/cookie/+server.ts.
// Keycloak callers (the common path) get `license_token: null` from
// /auth/me by design — the JWT alone is enough for the proxy to inject
// `Authorization: Bearer <jwt>` downstream and let backend AuthMiddleware
// validate it. Sync as long as we have a JWT; the license_token cookie is
// only set when one was actually issued.
async function syncAuthCookies(): Promise<void> {
	if (!browser) return;
	// In the dev/e2e auth-bypass paths the cookies are pre-seeded externally
	// (e2e global-setup writes license_token + e2e_session). getToken() here
	// returns a SYNTHETIC non-JWT sentinel, so syncing would POST /auth/cookie
	// with {license_token: null, jwt: 'e2e-bypass-token'} — writing a bogus
	// kc_token cookie AND dropping the real license_token cookie. The proxy then
	// forwards the fake kc_token as Authorization with no X-Tenant-Id → 401 on
	// every /api call (this hung the post-promote E2E). Leave the seeded cookies
	// untouched.
	if (isBypassed()) return;
	const jwt = getToken();
	if (!jwt) return;
	const license = currentUser?.license_token ?? null;
	try {
		const response = await fetch('/auth/cookie', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${jwt}`
			},
			body: JSON.stringify({ license_token: license, jwt })
		});
		if (!response.ok) throw new Error(`/auth/cookie returned ${response.status}`);
	} catch (err) {
		// Cookie sync is best-effort. Header-based auth still works for
		// regular fetch() calls; only window.open / iframe-src loses the
		// fallback path. Don't block the user on a transient failure — but do
		// tell them ONCE so a later blank download page isn't a silent mystery.
		if (import.meta.env.DEV) console.warn('Auth cookie sync failed:', err);
		if (!cookieSyncWarned) {
			cookieSyncWarned = true;
			toastError(
				'Cross-origin auth unavailable',
				'File downloads and external opens may not work this session.'
			);
		}
	}
}

async function clearAuthCookies(): Promise<void> {
	if (!browser) return;
	// Never touch externally-seeded bypass cookies (see syncAuthCookies).
	if (isBypassed()) return;
	const jwt = getToken();
	if (!jwt) return;
	try {
		await fetch('/auth/cookie', {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${jwt}` }
		});
	} catch (err) {
		if (import.meta.env.DEV) console.warn('Auth cookie clear failed:', err);
	}
}

let currentUser = $state<AuthMeUser | null>(null);
let loading = $state(true);
let authReadyPromise: Promise<void> | null = null;

function makeDevUser(): AuthMeUser {
	return {
		sub: 'dev-user',
		email: 'dev@localhost',
		name: 'Dev User',
		preferred_username: 'dev',
		roles: ['admin'],
		license_token: null
	};
}

/**
 * Initialise Keycloak and fetch user detail.
 *
 * Call once on app mount (auto-invoked at bottom of this module in browser).
 * Callers can still use `fetchUser()` to re-sync user data after mutations.
 * The tenant licence plan is NOT part of the user — it is a tenant-level
 * licence read from `GET /api/license/status` by `licenseGate`.
 */
export async function initAuth(): Promise<void> {
	if (!browser) return;
	loading = true;
	try {
		const authed = await initKeycloak();
		if (authed) {
			// The token is IDENTITY only (sub / email / name). Roles and tenant
			// come exclusively from the orchestrator's /auth/me (fetchUser below):
			// a realm role in the token says nothing about this w2v tenant.
			const info = getUserInfo();
			if (info) {
				currentUser = {
					sub: info.id,
					email: info.email,
					name: info.name,
					preferred_username: info.preferred_username,
					roles: [],
					license_token: null
				};
			}

			keycloak.onAuthLogout = () => {
				currentUser = null;
			};

			// Refresh HttpOnly cookies whenever Keycloak rotates the access
			// token (the 10s polling loop in services/keycloak.ts calls
			// updateToken). Without this, cookies expire after their
			// fixed Max-Age while the in-memory JWT keeps rotating.
			keycloak.onAuthRefreshSuccess = () => {
				void syncAuthCookies();
			};

			await fetchUser();
		} else if (isBypassed()) {
			currentUser = makeDevUser();
		}
	} catch (err) {
		if (import.meta.env.DEV) console.error('Auth init failed:', err);
		if (import.meta.env.DEV) {
			currentUser = makeDevUser();
		} else {
			currentUser = null;
		}
	} finally {
		loading = false;
	}
}

/**
 * Clear the switcher's persisted tenant when the caller is not a member of it.
 * super_admin may act into any SWITCHABLE tenant (audited server-side), so
 * theirs stands here; a refused one is dropped by `meDroppingRefusedTenant`.
 * Only runs when the backend reports `memberships` (the P2 contract). Dynamic
 * import: the switcher store imports `$lib/api/client`, which imports this
 * module — a static import would close an evaluation-order cycle.
 */
async function dropStaleActiveTenant(me: AuthMeUser): Promise<boolean> {
	if (!Array.isArray(me.memberships)) return false;
	if ((me.roles ?? []).includes('super_admin')) return false;
	const { tenantSwitcher } = await import('$lib/stores/tenant-switcher.svelte.js');
	return tenantSwitcher.reconcile(me.memberships.map((m) => m.tenant_id));
}

/**
 * The backend refused the stored active tenant (unknown / suspended / deleted).
 * Unlike a membership mismatch this applies to a super_admin TOO: the choice is
 * never served, and keeping it emptied the shell (no roles → no picker → no way
 * back). Drop it and tell the user. `refusedId` undefined = drop whatever is set.
 */
async function dropRefusedActiveTenant(refusedId?: string | null): Promise<boolean> {
	const { tenantSwitcher, REFUSED_TENANT_NOTICE } =
		await import('$lib/stores/tenant-switcher.svelte.js');
	if (!tenantSwitcher.dropRefused(refusedId)) return false;
	toastWarning(REFUSED_TENANT_NOTICE.title, REFUSED_TENANT_NOTICE.description);
	return true;
}

/** Announce a drop made mid-session by the API client (it reloads onto home). */
async function announcePendingRefusal(): Promise<void> {
	const { tenantSwitcher, REFUSED_TENANT_NOTICE } =
		await import('$lib/stores/tenant-switcher.svelte.js');
	if (tenantSwitcher.consumeRefusedNotice()) {
		toastWarning(REFUSED_TENANT_NOTICE.title, REFUSED_TENANT_NOTICE.description);
	}
}

/**
 * `/auth/me`, healed against a refused active tenant: an orchestrator that
 * reports `active_tenant_refused` (or, predating it, 404s `TENANT_NOT_FOUND`
 * on /auth/me itself) gets the stored choice dropped and is asked again.
 */
async function meDroppingRefusedTenant(): Promise<AuthMeUser | null> {
	let me: AuthMeUser | null;
	try {
		me = await authApi.me();
	} catch (err) {
		const refused =
			err instanceof ApiError &&
			isActiveTenantRefusal(err.status, err.code, '/auth/me', err.details) &&
			(await dropRefusedActiveTenant(getActiveTenantId()));
		if (!refused) throw err;
		return authApi.me();
	}
	if (me?.active_tenant_refused && (await dropRefusedActiveTenant(me.active_tenant_refused))) {
		me = (await authApi.me()) ?? me;
	}
	return me;
}

/** Refresh backend user detail for an already-authenticated user. */
export async function fetchUser(): Promise<void> {
	if (!browser) return;
	if (!kcIsAuthenticated() && !isBypassed()) {
		currentUser = null;
		return;
	}
	try {
		await announcePendingRefusal();
		let backendUser = await meDroppingRefusedTenant();
		// A persisted `X-Active-Tenant-Id` that is not one of the caller's
		// memberships is refused by the backend (NO_MEMBERSHIP) — and /auth/me,
		// which is exempt, answers it with `tenant_id: null`, which would read as
		// "no workspace" for a user who has several. Drop it and ask again.
		if (backendUser && (await dropStaleActiveTenant(backendUser))) {
			backendUser = (await authApi.me()) ?? backendUser;
		}
		if (backendUser) {
			// On the licence-token path /auth/me's `name` is the subject id, not a
			// name — keep the identity token's real name rather than clobber it.
			const name = isIdPlaceholder(backendUser.name, backendUser)
				? currentUser?.name || backendUser.name
				: backendUser.name;
			currentUser = {
				...(currentUser ?? {}),
				...backendUser,
				name,
				// Roles come ONLY from /auth/me. An empty list means no roles —
				// never a fallback to the token's realm roles.
				roles: backendUser.roles ?? [],
				email: backendUser.email ?? currentUser?.email ?? null
			} as AuthMeUser;
		}
	} catch (err) {
		if (import.meta.env.DEV) console.error('Failed to fetch /auth/me:', err);
		// Distinguish "backend is dead" from "auth missing": 5xx, network
		// errors, or any non-ApiError exception (e.g. fetch threw) mean the
		// orchestrator is unreachable. Flip the health store to 'down' so the
		// layout renders a clear "Backend unavailable" screen instead of an
		// empty logged-in shell. 4xx (401/403) leave health untouched — those
		// are real auth/authz failures, not backend outages.
		const status = err instanceof ApiError ? err.status : 0;
		if (status === 0 || status >= 500) {
			markBackendDown();
		}
	} finally {
		// /auth/me echoes back the raw license token for license-token callers
		// (null on the JWT path). Plumb it into the API client so subsequent
		// S2S calls can forward `X-Tenant-Id: Bearer <token>`. See CLAUDE.md
		// "Auth — license token + tenant forwarding".
		setLicenseToken(currentUser?.license_token ?? null);
		// Plant HttpOnly cookies so the SvelteKit proxy can authenticate
		// header-less navigations (e.g. `window.open('/api/.../html')`) on
		// behalf of the SPA. See src/routes/auth/cookie/+server.ts.
		await syncAuthCookies();
	}
}

export async function clearUser(): Promise<void> {
	// Clear cookies BEFORE Keycloak logout — the DELETE endpoint requires a
	// well-formed JWT and kcLogout() invalidates the session.
	await clearAuthCookies();
	currentUser = null;
	// Flush every per-user cache the SPA holds in module-level $state. Without
	// this, a logout-then-login-as-different-user (or even same-user re-auth
	// after a license rotation) inherits the previous session's projects,
	// drafts, verbatim, elements, annotations, checkpoints, and wizard input.
	// Backend tenancy guards the data on the wire, but the SPA's in-memory
	// view does not — keep them in sync.
	clearLicenseToken();
	invalidateProjects();
	invalidateDrafts();
	invalidateVerbatim();
	invalidateElements();
	invalidateAnnotations();
	invalidateCheckpoints();
	wizard.resetWizard();
	if (!isBypassed()) {
		await kcLogout().catch((err) => {
			if (import.meta.env.DEV) console.error('Keycloak logout failed:', err);
		});
	}
}

export function getUser(): AuthMeUser | null {
	return currentUser;
}

export function isLoading(): boolean {
	return loading;
}

export function isAuthenticated(): boolean {
	return currentUser !== null;
}

/**
 * Resolves once `initAuth()` has finished (success or caught-failure). Callers
 * that must not fire token-authenticated fetches before Keycloak is ready
 * should `await ensureAuthReady()` — e.g. the root `+layout.ts` load function.
 * Repeated calls share the same in-flight promise, so there is only one init.
 */
export function ensureAuthReady(): Promise<void> {
	if (!browser) return Promise.resolve();
	if (!authReadyPromise) {
		authReadyPromise = initAuth();
	}
	return authReadyPromise;
}

// ---------------------------------------------------------------------------
// Role helpers (ported from fr, trimmed to what w2v actually needs)
// ---------------------------------------------------------------------------

export function hasRole(role: string): boolean {
	return currentUser?.roles?.includes(role) ?? false;
}

export function isAdmin(): boolean {
	return hasRole('admin');
}

export function isPowerUser(): boolean {
	return hasRole('admin') || hasRole('power-user');
}

// Tenancy realm roles (super_admin > tenant_admin > member), adopted from
// commonpractice's proven admin-tier model. `super_admin` is a COMPOSITE of
// `tenant_admin` — it passes the tenant gate too. These are orthogonal to the
// product flags above (isAdmin / isPowerUser), which stay as-is. All of them read
// the roles `/auth/me` reported — never the Keycloak token.
export function isSuperAdmin(): boolean {
	return hasRole('super_admin');
}

/**
 * The caller's MEMBERSHIP role in the active tenant (P2: `tenant_members.role`,
 * from `/auth/me.role`). Null when there is no membership, for a super_admin
 * acting into a tenant they do not belong to, or under claim-mode tenancy.
 */
export function getMembershipRole(): string | null {
	return currentUser?.role ?? null;
}

/**
 * Tenant-admin gate on the w2v membership role from `/auth/me` (see
 * `hasTenantAdmin`): a `role: 'member'` is never outranked by anything in
 * `roles`, and no input comes from the Keycloak token.
 */
export function isTenantAdmin(): boolean {
	return hasTenantAdmin(currentUser);
}

/**
 * True when the backend says this caller has no workspace (`tenant_id: null`).
 * A super_admin is exempt: the platform screens need no workspace.
 */
export function hasNoWorkspace(): boolean {
	return currentUser !== null && currentUser.tenant_id === null && !isSuperAdmin();
}

export function canAccessAdmin(): boolean {
	return isTenantAdmin();
}

// Test-only setter. DO NOT use in production code — currentUser is driven by
// initAuth/fetchUser. Exported under a __ prefix to signal "internal".
// The module has side effects (see the `if (browser)` block below), so it
// cannot be tree-shaken out of prod bundles; guard the body instead to
// neutralise the symbol at runtime.
export function __setUserForTest(user: AuthMeUser | null): void {
	if (!import.meta.env.DEV && import.meta.env.MODE !== 'test') return;
	currentUser = user;
}

if (browser) {
	void ensureAuthReady();
}

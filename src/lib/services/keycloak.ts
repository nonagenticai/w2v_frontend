// src/lib/services/keycloak.ts
// Keycloak client for the w2v frontend. Standard PKCE browser flow against
// the realm in VITE_KEYCLOAK_REALM (`w2v` since the Studio realm cutover) on
// auth.nonagentic.ai. Mirrors the `fr` frontend pattern.

import Keycloak from 'keycloak-js';
// Leaf state module, NOT health.svelte.js: this file is reachable from
// $lib/api/client.ts, so importing the probe module would close an import
// cycle.
import { stopHealthPolling } from '$lib/stores/health-state.svelte.js';

const keycloakConfig = {
	url: import.meta.env.VITE_KEYCLOAK_URL,
	realm: import.meta.env.VITE_KEYCLOAK_REALM,
	clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'w2v-frontend'
};

export const keycloak = new Keycloak(keycloakConfig);

let bypassed = false;

export function isBypassed(): boolean {
	return bypassed;
}

function hasE2ECookie(): boolean {
	// Two-cookie test-mode marker for the Playwright post-promote matrix.
	// Both must be present: `e2e_session=1` AND a non-empty `license_token`.
	// Set jointly by w2v_frontend/e2e/global-setup.ts before Playwright opens
	// a page. The SSR `/api/*` proxy already reads `license_token` from the
	// cookie jar and forwards it as `X-Tenant-Id: Bearer …` upstream — this
	// hook just teaches the SPA's client-side Keycloak.js to NOT race a full
	// OIDC redirect against that cookie-based flow.
	//
	// Threat model: a visitor with a valid `license_token` who also sets
	// `e2e_session=1` gains SPA access without the Keycloak realm login UI.
	// That visitor already has API access via the token (license_token is
	// the underlying auth currency); the SPA bypass does not grant new
	// capability, only skips the user-facing OIDC dance.
	if (typeof document === 'undefined') return false;
	const cookies = document.cookie.split(';').map((c) => c.trim());
	const hasMarker = cookies.some((c) => c.startsWith('e2e_session=1'));
	if (!hasMarker) return false;
	const hasLicense = cookies.some(
		(c) => c.startsWith('license_token=') && c.length > 'license_token='.length
	);
	return hasLicense;
}

export async function initKeycloak(): Promise<boolean> {
	// Dev escape hatch: skip Keycloak entirely when VITE_AUTH_BYPASS=true.
	// REQUIRES `import.meta.env.DEV` (vite dev server) — refuse to honour
	// the bypass in production builds even if the env var leaks in, since
	// the mock user is minted with `roles: ['admin', 'power-user']` and a
	// bogus `dev-bypass-token`. Without the DEV guard, an accidental
	// VITE_AUTH_BYPASS=true in a prod build env auto-authenticates every
	// visitor as admin.
	if (import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true') {
		console.warn('[AUTH BYPASS] Keycloak disabled — using mock dev user');
		bypassed = true;
		const kc = keycloak as unknown as {
			authenticated: boolean;
			token: string;
			tokenParsed: Record<string, unknown>;
		};
		kc.authenticated = true;
		kc.token = 'dev-bypass-token';
		kc.tokenParsed = {
			sub: 'dev-user-00000000',
			email: 'dev@localhost',
			name: 'Dev User',
			preferred_username: 'dev',
			realm_access: { roles: ['admin', 'power-user'] }
		};
		return true;
	}

	// E2E test-mode bypass for the post-promote Playwright matrix. Requires
	// the joint `e2e_session=1` + `license_token=…` cookies set by
	// w2v_frontend/e2e/global-setup.ts. Honoured in production builds because
	// the matrix runs against the LIVE in-cluster frontend image (port-forwarded
	// from the runner) — there is no dev-server option in that path. See the
	// hasE2ECookie() docstring for the threat-model note.
	if (hasE2ECookie()) {
		console.warn(
			'[AUTH BYPASS] e2e_session cookie detected — Keycloak skipped, using license_token cookie path'
		);
		bypassed = true;
		const kc = keycloak as unknown as {
			authenticated: boolean;
			token: string;
			tokenParsed: Record<string, unknown>;
		};
		kc.authenticated = true;
		// `token` is only used to attach Authorization headers on the SPA's
		// own fetch() calls; the SSR proxy re-attaches X-Tenant-Id from the
		// license_token cookie regardless, so any non-empty value works here.
		kc.token = 'e2e-bypass-token';
		kc.tokenParsed = {
			sub: 'e2e-user-00000000',
			email: 'e2e@nonagentic.ai',
			name: 'E2E Test User',
			preferred_username: 'e2e',
			realm_access: { roles: ['admin', 'power-user'] }
		};
		return true;
	}

	try {
		// onLoad: 'login-required' delegates the "are you signed in" decision
		// to Keycloak. On every fresh load:
		//   - If the user has a valid SSO session cookie at auth.nonagentic.ai
		//     (the realm's SSO Session Idle hasn't elapsed), Keycloak silently
		//     redirects back with a fresh code → init exchanges → returns true.
		//   - If no SSO session, the user sees Keycloak's branded login UI.
		//     After login, redirect back, init returns true.
		// Without an onLoad, init returns false on every refresh (no SSO check
		// happens) and the user has to click an in-page Sign-in button on
		// every reload — which is the bug this replaces.
		//
		// 'check-sso' was tried previously and rejected (see git history): it
		// uses prompt=none which created a URL-bar bounce on every mount, and
		// 'silentCheckSsoFallback' via iframe relies on 3rd-party cookies that
		// modern browsers block. 'login-required' is full-page (no iframe), no
		// prompt=none (Keycloak does its own cookie check), and we disable
		// the iframe fallback so a failure surfaces as a thrown error instead
		// of a hung iframe.
		const authenticated = await keycloak.init({
			onLoad: 'login-required',
			pkceMethod: 'S256',
			checkLoginIframe: false,
			silentCheckSsoFallback: false
		});

		// keycloak-js strips the callback fragment inside init(), but it runs
		// concurrently with SvelteKit's hydration, and the router can write
		// its captured (fragment-bearing) URL back into history. The leftover
		// `#state=…&code=…` then leaked into every later `location.href` use
		// (including the logout redirect). Strip it again once init settles;
		// a no-op when keycloak-js already did.
		clearKeycloakCallbackFragment();

		if (authenticated) {
			setupTokenRefresh();
		}
		return authenticated;
	} catch (error) {
		console.error('Failed to initialize Keycloak:', error);
		// Defensive: if the URL has a callback fragment (#state=..., #code=...),
		// clear it so a reload can't re-feed the same dead code back into init().
		// Without this, a failed code exchange causes an infinite loop where the
		// 401 handler calls keycloak.login(), Keycloak redirects back with
		// another code appended to the fragment, and we retry with the SAME
		// stale first-code-wins parse. Symptoms: URL fragment grows with
		// dozens of stacked state/session_state/iss/code tuples.
		clearKeycloakCallbackFragment();
		throw error;
	}
}

export function clearKeycloakCallbackFragment(): void {
	if (typeof window === 'undefined') return;
	const hash = window.location.hash;
	if (!hash) return;
	// Only clear hashes that look like a Keycloak callback (contain state=
	// or code=). Leave unrelated app hashes (e.g. #section-anchor) alone.
	if (!hash.includes('state=') && !hash.includes('code=')) return;
	history.replaceState(null, '', window.location.pathname + window.location.search);
}

const REFRESH_POLL_INTERVAL_MS = 10_000;
const REFRESH_MIN_VALIDITY_S = 60;

// Backoff between refresh attempts — one entry per *gap*, so at
// REFRESH_MAX_ATTEMPTS=3 only the first two are ever used (~3s of total delay
// before a definitive failure redirects). The third entry is headroom: raising
// REFRESH_MAX_ATTEMPTS to 4 needs no second edit here.
const REFRESH_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];
const REFRESH_MAX_ATTEMPTS = 3;

let refreshIntervalId: ReturnType<typeof setInterval> | null = null;
let visibilityHandlerAttached = false;
// Guards against a second poll tick (or a visibility-triggered refresh)
// starting while a retry sequence is still backing off.
let refreshCycleInFlight = false;

// Single-flight redirect. `keycloak.login()` triggers a window.location
// navigation — concurrent callers must NOT each fire one, both because
// it's wasteful and because the second navigation can interrupt the first
// mid-flight (the symptom: URL flickers, code-exchange fails). Once the
// promise is set, every other caller awaits the same handle. The promise
// resolves only after navigation completes (in production: effectively
// never, the page unloads first).
let redirectInFlight: Promise<void> | null = null;

async function redirectToLoginOnce(): Promise<void> {
	if (!redirectInFlight) {
		clearKeycloakCallbackFragment();
		redirectInFlight = keycloak.login().catch((err) => {
			console.error('Keycloak login redirect failed:', err);
		});
	}
	return redirectInFlight;
}

/**
 * True when the refresh token is definitely unusable — i.e. the session is
 * really dead and retrying cannot help.
 *
 * keycloak-js rejects `updateToken()` bare (no HTTP status, often no message),
 * so the rejection value itself can classify nothing. The only reliable signal
 * available client-side is the parsed refresh token's own `exp`. An absent
 * `refreshTokenParsed` means we never had (or have lost) a refresh token, which
 * is equally terminal.
 */
function isRefreshTokenExpired(): boolean {
	const exp: number | undefined = keycloak.refreshTokenParsed?.exp;
	if (typeof exp !== 'number') return true;
	return exp <= Date.now() / 1000;
}

function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Single place where the refresh retry policy lives — used by BOTH the 10s
 * poll and the per-request `ensureFreshToken()`.
 *
 * A single `updateToken` rejection used to end the session outright, so one
 * transient network blip during a 15-25 minute pipeline run logged the tester
 * out. Now: if the refresh token is still within its own `exp`, the rejection
 * is treated as transient and retried (3 attempts, ~1s/2s backoff between
 * them). Expiry is re-checked between attempts because the token can lapse
 * mid-backoff. If the refresh token IS expired the session really is dead, so
 * we bail on the FIRST rejection with no delay — the pre-existing behaviour.
 *
 * @returns whether the access token is now fresh.
 */
async function refreshWithRetry(minValidity: number): Promise<boolean> {
	for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
		try {
			await keycloak.updateToken(minValidity);
			return true;
		} catch {
			if (isRefreshTokenExpired()) return false;
			if (attempt === REFRESH_MAX_ATTEMPTS) return false;
			await sleep(REFRESH_BACKOFF_MS[attempt - 1]);
			// The refresh token can lapse while we were backing off.
			if (isRefreshTokenExpired()) return false;
		}
	}
	return false;
}

/**
 * Background (non-request-bound) refresh: retry, and on definitive failure
 * stop polling so we don't fire login() every 10s for the rest of the page
 * lifecycle, then redirect exactly once.
 */
async function runBackgroundRefresh(): Promise<void> {
	if (refreshCycleInFlight) return;
	refreshCycleInFlight = true;
	try {
		const fresh = await refreshWithRetry(REFRESH_MIN_VALIDITY_S);
		if (!fresh) {
			stopRefreshInterval();
			console.error('Keycloak refresh failed after retries — redirecting to login');
			void redirectToLoginOnce();
		}
	} finally {
		refreshCycleInFlight = false;
	}
}

function startRefreshInterval(): void {
	if (refreshIntervalId !== null) return;
	refreshIntervalId = setInterval(() => {
		void runBackgroundRefresh();
	}, REFRESH_POLL_INTERVAL_MS);
}

function stopRefreshInterval(): void {
	if (refreshIntervalId !== null) {
		clearInterval(refreshIntervalId);
		refreshIntervalId = null;
	}
}

function attachVisibilityHandler(): void {
	if (visibilityHandlerAttached) return;
	if (typeof document === 'undefined') return;
	visibilityHandlerAttached = true;
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			stopRefreshInterval();
		} else if (keycloak.authenticated) {
			// Refresh ONCE immediately: the tab may have been backgrounded for
			// minutes, so waiting up to a full poll interval for the first
			// refresh leaves a window where outbound requests carry a stale
			// (or expired) Bearer. Then resume polling.
			void runBackgroundRefresh();
			startRefreshInterval();
		}
	});
}

function setupTokenRefresh(): void {
	attachVisibilityHandler();
	if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
		// Tab starts in background — don't poll until it foregrounds.
		return;
	}
	startRefreshInterval();
}

export function login(): Promise<void> {
	return keycloak.login();
}

/**
 * The post-logout redirect target. It must match the client's "Valid post
 * logout redirect URIs" in Keycloak EXACTLY — that is the app root with a
 * trailing slash (`https://w2v.nonagentic.ai/`). keycloak-js defaults to
 * `location.href`, which carries the current path and, right after login,
 * the OIDC callback fragment; Keycloak then rejects it with an
 * "invalid redirect uri" page and the user is stranded on auth.nonagentic.ai.
 */
export function postLogoutRedirectUri(): string {
	return window.location.origin + '/';
}

export function logout(): Promise<void> {
	stopRefreshInterval();
	stopHealthPolling();
	return keycloak.logout({ redirectUri: postLogoutRedirectUri() });
}

export function getToken(): string | undefined {
	return keycloak.token;
}

/**
 * Refresh the access token if it expires within `minValidity` seconds and
 * return the live token. Callers should `await` this on every outbound
 * request so the attached Bearer is always current — caching the value at
 * login time produces silent JWTExpired bursts a few minutes after sign-in,
 * especially when the tab was backgrounded long enough for the browser to
 * suspend our 10s polling interval (Chrome aggressively throttles inactive
 * tabs). A rejection is retried per `refreshWithRetry()` (transient blips do
 * NOT end the session); only a definitive failure redirects to Keycloak, where
 * with onLoad:'login-required' the round-trip is silent if the SSO session is
 * still valid.
 *
 * Returns undefined when not authenticated (e.g. mid-init). On refresh
 * failure the function AWAITS the single-flight Keycloak redirect — in
 * production the page navigates away before this resolves, so concurrent
 * callers are suspended cleanly instead of falling through to fire unauth
 * requests and surface 401s in the console gap before navigation.
 */
export async function ensureFreshToken(minValidity: number = 30): Promise<string | undefined> {
	if (bypassed) return keycloak.token;
	if (!keycloak.authenticated) return undefined;
	const fresh = await refreshWithRetry(minValidity);
	if (!fresh) {
		stopRefreshInterval();
		// Block here until the redirect completes (in production: never,
		// since window.location replaces the document). If the redirect
		// promise rejects synchronously (e.g. keycloak adapter teardown),
		// we still fall through to return undefined and the caller fires
		// an unauthenticated request — better than hanging forever.
		await redirectToLoginOnce();
		return undefined;
	}
	return keycloak.token;
}

export function isAuthenticated(): boolean {
	return keycloak.authenticated ?? false;
}

export interface KeycloakUserInfo {
	id: string;
	email: string | null;
	name: string;
	preferred_username: string;
	roles: string[];
}

export function getUserInfo(): KeycloakUserInfo | null {
	const parsed = keycloak.tokenParsed as
		| {
				sub?: string;
				email?: string;
				name?: string;
				preferred_username?: string;
				realm_access?: { roles?: string[] };
		  }
		| undefined;
	if (!parsed?.sub) return null;
	return {
		id: parsed.sub,
		email: parsed.email ?? null,
		name: parsed.name ?? parsed.preferred_username ?? parsed.sub,
		preferred_username: parsed.preferred_username ?? parsed.sub,
		roles: parsed.realm_access?.roles ?? []
	};
}

export function manageAccount(): Promise<void> {
	return keycloak.accountManagement();
}

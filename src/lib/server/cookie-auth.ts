// Single source of truth for the SvelteKit proxy's cookie-auth fallback.
//
// The SPA normally attaches `Authorization: Bearer <jwt>` and
// `X-Tenant-Id: Bearer <license_token>` on every /api/* fetch (see
// `$lib/api/client.ts`). Browser-initiated navigations that AREN'T fetch/XHR
// — `window.open(...)`, an `<a href="/api/...">` click, an `<iframe src>` —
// can't attach headers. After login the SPA POSTs both tokens to
// `/auth/cookie`, which plants them as HttpOnly cookies (writer); the `/api`
// proxy reads them back as a fallback (reader). Both sides MUST agree on the
// cookie names + options, so they live here.
//
// NOTE: `server.js` (the production Node proxy) reimplements this same
// fallback because it runs outside the SvelteKit/`$lib` module graph and
// can't import this file. That duplication is intentional and documented in
// the repo CLAUDE.md — keep the two in sync by hand.

import type { Cookies } from '@sveltejs/kit';

/** Keycloak JWT cookie — mirrors `Authorization: Bearer <jwt>`. */
export const KC_COOKIE = 'kc_token';
/** License-token cookie — mirrors `X-Tenant-Id: Bearer <license_token>`. */
export const LICENSE_COOKIE = 'license_token';

/**
 * Base cookie options shared by the writer's `set`/`delete` and used to keep
 * them symmetric. `secure` is on for https and off for http so a dev
 * (`http://localhost`) browser doesn't silently drop the cookie. The writer
 * layers `maxAge` on top for `set`.
 */
export function cookieAuthOptions(secure: boolean) {
	return { path: '/', httpOnly: true, secure, sameSite: 'lax' as const };
}

/**
 * Apply the cookie→header auth fallback to an outbound proxy request, then
 * strip the cookie header. Headers always win over cookies, so a normal
 * fetch() from the SPA (which sets its own headers) is unaffected.
 *
 * CSRF-read defense: the auth cookies are `SameSite=Lax`, so the browser
 * still sends them on a cross-site *top-level GET navigation* — a victim
 * clicking an attacker's link to `/api/<artifact>` would otherwise read
 * tenant data with the victim's credentials. Refuse the cookie fallback
 * whenever the request is cross-site. `Sec-Fetch-Site` is emitted by every
 * browser that could hold these cookies; same-origin / same-site /
 * direct-navigation (`none`) and non-browser callers (header absent) are
 * unaffected.
 *
 * The cookie header is stripped from the upstream call regardless — backend
 * services don't speak the SvelteKit cookie shape, and forwarding cookies
 * that happen to carry auth material is a needless extra surface.
 *
 * Do NOT log token values — this only reads and forwards them.
 */
export function applyCookieAuthFallback(
	headers: Headers,
	cookies: Cookies,
	secFetchSite: string | null
): void {
	const cookieAuthAllowed = secFetchSite !== 'cross-site';
	const licCookie = cookies.get(LICENSE_COOKIE);

	// PRECEDENCE on `Authorization`, highest first:
	//   1. an Authorization header the caller already set  (never touched)
	//   2. the Keycloak JWT cookie                         (kc_token)
	//   3. the licence token cookie                        (license_token)
	// Rungs 2 and 3 are mutually exclusive: the licence token is only promoted
	// onto Authorization when nothing has claimed that header.
	if (cookieAuthAllowed && !headers.has('authorization')) {
		const kcCookie = cookies.get(KC_COOKIE);
		if (kcCookie) headers.set('Authorization', `Bearer ${kcCookie}`);
	}
	if (cookieAuthAllowed && !headers.has('x-tenant-id')) {
		if (licCookie) headers.set('X-Tenant-Id', `Bearer ${licCookie}`);
	}

	// The licence token ALSO goes on Authorization when that header is still
	// free. Why: w2v-orchestrator is moving behind the `license-authz` Istio
	// ext-authz gate, and that gate reads the licence token ONLY from
	// `Authorization: Bearer <token>` — it never looks at `X-Tenant-Id`. A
	// browser session authenticated by licence token alone (no kc_token) would
	// otherwise reach the gate with no credential it can read, and get a 401.
	//
	// Expand half of an expand/contract: `X-Tenant-Id` is KEPT, so this is safe
	// to deploy in any order relative to the gate. Today's orchestrator ignores
	// the new header — its middleware enters the JWT branch only when the
	// bearer `_looks_like_jwt()`, and an opaque licence token is not
	// JWT-shaped — and still authenticates off `X-Tenant-Id`.
	if (cookieAuthAllowed && !headers.has('authorization') && licCookie) {
		headers.set('Authorization', `Bearer ${licCookie}`);
	}

	headers.delete('cookie');
}

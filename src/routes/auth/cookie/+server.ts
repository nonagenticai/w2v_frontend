// HttpOnly cookie issuance for the SvelteKit proxy auth fallback.
//
// Why this exists
// ---------------
// The SPA normally attaches `Authorization: Bearer <jwt>` and
// `X-Tenant-Id: Bearer <license_token>` on every /api/* fetch via
// $lib/api/client.ts. Headers cannot be attached to a `window.open(...)`
// or any other browser-initiated navigation that isn't an XHR/fetch.
//
// Plan E2 (Option A — frontend-only) bridges that gap: after login, the
// SPA POSTs both tokens here; we set them as HttpOnly+Secure+SameSite=Lax
// cookies on the same origin. The proxy at `/api/[...path]/+server.ts`
// reads these cookies as a fallback when the inbound request lacks the
// usual Authorization / X-Tenant-Id headers, and injects them on the
// outbound proxied request. Backend AuthMiddleware sees the same shape
// it always saw — no backend changes required.
//
// Auth on this endpoint itself
// ----------------------------
// We require a well-formed `Authorization: Bearer <jwt>` on the request.
// The SPA already holds the JWT when it calls us, so this is cheap, and
// it stops a random unauthenticated POST from setting cookies for someone
// else's tenant. The cookies' VALIDITY is enforced downstream by the
// backend AuthMiddleware on every proxied call — this endpoint just
// gates who can plant them in this browser.

import { KC_COOKIE, LICENSE_COOKIE, cookieAuthOptions } from '$lib/server/cookie-auth';
import type { RequestHandler } from './$types';

// 1 hour. Tokens may have longer or shorter natural TTL — the SPA
// re-calls POST /auth/cookie on token refresh to keep cookies fresh.
const MAX_AGE_S = 3600;

interface CookieBody {
	license_token?: unknown;
	jwt?: unknown;
}

function isWellFormedBearer(header: string | null): boolean {
	if (!header) return false;
	const m = header.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
	return m !== null;
}

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	if (!isWellFormedBearer(request.headers.get('authorization'))) {
		return new Response(null, { status: 401 });
	}

	let body: CookieBody;
	try {
		body = (await request.json()) as CookieBody;
	} catch {
		return new Response(null, { status: 400 });
	}

	// JWT is mandatory (the only thing every authed caller has). The
	// license_token is optional — Keycloak callers come in with a null
	// license_token by design (see w2v_orchestrator/src/api/routes/auth.py
	// `auth_me`); they only need kc_token for the proxy fallback.
	const jwt = typeof body.jwt === 'string' ? body.jwt : '';
	const license =
		typeof body.license_token === 'string' && body.license_token.length > 0
			? body.license_token
			: null;
	if (!jwt) {
		return new Response(null, { status: 400 });
	}

	// In dev (http://localhost), `secure: true` would cause the browser to
	// silently drop the cookie. Mirror SvelteKit's own session-cookie
	// convention: secure on https, off on http.
	const secure = url.protocol === 'https:';

	const base = cookieAuthOptions(secure);
	const opts = { ...base, maxAge: MAX_AGE_S };
	if (license !== null) {
		cookies.set(LICENSE_COOKIE, license, opts);
	} else {
		// License missing now — clear any stale cookie so we don't pin an
		// old value if the user was previously license-bearing and isn't now.
		cookies.delete(LICENSE_COOKIE, base);
	}
	cookies.set(KC_COOKIE, jwt, opts);

	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, cookies, url }) => {
	if (!isWellFormedBearer(request.headers.get('authorization'))) {
		// Even on logout we require a JWT — otherwise an unauthenticated
		// caller could clear another tab's cookies. If the JWT is already
		// invalid the worst case is the user manually clears cookies.
		return new Response(null, { status: 401 });
	}

	const secure = url.protocol === 'https:';
	const opts = cookieAuthOptions(secure);
	cookies.delete(LICENSE_COOKIE, opts);
	cookies.delete(KC_COOKIE, opts);

	return new Response(null, { status: 204 });
};

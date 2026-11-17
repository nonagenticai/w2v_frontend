// Cookie→header auth fallback for the production Node proxy (`server.js`).
//
// Extracted from server.js so it can be unit-tested: server.js calls
// `server.listen()` at import time and cannot be imported by a test. Same
// arrangement as server-backpressure.js. Plain ESM, no dependencies — this
// file is loaded by `node server.js` OUTSIDE the SvelteKit/`$lib` module
// graph, which is why it cannot simply import `$lib/server/cookie-auth.ts`.
// The two implementations are duplicated on purpose; keep them in sync
// (repo CLAUDE.md § Gotchas).
//
// Cookie-based auth fallback exists for navigation-style /api/* requests that
// can't attach Authorization / X-Tenant-Id headers themselves (window.open,
// <a href="/api/...">, <iframe src>, EventSource). The SPA writes these
// cookies via POST /auth/cookie after Keycloak login. Headers always win over
// cookies, so a normal authed fetch() is unaffected.
//
// Do NOT log token values — this only reads and forwards them.

/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
	/** @type {Record<string, string>} */
	const out = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq <= 0) continue;
		const k = part.slice(0, eq).trim();
		const v = part.slice(eq + 1).trim();
		if (k) out[k] = decodeURIComponent(v);
	}
	return out;
}

// Parse the `exp` claim out of a JWT without verifying the signature.
// We only use this to decide "is this cookie already past its useful life
// — and therefore a guaranteed 401 if we forward it." Returns +Infinity on
// any parse failure so a malformed cookie still gets forwarded (the
// orchestrator will reject it with a precise reason); we only short-circuit
// when we're certain the token is expired.
/**
 * @param {unknown} token
 * @returns {number}
 */
export function jwtExpEpochSeconds(token) {
	if (typeof token !== 'string') return Number.POSITIVE_INFINITY;
	const parts = token.split('.');
	if (parts.length !== 3) return Number.POSITIVE_INFINITY;
	try {
		const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
		const claims = JSON.parse(payload);
		const exp = Number(claims?.exp);
		return Number.isFinite(exp) ? exp : Number.POSITIVE_INFINITY;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * Mutate `req.headers` in place: cookie → header fallback, then strip the
 * cookie header.
 *
 * CSRF-read defense: the auth cookies are SameSite=Lax, so the browser still
 * sends them on a cross-site *top-level GET navigation* (a victim clicking an
 * attacker's link to /api/<artifact>). Refuse the cookie fallback for any
 * cross-site request. Sec-Fetch-Site is set by every browser that could hold
 * these cookies; same-origin / same-site / direct-nav (`none`) and non-browser
 * callers (header absent) are unaffected. Mirrors src/routes/api/[...path].
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {void}
 */
export function injectCookieAuth(req) {
	const cookies = parseCookies(req.headers.cookie);
	const cookieAuthAllowed = req.headers['sec-fetch-site'] !== 'cross-site';

	// PRECEDENCE on `Authorization`, highest first:
	//   1. an Authorization header the caller already set  (never touched)
	//   2. the Keycloak JWT cookie                         (kc_token)
	//   3. the licence token cookie                        (license_token)
	// Rungs 2 and 3 are mutually exclusive: the licence token is only
	// promoted onto Authorization when nothing has claimed that header.
	let authorizationSet = Boolean(req.headers['authorization']);

	if (cookieAuthAllowed && !authorizationSet && cookies.kc_token) {
		// Cookies outlive the JWT they wrap (the cookie's Max-Age is fixed at
		// issuance; the inner JWT has a short hard `exp`). Forwarding an
		// already-expired cookie produces a guaranteed 401 — worse, it masks
		// the real client-side bug where the SPA failed to attach a fresh
		// Bearer. Skip the fallback when we can prove the token is dead.
		const expSec = jwtExpEpochSeconds(cookies.kc_token);
		const nowSec = Math.floor(Date.now() / 1000);
		if (expSec > nowSec) {
			req.headers['authorization'] = `Bearer ${cookies.kc_token}`;
			authorizationSet = true;
		}
	}

	if (cookieAuthAllowed && !req.headers['x-tenant-id'] && cookies.license_token) {
		req.headers['x-tenant-id'] = `Bearer ${cookies.license_token}`;
	}

	// The licence token ALSO goes on Authorization when that header is still
	// free. Why: w2v-orchestrator is moving behind the `license-authz` Istio
	// ext-authz gate, and that gate reads the licence token ONLY from
	// `Authorization: Bearer <token>` — it never looks at `x-tenant-id`. A
	// browser session authenticated by licence token alone (no kc_token) would
	// otherwise reach the gate with no credential it can read, and get a 401.
	//
	// This is the expand half of an expand/contract: `x-tenant-id` is KEPT, so
	// the change is safe to deploy in any order relative to the gate. Today's
	// orchestrator ignores the new header — its middleware enters the JWT
	// branch only when the bearer `_looks_like_jwt()`, and an opaque licence
	// token is not JWT-shaped — and still authenticates off `x-tenant-id`.
	if (cookieAuthAllowed && !authorizationSet && cookies.license_token) {
		req.headers['authorization'] = `Bearer ${cookies.license_token}`;
	}

	// Don't forward the cookie header upstream — backend doesn't speak it
	// and forwarding auth-bearing cookies is needless extra surface.
	delete req.headers['cookie'];
}

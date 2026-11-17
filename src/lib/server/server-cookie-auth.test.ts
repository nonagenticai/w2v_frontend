// Regression cover for the PRODUCTION Node proxy's cookie→header auth
// fallback (`../../../server-cookie-auth.js`, called from `server.js`).
//
// ⚠️ WHY THE `Authorization` ASSERTIONS EXIST — this is an outage gate, not
// a style preference. `w2v-orchestrator` is being put behind the
// `license-authz` Istio ext-authz gate, and that gate reads the licence token
// ONLY from `Authorization: Bearer <token>`; it never looks at `X-Tenant-Id`
// on the way in. Before this fix the proxy put the licence token exclusively
// on `X-Tenant-Id`, so every browser session authenticated by licence token
// alone — no `kc_token` — would arrive at the gate with no credential it
// could read and get a flat 401. Deleting the "promotes the licence token"
// test below re-opens that outage silently: nothing else in this repo fails.
//
// The `X-Tenant-Id` assertions are the other half of the expand/contract.
// The header must KEEP being sent, because today's orchestrator still
// authenticates off it (its middleware only takes the JWT branch when the
// bearer `_looks_like_jwt()`, and an opaque licence token is not JWT-shaped).
// Dropping it would make this change order-dependent on the gate rollout.
//
// These tests exercise the real module. `server.js` itself cannot be
// imported — it calls `server.listen()` at import time — which is why the
// logic lives in its own file, mirroring server-backpressure.js.
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { injectCookieAuth, jwtExpEpochSeconds } from '../../../server-cookie-auth.js';

/** A signature-free JWT whose `exp` is `secondsFromNow` away. */
function jwtExpiringIn(secondsFromNow: number): string {
	const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
	const payload = Buffer.from(JSON.stringify({ exp }), 'utf8').toString('base64url');
	return `header.${payload}.signature`;
}

/**
 * Minimal stand-in for a node IncomingMessage. `injectCookieAuth` only ever
 * touches `req.headers`, so the cast is safe — same shape as the fake in
 * proxy-backpressure.test.ts.
 */
function fakeRequest(headers: Record<string, string>) {
	const req = { headers: { ...headers } };
	return req as unknown as IncomingMessage & { headers: Record<string, string | undefined> };
}

function cookieHeader(pairs: Record<string, string>): string {
	return Object.entries(pairs)
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('; ');
}

const LIVE_JWT = jwtExpiringIn(3600);

describe('injectCookieAuth — licence token reaches the ext-authz gate', () => {
	it('promotes the licence token onto Authorization when there is no Keycloak JWT', () => {
		// THE FIX. A licence-token-only session is the common case for an
		// external portal user; without this header the ext-authz gate 401s.
		const req = fakeRequest({ cookie: cookieHeader({ license_token: 'lic-xyz' }) });

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe('Bearer lic-xyz');
	});

	it('still sends X-Tenant-Id alongside it (the expand half of expand/contract)', () => {
		// Today's orchestrator authenticates off THIS header and ignores the
		// non-JWT-shaped bearer. Dropping it makes the rollout order-dependent.
		const req = fakeRequest({ cookie: cookieHeader({ license_token: 'lic-xyz' }) });

		injectCookieAuth(req);

		expect(req.headers['x-tenant-id']).toBe('Bearer lic-xyz');
	});

	it('sends the licence token on BOTH headers in one pass', () => {
		const req = fakeRequest({ cookie: cookieHeader({ license_token: 'lic-xyz' }) });

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe('Bearer lic-xyz');
		expect(req.headers['x-tenant-id']).toBe('Bearer lic-xyz');
	});
});

describe('injectCookieAuth — Authorization precedence', () => {
	it('never overrides an Authorization header the caller already set', () => {
		const req = fakeRequest({
			authorization: 'Bearer header-wins',
			cookie: cookieHeader({ kc_token: LIVE_JWT, license_token: 'lic-xyz' })
		});

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe('Bearer header-wins');
		// …but the tenant header is still filled from the cookie.
		expect(req.headers['x-tenant-id']).toBe('Bearer lic-xyz');
	});

	it('prefers the Keycloak JWT over the licence token on Authorization', () => {
		// The pre-existing path. It MUST keep working byte-for-byte: the
		// orchestrator resolves roles from this JWT.
		const req = fakeRequest({
			cookie: cookieHeader({ kc_token: LIVE_JWT, license_token: 'lic-xyz' })
		});

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe(`Bearer ${LIVE_JWT}`);
		expect(req.headers['x-tenant-id']).toBe('Bearer lic-xyz');
	});

	it('falls back to the licence token when the Keycloak JWT cookie is expired', () => {
		// An expired kc_token is deliberately NOT forwarded (guaranteed 401).
		// Having declined it, Authorization is free again — so the licence
		// token must take it, rather than the request going out bare.
		const req = fakeRequest({
			cookie: cookieHeader({ kc_token: jwtExpiringIn(-60), license_token: 'lic-xyz' })
		});

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe('Bearer lic-xyz');
		expect(req.headers['x-tenant-id']).toBe('Bearer lic-xyz');
	});

	it('leaves an existing X-Tenant-Id header alone and does not promote it', () => {
		const req = fakeRequest({
			'x-tenant-id': 'Bearer header-tenant',
			cookie: cookieHeader({ license_token: 'lic-xyz' })
		});

		injectCookieAuth(req);

		expect(req.headers['x-tenant-id']).toBe('Bearer header-tenant');
		// The COOKIE value, not the header value — the promotion reads cookies.
		expect(req.headers['authorization']).toBe('Bearer lic-xyz');
	});
});

describe('injectCookieAuth — CSRF-read defense still holds', () => {
	it('attaches NEITHER header on a cross-site request', () => {
		// The new Authorization promotion must not become a way around the
		// SameSite=Lax top-level-navigation hole this guard closes.
		const req = fakeRequest({
			'sec-fetch-site': 'cross-site',
			cookie: cookieHeader({ kc_token: LIVE_JWT, license_token: 'lic-xyz' })
		});

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBeUndefined();
		expect(req.headers['x-tenant-id']).toBeUndefined();
	});

	it.each(['same-origin', 'same-site', 'none'])('attaches cookie auth on %s', (site) => {
		const req = fakeRequest({
			'sec-fetch-site': site,
			cookie: cookieHeader({ license_token: 'lic-xyz' })
		});

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe('Bearer lic-xyz');
	});

	it('attaches cookie auth when Sec-Fetch-Site is absent (non-browser caller)', () => {
		const req = fakeRequest({ cookie: cookieHeader({ license_token: 'lic-xyz' }) });

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBe('Bearer lic-xyz');
	});
});

describe('injectCookieAuth — unchanged invariants', () => {
	it('strips the cookie header before the request goes upstream', () => {
		const req = fakeRequest({ cookie: cookieHeader({ license_token: 'lic-xyz' }) });

		injectCookieAuth(req);

		expect(req.headers['cookie']).toBeUndefined();
	});

	it('adds nothing when there are no auth cookies at all', () => {
		const req = fakeRequest({ cookie: 'theme=dark' });

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBeUndefined();
		expect(req.headers['x-tenant-id']).toBeUndefined();
	});

	it('is a no-op on a request with no cookie header', () => {
		const req = fakeRequest({});

		injectCookieAuth(req);

		expect(req.headers['authorization']).toBeUndefined();
		expect(req.headers['x-tenant-id']).toBeUndefined();
	});
});

describe('jwtExpEpochSeconds', () => {
	it('reads the exp claim', () => {
		const exp = Math.floor(Date.now() / 1000) + 120;
		expect(jwtExpEpochSeconds(jwtExpiringIn(120))).toBe(exp);
	});

	it('returns +Infinity for an opaque (non-JWT) licence token, so it is never judged expired', () => {
		// Load-bearing for the fallback above: the licence token is opaque and
		// must not be short-circuited as "dead" by the JWT expiry check.
		expect(jwtExpEpochSeconds('lic-xyz')).toBe(Number.POSITIVE_INFINITY);
		expect(jwtExpEpochSeconds('not.a.jwt')).toBe(Number.POSITIVE_INFINITY);
	});
});

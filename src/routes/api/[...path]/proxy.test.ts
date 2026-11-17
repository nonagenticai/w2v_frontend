/**
 * Proxy tests for the SvelteKit /api/[...path] catch-all (dev-mode proxy).
 *
 * The production HTTP proxy lives in server.js with the same shape; both
 * paths must generate + forward + mirror X-Request-Id so the trace chain
 * (browser → frontend → orchestrator → siblings) shares one correlation id.
 *
 * Regression: prior to PR2, neither proxy generated or forwarded
 * X-Request-Id. The orchestrator's request_id middleware always minted a
 * fresh uuid per inbound call, so the browser had no way to grep one user
 * action across the fleet's logs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/config', () => ({
	API_URL: 'http://w2v-orchestrator.example',
	HTML_RENDER_URL: 'http://html-render.example',
	TEST_RUNNER_URL: 'http://test-runner.example'
}));

import { GET } from './+server';

function fakeCookies(): import('@sveltejs/kit').Cookies {
	// Only `.get` is read in proxy(); the other methods are stubbed to satisfy
	// the type without doing anything.
	const noop = () => undefined as never;
	return {
		get: () => undefined,
		getAll: () => [],
		set: noop,
		delete: noop,
		serialize: () => ''
	} as unknown as import('@sveltejs/kit').Cookies;
}

function captureFetch(responseBody: BodyInit | null, init?: ResponseInit) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const fetchSpy = vi.fn(async (url: string, fetchInit?: RequestInit) => {
		calls.push({ url, init: fetchInit });
		return new Response(responseBody, init);
	});
	vi.stubGlobal('fetch', fetchSpy);
	return calls;
}

function makeEvent(headers: Record<string, string>) {
	const request = new Request('http://w2v-frontend.test/api/runs/x', {
		method: 'GET',
		headers
	});
	const url = new URL('http://w2v-frontend.test/api/runs/x');
	return {
		request,
		url,
		cookies: fakeCookies(),
		params: { path: 'runs/x' },
		// Minimal RequestEvent shape — the route only reads request/url/cookies.
		platform: undefined,
		locals: {},
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		fetch: globalThis.fetch.bind(globalThis),
		getClientAddress: () => '127.0.0.1',
		route: { id: '/api/[...path]' }
	} as unknown as Parameters<typeof GET>[0];
}

describe('api/[...path] proxy — X-Request-Id', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('forwards an inbound X-Request-Id verbatim to the upstream + mirrors on response', async () => {
		const calls = captureFetch('{"ok":true}', {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
		const event = makeEvent({ 'x-request-id': 'rid-from-client-42' });

		const response = await GET(event);

		expect(calls).toHaveLength(1);
		const upstreamHeaders = new Headers(calls[0].init?.headers);
		expect(upstreamHeaders.get('x-request-id')).toBe('rid-from-client-42');
		expect(response.headers.get('x-request-id')).toBe('rid-from-client-42');
	});

	it('generates a UUID when no inbound X-Request-Id is present, and uses the same value upstream + on the response', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEvent({});

		const response = await GET(event);

		const generated = response.headers.get('x-request-id');
		expect(generated, 'response must always carry X-Request-Id').toBeTruthy();
		// UUIDv4 shape: 8-4-4-4-12 hex.
		expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		const upstreamHeaders = new Headers(calls[0].init?.headers);
		expect(upstreamHeaders.get('x-request-id')).toBe(generated);
	});

	it('emits X-Request-Id even on the 502 upstream-unavailable error path', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('boom');
			})
		);
		const event = makeEvent({ 'x-request-id': 'rid-error-1' });

		const response = await GET(event);

		expect(response.status).toBe(502);
		expect(response.headers.get('x-request-id')).toBe('rid-error-1');
	});
});

function fakeCookiesWith(values: Record<string, string>): import('@sveltejs/kit').Cookies {
	const noop = () => undefined as never;
	return {
		get: (name: string) => values[name],
		getAll: () => [],
		set: noop,
		delete: noop,
		serialize: () => ''
	} as unknown as import('@sveltejs/kit').Cookies;
}

// `Sec-Fetch-*` are forbidden request headers — undici strips them from a
// `Request` built in script (that's exactly why the proxy can trust them: the
// browser sets them, scripts can't forge them). So we hand-roll a request whose
// `headers.get` injects the Sec-Fetch-Site the browser would have sent.
function makeEventWithCookies(
	secFetchSite: string | null,
	cookieValues: Record<string, string>,
	extraHeaders: Record<string, string> = {}
) {
	const headers = new Headers(extraHeaders);
	const realGet = headers.get.bind(headers);
	// Shadow .get (iteration via the prototype is unaffected, so `new Headers()`
	// copies still work) to inject the Sec-Fetch-Site the browser would send.
	Object.defineProperty(headers, 'get', {
		value: (name: string) =>
			name.toLowerCase() === 'sec-fetch-site' ? secFetchSite : realGet(name),
		configurable: true
	});
	const request = {
		method: 'GET',
		headers,
		arrayBuffer: async () => new ArrayBuffer(0)
	} as unknown as Request;
	const url = new URL('http://w2v-frontend.test/api/runs/x');
	return {
		request,
		url,
		cookies: fakeCookiesWith(cookieValues),
		params: { path: 'runs/x' },
		platform: undefined,
		locals: {},
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		fetch: globalThis.fetch.bind(globalThis),
		getClientAddress: () => '127.0.0.1',
		route: { id: '/api/[...path]' }
	} as unknown as Parameters<typeof GET>[0];
}

const COOKIES = { kc_token: 'jwt-abc', license_token: 'lic-xyz' };

describe('api/[...path] proxy — cookie-auth CSRF guard', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('does NOT attach cookie auth on a cross-site request (CSRF-read defense)', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('cross-site', COOKIES);

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBeNull();
		expect(upstream.get('x-tenant-id')).toBeNull();
	});

	it('attaches cookie auth on a same-origin request', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('same-origin', COOKIES);

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBe('Bearer jwt-abc');
		expect(upstream.get('x-tenant-id')).toBe('Bearer lic-xyz');
	});

	it('attaches cookie auth on a direct navigation (sec-fetch-site: none)', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('none', COOKIES);

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBe('Bearer jwt-abc');
	});

	it('attaches cookie auth when Sec-Fetch-Site is absent (non-browser caller)', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies(null, COOKIES);

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBe('Bearer jwt-abc');
	});

	it('explicit Authorization header is never overridden by the cookie fallback', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('same-origin', COOKIES, {
			authorization: 'Bearer header-wins'
		});

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBe('Bearer header-wins');
	});
});

// Mirrors src/lib/server/server-cookie-auth.test.ts, which covers the same
// rule for the PRODUCTION proxy (`server.js`). Both implementations exist on
// purpose — prod bypasses SvelteKit — and CLAUDE.md § Gotchas requires them to
// stay in sync, so the behaviour is pinned on both sides.
describe('api/[...path] proxy — licence token reaches the ext-authz gate', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('promotes the licence token onto Authorization when there is no Keycloak JWT', async () => {
		// `license-authz` reads the licence token ONLY from `Authorization`;
		// without this a kc_token-less session gets a flat 401 at the gate.
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('same-origin', { license_token: 'lic-xyz' });

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBe('Bearer lic-xyz');
		// Expand half: X-Tenant-Id is KEPT, so this is order-independent
		// relative to the gate rollout.
		expect(upstream.get('x-tenant-id')).toBe('Bearer lic-xyz');
	});

	it('prefers the Keycloak JWT over the licence token on Authorization', async () => {
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('same-origin', COOKIES);

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBe('Bearer jwt-abc');
		expect(upstream.get('x-tenant-id')).toBe('Bearer lic-xyz');
	});

	it('does NOT promote the licence token on a cross-site request', async () => {
		// The promotion must not become a way around the CSRF-read guard.
		const calls = captureFetch('{"ok":true}', { status: 200 });
		const event = makeEventWithCookies('cross-site', { license_token: 'lic-xyz' });

		await GET(event);

		const upstream = new Headers(calls[0].init?.headers);
		expect(upstream.get('authorization')).toBeNull();
		expect(upstream.get('x-tenant-id')).toBeNull();
	});
});

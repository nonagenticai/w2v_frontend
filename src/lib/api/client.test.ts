import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { ensureFreshToken } from '$lib/services/keycloak.js';
import { ApiError, api, setActiveTenantId, withActiveTenant } from './client.js';

describe('api client — fresh token per request', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({})
		});
		vi.mocked(ensureFreshToken).mockReset();
	});

	it('awaits ensureFreshToken at request time, not from a cached header', async () => {
		vi.mocked(ensureFreshToken).mockResolvedValueOnce('token-A');
		await api.get('/first');

		vi.mocked(ensureFreshToken).mockResolvedValueOnce('token-B');
		await api.get('/second');

		expect(ensureFreshToken).toHaveBeenCalledTimes(2);
		expect(ensureFreshToken).toHaveBeenNthCalledWith(1, 30);
		expect(ensureFreshToken).toHaveBeenNthCalledWith(2, 30);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
			string,
			string
		>;
		const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<
			string,
			string
		>;
		expect(firstHeaders.Authorization).toBe('Bearer token-A');
		expect(secondHeaders.Authorization).toBe('Bearer token-B');
	});

	it('omits the Authorization header when ensureFreshToken returns undefined', async () => {
		vi.mocked(ensureFreshToken).mockResolvedValueOnce(undefined);
		await api.get('/anon');

		const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});

	it('omits Authorization for the e2e/dev bypass sentinel tokens', async () => {
		// keycloak.ts mints 'e2e-bypass-token' / 'dev-bypass-token' in the bypass
		// paths. They are not real JWTs, so attaching them as Authorization makes
		// the backend 401 (invalid JWT) even with a valid X-Tenant-Id license —
		// which froze the post-promote E2E's run-status badge. They must never be
		// sent as Authorization.
		for (const sentinel of ['e2e-bypass-token', 'dev-bypass-token']) {
			fetchMock.mockClear();
			vi.mocked(ensureFreshToken).mockResolvedValueOnce(sentinel);
			await api.get('/runs/abc');
			const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
			expect(headers.Authorization, sentinel).toBeUndefined();
		}
	});

	it('keycloak token wins over caller-supplied headers', async () => {
		// `request()` spreads `authHeader` LAST, after the caller's own
		// `init.headers`, so nothing a caller passes can displace the live
		// Keycloak token. This used to be asserted via `setDefaultHeader()`,
		// which had no non-test caller and is now deleted — with it gone, the
		// only caller-controlled header on the public `api` surface is
		// `Idempotency-Key`, so that is what this exercises: the caller's header
		// lands, Authorization stays the Keycloak one.
		vi.mocked(ensureFreshToken).mockResolvedValueOnce('kc-real-token');
		await api.post('/guarded', { a: 1 }, { idempotencyKey: 'key-123' });
		const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers['Idempotency-Key']).toBe('key-123');
		expect(headers.Authorization).toBe('Bearer kc-real-token');
	});
});

describe('api client — X-Active-Tenant-Id scope-switch header', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
		vi.mocked(ensureFreshToken).mockReset();
		vi.mocked(ensureFreshToken).mockResolvedValue(undefined);
		setActiveTenantId(null); // reset between tests
	});

	function lastHeaders(): Record<string, string> {
		const call = fetchMock.mock.calls.at(-1)!;
		return (call[1] as RequestInit).headers as Record<string, string>;
	}

	it('omits the header by default (acting as own tenant)', async () => {
		await api.get('/projects');
		expect(lastHeaders()['X-Active-Tenant-Id']).toBeUndefined();
	});

	it('sends X-Active-Tenant-Id once a tenant is selected', async () => {
		setActiveTenantId('tenant-b');
		await api.get('/projects');
		expect(lastHeaders()['X-Active-Tenant-Id']).toBe('tenant-b');
	});

	it('drops the header again when cleared with null', async () => {
		setActiveTenantId('tenant-b');
		setActiveTenantId(null);
		await api.get('/projects');
		expect(lastHeaders()['X-Active-Tenant-Id']).toBeUndefined();
	});

	it('rebuilds the header per request so switching mid-session takes effect', async () => {
		setActiveTenantId('tenant-b');
		await api.get('/first');
		setActiveTenantId('tenant-c');
		await api.get('/second');
		const first = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		const second = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
		expect(first['X-Active-Tenant-Id']).toBe('tenant-b');
		expect(second['X-Active-Tenant-Id']).toBe('tenant-c');
	});
});

describe('withActiveTenant — SSE scope-switch over the header-less EventSource', () => {
	beforeEach(() => setActiveTenantId(null));

	it('returns the url unchanged when acting as own tenant', () => {
		expect(withActiveTenant('/api/runs/r1/events')).toBe('/api/runs/r1/events');
	});

	it('appends active_tenant with ? when the url has no query', () => {
		setActiveTenantId('tenant-b');
		expect(withActiveTenant('/api/runs/r1/events')).toBe(
			'/api/runs/r1/events?active_tenant=tenant-b'
		);
	});

	it('appends with & when the url already has a query', () => {
		setActiveTenantId('tenant-b');
		expect(withActiveTenant('/api/projects/p1/events?foo=1')).toBe(
			'/api/projects/p1/events?foo=1&active_tenant=tenant-b'
		);
	});

	it('url-encodes the tenant id', () => {
		setActiveTenantId('a b/c');
		expect(withActiveTenant('/api/runs/r1/events')).toBe(
			'/api/runs/r1/events?active_tenant=a%20b%2Fc'
		);
	});

	it('drops the param again once the switch is cleared', () => {
		setActiveTenantId('tenant-b');
		setActiveTenantId(null);
		expect(withActiveTenant('/api/runs/r1/events')).toBe('/api/runs/r1/events');
	});
});

describe('api client — 401 throws, does NOT auto-redirect', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.mocked(ensureFreshToken).mockReset();
		vi.mocked(ensureFreshToken).mockResolvedValue(undefined);
	});

	it('throws ApiError(401) with server-provided detail', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ detail: 'missing license' })
		});

		await expect(api.get('/pipeline')).rejects.toMatchObject({
			status: 401,
			detail: 'missing license'
		});
		await expect(api.get('/pipeline')).rejects.toBeInstanceOf(ApiError);
	});

	it('extracts message from the canonical { error: { message } } envelope', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 404,
			statusText: 'Not Found',
			json: async () => ({
				error: {
					code: 'HTTP_404',
					message: 'Run not found',
					status: 404,
					request_id: '01J...',
					timestamp: '2026-05-25T00:00:00Z'
				}
			})
		});

		await expect(api.get('/runs/missing')).rejects.toMatchObject({
			status: 404,
			detail: 'Run not found'
		});
	});

	it('throws ApiError on any non-2xx, falling back to statusText when body is not JSON', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			json: async () => {
				throw new Error('not json');
			}
		});

		await expect(api.get('/crash')).rejects.toMatchObject({
			status: 500,
			detail: 'Internal Server Error'
		});
	});
});

describe('api client — empty-body handling (204 / 205)', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.mocked(ensureFreshToken).mockReset();
		vi.mocked(ensureFreshToken).mockResolvedValue('kc-token');
	});

	function emptyResponse(status: number) {
		return {
			ok: status >= 200 && status < 300,
			status,
			statusText: `${status}`,
			// Match real Fetch API behaviour: .json() on an empty body throws
			// SyntaxError("Unexpected end of JSON input"). The pre-fix client
			// hit exactly this path on every 204 DELETE / reorder.
			json: async () => {
				throw new SyntaxError('Unexpected end of JSON input');
			}
		};
	}

	it('does not crash on 204 No Content (covers DELETE annotation/verbatim, reorderChildren)', async () => {
		fetchMock.mockResolvedValueOnce(emptyResponse(204));
		await expect(api.delete<void>('/something')).resolves.toBeUndefined();
	});

	it('does not crash on 205 Reset Content', async () => {
		fetchMock.mockResolvedValueOnce(emptyResponse(205));
		await expect(api.delete<void>('/something')).resolves.toBeUndefined();
	});

	it('still parses JSON normally on 200 with content', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ foo: 1 })
		});
		await expect(api.get<{ foo: number }>('/something')).resolves.toEqual({ foo: 1 });
	});
});

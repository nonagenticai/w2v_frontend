import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { ensureFreshToken } from '$lib/services/keycloak.js';
import { ApiError, parseRetryAfter } from './client.js';
import { providerError, providers } from './providers.js';

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
	return { ok: true, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function envelope(status: number, code: string, message: string, details?: unknown) {
	return {
		ok: false,
		status,
		statusText: 'x',
		json: async () => ({ error: { code, message, status, request_id: 'r', details } })
	};
}
const call = (i = 0) => ({
	url: fetchMock.mock.calls[i][0] as string,
	method: (fetchMock.mock.calls[i][1]?.method ?? 'GET') as string,
	body: fetchMock.mock.calls[i][1]?.body
		? JSON.parse(fetchMock.mock.calls[i][1].body as string)
		: undefined
});

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockReset();
	vi.mocked(ensureFreshToken).mockResolvedValue('kc-token');
});

describe('providers api client — routes', () => {
	it('lists slots from /api/tenant/connections', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await providers.list();
		expect(call()).toMatchObject({ url: '/api/tenant/connections', method: 'GET' });
	});

	it('PUTs a connection with expected_version and the write-only secret', async () => {
		fetchMock.mockResolvedValue(ok({ slot: 'llm' }));
		await providers.save('llm', {
			kind: 'openai-compatible',
			base_url: 'https://api.example.com/v1',
			model: 'm',
			secret: 'sk-new',
			expected_version: 3
		});
		expect(call()).toEqual({
			url: '/api/tenant/connections/llm',
			method: 'PUT',
			body: {
				kind: 'openai-compatible',
				base_url: 'https://api.example.com/v1',
				model: 'm',
				secret: 'sk-new',
				expected_version: 3
			}
		});
	});

	it('POSTs a draft test, or an empty body to test the stored version', async () => {
		fetchMock.mockResolvedValue(ok({ ok: true, message: 'ok' }));
		await providers.test('llm', { kind: 'anthropic', secret: null });
		expect(call(0)).toEqual({
			url: '/api/tenant/connections/llm/test',
			method: 'POST',
			body: { kind: 'anthropic', secret: null }
		});
		await providers.test('llm');
		expect(call(1)).toEqual({
			url: '/api/tenant/connections/llm/test',
			method: 'POST',
			body: undefined
		});
	});

	it('DELETEs a connection and url-encodes the slot', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => null });
		await providers.remove('publish.youtube/x');
		expect(call()).toMatchObject({
			url: '/api/tenant/connections/publish.youtube%2Fx',
			method: 'DELETE'
		});
	});

	it('surfaces the envelope code + details on ApiError', async () => {
		fetchMock.mockResolvedValue(
			envelope(422, 'PROVIDER_TEST_FAILED', 'unauthorized', { upstream_status: 401 })
		);
		const err = await providers
			.save('llm', { kind: 'anthropic', expected_version: 0 })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).code).toBe('PROVIDER_TEST_FAILED');
		expect((err as ApiError).details).toEqual({ upstream_status: 401 });
	});
});

describe('Retry-After on ApiError', () => {
	it('fetch path reads the Retry-After header onto ApiError.retryAfter', async () => {
		fetchMock.mockResolvedValue({
			...envelope(429, 'PROVIDER_TEST_RATE_LIMITED', 'slow'),
			headers: new Headers({ 'Retry-After': '42' })
		});
		const err = await providers.test('llm').catch((x: unknown) => x);
		expect((err as ApiError).retryAfter).toBe(42);
		expect(providerError(err).message).toContain('try again in 42 s');
	});

	it('parseRetryAfter handles delta-seconds, HTTP-date, junk and absence', () => {
		const now = Date.parse('2026-10-09T12:00:00Z');
		expect(parseRetryAfter('5', now)).toBe(5);
		expect(parseRetryAfter('Fri, 09 Oct 2026 12:00:20 GMT', now)).toBe(20);
		expect(parseRetryAfter('Fri, 09 Oct 2026 11:00:00 GMT', now)).toBe(0);
		expect(parseRetryAfter('soon', now)).toBeNull();
		expect(parseRetryAfter(null, now)).toBeNull();
		expect(parseRetryAfter('', now)).toBeNull();
	});
});

describe('providerError — code → copy + follow-up action', () => {
	const e = (
		status: number,
		code: string,
		msg = 'server says',
		details?: Record<string, unknown>
	) => new ApiError(status, 'x', msg, code, details);

	it('PROVIDER_TEST_FAILED names the upstream status and says nothing was saved', () => {
		const info = providerError(e(422, 'PROVIDER_TEST_FAILED', 'bad key', { upstream_status: 401 }));
		expect(info.code).toBe('PROVIDER_TEST_FAILED');
		expect(info.upstreamStatus).toBe(401);
		expect(info.message).toContain('HTTP 401');
		expect(info.message).toContain('bad key');
		expect(info.message).toContain('Nothing was saved');
		expect(info.action).toBeNull();
	});

	it('PROVIDER_TEST_FAILED without an upstream status (network error) still reads well', () => {
		const info = providerError(
			e(422, 'PROVIDER_TEST_FAILED', 'timed out', { upstream_status: null })
		);
		expect(info.upstreamStatus).toBeNull();
		expect(info.message).not.toContain('HTTP');
		expect(info.message).toContain('timed out');
	});

	it('SECRET_REENTRY_REQUIRED asks to focus the secret field', () => {
		const info = providerError(e(422, 'SECRET_REENTRY_REQUIRED'));
		expect(info.action).toBe('focus-secret');
		expect(info.message).toMatch(/enter the API key again/);
	});

	it('EGRESS_REFUSED carries the server reason', () => {
		const info = providerError(e(422, 'EGRESS_REFUSED', 'private address 10.0.0.1'));
		expect(info.message).toContain('not allowed');
		expect(info.message).toContain('private address 10.0.0.1');
		expect(info.action).toBeNull();
	});

	it('VERSION_CONFLICT asks the screen to reload', () => {
		const info = providerError(e(409, 'VERSION_CONFLICT'));
		expect(info.action).toBe('reload');
		expect(info.message).toMatch(/reloaded/);
	});

	it('PROVIDER_KEYRING_UNAVAILABLE is flagged as a platform issue', () => {
		const info = providerError(e(503, 'PROVIDER_KEYRING_UNAVAILABLE'));
		expect(info.platformIssue).toBe(true);
		expect(info.message).toMatch(/platform issue/);
	});

	it('PROVIDER_TEST_RATE_LIMITED uses details.retry_after first', () => {
		const err = new ApiError(
			429,
			'x',
			'slow',
			'PROVIDER_TEST_RATE_LIMITED',
			{ retry_after: 12 },
			99
		);
		const info = providerError(err);
		expect(info.retryAfterSeconds).toBe(12);
		expect(info.message).toBe('Too many provider tests — try again in 12 s.');
	});

	it('PROVIDER_TEST_RATE_LIMITED falls back to the Retry-After header, then to "shortly"', () => {
		const hdr = new ApiError(429, 'x', 'slow', 'PROVIDER_TEST_RATE_LIMITED', undefined, 30);
		expect(providerError(hdr).retryAfterSeconds).toBe(30);
		expect(providerError(hdr).message).toContain('try again in 30 s');
		const none = providerError(e(429, 'PROVIDER_TEST_RATE_LIMITED'));
		expect(none.retryAfterSeconds).toBeNull();
		expect(none.message).toMatch(/Too many provider tests — try again shortly/);
	});

	it.each([
		['SLOT_NOT_WRITABLE', /platform provided/],
		['INVALID_BASE_URL', /base URL is not valid/],
		['PROVIDER_KIND_NOT_ALLOWED', /provider type is not enabled/],
		['BASE_URL_REQUIRED', /needs a base URL/]
	])('%s gets clear copy', (code, expected) => {
		const info = providerError(e(422, code, 'raw'));
		expect(info.code).toBe(code);
		expect(info.message).toMatch(expected);
		expect(info.retryAfterSeconds).toBeNull();
	});

	it('unknown codes fall back to the server message; non-ApiErrors to their message', () => {
		expect(providerError(e(422, 'SOME_NEW_CODE', 'base URL must be http(s)')).message).toBe(
			'base URL must be http(s)'
		);
		expect(providerError(new Error('offline')).message).toBe('offline');
		expect(providerError('weird', 'fallback').message).toBe('fallback');
	});
});

describe('providers api client — LLM access + model list', () => {
	it('POSTs the model-list draft to /tenant/connections/{slot}/models', async () => {
		fetchMock.mockResolvedValue(ok({ models: ['m-1', 'm-2'] }));
		const res = await providers.models('llm', {
			kind: 'openai-compatible',
			base_url: 'https://llm.example.com/v1',
			secret: 'sk-typed'
		});
		expect(call()).toEqual({
			url: '/api/tenant/connections/llm/models',
			method: 'POST',
			body: {
				kind: 'openai-compatible',
				base_url: 'https://llm.example.com/v1',
				secret: 'sk-typed'
			}
		});
		expect(res.models).toEqual(['m-1', 'm-2']);
	});

	it('omits secret from the model-list body when none was typed (server uses the stored key)', async () => {
		fetchMock.mockResolvedValue(ok({ models: [] }));
		await providers.models('vlm', { kind: 'openai', base_url: null });
		expect(call().body).toEqual({ kind: 'openai', base_url: null });
		expect(call().body).not.toHaveProperty('secret');
	});

	it('list() passes llm_access through verbatim', async () => {
		const body = {
			llm_access: { mode: 'platform_only', label: 'Platform services only' },
			items: [{ slot: 'llm' }]
		};
		fetchMock.mockResolvedValue(ok(body));
		const res = await providers.list();
		expect(res.llm_access?.mode).toBe('platform_only');
		expect(res.items[0].slot).toBe('llm');
	});

	it('a bare {"error":"models_unavailable","detail"} 422 maps to copy carrying the detail', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 422,
			statusText: 'Unprocessable',
			json: async () => ({
				error: {
					code: 'models_unavailable',
					message: 'GET /models returned 401',
					details: { upstream_status: 401 }
				}
			})
		});
		const err = await providers.models('llm', { kind: 'openai', base_url: null }).catch((x) => x);
		const info = providerError(err);
		expect(info.code).toBe('models_unavailable');
		expect(info.upstreamStatus).toBe(401);
		expect(info.message).toBe(
			"Couldn't load the provider's models (HTTP 401): GET /models returned 401"
		);
	});

	it('409 tenant_byo_disabled explains Platform services only', () => {
		const info = providerError(new ApiError(409, 'Conflict', 'x', 'tenant_byo_disabled'));
		expect(info.code).toBe('tenant_byo_disabled');
		expect(info.message).toMatch(/Platform services only/);
	});
});

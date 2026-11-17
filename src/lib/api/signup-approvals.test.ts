import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { ensureFreshToken } from '$lib/services/keycloak.js';
import { signupApprovals } from './signup-approvals.js';
import { ApiError } from './client.js';

const ROW = {
	id: 'a1',
	email: 'ada@example.com',
	name: 'Ada',
	company: null,
	message: 'hi',
	locale: 'nl',
	source: 'web',
	status: 'pending',
	created_at: '2026-10-20T10:00:00+00:00',
	decided_at: null,
	decided_via: null,
	decider_actor: null,
	approving: false,
	tenant_name: null,
	tenant_slug: null,
	tenant_id: null,
	llm_access: null,
	suggested_tenant_name: 'Ada',
	steps: {},
	steps_not_ok: [],
	email_state: 'waiting',
	steps_attempts: 0,
	steps_next_attempt_at: null
};

function ok(body: unknown) {
	return { ok: true, status: 200, json: async () => body };
}

describe('signupApprovals api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.mocked(ensureFreshToken).mockReset();
		vi.mocked(ensureFreshToken).mockResolvedValue('kc-token');
	});

	const call = (i = 0) => {
		const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit | undefined];
		return {
			url,
			method: init?.method ?? 'GET',
			body: init?.body ? JSON.parse(String(init.body)) : undefined
		};
	};

	it('list() hits the queue with the status filter', async () => {
		fetchMock.mockResolvedValue(ok({ items: [ROW] }));
		const res = await signupApprovals.list('needs_attention');
		expect(call().url).toBe('/api/admin/signup-approvals?status=needs_attention');
		expect(res.items).toEqual([ROW]);
	});

	it('list() without a filter asks for everything', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await signupApprovals.list();
		expect(call().url).toBe('/api/admin/signup-approvals');
	});

	it('get() unwraps { data } and encodes the id', async () => {
		fetchMock.mockResolvedValue(ok({ data: ROW }));
		const row = await signupApprovals.get('a/1');
		expect(call().url).toBe('/api/admin/signup-approvals/a%2F1');
		expect(row).toEqual(ROW);
	});

	it('invite() posts email/name/locale and drops an empty company', async () => {
		fetchMock.mockResolvedValue(ok({ approval: ROW, emailState: 'sent', stepsNotOk: [] }));
		await signupApprovals.invite({ email: 'a@b.co', name: 'A', company: null, locale: 'de' });
		expect(call()).toEqual({
			url: '/api/admin/signup-approvals/invite',
			method: 'POST',
			body: { email: 'a@b.co', name: 'A', locale: 'de' }
		});
	});

	it('invite() sends the company when given', async () => {
		fetchMock.mockResolvedValue(ok({ approval: ROW, emailState: 'sent', stepsNotOk: [] }));
		await signupApprovals.invite({ email: 'a@b.co', name: 'A', company: 'Acme', locale: 'en' });
		expect(call().body).toEqual({ email: 'a@b.co', name: 'A', company: 'Acme', locale: 'en' });
	});

	it('approve() posts an empty body, or tenantName when chosen', async () => {
		fetchMock.mockResolvedValue(ok({ approval: ROW, emailState: 'waiting', stepsNotOk: [] }));
		await signupApprovals.approve('a1');
		expect(call(0)).toEqual({
			url: '/api/admin/signup-approvals/a1/approve',
			method: 'POST',
			body: {}
		});
		await signupApprovals.approve('a1', 'Acme Studio');
		expect(call(1).body).toEqual({ tenantName: 'Acme Studio' });
		await signupApprovals.approve('a1', undefined, 'platform_only');
		expect(call(2).body).toEqual({ llmAccess: 'platform_only' });
	});

	it('invite() sends the chosen LLM access', async () => {
		fetchMock.mockResolvedValue(ok({ approval: ROW, emailState: 'sent', stepsNotOk: [] }));
		await signupApprovals.invite({
			email: 'a@b.co',
			name: 'A',
			locale: 'en',
			llmAccess: 'local_allowed'
		});
		expect(call().body).toEqual({
			email: 'a@b.co',
			name: 'A',
			locale: 'en',
			llmAccess: 'local_allowed'
		});
	});

	it('reject() and retry() unwrap { approval }', async () => {
		fetchMock.mockResolvedValue(ok({ approval: { ...ROW, status: 'rejected' } }));
		expect((await signupApprovals.reject('a1')).status).toBe('rejected');
		expect(call(0)).toMatchObject({ url: '/api/admin/signup-approvals/a1/reject', method: 'POST' });

		fetchMock.mockResolvedValue(ok({ approval: { ...ROW, status: 'approved' } }));
		expect((await signupApprovals.retry('a1')).status).toBe('approved');
		expect(call(1)).toMatchObject({ url: '/api/admin/signup-approvals/a1/retry', method: 'POST' });
	});

	it('remove() sends the typed slug, and the legacy login only when given', async () => {
		fetchMock.mockResolvedValue(ok({ approval: { ...ROW, status: 'removed' } }));
		expect((await signupApprovals.remove('a1', { confirm: 'ada' })).status).toBe('removed');
		expect(call(0)).toEqual({
			url: '/api/admin/signup-approvals/a1/remove',
			method: 'POST',
			body: { confirm: 'ada' }
		});
		await signupApprovals.remove('a1', {
			confirm: 'ada',
			legacy_identity: { user_id: 'u-1', evidence: 'log line' },
			allow_credentialed_delete: true
		});
		expect(call(1).body).toEqual({
			confirm: 'ada',
			legacy_identity: { user_id: 'u-1', evidence: 'log line' },
			allow_credentialed_delete: true
		});
	});

	it('retryRemoval() and resolveRemoval() post to the removal routes', async () => {
		fetchMock.mockResolvedValue(ok({ approval: { ...ROW, status: 'removed' } }));
		await signupApprovals.retryRemoval('a1');
		expect(call(0)).toEqual({
			url: '/api/admin/signup-approvals/a1/removal/retry',
			method: 'POST',
			body: {}
		});
		await signupApprovals.resolveRemoval('a1', 'cleaned up by hand');
		expect(call(1)).toEqual({
			url: '/api/admin/signup-approvals/a1/removal/resolve',
			method: 'POST',
			body: { note: 'cleaned up by hand', acknowledge_live_access: true }
		});
	});

	it('a flat 503 signup_not_configured surfaces as ApiError.code', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 503,
			statusText: 'Service Unavailable',
			headers: new Headers(),
			json: async () => ({
				error: 'signup_not_configured',
				detail: 'Early-access signup is not enabled on this deployment (W2V_SIGNUP_ENABLED).'
			})
		});
		const err = await signupApprovals.list('pending').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(503);
		expect(err.code).toBe('signup_not_configured');
	});

	it('a flat 409 keeps its extra keys (signupId) on ApiError.body', async () => {
		const body = {
			error: 'early_access_workspace_exists',
			detail: 'ada@example.com already has an early-access workspace',
			signupId: 'old-1',
			tenantId: 't-old'
		};
		fetchMock.mockResolvedValue({
			ok: false,
			status: 409,
			statusText: 'Conflict',
			headers: new Headers(),
			json: async () => body
		});
		const err = await signupApprovals
			.invite({ email: 'ada@example.com', name: 'Ada', locale: 'en' })
			.catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe('early_access_workspace_exists');
		expect(err.body).toEqual(body);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { ensureFreshToken } from '$lib/services/keycloak.js';
import { admin } from './admin.js';
import { ApiError } from './client.js';

describe('admin api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.mocked(ensureFreshToken).mockReset();
		vi.mocked(ensureFreshToken).mockResolvedValue('kc-token');
	});

	it('GET /admin/tenants returns the tenant list verbatim (snake_case)', async () => {
		const body = {
			items: [
				{
					tenant_id: 't1',
					project_count: 3,
					last_activity: '2026-06-12T10:00:00Z',
					run_count: 9,
					total_cost_usd: 3.75
				},
				{ tenant_id: 't2', project_count: 1, last_activity: null, run_count: 0, total_cost_usd: 0 }
			],
			total: 2
		};
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

		const res = await admin.tenants();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/tenants');
		expect(res).toEqual(body);
		expect(res.items[0].project_count).toBe(3);
		expect(res.items[0].run_count).toBe(9);
		expect(res.items[0].total_cost_usd).toBe(3.75);
	});

	it('GET /admin/overview returns the tenant aggregate verbatim', async () => {
		const body = { tenant_id: 't1', project_count: 5, run_count: 9, total_cost_usd: 3.75 };
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

		const res = await admin.overview();

		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/overview');
		expect(res).toEqual(body);
	});

	it('GET /admin/usage returns the cost/token breakdown verbatim', async () => {
		const body = {
			tenant_id: 't1',
			totals: {
				run_count: 3,
				project_count: 2,
				input_tokens: 300,
				output_tokens: 150,
				cost_usd: 5.5
			},
			by_type: [
				{ type: 'course', run_count: 1, cost_usd: 3.0, input_tokens: 200, output_tokens: 100 }
			],
			by_stage: [
				{
					stage_name: 'script',
					call_count: 2,
					cost_usd: 5.0,
					input_tokens: 300,
					output_tokens: 150
				}
			],
			by_model: [
				{
					model: 'gpt',
					provider: 'openai',
					call_count: 2,
					cost_usd: 5.0,
					input_tokens: 300,
					output_tokens: 150
				}
			],
			time_series: [
				{ bucket: '2026-06-13', cost_usd: 1.5, input_tokens: 10, output_tokens: 5 },
				{ bucket: '2026-06-15', cost_usd: 4.0, input_tokens: 290, output_tokens: 145 }
			]
		};
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

		const res = await admin.usage();

		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/usage');
		expect(res).toEqual(body);
		expect(res.totals.cost_usd).toBe(5.5);
		expect(res.time_series).toHaveLength(2);
		expect(res.time_series[0].bucket).toBe('2026-06-13');
	});

	it('GET /admin/usage appends bucket + window_days when provided', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ time_series: [] }) });
		await admin.usage({ bucket: 'week', windowDays: 90 });
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/usage?bucket=week&window_days=90');
	});

	it('GET /admin/usage omits window_days for all-time (null)', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ time_series: [] }) });
		await admin.usage({ bucket: 'month', windowDays: null });
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/usage?bucket=month');
	});

	it('surfaces a usage 403 as ApiError', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			statusText: 'Forbidden',
			json: async () => ({ error: { message: 'tenant_admin role required' } })
		});
		await expect(admin.usage()).rejects.toBeInstanceOf(ApiError);
	});

	it('PATCH /admin/tenants/{id} sends the body and returns the updated summary', async () => {
		const body = {
			tenant_id: 't1',
			name: 'Acme Corp',
			status: 'suspended',
			project_count: 3,
			last_activity: null
		};
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

		const res = await admin.updateTenant('t1', { name: 'Acme Corp', status: 'suspended' });

		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/tenants/t1');
		const init = fetchMock.mock.calls[0][1];
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ name: 'Acme Corp', status: 'suspended' });
		expect(res).toEqual(body);
	});

	it('surfaces a PATCH 403 as ApiError', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			statusText: 'Forbidden',
			json: async () => ({ error: { message: 'super_admin role required' } })
		});
		await expect(admin.updateTenant('t1', { name: 'x' })).rejects.toBeInstanceOf(ApiError);
	});

	it('GET /admin/audit passes limit/offset and returns the page verbatim', async () => {
		const body = {
			items: [
				{
					id: 'a1',
					created_at: '2026-06-14T10:00:00Z',
					actor_subject_id: 's1',
					action: 'scope.switch',
					target_tenant_id: 't2',
					detail: { from_tenant: 't1' }
				}
			],
			total: 1,
			limit: 50,
			offset: 0
		};
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });

		const res = await admin.auditLog({ limit: 25, offset: 50 });

		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit?limit=25&offset=50');
		expect(res).toEqual(body);
	});

	it('GET /admin/audit defaults limit/offset when called bare', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0, limit: 50, offset: 0 })
		});
		await admin.auditLog();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit?limit=50&offset=0');
	});

	it('GET /admin/audit appends action/tenant/actor filters when set', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0, limit: 50, offset: 0 })
		});
		await admin.auditLog({
			action: 'scope.switch',
			tenantId: 't1',
			actorSubjectId: 's1'
		});
		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain('action=scope.switch');
		expect(url).toContain('tenant_id=t1');
		expect(url).toContain('actor_subject_id=s1');
	});

	it('GET /admin/request-audit defaults limit/offset when called bare', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0, limit: 50, offset: 0 })
		});
		await admin.requestAudit();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/request-audit?limit=50&offset=0');
	});

	it('GET /admin/request-audit appends all filters when set', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0, limit: 50, offset: 0 })
		});
		await admin.requestAudit({
			event: 'auth_failure',
			method: 'POST',
			crossTenant: true,
			effectiveTenantId: 't1',
			actorSubjectId: 's1',
			since: '2026-06-01T00:00:00Z',
			until: '2026-06-15T00:00:00Z',
			minStatus: 400
		});
		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain('event=auth_failure');
		expect(url).toContain('method=POST');
		expect(url).toContain('cross_tenant=true');
		expect(url).toContain('effective_tenant_id=t1');
		expect(url).toContain('actor_subject_id=s1');
		expect(url).toContain('min_status=400');
	});

	it('GET /admin/request-audit sends cross_tenant=false explicitly (not omitted)', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0, limit: 50, offset: 0 })
		});
		await admin.requestAudit({ crossTenant: false });
		expect(fetchMock.mock.calls[0][0] as string).toContain('cross_tenant=false');
	});

	it('POST /admin/scope-switch sends to_tenant_id (value + null) and returns the entry', async () => {
		const entry = {
			id: 'a1',
			created_at: '2026-06-14T10:00:00Z',
			actor_subject_id: 's1',
			action: 'scope.switch',
			target_tenant_id: 't2',
			detail: { from_tenant: 't1' }
		};
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => entry });

		const res = await admin.recordScopeSwitch('t2');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/scope-switch');
		const init = fetchMock.mock.calls[0][1];
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ to_tenant_id: 't2' });
		expect(res).toEqual(entry);

		fetchMock.mockClear();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ...entry, action: 'scope.reset', target_tenant_id: null })
		});
		await admin.recordScopeSwitch(null);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ to_tenant_id: null });
	});

	it('surfaces an audit 403 as ApiError', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			statusText: 'Forbidden',
			json: async () => ({ error: { message: 'super_admin role required' } })
		});
		await expect(admin.auditLog()).rejects.toBeInstanceOf(ApiError);
	});

	it('surfaces a 403 as ApiError for the screen to render a denied state', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 403,
			statusText: 'Forbidden',
			json: async () => ({ error: { message: 'super_admin role required' } })
		});

		await expect(admin.tenants()).rejects.toMatchObject({
			status: 403,
			detail: 'super_admin role required'
		});
		await expect(admin.overview()).rejects.toBeInstanceOf(ApiError);
	});

	it('POST /admin/provision sends the input and returns the invite + one-time tokens', async () => {
		const result = {
			tenant_id: 't-1',
			invite_id: 'inv-1',
			tokens: { w2v: 'TOKEN-1' },
			license_ids: { w2v: 'lic-1' }
		};
		fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => result });

		const res = await admin.provisionUser({
			email: 'new@example.com',
			name: 'New User',
			tenant_slug: 'acme-corp',
			workspace_role: 'tenant_admin'
		});

		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/provision');
		expect(fetchMock.mock.calls[0][1].method).toBe('POST');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			email: 'new@example.com',
			name: 'New User',
			tenant_slug: 'acme-corp',
			workspace_role: 'tenant_admin'
		});
		expect(res).toEqual(result);
		expect(res.tokens?.w2v).toBe('TOKEN-1');
		expect(res.invite_id).toBe('inv-1');
	});
});

describe('admin api client — tenant LLM access', () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.mocked(ensureFreshToken).mockResolvedValue('kc-token');
	});

	it('GET /admin/tenants/{id}/llm-access', async () => {
		const body = { mode: 'local_allowed', source: 'tenant' };
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
		const res = await admin.tenantLlmAccess('t/1');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/tenants/t%2F1/llm-access');
		expect(fetchMock.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
		expect(res).toEqual(body);
	});

	it('PUT /admin/tenants/{id}/llm-access sends {mode}', async () => {
		const body = { mode: 'platform_only', source: 'tenant' };
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
		const res = await admin.setTenantLlmAccess('t1', 'platform_only');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/tenants/t1/llm-access');
		expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
		expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
			mode: 'platform_only'
		});
		expect(res.mode).toBe('platform_only');
	});

	it('a 502 envelope surfaces error.code LICENCES_REFUSED', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 502,
			statusText: 'Bad Gateway',
			json: async () => ({
				error: { code: 'LICENCES_REFUSED', message: 'licences 403', details: { status: 403 } }
			})
		});
		const err = await admin.setTenantLlmAccess('t1', 'local_allowed').catch((x) => x);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe('LICENCES_REFUSED');
		expect(err.detail).toBe('licences 403');
	});

	it('provision carries llm_access in the body', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ tenant_id: 't' }) });
		await admin.provisionUser({
			email: 'a@b.c',
			name: 'A',
			tenant_slug: 'acme',
			llm_access: 'local_allowed'
		});
		expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
			llm_access: 'local_allowed'
		});
	});
});

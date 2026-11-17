import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A super_admin whose ACTIVE tenant became unknown / suspended / deleted gets
// 404 TENANT_NOT_FOUND on every request. The client must drop the stored choice
// (super_admin included) and land on home with a notice — never leave an empty
// shell that 404s forever. A TENANT_NOT_FOUND about a TARGET tenant is data.

vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn(async () => undefined) }));

const { dropRefusedMock, flagNoticeMock } = vi.hoisted(() => ({
	dropRefusedMock: vi.fn(),
	flagNoticeMock: vi.fn()
}));
vi.mock('$lib/stores/tenant-switcher.svelte.js', () => ({
	tenantSwitcher: {
		dropRefused: (id?: string | null) => dropRefusedMock(id),
		flagRefusedNotice: () => flagNoticeMock()
	}
}));

import { api, isActiveTenantRefusal, setActiveTenantId } from './client.js';
import { installXhrFetchShim } from './test-support/xhr-fetch-shim.js';

const DEAD = '33333333-3333-3333-3333-333333333333';

function notFound(details?: Record<string, unknown>) {
	return {
		ok: false,
		status: 404,
		statusText: 'Not Found',
		headers: new Headers(),
		json: async () => ({
			error: {
				code: 'TENANT_NOT_FOUND',
				message: 'tenant not provisioned',
				status: 404,
				...(details ? { details } : {})
			}
		})
	};
}

describe('api client — refused active tenant', () => {
	const fetchMock = vi.fn();
	const assignMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		dropRefusedMock.mockReset().mockReturnValue(true);
		flagNoticeMock.mockReset();
		assignMock.mockReset();
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: { assign: assignMock }
		});
		setActiveTenantId(DEAD);
	});

	afterEach(() => {
		setActiveTenantId(null);
		vi.unstubAllGlobals();
	});

	it('drops the active tenant, flags a notice and goes home', async () => {
		fetchMock.mockResolvedValue(notFound({ active_tenant: DEAD }));
		await api.get('/projects').catch(() => undefined);
		await vi.waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'));
		expect(dropRefusedMock).toHaveBeenCalledWith(DEAD);
		expect(flagNoticeMock).toHaveBeenCalledTimes(1);
	});

	it('a TENANT_NOT_FOUND about a target tenant on /admin/ is data, not a refusal', async () => {
		fetchMock.mockResolvedValue(notFound());
		await api.get(`/admin/tenants/${DEAD}/llm-access`).catch(() => undefined);
		await new Promise((r) => setTimeout(r, 20));
		expect(dropRefusedMock).not.toHaveBeenCalled();
		expect(assignMock).not.toHaveBeenCalled();
	});

	it('a detail-less TENANT_NOT_FOUND from a tenant route (PUT /tenant/defaults) does NOT drop the choice', async () => {
		// Live shape: a bound, switchable, project-only tenant with no registry row.
		fetchMock.mockResolvedValue(notFound());
		await api.put('/tenant/defaults', { tts: null }).catch(() => undefined);
		await new Promise((r) => setTimeout(r, 20));
		expect(dropRefusedMock).not.toHaveBeenCalled();
		expect(flagNoticeMock).not.toHaveBeenCalled();
		expect(assignMock).not.toHaveBeenCalled();
	});

	it('the XHR upload transport drops a refused active tenant too', async () => {
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value));
		fetchMock.mockResolvedValue(notFound({ active_tenant: DEAD }));
		await api.putRaw('/video-sources/uploads/u1/parts/1', new Blob(['x'])).catch(() => undefined);
		await vi.waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'));
		expect(dropRefusedMock).toHaveBeenCalledWith(DEAD);
		expect(flagNoticeMock).toHaveBeenCalledTimes(1);
	});

	it('the XHR transport leaves a detail-less TENANT_NOT_FOUND alone', async () => {
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value));
		fetchMock.mockResolvedValue(notFound());
		await api.postFormProgress('/tenant/music', new FormData()).catch(() => undefined);
		await new Promise((r) => setTimeout(r, 20));
		expect(dropRefusedMock).not.toHaveBeenCalled();
	});

	it('/auth/me is left to fetchUser (healed in place, no reload)', async () => {
		fetchMock.mockResolvedValue(notFound({ active_tenant: DEAD }));
		await api.get('/auth/me').catch(() => undefined);
		await new Promise((r) => setTimeout(r, 20));
		expect(dropRefusedMock).not.toHaveBeenCalled();
	});

	it('classifies refusals exactly', () => {
		expect(
			isActiveTenantRefusal(404, 'TENANT_NOT_FOUND', '/projects', { active_tenant: DEAD })
		).toBe(true);
		// Names a different tenant than the one we act in.
		expect(
			isActiveTenantRefusal(404, 'TENANT_NOT_FOUND', '/projects', { active_tenant: 'x' })
		).toBe(false);
		expect(isActiveTenantRefusal(404, 'NOT_FOUND', '/projects')).toBe(false);
		expect(isActiveTenantRefusal(500, 'TENANT_NOT_FOUND', '/projects')).toBe(false);
		// No detail ⇒ not proof of a refused active tenant (route-level 404 about
		// a switchable tenant), except on /auth/me from an older backend.
		expect(isActiveTenantRefusal(404, 'TENANT_NOT_FOUND', '/projects')).toBe(false);
		expect(isActiveTenantRefusal(404, 'TENANT_NOT_FOUND', '/tenant/defaults')).toBe(false);
		expect(isActiveTenantRefusal(404, 'TENANT_NOT_FOUND', '/auth/me')).toBe(true);
		setActiveTenantId(null);
		expect(
			isActiveTenantRefusal(404, 'TENANT_NOT_FOUND', '/projects', { active_tenant: DEAD })
		).toBe(false);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The client trips the license gate on a 402 / license-coded 403 so the SPA
// hard-blocks instead of toasting raw errors. A 403 TENANT_NOT_ONBOARDED (the
// orchestrator's answer for a tenant licences holds no w2v grant for) must trip
// it too; an unrelated 403 (e.g. NO_MEMBERSHIP) must not.

vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn(async () => undefined) }));

const { handleForbiddenMock } = vi.hoisted(() => ({ handleForbiddenMock: vi.fn() }));
vi.mock('$lib/stores/licenseGate.svelte', () => ({
	licenseGate: { handleForbidden: handleForbiddenMock }
}));

import { api, ApiError } from './client.js';

function envelope403(code: string) {
	return {
		ok: false,
		status: 403,
		statusText: 'Forbidden',
		headers: new Headers(),
		json: async () => ({ error: { code, message: 'raw server text', status: 403 } })
	};
}

describe('api client — license-gate interceptor', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		handleForbiddenMock.mockReset();
	});

	it('a 403 TENANT_NOT_ONBOARDED trips the license gate', async () => {
		fetchMock.mockResolvedValue(envelope403('TENANT_NOT_ONBOARDED'));
		const err = await api.get('/projects').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).code).toBe('TENANT_NOT_ONBOARDED');
		await vi.waitFor(() => expect(handleForbiddenMock).toHaveBeenCalledTimes(1));
	});

	it('an unrelated 403 (NO_MEMBERSHIP) does not trip the license gate', async () => {
		fetchMock.mockResolvedValue(envelope403('NO_MEMBERSHIP'));
		await api.get('/projects').catch(() => undefined);
		// Give the dynamic import the same chance it had in the positive case.
		await new Promise((r) => setTimeout(r, 20));
		expect(handleForbiddenMock).not.toHaveBeenCalled();
	});

	it('the status endpoint itself is exempt, so the block screen can resolve its reason', async () => {
		fetchMock.mockResolvedValue(envelope403('TENANT_NOT_ONBOARDED'));
		await api.get('/license/status').catch(() => undefined);
		await new Promise((r) => setTimeout(r, 20));
		expect(handleForbiddenMock).not.toHaveBeenCalled();
	});

	it('a 403 TENANT_NOT_ONBOARDED about ANOTHER tenant (/admin/tenants/{id}/…) does not trip the gate', async () => {
		fetchMock.mockResolvedValue(envelope403('TENANT_NOT_ONBOARDED'));
		const err = await api.get('/admin/tenants/t1/llm-access').catch((e: unknown) => e);
		expect((err as ApiError).code).toBe('TENANT_NOT_ONBOARDED');
		await new Promise((r) => setTimeout(r, 20));
		expect(handleForbiddenMock).not.toHaveBeenCalled();
	});

	// w2v_orchestrator#1106: a byo_required tenant IS licensed — its 402 says
	// "configure your own provider". Blocking the SPA would hide the fix.
	function envelope402(details?: unknown) {
		return {
			ok: false,
			status: 402,
			statusText: 'Payment Required',
			headers: new Headers(),
			json: async () => ({
				error: { code: 'HTTP_402', message: 'x', status: 402, ...(details ? { details } : {}) }
			})
		};
	}

	it('a 402 byo_provider_required does NOT trip the license gate, and keeps its details', async () => {
		const byo = { code: 'byo_provider_required', modality: 'image', message: 'm' };
		fetchMock.mockResolvedValue(envelope402(byo));
		const err = await api.post('/runs', {}).catch((e: unknown) => e);
		expect((err as ApiError).details).toEqual(byo);
		await new Promise((r) => setTimeout(r, 20));
		expect(handleForbiddenMock).not.toHaveBeenCalled();
	});

	it('any other 402 still trips the license gate', async () => {
		fetchMock.mockResolvedValue(envelope402());
		await api.post('/runs', {}).catch(() => undefined);
		await vi.waitFor(() => expect(handleForbiddenMock).toHaveBeenCalledTimes(1));
	});

	// The start_run preflight (w2v_orchestrator#1108) sends a BARE FastAPI body,
	// not the envelope: `{detail: {code, modality, message}}`.
	it('a bare-detail 402 byo_provider_required keeps its details and does NOT trip the gate', async () => {
		const byo = { code: 'byo_provider_required', modality: 'tts', message: 'm' };
		fetchMock.mockResolvedValue({
			ok: false,
			status: 402,
			statusText: 'Payment Required',
			headers: new Headers(),
			json: async () => ({ detail: byo })
		});
		const err = await api.post('/deliverables/d/runs', {}).catch((e: unknown) => e);
		expect((err as ApiError).details).toEqual(byo);
		expect((err as ApiError).detail).toBe('m');
		await new Promise((r) => setTimeout(r, 20));
		expect(handleForbiddenMock).not.toHaveBeenCalled();
	});
});

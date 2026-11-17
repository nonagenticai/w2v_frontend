import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { ensureFreshToken } from '$lib/services/keycloak.js';
import { ApiError } from './client.js';
import { tenancy, tenancyErrorMessage } from './tenancy.js';

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
	return { ok: true, status, json: async () => body };
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

describe('tenancy api client — routes', () => {
	it('lists members with status/limit/offset', async () => {
		fetchMock.mockResolvedValue(ok({ items: [], total: 0, limit: 10, offset: 20 }));
		await tenancy.members({ status: 'active', limit: 10, offset: 20 });
		expect(call()).toMatchObject({
			url: '/api/tenant/members?limit=10&offset=20&status=active',
			method: 'GET'
		});
	});

	it('PATCHes a member role and DELETEs a member', async () => {
		fetchMock.mockResolvedValue(ok({}));
		await tenancy.setMemberRole('s-1', 'tenant_admin');
		expect(call(0)).toEqual({
			url: '/api/tenant/members/s-1',
			method: 'PATCH',
			body: { role: 'tenant_admin' }
		});
		await tenancy.removeMember('s-1');
		expect(call(1)).toMatchObject({ url: '/api/tenant/members/s-1', method: 'DELETE' });
	});

	it('creates, lists, resends and revokes invites', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await tenancy.createInvite('a@b.co', 'member');
		await tenancy.invites('pending');
		await tenancy.resendInvite('i-1');
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await tenancy.revokeInvite('i-1');
		expect(call(0)).toEqual({
			url: '/api/tenant/invites',
			method: 'POST',
			body: { email: 'a@b.co', role: 'member' }
		});
		expect(call(1)).toMatchObject({ url: '/api/tenant/invites?status=pending', method: 'GET' });
		expect(call(2)).toMatchObject({ url: '/api/tenant/invites/i-1/resend', method: 'POST' });
		expect(call(3)).toMatchObject({ url: '/api/tenant/invites/i-1', method: 'DELETE' });
	});

	it('accepts an invite, lists my tenants, renames the tenant', async () => {
		fetchMock.mockResolvedValue(ok({}));
		await tenancy.acceptInvite('tok-0123456789abcdef');
		await tenancy.myTenants();
		await tenancy.renameTenant('Acme');
		expect(call(0)).toEqual({
			url: '/api/invites/accept',
			method: 'POST',
			body: { token: 'tok-0123456789abcdef' }
		});
		expect(call(1)).toMatchObject({ url: '/api/me/tenants', method: 'GET' });
		expect(call(2)).toEqual({ url: '/api/tenant', method: 'PATCH', body: { name: 'Acme' } });
	});

	it('lists, creates (expiry only when given) and revokes API keys', async () => {
		fetchMock.mockResolvedValue(ok({ items: [], total: 0 }));
		await tenancy.apiKeys();
		await tenancy.createApiKey('ci');
		await tenancy.createApiKey('ci2', '2027-01-01T00:00:00.000Z');
		await tenancy.createApiKey('merqi', null, ['connections:write']);
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await tenancy.revokeApiKey('k-1');
		expect(call(0)).toMatchObject({ url: '/api/tenant/api-keys', method: 'GET' });
		// No scope chosen → `scopes` omitted (the server default is none).
		expect(call(1).body).toEqual({ name: 'ci' });
		expect(call(2).body).toEqual({ name: 'ci2', expires_at: '2027-01-01T00:00:00.000Z' });
		expect(call(3).body).toEqual({ name: 'merqi', scopes: ['connections:write'] });
		expect(call(4)).toMatchObject({ url: '/api/tenant/api-keys/k-1', method: 'DELETE' });
	});
});

describe('tenancy error codes', () => {
	it('ApiError carries the envelope code and details', async () => {
		fetchMock.mockResolvedValue(
			envelope(409, 'INVITE_PENDING', 'pending; resend it', { invite_id: 'i-9' })
		);
		const err = await tenancy.createInvite('a@b.co').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).code).toBe('INVITE_PENDING');
		expect((err as ApiError).details).toEqual({ invite_id: 'i-9' });
	});

	it('maps LAST_TENANT_ADMIN to the "needs at least one admin" copy', async () => {
		fetchMock.mockResolvedValue(
			envelope(409, 'LAST_TENANT_ADMIN', 'A workspace must keep at least one active tenant admin.')
		);
		const err = await tenancy.setMemberRole('s-1', 'member').catch((e: unknown) => e);
		expect(tenancyErrorMessage(err)).toMatch(/workspace needs at least one admin/i);
	});

	it('maps IDENTITY_PROVIDER_FORBIDDEN to operator-facing copy, distinct from KEYCLOAK_UNAVAILABLE', async () => {
		fetchMock.mockResolvedValue(
			envelope(502, 'IDENTITY_PROVIDER_FORBIDDEN', 'raw server text that must not be shown')
		);
		const err = await tenancy.createInvite('new@example.com', 'member').catch((e: unknown) => e);
		expect((err as ApiError).code).toBe('IDENTITY_PROVIDER_FORBIDDEN');
		expect(tenancyErrorMessage(err)).toBe(
			"Identity service refused the request — the platform's invite permission is missing; contact the operator"
		);
		expect(tenancyErrorMessage(new ApiError(502, 'x', 'raw', 'KEYCLOAK_UNAVAILABLE'))).toBe(
			'The sign-in service is unreachable right now. Try again in a moment.'
		);
	});

	it('maps TENANT_NOT_ONBOARDED to the contact-your-administrator copy, not the raw server text', () => {
		expect(
			tenancyErrorMessage(
				new ApiError(
					403,
					'Forbidden',
					'This tenant is not onboarded to w2v: …',
					'TENANT_NOT_ONBOARDED'
				)
			)
		).toBe("This workspace isn't set up for Studio yet — contact your administrator.");
	});

	it('falls back to the server message for an unknown code, then to the fallback', () => {
		expect(tenancyErrorMessage(new ApiError(500, 'x', 'boom', 'WEIRD'))).toBe('boom');
		expect(tenancyErrorMessage(new ApiError(500, 'x', ''), 'fallback')).toBe('fallback');
		expect(tenancyErrorMessage('nope', 'fallback')).toBe('fallback');
	});
});

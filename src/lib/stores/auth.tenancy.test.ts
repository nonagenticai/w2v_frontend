import { beforeEach, describe, expect, it, vi } from 'vitest';

// P2 tenancy in the auth store: role from /auth/me, the no-workspace signal,
// stale active-tenant reconciliation, and pending invites (listed, never auto-accepted).

vi.mock('$app/environment', () => ({ browser: true }));

const {
	meMock,
	reconcileMock,
	toastSuccessMock,
	toastWarningMock,
	dropRefusedMock,
	consumeNoticeMock
} = vi.hoisted(() => {
	// The store auto-runs initAuth() at import (browser: true), whose cookie sync
	// calls fetch — stub it BEFORE the import so nothing reaches the network.
	(globalThis as { fetch?: unknown }).fetch = async () => ({ ok: true });
	return {
		meMock: vi.fn(),
		reconcileMock: vi.fn(),
		toastSuccessMock: vi.fn(),
		toastWarningMock: vi.fn(),
		dropRefusedMock: vi.fn(),
		consumeNoticeMock: vi.fn()
	};
});

vi.mock('$lib/api/auth.js', () => ({ auth: { me: meMock } }));
vi.mock('$lib/api/client.js', async () => {
	const actual: typeof import('$lib/api/client.js') = await vi.importActual('$lib/api/client.js');
	return { ...actual, setLicenseToken: vi.fn() };
});
vi.mock('$lib/stores/health-state.svelte.js', () => ({ markBackendDown: vi.fn() }));
vi.mock('$lib/stores/tenant-switcher.svelte.js', () => ({
	tenantSwitcher: {
		reconcile: reconcileMock,
		dropRefused: (id?: string | null) => dropRefusedMock(id),
		consumeRefusedNotice: () => consumeNoticeMock()
	},
	REFUSED_TENANT_NOTICE: { title: 'Workspace unavailable', description: 'gone' }
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: vi.fn(),
	toastSuccess: toastSuccessMock,
	toastWarning: toastWarningMock
}));
vi.mock('$lib/services/keycloak.js', () => ({
	getToken: () => 'fake-jwt',
	getUserInfo: () => null,
	initKeycloak: vi.fn(async () => true),
	isAuthenticated: () => true,
	isBypassed: () => false,
	keycloak: { onAuthLogout: undefined, onAuthRefreshSuccess: undefined },
	logout: vi.fn()
}));

import { ApiError, setActiveTenantId } from '$lib/api/client.js';
import {
	__setUserForTest,
	isSuperAdmin,
	fetchUser,
	getUser,
	getMembershipRole,
	hasNoWorkspace,
	isTenantAdmin
} from './auth.svelte.js';

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

function me(over: Record<string, unknown> = {}) {
	return {
		sub: 'u',
		subject_id: 'u',
		email: 'u@x.co',
		name: 'U',
		preferred_username: 'u',
		roles: [],
		license_token: null,
		tenant_id: T1,
		role: 'member',
		memberships: [{ tenant_id: T1, name: 'One', role: 'member', tenant_status: 'active' }],
		pending_invites: [],
		...over
	};
}

beforeEach(() => {
	meMock.mockReset();
	reconcileMock.mockReset().mockReturnValue(false);
	toastSuccessMock.mockReset();
	toastWarningMock.mockReset();
	dropRefusedMock.mockReset().mockReturnValue(false);
	consumeNoticeMock.mockReset().mockReturnValue(false);
	setActiveTenantId(null);
	__setUserForTest(null);
	(globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () => ({
		ok: true
	})) as unknown as typeof fetch;
});

describe('membership role', () => {
	it('a membership role of member outranks a stale realm tenant_admin', async () => {
		meMock.mockResolvedValue(me({ roles: ['tenant_admin'], role: 'member' }));
		await fetchUser();
		expect(getMembershipRole()).toBe('member');
		expect(isTenantAdmin()).toBe(false);
	});

	it('membership role tenant_admin grants the tenant gate without any realm role', async () => {
		meMock.mockResolvedValue(me({ roles: [], role: 'tenant_admin' }));
		await fetchUser();
		expect(isTenantAdmin()).toBe(true);
	});

	it('with no membership role (claim mode) the gate mirrors the roles /me reported', async () => {
		meMock.mockResolvedValue(me({ roles: ['tenant_admin'], role: null }));
		await fetchUser();
		expect(isTenantAdmin()).toBe(true);
	});
});

describe('no workspace', () => {
	it('tenant_id null ⇒ hasNoWorkspace', async () => {
		meMock.mockResolvedValue(me({ tenant_id: null, role: null, memberships: [] }));
		await fetchUser();
		expect(hasNoWorkspace()).toBe(true);
	});

	it('a tenant ⇒ not no-workspace; a super_admin is exempt even with tenant_id null', async () => {
		meMock.mockResolvedValue(me());
		await fetchUser();
		expect(hasNoWorkspace()).toBe(false);
		meMock.mockResolvedValue(me({ tenant_id: null, roles: ['super_admin'], memberships: [] }));
		await fetchUser();
		expect(hasNoWorkspace()).toBe(false);
	});
});

describe('stale active tenant', () => {
	it('reconciles against memberships and re-fetches /me when it dropped one', async () => {
		reconcileMock.mockReturnValue(true);
		meMock
			.mockResolvedValueOnce(me({ tenant_id: null })) // answered under the stale header
			.mockResolvedValueOnce(me({ tenant_id: T1 }));
		await fetchUser();
		expect(reconcileMock).toHaveBeenCalledWith([T1]);
		expect(meMock).toHaveBeenCalledTimes(2);
		expect(hasNoWorkspace()).toBe(false);
	});

	it('does not reconcile for a super_admin (they may act in any tenant)', async () => {
		meMock.mockResolvedValue(me({ roles: ['super_admin'], tenant_id: T2 }));
		await fetchUser();
		expect(reconcileMock).not.toHaveBeenCalled();
		expect(meMock).toHaveBeenCalledTimes(1);
	});

	it('does not reconcile against a backend that reports no memberships field', async () => {
		const legacy = me();
		delete (legacy as Record<string, unknown>).memberships;
		meMock.mockResolvedValue(legacy);
		await fetchUser();
		expect(reconcileMock).not.toHaveBeenCalled();
	});
});

describe('refused active tenant (super_admin lock-out)', () => {
	const DEAD = '33333333-3333-3333-3333-333333333333';

	it('a super_admin whose choice /me reports refused drops it, is told, and keeps super_admin', async () => {
		setActiveTenantId(DEAD);
		dropRefusedMock.mockReturnValue(true);
		meMock
			.mockResolvedValueOnce(
				me({ roles: ['super_admin'], tenant_id: null, active_tenant_refused: DEAD })
			)
			.mockResolvedValueOnce(me({ roles: ['super_admin'], tenant_id: null }));
		await fetchUser();
		expect(dropRefusedMock).toHaveBeenCalledWith(DEAD);
		expect(toastWarningMock).toHaveBeenCalledWith('Workspace unavailable', 'gone');
		expect(meMock).toHaveBeenCalledTimes(2);
		expect(isSuperAdmin()).toBe(true);
	});

	it('an older backend 404ing /auth/me with TENANT_NOT_FOUND no longer leaves roles empty', async () => {
		setActiveTenantId(DEAD);
		dropRefusedMock.mockReturnValue(true);
		__setUserForTest(me({ roles: [] }) as never);
		meMock
			.mockRejectedValueOnce(
				new ApiError(404, 'Not Found', 'tenant not provisioned', 'TENANT_NOT_FOUND')
			)
			.mockResolvedValueOnce(me({ roles: ['super_admin'], tenant_id: null }));
		await fetchUser();
		expect(dropRefusedMock).toHaveBeenCalled();
		expect(toastWarningMock).toHaveBeenCalled();
		expect(isSuperAdmin()).toBe(true);
	});

	it('announces a drop the API client made before its reload, exactly once', async () => {
		consumeNoticeMock.mockReturnValueOnce(true);
		meMock.mockResolvedValue(me({ roles: ['super_admin'], tenant_id: null }));
		await fetchUser();
		expect(consumeNoticeMock).toHaveBeenCalledTimes(1);
		expect(toastWarningMock).toHaveBeenCalledTimes(1);
		expect(toastWarningMock).toHaveBeenCalledWith('Workspace unavailable', 'gone');
		await fetchUser();
		expect(toastWarningMock).toHaveBeenCalledTimes(1);
	});

	it('nothing refused ⇒ nothing dropped, no notice, one /me', async () => {
		setActiveTenantId(T2);
		meMock.mockResolvedValue(me({ roles: ['super_admin'], tenant_id: T2 }));
		await fetchUser();
		expect(dropRefusedMock).not.toHaveBeenCalled();
		expect(toastWarningMock).not.toHaveBeenCalled();
		expect(meMock).toHaveBeenCalledTimes(1);
	});
});

describe('pending invites', () => {
	it('keeps pending_invites on the user and auto-accepts / announces nothing', async () => {
		const pending = {
			id: 'inv-2',
			tenant_id: T2,
			tenant_name: 'Two',
			role: 'member',
			expires_at: '2026-12-01T00:00:00Z'
		};
		meMock.mockResolvedValue(me({ pending_invites: [pending] }));
		await fetchUser();
		expect(getUser()?.pending_invites).toEqual([pending]);
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(meMock).toHaveBeenCalledTimes(1);
	});
});

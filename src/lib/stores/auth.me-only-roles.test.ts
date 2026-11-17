import { beforeEach, describe, expect, it, vi } from 'vitest';

// G4: roles and tenant come ONLY from the orchestrator's /auth/me. The Keycloak
// token is identity (sub / email / name) — its realm roles must never reach the
// store, not as a seed, not as a fallback when /me answers with no roles.

vi.mock('$app/environment', () => ({ browser: true }));

const { meMock, TOKEN_REALM_ROLES } = vi.hoisted(() => {
	// initAuth() auto-runs at import (browser: true); its cookie sync calls fetch.
	(globalThis as { fetch?: unknown }).fetch = async () => ({ ok: true });
	return {
		meMock: vi.fn<() => Promise<unknown>>(async () => null),
		// What a portal-realm token for an fr admin carries.
		TOKEN_REALM_ROLES: ['tenant_admin', 'super_admin', 'admin', 'power-user']
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
		reconcile: vi.fn(() => false),
		dropRefused: vi.fn(() => false),
		consumeRefusedNotice: vi.fn(() => false)
	},
	REFUSED_TENANT_NOTICE: { title: 't', description: 'd' }
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	toastWarning: vi.fn()
}));
vi.mock('$lib/services/keycloak.js', () => ({
	getToken: () => 'fake-jwt',
	getUserInfo: () => ({
		id: 'sub-1',
		email: 'admin@x.co',
		name: 'Token Admin',
		preferred_username: 'tokenadmin',
		roles: TOKEN_REALM_ROLES
	}),
	initKeycloak: vi.fn(async () => true),
	isAuthenticated: () => true,
	isBypassed: () => false,
	keycloak: { onAuthLogout: undefined, onAuthRefreshSuccess: undefined },
	logout: vi.fn()
}));

import { ApiError } from '$lib/api/client.js';
import {
	ensureAuthReady,
	getUser,
	initAuth,
	isAdmin,
	isSuperAdmin,
	isTenantAdmin
} from './auth.svelte.js';

const T1 = '11111111-1111-1111-1111-111111111111';

function me(over: Record<string, unknown> = {}) {
	return {
		sub: 'sub-1',
		email: 'admin@x.co',
		name: 'Token Admin',
		preferred_username: 'tokenadmin',
		roles: [],
		license_token: null,
		tenant_id: T1,
		role: null,
		memberships: [],
		pending_invites: [],
		...over
	};
}

beforeEach(async () => {
	// Let the import-time initAuth() settle before each test drives its own.
	await ensureAuthReady();
	meMock.mockReset();
});

describe('roles come only from /auth/me', () => {
	it('an empty /me roles list means no roles — the token realm roles are not used', async () => {
		meMock.mockResolvedValue(me({ roles: [], role: null }));
		await initAuth();
		expect(getUser()?.roles).toEqual([]);
		expect(isSuperAdmin()).toBe(false);
		expect(isTenantAdmin()).toBe(false);
		expect(isAdmin()).toBe(false);
	});

	it('/me roles replace the token roles entirely (membership role member stays a member)', async () => {
		meMock.mockResolvedValue(me({ roles: ['member'], role: 'member' }));
		await initAuth();
		expect(getUser()?.roles).toEqual(['member']);
		expect(isTenantAdmin()).toBe(false);
	});

	it('identity still comes from the token while /me is unreachable, but no roles do', async () => {
		meMock.mockRejectedValue(new ApiError(503, 'Service Unavailable', 'down'));
		await initAuth();
		expect(getUser()?.sub).toBe('sub-1');
		expect(getUser()?.email).toBe('admin@x.co');
		expect(getUser()?.roles).toEqual([]);
		expect(isSuperAdmin()).toBe(false);
		expect(isTenantAdmin()).toBe(false);
	});

	it('a 401 from /me (null) leaves no roles either', async () => {
		meMock.mockResolvedValue(null);
		await initAuth();
		expect(getUser()?.roles).toEqual([]);
		expect(isTenantAdmin()).toBe(false);
	});

	it('the w2v membership role from /me is what grants the tenant gate', async () => {
		meMock.mockResolvedValue(me({ roles: ['tenant_admin'], role: 'tenant_admin' }));
		await initAuth();
		expect(isTenantAdmin()).toBe(true);
		expect(isSuperAdmin()).toBe(false);
	});
});

describe('/auth/me name placeholder', () => {
	it('a subject-id /me name does not clobber the token name', async () => {
		const id = '01a0dd02-d324-77bb-acd8-7c31fb6e95ec';
		meMock.mockResolvedValue(me({ name: id, subject_id: id }));
		await initAuth();
		expect(getUser()?.name).toBe('Token Admin');
	});

	it('a real /me name still wins', async () => {
		meMock.mockResolvedValue(me({ name: 'tokenadmin' }));
		await initAuth();
		expect(getUser()?.name).toBe('tokenadmin');
	});
});

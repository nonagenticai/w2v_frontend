import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/services/keycloak.js', () => ({
	getToken: () => undefined,
	getUserInfo: () => null,
	initKeycloak: vi.fn(async () => false),
	isAuthenticated: () => false,
	isBypassed: () => false,
	keycloak: { onAuthLogout: undefined, onAuthRefreshSuccess: undefined },
	logout: vi.fn()
}));
vi.mock('$lib/api/auth.js', () => ({ auth: { me: vi.fn(async () => null) } }));
vi.mock('$lib/api/client.js', () => ({
	clearAuthToken: vi.fn(),
	setAuthToken: vi.fn(),
	setDefaultHeader: vi.fn(),
	setLicenseToken: vi.fn()
}));

import {
	__setUserForTest,
	canAccessAdmin,
	hasRole,
	isAdmin,
	isPowerUser,
	isSuperAdmin,
	isTenantAdmin
} from './auth.svelte.js';

describe('role helpers', () => {
	it('hasRole returns true only for roles on the current user', () => {
		__setUserForTest({
			sub: 'u1',
			email: null,
			name: 'x',
			preferred_username: 'x',
			license_token: null,
			roles: ['admin', 'editor']
		});
		expect(hasRole('admin')).toBe(true);
		expect(hasRole('viewer')).toBe(false);
	});

	it('hasRole returns false when no user', () => {
		__setUserForTest(null);
		expect(hasRole('admin')).toBe(false);
	});

	it('isAdmin is true iff roles contains admin', () => {
		__setUserForTest({
			sub: 'u2',
			email: null,
			name: 'x',
			preferred_username: 'x',
			license_token: null,
			roles: ['editor']
		});
		expect(isAdmin()).toBe(false);

		__setUserForTest({
			sub: 'u2',
			email: null,
			name: 'x',
			preferred_username: 'x',
			license_token: null,
			roles: ['admin']
		});
		expect(isAdmin()).toBe(true);
	});

	it('isPowerUser is true for admin, power-user, or both; false otherwise', () => {
		const base = {
			sub: 'u',
			email: null,
			name: 'x',
			preferred_username: 'x',
			license_token: null
		} as const;

		__setUserForTest({ ...base, roles: ['admin'] });
		expect(isPowerUser()).toBe(true);

		__setUserForTest({ ...base, roles: ['power-user'] });
		expect(isPowerUser()).toBe(true);

		__setUserForTest({ ...base, roles: ['admin', 'power-user'] });
		expect(isPowerUser()).toBe(true);

		__setUserForTest({ ...base, roles: ['editor'] });
		expect(isPowerUser()).toBe(false);

		__setUserForTest(null);
		expect(isPowerUser()).toBe(false);
	});
});

describe('tenancy admin-tier helpers (super_admin > tenant_admin > member)', () => {
	const base = {
		sub: 'u',
		email: null,
		name: 'x',
		preferred_username: 'x',
		license_token: null
	} as const;

	it('member (no admin roles) → none', () => {
		__setUserForTest({ ...base, roles: ['member'] });
		expect(isSuperAdmin()).toBe(false);
		expect(isTenantAdmin()).toBe(false);
		expect(canAccessAdmin()).toBe(false);
	});

	it('tenant_admin → tenant gate only, not super', () => {
		__setUserForTest({ ...base, roles: ['tenant_admin'] });
		expect(isSuperAdmin()).toBe(false);
		expect(isTenantAdmin()).toBe(true);
		expect(canAccessAdmin()).toBe(true);
	});

	it('super_admin is composite → passes both gates', () => {
		__setUserForTest({ ...base, roles: ['super_admin'] });
		expect(isSuperAdmin()).toBe(true);
		expect(isTenantAdmin()).toBe(true);
		expect(canAccessAdmin()).toBe(true);
	});

	it('no user / anon → none', () => {
		__setUserForTest(null);
		expect(isSuperAdmin()).toBe(false);
		expect(isTenantAdmin()).toBe(false);
		expect(canAccessAdmin()).toBe(false);
	});
});

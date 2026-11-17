import { describe, expect, it } from 'vitest';
import {
	hasSuperAdmin,
	hasTenantAdmin,
	requireAnyAdmin,
	requireSuperAdmin,
	requireTenantAdmin
} from './auth-guards';

const member = { roles: ['member'] };
const tenantAdmin = { roles: ['tenant_admin'] };
const superAdmin = { roles: ['super_admin'] };

describe('auth-guards predicates', () => {
	it('hasSuperAdmin only for super_admin', () => {
		expect(hasSuperAdmin(superAdmin)).toBe(true);
		expect(hasSuperAdmin(tenantAdmin)).toBe(false);
		expect(hasSuperAdmin(member)).toBe(false);
		expect(hasSuperAdmin(null)).toBe(false);
		expect(hasSuperAdmin(undefined)).toBe(false);
	});

	it('hasTenantAdmin is composite (tenant_admin OR super_admin)', () => {
		expect(hasTenantAdmin(tenantAdmin)).toBe(true);
		expect(hasTenantAdmin(superAdmin)).toBe(true);
		expect(hasTenantAdmin(member)).toBe(false);
		expect(hasTenantAdmin(null)).toBe(false);
	});
});

describe('auth-guards require* throwers', () => {
	it('requireSuperAdmin throws 403 for non-super', () => {
		expect(() => requireSuperAdmin(superAdmin)).not.toThrow();
		let status: number | undefined;
		try {
			requireSuperAdmin(tenantAdmin);
		} catch (e) {
			status = (e as { status?: number }).status;
		}
		expect(status).toBe(403);
		expect(() => requireSuperAdmin(member)).toThrow();
		expect(() => requireSuperAdmin(null)).toThrow();
	});

	it('requireTenantAdmin passes tenant_admin + super_admin, throws for member', () => {
		expect(() => requireTenantAdmin(tenantAdmin)).not.toThrow();
		expect(() => requireTenantAdmin(superAdmin)).not.toThrow();
		expect(() => requireTenantAdmin(member)).toThrow();
	});

	it('requireAnyAdmin passes either admin role, throws for member/anon', () => {
		expect(() => requireAnyAdmin(tenantAdmin)).not.toThrow();
		expect(() => requireAnyAdmin(superAdmin)).not.toThrow();
		expect(() => requireAnyAdmin(member)).toThrow();
		expect(() => requireAnyAdmin(null)).toThrow();
	});
});

describe('auth-guards gate on the w2v membership role from /auth/me', () => {
	it('a membership role of member is never an admin, whatever `roles` carries', () => {
		const staleRealm = { roles: ['tenant_admin'], role: 'member' };
		expect(hasTenantAdmin(staleRealm)).toBe(false);
		expect(() => requireTenantAdmin(staleRealm)).toThrow();
		expect(() => requireAnyAdmin(staleRealm)).toThrow();
	});

	it('a membership role of tenant_admin passes with no tenant_admin in `roles`', () => {
		const w2vAdmin = { roles: [], role: 'tenant_admin' };
		expect(hasTenantAdmin(w2vAdmin)).toBe(true);
		expect(() => requireTenantAdmin(w2vAdmin)).not.toThrow();
		expect(hasSuperAdmin(w2vAdmin)).toBe(false);
	});

	it('super_admin passes even with no membership in the tenant (role null)', () => {
		expect(hasTenantAdmin({ roles: ['super_admin'], role: null })).toBe(true);
	});
});

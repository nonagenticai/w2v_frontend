// src/lib/utils/auth-guards.ts — admin-tier Phase A (mostly dormant).
//
// Client-side mirrors of the (forthcoming) backend role guards. The server is
// always the real authority — every /api/* call 403s on its own in Phase B; these
// only gate the UI shell so a member never sees an admin screen flash before the
// API denies it. Ported from commonpractice's frontend/src/lib/utils/auth-guards.ts.
//
// The route-group `+layout.svelte` gates use the auth-store helpers directly; these
// param-taking predicates exist for unit testing and future `+layout.ts` server
// loads. `super_admin` is a COMPOSITE of `tenant_admin` (it passes the tenant gate).
//
// Every input here is the orchestrator's `GET /api/auth/me` answer — never the
// Keycloak token. `role` is the caller's w2v membership role in the active
// tenant (`tenant_members.role`); `roles` are the effective roles w2v resolved
// for this request (under W2V_TENANCY_SOURCE=membership: the membership role
// plus `super_admin`; a realm `tenant_admin` is dropped server-side).
import { error } from '@sveltejs/kit';

export interface RoleBearer {
	roles: string[];
	/** `/auth/me.role` — the w2v membership role in the active tenant. */
	role?: string | null;
}

export function hasSuperAdmin(user: RoleBearer | null | undefined): boolean {
	return user?.roles.includes('super_admin') ?? false;
}

/**
 * True for a w2v tenant_admin OR a super_admin (composite). The w2v membership
 * role is authoritative whenever `/auth/me` reports one: a `member` is never an
 * admin, whatever else `roles` carries. With no membership role (claim/shadow
 * tenancy) the gate mirrors the effective roles `/auth/me` reported — the same
 * roles the backend's own guards check in that mode.
 */
export function hasTenantAdmin(user: RoleBearer | null | undefined): boolean {
	if (!user) return false;
	if (hasSuperAdmin(user)) return true;
	if (user.role != null) return user.role === 'tenant_admin';
	return user.roles.includes('tenant_admin');
}

/** Platform scope: throws 403 unless the user holds super_admin. */
export function requireSuperAdmin(user: RoleBearer | null | undefined): void {
	if (!hasSuperAdmin(user)) {
		throw error(403, 'Super admin role required');
	}
}

/** Tenant scope: passes for tenant_admin or super_admin (composite). */
export function requireTenantAdmin(user: RoleBearer | null | undefined): void {
	if (!hasTenantAdmin(user)) {
		throw error(403, 'Tenant admin role required');
	}
}

/** Outer admin gate (either tenancy admin role). */
export function requireAnyAdmin(user: RoleBearer | null | undefined): void {
	if (!hasTenantAdmin(user)) {
		throw error(403, 'Admin role required');
	}
}

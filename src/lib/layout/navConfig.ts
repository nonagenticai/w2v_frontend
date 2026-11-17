// w2v navigation config — the ONE source for the sidebar's information
// architecture. The sidebar renders a home row, a "New project" call-to-action
// button (an action, deliberately NOT a nav row), then three grouped sections:
//
//   Create     — the product surface (Projects, Critique)
//   Workspace  — this workspace's library, connections, people and settings
//   Platform   — super_admin-only, all-tenant screens, behind a divider
//
// Every label is unique across the whole config (a super_admin sees all three
// sections at once, so two rows called "Audit log" would be ambiguous about
// scope). navConfig.test.ts enforces that. Icons are `@lucide/svelte` component
// references resolved at the call site.
//
// Still not surfaced: /projects/[pid]/verbatim and runs/[id] (legacy deep links
// that redirect into the project workspace), /license-upgrade (reached from the
// licence banners) and /no-workspace.

import {
	LayoutDashboard,
	FolderKanban,
	MessageSquareText,
	Settings as SettingsIcon,
	Shield,
	Building2,
	ScrollText,
	FileSearch,
	BarChart3,
	Users,
	UserPlus,
	Activity,
	KeyRound,
	Plug,
	Cpu,
	Music,
	History,
	Inbox
} from '@lucide/svelte';
import type { Component } from 'svelte';

export type NavRole = 'super_admin' | 'tenant_admin';

export interface NavItem {
	id: string;
	label: string;
	href: string;
	icon: Component<any>;
	/**
	 * Admin-tier gate. `tenant_admin` → this workspace's admin screens (super_admin
	 * passes too, composite); `super_admin` → platform/all-tenant screens. Items
	 * without this are visible to everyone. Gated on the ROLE, never on tenant.
	 */
	requiresRole?: NavRole;
	/**
	 * Active only on an exact path match, never for a sub-path. `/admin` (this
	 * workspace's overview) needs it: `/admin/onboarding` is a separate
	 * super_admin screen with its own row, not a child of the overview.
	 */
	exact?: boolean;
}

export interface NavSection {
	id: 'create' | 'workspace' | 'platform';
	label: string;
	/** Whole-section gate; the section is also hidden when no item in it is visible. */
	requiresRole?: NavRole;
	/** Rendered with a divider above it, separating it from the caller's own workspace. */
	divider?: boolean;
	items: readonly NavItem[];
}

/** The landing page. Rendered above the sections, not inside one. */
export const HOME_ITEM: NavItem = {
	id: 'dashboard',
	label: 'Dashboard',
	href: '/',
	icon: LayoutDashboard
};

/** The primary call to action, rendered as a button under the brand mark. */
export const NEW_PROJECT_CTA = { label: 'New project', href: '/projects/new' } as const;

export const NAV_SECTIONS: readonly NavSection[] = [
	{
		id: 'create',
		label: 'Create',
		items: [
			{ id: 'projects', label: 'Projects', href: '/projects', icon: FolderKanban },
			{ id: 'critique', label: 'Critique', href: '/critique', icon: MessageSquareText }
		]
	},
	{
		id: 'workspace',
		label: 'Workspace',
		items: [
			{
				id: 'admin',
				label: 'Workspace overview',
				href: '/admin',
				icon: Shield,
				requiresRole: 'tenant_admin',
				exact: true
			},
			{ id: 'music', label: 'Music library', href: '/music', icon: Music },
			{
				id: 'services',
				label: 'Services',
				href: '/services',
				icon: Cpu,
				requiresRole: 'tenant_admin'
			},
			{
				id: 'providers',
				label: 'Providers',
				href: '/providers',
				icon: Plug,
				requiresRole: 'tenant_admin'
			},
			{
				id: 'members',
				label: 'Members',
				href: '/members',
				icon: Users,
				requiresRole: 'tenant_admin'
			},
			{
				id: 'api-keys',
				label: 'API keys',
				href: '/api-keys',
				icon: KeyRound,
				requiresRole: 'tenant_admin'
			},
			{
				id: 'usage',
				label: 'Usage',
				href: '/usage',
				icon: BarChart3,
				requiresRole: 'tenant_admin'
			},
			{
				id: 'workspace-audit',
				label: 'Workspace audit log',
				href: '/workspace-audit',
				icon: History,
				requiresRole: 'tenant_admin'
			},
			{ id: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon }
		]
	},
	{
		id: 'platform',
		label: 'Platform',
		requiresRole: 'super_admin',
		divider: true,
		items: [
			{
				id: 'active-runs',
				label: 'All runs',
				href: '/active-runs',
				icon: Activity,
				requiresRole: 'super_admin'
			},
			{
				id: 'tenants',
				label: 'Tenants',
				href: '/tenants',
				icon: Building2,
				requiresRole: 'super_admin'
			},
			{
				id: 'provision',
				label: 'Provision tenant',
				href: '/provision',
				icon: UserPlus,
				requiresRole: 'super_admin'
			},
			{
				id: 'onboarding',
				label: 'Early access',
				href: '/admin/onboarding',
				icon: Inbox,
				requiresRole: 'super_admin'
			},
			{
				id: 'audit',
				label: 'Platform audit log',
				href: '/audit',
				icon: ScrollText,
				requiresRole: 'super_admin'
			},
			{
				id: 'request-audit',
				label: 'Request audit log',
				href: '/request-audit',
				icon: FileSearch,
				requiresRole: 'super_admin'
			}
		]
	}
] as const;

/** Every navigable row (home + all section items), flattened. */
export const NAV_ITEMS: readonly NavItem[] = [HOME_ITEM, ...NAV_SECTIONS.flatMap((s) => s.items)];

/** Active when the path matches exactly for '/', or is a prefix otherwise. */
export function isActive(href: string, pathname: string): boolean {
	if (href === '/') return pathname === '/';
	return pathname === href || pathname.startsWith(href + '/');
}

/** `isActive` for a nav row, honouring its `exact` flag. */
export function isItemActive(item: Pick<NavItem, 'href' | 'exact'>, pathname: string): boolean {
	return item.exact ? pathname === item.href : isActive(item.href, pathname);
}

export interface NavRoles {
	isSuperAdmin: boolean;
	isTenantAdmin: boolean;
}

function passes(role: NavRole | undefined, roles: NavRoles): boolean {
	if (!role) return true;
	return role === 'super_admin' ? roles.isSuperAdmin : roles.isTenantAdmin;
}

/**
 * Whether a nav item is visible for the caller's realm roles. Items without a
 * `requiresRole` are always visible; `super_admin` is a composite that passes the
 * `tenant_admin` gate. Gated on ROLE, never on tenant. Pure (role booleans passed
 * in) so it's unit-testable without the auth store / component runtime.
 */
export function canSeeNavItem(item: NavItem, roles: NavRoles): boolean {
	return passes(item.requiresRole, roles);
}

/** The sections a caller sees, each trimmed to its visible items; empty sections dropped. */
export function visibleSections(roles: NavRoles): NavSection[] {
	return NAV_SECTIONS.filter((s) => passes(s.requiresRole, roles))
		.map((s) => ({ ...s, items: s.items.filter((i) => canSeeNavItem(i, roles)) }))
		.filter((s) => s.items.length > 0);
}

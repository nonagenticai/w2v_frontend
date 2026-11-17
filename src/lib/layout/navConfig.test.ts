import { describe, expect, it } from 'vitest';
import {
	NAV_ITEMS,
	NAV_SECTIONS,
	NEW_PROJECT_CTA,
	canSeeNavItem,
	isActive,
	isItemActive,
	visibleSections,
	type NavItem
} from './navConfig';

const item = (id: string) => NAV_ITEMS.find((i) => i.id === id) as NavItem;

const member = { isSuperAdmin: false, isTenantAdmin: false };
const tenantAdmin = { isSuperAdmin: false, isTenantAdmin: true };
const superAdmin = { isSuperAdmin: true, isTenantAdmin: true };

const shape = (roles: typeof member) =>
	visibleSections(roles).map((s) => [s.label, s.items.map((i) => i.label)]);

describe('navConfig grouping', () => {
	it('a member sees Create + the member-readable Workspace items, no Platform', () => {
		expect(shape(member)).toEqual([
			['Create', ['Projects', 'Critique']],
			['Workspace', ['Music library', 'Settings']]
		]);
	});

	it('a tenant_admin sees the full Workspace section, still no Platform', () => {
		expect(shape(tenantAdmin)).toEqual([
			['Create', ['Projects', 'Critique']],
			[
				'Workspace',
				[
					'Workspace overview',
					'Music library',
					'Services',
					'Providers',
					'Members',
					'API keys',
					'Usage',
					'Workspace audit log',
					'Settings'
				]
			]
		]);
	});

	it('a super_admin additionally sees Platform, behind a divider', () => {
		const sections = visibleSections(superAdmin);
		const platform = sections.find((s) => s.id === 'platform');
		expect(platform?.divider).toBe(true);
		expect(platform?.items.map((i) => i.label)).toEqual([
			'All runs',
			'Tenants',
			'Provision tenant',
			'Early access',
			'Platform audit log',
			'Request audit log'
		]);
	});

	it('every label is unique — no two rows read the same (e.g. two "Audit log"s)', () => {
		const labels = NAV_ITEMS.map((i) => i.label.toLowerCase());
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('/critique is a real nav destination', () => {
		expect(item('critique').href).toBe('/critique');
		expect(canSeeNavItem(item('critique'), member)).toBe(true);
	});

	it('New project is a call to action, not a nav row', () => {
		expect(NAV_ITEMS.some((i) => i.href === NEW_PROJECT_CTA.href)).toBe(false);
		expect(NEW_PROJECT_CTA.href).toBe('/projects/new');
	});

	it('no two visible rows can be active for the same path (no most-specific-wins hack)', () => {
		const paths = [
			'/',
			'/projects',
			'/projects/new',
			'/projects/p1/runs/r1',
			'/audit',
			'/admin',
			'/admin/onboarding'
		];
		for (const path of paths) {
			const active = NAV_ITEMS.filter((i) => isItemActive(i, path));
			expect(active.length, path).toBeLessThanOrEqual(1);
		}
		expect(isActive('/projects', '/projects/new')).toBe(true);
	});

	it('/admin/onboarding lights only the Early access row, /admin only the overview', () => {
		expect(NAV_ITEMS.filter((i) => isItemActive(i, '/admin/onboarding')).map((i) => i.id)).toEqual([
			'onboarding'
		]);
		expect(NAV_ITEMS.filter((i) => isItemActive(i, '/admin')).map((i) => i.id)).toEqual(['admin']);
	});

	it('Early access is a super_admin platform row at /admin/onboarding', () => {
		const platform = NAV_SECTIONS.find((s) => s.id === 'platform')!;
		const ea = platform.items.find((i) => i.id === 'onboarding')!;
		expect(ea.href).toBe('/admin/onboarding');
		expect(canSeeNavItem(ea, member)).toBe(false);
	});

	it('every platform item is itself super_admin-gated (defence in depth)', () => {
		const platform = NAV_SECTIONS.find((s) => s.id === 'platform')!;
		for (const i of platform.items) expect(i.requiresRole, i.id).toBe('super_admin');
	});
});

describe('navConfig role gating', () => {
	it('role-agnostic items are always visible', () => {
		expect(canSeeNavItem(item('projects'), member)).toBe(true);
	});

	it('member sees no admin items', () => {
		expect(canSeeNavItem(item('admin'), member)).toBe(false);
		expect(canSeeNavItem(item('tenants'), member)).toBe(false);
	});

	it('tenant_admin sees /admin but not /tenants', () => {
		expect(canSeeNavItem(item('admin'), tenantAdmin)).toBe(true);
		expect(canSeeNavItem(item('tenants'), tenantAdmin)).toBe(false);
	});

	it('request-audit and provision are super_admin-only', () => {
		for (const id of ['request-audit', 'provision']) {
			expect(canSeeNavItem(item(id), member)).toBe(false);
			expect(canSeeNavItem(item(id), tenantAdmin)).toBe(false);
			expect(canSeeNavItem(item(id), superAdmin)).toBe(true);
		}
	});

	it('Members, API keys, Services, Providers and the workspace audit log are tenant_admin-only', () => {
		for (const id of ['members', 'api-keys', 'services', 'providers', 'workspace-audit']) {
			expect(canSeeNavItem(item(id), tenantAdmin), id).toBe(true);
			expect(canSeeNavItem(item(id), member), id).toBe(false);
		}
	});

	it('Services opens the GPU test bench at /services', () => {
		expect(item('services').href).toBe('/services');
		expect(isItemActive(item('services'), '/services/image')).toBe(true);
		expect(isItemActive(item('services'), '/')).toBe(false);
	});

	it('Music is visible to every member — the library GET is member-readable', () => {
		expect(item('music').href).toBe('/music');
		expect(canSeeNavItem(item('music'), member)).toBe(true);
	});
});

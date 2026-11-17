import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readable } from 'svelte/store';

const { roles, path } = vi.hoisted(() => ({
	roles: { superAdmin: false, tenantAdmin: false },
	path: { value: '/' }
}));
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (fn: (v: unknown) => void) =>
			readable({ url: new URL(`http://x${path.value}`) }).subscribe(fn)
	}
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	isSuperAdmin: () => roles.superAdmin,
	isTenantAdmin: () => roles.tenantAdmin
}));

import { render, screen, within } from '@testing-library/svelte';
import SidebarNav from './SidebarNav.svelte';

const groupLabels = () =>
	screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby'));

beforeEach(() => {
	roles.superAdmin = false;
	roles.tenantAdmin = false;
	path.value = '/';
});

describe('SidebarNav', () => {
	it('renders grouped sections with headings, and New project as a button-styled CTA', () => {
		render(SidebarNav, { forceExpanded: true });
		expect(groupLabels()).toEqual(['nav-section-create', 'nav-section-workspace']);
		const create = screen.getByRole('group', { name: 'Create' });
		expect(within(create).getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe(
			'/projects'
		);
		expect(within(create).getByRole('link', { name: 'Critique' }).getAttribute('href')).toBe(
			'/critique'
		);
		expect(screen.getByTestId('sidebar-new-project').getAttribute('href')).toBe('/projects/new');
	});

	it('gives the mobile-drawer instance its own New project testid', () => {
		render(SidebarNav, { forceExpanded: true, testidPrefix: 'drawer' });
		expect(screen.getByTestId('drawer-new-project').getAttribute('href')).toBe('/projects/new');
		expect(screen.queryByTestId('sidebar-new-project')).toBeNull();
	});

	it('hides the Platform section, health-style operator chrome and the version from non-operators', () => {
		roles.tenantAdmin = true;
		render(SidebarNav, { forceExpanded: true });
		expect(screen.queryByRole('group', { name: 'Platform' })).toBeNull();
		expect(screen.queryByTestId('app-version')).toBeNull();
	});

	it('shows Platform (with a divider) and the build version to a super_admin', () => {
		roles.superAdmin = true;
		roles.tenantAdmin = true;
		render(SidebarNav, { forceExpanded: true });
		const platform = screen.getByTestId('nav-section-platform');
		expect(platform.className).toContain('border-t');
		expect(within(platform).getByRole('link', { name: 'Platform audit log' })).toBeTruthy();
		expect(screen.getByTestId('app-version').textContent).toMatch(/v\d+\.\d+\.\d+/);
	});

	it('on /projects/new only "Projects" is current — the CTA is not a competing nav row', () => {
		path.value = '/projects/new';
		render(SidebarNav, { forceExpanded: true });
		const current = screen
			.getAllByRole('link')
			.filter((a) => a.getAttribute('aria-current') === 'page');
		expect(current.map((a) => a.textContent?.trim())).toEqual(['Projects']);
	});
});

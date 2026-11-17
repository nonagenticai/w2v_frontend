import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isSuperAdminMock = vi.fn();
const getUserMock = vi.fn();
const setActiveMock = vi.fn();
const tenantsMock = vi.fn();
const recordScopeSwitchMock = vi.fn();
let activeTenantId: string | null = null;

vi.mock('$lib/stores/auth.svelte.js', () => ({
	isSuperAdmin: () => isSuperAdminMock(),
	getUser: () => getUserMock()
}));
vi.mock('$lib/stores/tenant-switcher.svelte.js', () => ({
	tenantSwitcher: {
		get activeTenantId() {
			return activeTenantId;
		},
		setActive: (id: string | null) => setActiveMock(id)
	}
}));
vi.mock('$lib/api/admin.js', () => ({
	admin: {
		tenants: () => tenantsMock(),
		recordScopeSwitch: (id: string | null) => recordScopeSwitchMock(id)
	}
}));

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import TenantSwitcher from './TenantSwitcher.svelte';

const reloadMock = vi.fn();

const MEMBERSHIPS = [
	{ tenant_id: 'tenant-aaa', name: 'Acme', role: 'tenant_admin', tenant_status: 'active' },
	{ tenant_id: 'tenant-bbb', name: null, role: 'member', tenant_status: 'active' }
];

function user(
	memberships = MEMBERSHIPS,
	tenant_id: string | null = 'tenant-aaa',
	role: string | null = 'tenant_admin'
) {
	return { sub: 'u', roles: [], tenant_id, role, memberships };
}

beforeEach(() => {
	vi.clearAllMocks();
	activeTenantId = null;
	isSuperAdminMock.mockReturnValue(false);
	getUserMock.mockReturnValue(user());
	recordScopeSwitchMock.mockResolvedValue({ id: 'a1' });
	tenantsMock.mockResolvedValue({
		items: [
			{ tenant_id: 'tenant-aaa', name: 'Acme', project_count: 3, last_activity: null },
			{ tenant_id: 'tenant-zzz', name: 'Foreign Co', project_count: 1, last_activity: null }
		],
		total: 2
	});
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { reload: reloadMock }
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('TenantSwitcher — members', () => {
	it('offers exactly the caller’s memberships to a NON-super user, with no platform list', async () => {
		render(TenantSwitcher);
		await tick();
		expect(screen.getByTestId('tenant-switcher')).toBeTruthy();
		const labels = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		// Name (+ admin marker) when set, a labelled short id otherwise; no "Self"; no foreign tenant.
		expect(labels).toEqual(['Acme · admin', 'Unnamed workspace · tenant-b']);
		expect(tenantsMock).not.toHaveBeenCalled();
	});

	it('preselects the tenant /auth/me resolved when nothing is persisted', async () => {
		getUserMock.mockReturnValue(user(MEMBERSHIPS, 'tenant-bbb'));
		render(TenantSwitcher);
		await tick();
		expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('tenant-bbb');
	});

	it('switches workspace WITHOUT a super-admin audit call, then reloads', async () => {
		render(TenantSwitcher);
		await tick();
		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tenant-bbb' } });
		await vi.waitFor(() => expect(reloadMock).toHaveBeenCalled());
		expect(setActiveMock).toHaveBeenCalledWith('tenant-bbb');
		expect(recordScopeSwitchMock).not.toHaveBeenCalled();
	});

	it('a single membership renders as a label, not a picker', async () => {
		getUserMock.mockReturnValue(user([MEMBERSHIPS[0]]));
		render(TenantSwitcher);
		await tick();
		expect(screen.queryByTestId('tenant-switcher')).toBeNull();
		expect(screen.getByTestId('tenant-switcher-single').textContent).toContain('Acme');
	});

	it('claim mode (role null) gets NO picker even with several memberships — the backend ignores X-Active-Tenant-Id there', async () => {
		getUserMock.mockReturnValue(user(MEMBERSHIPS, 'tenant-aaa', null));
		render(TenantSwitcher);
		await tick();
		expect(screen.queryByTestId('tenant-switcher')).toBeNull();
		expect(screen.queryByRole('combobox')).toBeNull();
	});

	it('claim mode still gives a super_admin the picker', async () => {
		isSuperAdminMock.mockReturnValue(true);
		getUserMock.mockReturnValue(user(MEMBERSHIPS, 'tenant-aaa', null));
		render(TenantSwitcher);
		expect(await screen.findByRole('option', { name: 'Foreign Co' })).toBeTruthy();
		expect(screen.getByTestId('tenant-switcher')).toBeTruthy();
	});

	it('renders nothing for a user with no memberships', async () => {
		getUserMock.mockReturnValue(user([], null));
		render(TenantSwitcher);
		await tick();
		expect(screen.queryByTestId('tenant-switcher')).toBeNull();
		expect(screen.queryByTestId('tenant-switcher-single')).toBeNull();
	});
});

describe('TenantSwitcher — super_admin', () => {
	it('adds Self + foreign platform tenants (deduped against memberships)', async () => {
		isSuperAdminMock.mockReturnValue(true);
		render(TenantSwitcher);
		expect(await screen.findByRole('option', { name: 'Foreign Co' })).toBeTruthy();
		const labels = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(labels).toEqual([
			'Self (own workspace)',
			'Acme · admin',
			'Unnamed workspace · tenant-b',
			'Foreign Co'
		]);
	});

	it('records the scope switch for a super_admin and reloads', async () => {
		isSuperAdminMock.mockReturnValue(true);
		render(TenantSwitcher);
		await screen.findByRole('option', { name: 'Foreign Co' });
		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tenant-zzz' } });
		await vi.waitFor(() => expect(reloadMock).toHaveBeenCalled());
		expect(recordScopeSwitchMock).toHaveBeenCalledWith('tenant-zzz');
		expect(setActiveMock).toHaveBeenCalledWith('tenant-zzz');
	});

	it('offers ONLY switchable tenants — never a suspended or deleted one the backend refuses', async () => {
		isSuperAdminMock.mockReturnValue(true);
		tenantsMock.mockResolvedValue({
			items: [
				{ tenant_id: 'tenant-zzz', name: 'Foreign Co', switchable: true, status: 'active' },
				{ tenant_id: 'tenant-sus', name: 'Held Co', switchable: false, status: 'suspended' },
				{ tenant_id: 'tenant-del', name: 'Gone Co', switchable: false, status: 'deleted' },
				// An orchestrator predating `switchable`: fall back to the status.
				{ tenant_id: 'tenant-old', name: 'Old Held', status: 'suspended' },
				{ tenant_id: 'tenant-lap', name: 'Lapsed Co', status: 'licence_lapsed' }
			].map((t) => ({ project_count: 0, last_activity: null, ...t })),
			total: 5
		});
		render(TenantSwitcher);
		await screen.findByRole('option', { name: 'Foreign Co' });
		const labels = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(labels).toContain('Lapsed Co');
		for (const refused of ['Held Co', 'Gone Co', 'Old Held']) expect(labels).not.toContain(refused);
	});

	it('an unnamed tenant reads as a labelled short id in the picker AND the badge, never a bare UUID', async () => {
		const uuid = '019a3f2c-7d1e-7b4a-9c2d-5e6f7a8b9c0d';
		isSuperAdminMock.mockReturnValue(true);
		activeTenantId = uuid;
		tenantsMock.mockResolvedValue({
			items: [{ tenant_id: uuid, name: null, project_count: 0, last_activity: null }],
			total: 1
		});
		render(TenantSwitcher);
		const option = await screen.findByRole('option', { name: 'Unnamed workspace · 019a3f2c' });
		expect(option).toBeTruthy();
		const badge = screen.getByTestId('tenant-switcher-acting').textContent ?? '';
		expect(badge).toContain('Unnamed workspace · 019a3f2c');
		expect(badge).not.toContain(uuid);
	});

	it('badges acting into a NON-member tenant, not into a membership', async () => {
		isSuperAdminMock.mockReturnValue(true);
		activeTenantId = 'tenant-zzz';
		const { unmount } = render(TenantSwitcher);
		await screen.findByRole('option', { name: 'Foreign Co' });
		expect(screen.getByTestId('tenant-switcher-acting').textContent).toContain('Foreign Co');
		unmount();
		activeTenantId = 'tenant-aaa';
		render(TenantSwitcher);
		await screen.findByRole('option', { name: 'Foreign Co' });
		expect(screen.queryByTestId('tenant-switcher-acting')).toBeNull();
	});
});

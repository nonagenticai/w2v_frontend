// Platform tenants — per-tenant LLM access select (GET/PUT /admin/tenants/{id}/llm-access).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const adminMock = vi.hoisted(() => ({
	tenants: vi.fn(),
	updateTenant: vi.fn(),
	tenantLlmAccess: vi.fn(),
	setTenantLlmAccess: vi.fn()
}));
vi.mock('$lib/api', () => ({ admin: adminMock }));
vi.mock('$lib/api/youtube.js', () => ({
	youtube: {
		platformChannel: vi.fn().mockResolvedValue(null),
		setPlatformChannel: vi.fn(),
		adminTenantSettings: vi.fn().mockResolvedValue([]),
		setTenantPlatformChannelAllowed: vi.fn()
	}
}));
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/api/tenant-offboarding.js', async () => {
	const actual: typeof import('$lib/api/tenant-offboarding.js') = await vi.importActual(
		'$lib/api/tenant-offboarding.js'
	);
	return {
		...actual,
		adminOffboarding: {
			list: vi.fn().mockResolvedValue({ items: [] }),
			approve: vi.fn(),
			reject: vi.fn(),
			exportTenant: vi.fn(),
			plan: vi.fn(),
			deleteTenant: vi.fn()
		}
	};
});
const toastSuccessMock = vi.fn();
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccessMock(...a)
}));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import Page from './+page.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	adminMock.tenants.mockResolvedValue({
		items: [
			{ tenant_id: 'tenant-aaa', name: 'Acme', project_count: 1, last_activity: null },
			{ tenant_id: 'tenant-bbb', name: 'Beta', project_count: 0, last_activity: null }
		],
		total: 2
	});
	adminMock.tenantLlmAccess.mockImplementation(async (id: string) =>
		id === 'tenant-aaa'
			? { mode: 'platform_only', source: 'tenant' }
			: Promise.reject(new ApiError(502, 'x', 'licences down', 'LICENCES_REFUSED'))
	);
});

const select = (id: string) =>
	document.getElementById(`tenant-llm-access-${id}`) as HTMLSelectElement;

describe('(platform)/tenants — LLM access', () => {
	it('shows each tenant mode; an unreadable mode stays Unknown with the reason', async () => {
		render(Page);
		await screen.findAllByTestId('tenant-row');
		await waitFor(() => expect(select('tenant-aaa').value).toBe('platform_only'));
		const labels = [...select('tenant-aaa').options].map((o) => o.textContent?.trim());
		expect(labels).toEqual([
			'Unknown',
			'Platform services allowed',
			'Own providers required',
			'Platform services only'
		]);
		expect(select('tenant-bbb').value).toBe('');
		const rows = screen.getAllByTestId('tenant-row');
		expect(within(rows[1]).getByTestId('tenant-llm-access-error').textContent).toContain(
			'licences service refused the change: licences down'
		);
	});

	it('PUTs the chosen mode and confirms it saved', async () => {
		adminMock.setTenantLlmAccess.mockResolvedValue({ mode: 'local_allowed', source: 'tenant' });
		render(Page);
		await waitFor(() => expect(select('tenant-aaa').value).toBe('platform_only'));
		await fireEvent.change(select('tenant-aaa'), { target: { value: 'local_allowed' } });
		await waitFor(() =>
			expect(adminMock.setTenantLlmAccess).toHaveBeenCalledWith('tenant-aaa', 'local_allowed')
		);
		const row = screen.getAllByTestId('tenant-row')[0];
		expect(await within(row).findByTestId('tenant-llm-access-saved')).toBeTruthy();
		expect(toastSuccessMock).toHaveBeenCalledWith(
			'Service access saved',
			'Acme: Platform services allowed'
		);
	});

	it('a refused PUT reverts the select and shows the server reason', async () => {
		adminMock.setTenantLlmAccess.mockRejectedValue(
			new ApiError(502, 'x', 'licences 403', 'LICENCES_REFUSED')
		);
		render(Page);
		await waitFor(() => expect(select('tenant-aaa').value).toBe('platform_only'));
		await fireEvent.change(select('tenant-aaa'), { target: { value: 'byo_required' } });
		const row = screen.getAllByTestId('tenant-row')[0];
		const err = await within(row).findByTestId('tenant-llm-access-error');
		expect(err.textContent).toContain('licences 403');
		expect(select('tenant-aaa').value).toBe('platform_only');
		expect(within(row).queryByTestId('tenant-llm-access-saved')).toBeNull();
	});
});

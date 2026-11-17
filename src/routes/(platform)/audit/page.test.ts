import { describe, it, expect, vi, beforeEach } from 'vitest';

const auditLogMock = vi.fn();
const tenantsMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: {
		auditLog: (...a: unknown[]) => auditLogMock(...a),
		tenants: (...a: unknown[]) => tenantsMock(...a)
	}
}));

import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Page from './+page.svelte';

const entry = (over: Record<string, unknown> = {}) => ({
	id: 'a1',
	created_at: '2026-06-14T10:00:00Z',
	actor_subject_id: 'subject-1234567890',
	action: 'scope.switch',
	target_tenant_id: 'tenant-bbb',
	detail: { from_tenant: 'tenant-aaa' },
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	// Default: no registry names → labels fall back to UUIDs.
	tenantsMock.mockResolvedValue({ items: [], total: 0 });
});

describe('(platform)/audit page', () => {
	it('lists audit events once /admin/audit resolves', async () => {
		auditLogMock.mockResolvedValue({
			items: [
				entry(),
				entry({
					id: 'a2',
					action: 'tenant.update',
					target_tenant_id: 'tenant-ccc',
					detail: {
						before: { name: null, status: 'active' },
						after: { name: 'Acme', status: 'active' }
					}
				})
			],
			total: 2,
			limit: 50,
			offset: 0
		});
		render(Page);

		const rows = await screen.findAllByTestId('audit-row');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('Scope switched');
		expect(rows[0].textContent).toContain('subject-'); // short actor id
		expect(rows[0].textContent).toContain('acting as tenant-bbb'); // UUID fallback (no names)
		expect(rows[1].textContent).toContain('Tenant updated');
		expect(rows[1].textContent).toContain('name "—" → "Acme"');
		expect(auditLogMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
	});

	it('resolves tenant UUIDs to registry names', async () => {
		tenantsMock.mockResolvedValue({
			items: [{ tenant_id: 'tenant-bbb', name: 'Beta Inc', project_count: 1, last_activity: null }],
			total: 1
		});
		auditLogMock.mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
		render(Page);

		const row = await screen.findByTestId('audit-row');
		await vi.waitFor(() => expect(row.textContent).toContain('acting as Beta Inc'));
	});

	it('renders scope.reset with a friendly summary', async () => {
		auditLogMock.mockResolvedValue({
			items: [
				entry({
					action: 'scope.reset',
					target_tenant_id: null,
					detail: { from_tenant: 'tenant-aaa' }
				})
			],
			total: 1,
			limit: 50,
			offset: 0
		});
		render(Page);
		const row = await screen.findByTestId('audit-row');
		expect(row.textContent).toContain('reset to own tenant');
	});

	it('shows the empty state when there is no activity', async () => {
		auditLogMock.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
		render(Page);
		expect(await screen.findByText('No admin activity yet')).toBeTruthy();
		expect(screen.queryByTestId('audit-row')).toBeNull();
	});

	it('shows an error state when /admin/audit fails', async () => {
		auditLogMock.mockRejectedValue(new Error('nope'));
		render(Page);
		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load the audit log");
	});

	it('filters by action and resets to the first page', async () => {
		auditLogMock.mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
		render(Page);
		await screen.findByTestId('audit-row');

		const actionSelect = within(screen.getByTestId('filter-action')).getByRole('combobox');
		await fireEvent.change(actionSelect, { target: { value: 'scope.switch' } });

		await vi.waitFor(() =>
			expect(auditLogMock).toHaveBeenCalledWith(
				expect.objectContaining({ action: 'scope.switch', offset: 0 })
			)
		);
	});

	it('populates the tenant filter from the registry', async () => {
		tenantsMock.mockResolvedValue({
			items: [{ tenant_id: 'tenant-bbb', name: 'Beta Inc', project_count: 1, last_activity: null }],
			total: 1
		});
		auditLogMock.mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
		render(Page);
		await screen.findByTestId('audit-row');

		const tenantSelect = within(screen.getByTestId('filter-tenant')).getByRole('combobox');
		expect(await within(tenantSelect).findByRole('option', { name: 'Beta Inc' })).toBeTruthy();

		await fireEvent.change(tenantSelect, { target: { value: 'tenant-bbb' } });
		await vi.waitFor(() =>
			expect(auditLogMock).toHaveBeenCalledWith(
				expect.objectContaining({ tenantId: 'tenant-bbb', offset: 0 })
			)
		);
	});

	it('paginates: clicking Next refetches with the new offset', async () => {
		// total 60 > pageSize 50 → 2 pages, so the Pagination control renders.
		const items = Array.from({ length: 50 }, (_, i) => entry({ id: `a${i}` }));
		auditLogMock.mockResolvedValue({ items, total: 60, limit: 50, offset: 0 });
		render(Page);

		await screen.findAllByTestId('audit-row');
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		await vi.waitFor(() =>
			expect(auditLogMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 50 }))
		);
	});
});

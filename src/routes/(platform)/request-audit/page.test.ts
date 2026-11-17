import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestAuditMock = vi.fn();
const tenantsMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: {
		requestAudit: (...a: unknown[]) => requestAuditMock(...a),
		tenants: (...a: unknown[]) => tenantsMock(...a)
	}
}));

import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Page from './+page.svelte';

const entry = (over: Record<string, unknown> = {}) => ({
	id: 'r1',
	created_at: '2026-06-14T10:00:00Z',
	actor_subject_id: 'subject-1234567890',
	claim_tenant_id: 'tenant-aaaaaaaa',
	effective_tenant_id: 'tenant-bbbbbbbb',
	cross_tenant: false,
	event: 'mutation',
	method: 'POST',
	path: '/api/projects',
	resource: 'projects',
	status_code: 201,
	ip: '10.0.0.1',
	duration_ms: 12.3,
	credential_fingerprint: null,
	request_id: 'req-1',
	detail: {},
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	// Default: no registry names → tenant labels fall back to UUIDs.
	tenantsMock.mockResolvedValue({ items: [], total: 0 });
});

describe('(platform)/request-audit page', () => {
	it('lists request-audit events once /admin/request-audit resolves', async () => {
		requestAuditMock.mockResolvedValue({
			items: [
				entry(),
				entry({
					id: 'r2',
					event: 'auth_failure',
					method: 'GET',
					path: '/api/runs/x',
					status_code: 403,
					cross_tenant: true
				})
			],
			total: 2,
			limit: 50,
			offset: 0
		});
		render(Page);

		const rows = await screen.findAllByTestId('request-audit-row');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('mutation');
		expect(rows[0].textContent).toContain('POST');
		expect(rows[0].textContent).toContain('/api/projects');
		expect(rows[0].textContent).toContain('201');
		expect(rows[1].textContent).toContain('auth_failure');
		expect(rows[1].textContent).toContain('cross-tenant');
		expect(rows[1].textContent).toContain('403');
		expect(requestAuditMock).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 50, offset: 0 })
		);
	});

	it('resolves the effective tenant UUID to its registry name', async () => {
		requestAuditMock.mockResolvedValue({
			items: [entry({ effective_tenant_id: 'tenant-bbbbbbbb' })],
			total: 1,
			limit: 50,
			offset: 0
		});
		tenantsMock.mockResolvedValue({
			items: [{ tenant_id: 'tenant-bbbbbbbb', name: 'Acme' }],
			total: 1
		});
		render(Page);

		const row = await screen.findByTestId('request-audit-row');
		expect(row.textContent).toContain('tenant Acme');
		expect(row.textContent).not.toContain('tenant tenant-bb');
	});

	it('falls back to the UUID when the tenant has no registry name', async () => {
		requestAuditMock.mockResolvedValue({
			items: [entry({ effective_tenant_id: 'tenant-bbbbbbbb' })],
			total: 1,
			limit: 50,
			offset: 0
		});
		render(Page); // tenantsMock default = empty registry

		const row = await screen.findByTestId('request-audit-row');
		expect(row.textContent).toContain('tenant tenant-bbbbbbbb');
	});

	it('shows the empty state when there are no matching requests', async () => {
		requestAuditMock.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
		render(Page);
		expect(await screen.findByText('No matching requests')).toBeTruthy();
		expect(screen.queryByTestId('request-audit-row')).toBeNull();
	});

	it('shows an error state when /admin/request-audit fails', async () => {
		requestAuditMock.mockRejectedValue(new Error('nope'));
		render(Page);
		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load the request audit");
	});

	it('filters by event and resets to the first page', async () => {
		requestAuditMock.mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
		render(Page);
		await screen.findByTestId('request-audit-row');

		const eventSelect = within(screen.getByTestId('filter-event')).getByRole('combobox');
		await fireEvent.change(eventSelect, { target: { value: 'auth_failure' } });

		await vi.waitFor(() =>
			expect(requestAuditMock).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'auth_failure', offset: 0 })
			)
		);
	});

	it('filters by method and resets to the first page', async () => {
		requestAuditMock.mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
		render(Page);
		await screen.findByTestId('request-audit-row');

		const methodSelect = within(screen.getByTestId('filter-method')).getByRole('combobox');
		await fireEvent.change(methodSelect, { target: { value: 'POST' } });

		await vi.waitFor(() =>
			expect(requestAuditMock).toHaveBeenCalledWith(
				expect.objectContaining({ method: 'POST', offset: 0 })
			)
		);
	});

	it('filters by cross-tenant only', async () => {
		requestAuditMock.mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
		render(Page);
		await screen.findByTestId('request-audit-row');

		const ctSelect = within(screen.getByTestId('filter-cross-tenant')).getByRole('combobox');
		await fireEvent.change(ctSelect, { target: { value: 'true' } });

		await vi.waitFor(() =>
			expect(requestAuditMock).toHaveBeenCalledWith(
				expect.objectContaining({ crossTenant: true, offset: 0 })
			)
		);
	});

	it('paginates: clicking Next refetches with the new offset', async () => {
		const items = Array.from({ length: 50 }, (_, i) => entry({ id: `r${i}` }));
		requestAuditMock.mockResolvedValue({ items, total: 60, limit: 50, offset: 0 });
		render(Page);

		await screen.findAllByTestId('request-audit-row');
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		await vi.waitFor(() =>
			expect(requestAuditMock).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 50, offset: 50 })
			)
		);
	});
});

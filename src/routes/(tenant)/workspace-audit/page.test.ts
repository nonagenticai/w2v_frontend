import { describe, it, expect, vi, beforeEach } from 'vitest';

const { auditList } = vi.hoisted(() => ({ auditList: vi.fn() }));
vi.mock('$lib/api/tenant-audit.js', async () => {
	const actual: typeof import('$lib/api/tenant-audit.js') = await vi.importActual(
		'$lib/api/tenant-audit.js'
	);
	return { ...actual, tenantAudit: { list: auditList } };
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Page from './+page.svelte';

const MEMBER_ROW = {
	id: 'a-1',
	created_at: '2026-10-09T10:00:00Z',
	actor_subject_id: 'u-1',
	action: 'defaults.update',
	target_tenant_id: 't',
	detail: { version: 3, changes: { retention_mode: { from: null, to: 'off' } } },
	actor_kind: 'member',
	actor_label: 'ann@example.com'
};
const OPERATOR_ROW = {
	id: 'a-2',
	created_at: '2026-10-08T10:00:00Z',
	actor_subject_id: null,
	action: 'tenant.update',
	target_tenant_id: 't',
	detail: {},
	actor_kind: 'platform_operator',
	actor_label: 'platform operator'
};

beforeEach(() => vi.clearAllMocks());

describe('(tenant)/workspace-audit page', () => {
	it('renders rows; a platform operator is never named', async () => {
		auditList.mockResolvedValue({
			items: [MEMBER_ROW, OPERATOR_ROW],
			limit: 50,
			next_cursor: null
		});
		render(Page);
		const rows = await screen.findAllByTestId('audit-row');
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByTestId('audit-actor')).toHaveTextContent('by ann@example.com');
		expect(rows[0].textContent).toContain('Defaults updated');
		expect(within(rows[0]).getByTitle('defaults.update')).toBeTruthy();
		expect(rows[0].textContent).toContain('version: 3');
		expect(within(rows[1]).getByTestId('audit-actor')).toHaveTextContent('by platform operator');
		expect(auditList).toHaveBeenCalledWith({
			limit: 50,
			cursor: null,
			action: null,
			actorKind: null
		});
		expect(screen.queryByRole('button', { name: /Load older/ })).toBeNull();
	});

	it('a failed "Load older" shows the API\'s reason, not a generic line', async () => {
		const { ApiError } = await import('$lib/api/client.js');
		auditList
			.mockResolvedValueOnce({ items: [MEMBER_ROW], limit: 50, next_cursor: 'cur-1' })
			.mockRejectedValueOnce(new ApiError(400, 'Bad Request', 'cursor is malformed', 'BAD_CURSOR'));
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: /Load older/ }));
		expect(await screen.findByTestId('audit-load-more-error')).toHaveTextContent(
			"Couldn't load more entries: cursor is malformed"
		);
	});

	it('"Load older" follows next_cursor and appends', async () => {
		auditList
			.mockResolvedValueOnce({ items: [MEMBER_ROW], limit: 50, next_cursor: 'cur-1' })
			.mockResolvedValueOnce({ items: [OPERATOR_ROW], limit: 50, next_cursor: null });
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: /Load older/ }));
		await waitFor(() => expect(screen.getAllByTestId('audit-row')).toHaveLength(2));
		expect(auditList.mock.calls[1][0]).toMatchObject({ cursor: 'cur-1' });
		expect(screen.queryByRole('button', { name: /Load older/ })).toBeNull();
	});

	it('an action filter re-queries from the first page', async () => {
		auditList.mockResolvedValue({ items: [MEMBER_ROW], limit: 50, next_cursor: null });
		render(Page);
		await screen.findAllByTestId('audit-row');
		const select = within(screen.getByTestId('audit-action-filter')).getByRole('combobox');
		await fireEvent.change(select, { target: { value: 'music.upload' } });
		await waitFor(() =>
			expect(auditList).toHaveBeenLastCalledWith({
				limit: 50,
				cursor: null,
				action: 'music.upload',
				actorKind: null
			})
		);
	});
});

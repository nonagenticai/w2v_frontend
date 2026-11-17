import { describe, it, expect, vi, beforeEach } from 'vitest';

const tenantsMock = vi.fn();
const updateTenantMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: {
		tenants: (...a: unknown[]) => tenantsMock(...a),
		updateTenant: (...a: unknown[]) => updateTenantMock(...a),
		tenantLlmAccess: () => Promise.resolve({ mode: 'local_allowed', source: 'default' }),
		setTenantLlmAccess: vi.fn()
	}
}));

const ytMock = vi.hoisted(() => ({
	platformChannel: vi.fn(),
	setPlatformChannel: vi.fn(),
	adminTenantSettings: vi.fn(),
	setTenantPlatformChannelAllowed: vi.fn()
}));
vi.mock('$lib/api/youtube.js', () => ({ youtube: ytMock }));
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));

const offMock = vi.hoisted(() => ({
	list: vi.fn(),
	approve: vi.fn(),
	reject: vi.fn(),
	exportTenant: vi.fn(),
	plan: vi.fn(),
	deleteTenant: vi.fn()
}));
vi.mock('$lib/api/tenant-offboarding.js', async () => {
	const actual: typeof import('$lib/api/tenant-offboarding.js') = await vi.importActual(
		'$lib/api/tenant-offboarding.js'
	);
	return { ...actual, adminOffboarding: offMock };
});

const toastSuccessMock = vi.fn();
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccessMock(...a)
}));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Page from './+page.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	ytMock.platformChannel.mockResolvedValue(null);
	ytMock.adminTenantSettings.mockResolvedValue([]);
	offMock.list.mockResolvedValue({ items: [] });
});

describe('(platform)/tenants page', () => {
	it('lists tenants once /admin/tenants resolves', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{ tenant_id: 'tenant-aaa', project_count: 3, last_activity: '2026-06-12T10:00:00Z' },
				{ tenant_id: 'tenant-bbb', project_count: 1, last_activity: null }
			],
			total: 2
		});
		render(Page);

		const rows = await screen.findAllByTestId('tenant-row');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('tenant-aaa');
		expect(rows[0].textContent).toContain('3 projects');
		expect(rows[1].textContent).toContain('1 project');
		expect(tenantsMock).toHaveBeenCalledTimes(1);
	});

	it('shows per-tenant cost + a platform-wide cost total', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					project_count: 3,
					last_activity: null,
					run_count: 9,
					total_cost_usd: 3.75
				},
				{
					tenant_id: 'tenant-bbb',
					project_count: 1,
					last_activity: null,
					run_count: 0,
					total_cost_usd: 1.25
				}
			],
			total: 2
		});
		render(Page);

		const costs = await screen.findAllByTestId('tenant-cost');
		expect(costs[0].textContent).toContain('$3.75');
		expect(costs[0].textContent).toContain('9 runs');
		// Platform total = sum of per-tenant costs.
		expect(screen.getByTestId('platform-cost').textContent).toContain('$5.00 total');
	});

	it('renders a missing tenant cost as "Cost unavailable", never $0, and the total as unavailable', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					project_count: 3,
					last_activity: null,
					run_count: 9,
					total_cost_usd: 3.75
				},
				// No total_cost_usd: unknown, not zero.
				{ tenant_id: 'tenant-bbb', project_count: 1, last_activity: null, run_count: 2 }
			],
			total: 2
		});
		render(Page);

		const costs = await screen.findAllByTestId('tenant-cost');
		expect(costs[0].textContent).toContain('$3.75');
		expect(costs[1].textContent).toContain('Cost unavailable');
		expect(costs[1].textContent).not.toContain('$0');
		const total = screen.getByTestId('platform-cost');
		expect(total.textContent).toContain('Total cost unavailable');
		expect(total.textContent).not.toContain('$3.75');
		// The known part is only a lower bound — tooltip, not the figure.
		expect(total.getAttribute('title')).toContain('at least $3.75');
	});

	it('sorts an unknown cost last under Cost (high→low), not as $0', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{ tenant_id: 'tenant-unknown', project_count: 1, last_activity: null },
				{ tenant_id: 'tenant-zero', project_count: 1, last_activity: null, total_cost_usd: 0 },
				{ tenant_id: 'tenant-big', project_count: 1, last_activity: null, total_cost_usd: 9 }
			],
			total: 3
		});
		render(Page);
		await screen.findAllByTestId('tenant-row');
		const sort = document.querySelector('select[name="tenants-sort"]') as HTMLSelectElement;
		await fireEvent.change(sort, { target: { value: 'cost:desc' } });
		const ids = screen.getAllByTestId('tenant-row').map((r) => r.textContent ?? '');
		expect(ids[0]).toContain('tenant-big');
		expect(ids[1]).toContain('tenant-zero');
		expect(ids[2]).toContain('tenant-unknown');
	});

	it('shows the name when set (UUID secondary) + the status pill', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					name: 'Acme Corp',
					status: 'suspended',
					project_count: 2,
					last_activity: null
				}
			],
			total: 1
		});
		render(Page);

		const row = await screen.findByTestId('tenant-row');
		expect(row.textContent).toContain('Acme Corp');
		expect(row.textContent).toContain('tenant-aaa'); // UUID still shown as secondary
		expect(row.textContent).toContain('suspended');
	});

	it('shows the empty state when there are no tenants', async () => {
		tenantsMock.mockResolvedValue({ items: [], total: 0 });
		render(Page);

		expect(await screen.findByText('No tenants yet')).toBeTruthy();
		expect(screen.queryByTestId('tenant-row')).toBeNull();
		// The empty state offers the next action, not a dead end.
		expect(screen.getByRole('link', { name: 'Provision tenant' }).getAttribute('href')).toBe(
			'/provision'
		);
	});

	it('shows an error state when /admin/tenants fails', async () => {
		tenantsMock.mockRejectedValue(new Error('nope'));
		render(Page);

		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load tenants");
	});

	it('renames a tenant via the dialog and refetches the list', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					name: null,
					status: 'active',
					project_count: 1,
					last_activity: null
				}
			],
			total: 1
		});
		updateTenantMock.mockResolvedValue({
			tenant_id: 'tenant-aaa',
			name: 'New Name',
			status: 'active',
			project_count: 1,
			last_activity: null
		});
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
		const input = screen.getByLabelText('Display name');
		await fireEvent.input(input, { target: { value: 'New Name' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(updateTenantMock).toHaveBeenCalledWith('tenant-aaa', { name: 'New Name' });
		// initial load + reload after the rename.
		expect(tenantsMock).toHaveBeenCalledTimes(2);
	});

	it('filters the list client-side by name or id (no extra fetch)', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					name: 'Acme Corp',
					status: 'active',
					project_count: 1,
					last_activity: '2026-06-12T10:00:00Z'
				},
				{
					tenant_id: 'tenant-bbb',
					name: 'Globex',
					status: 'active',
					project_count: 1,
					last_activity: '2026-06-11T10:00:00Z'
				}
			],
			total: 2
		});
		render(Page);
		await screen.findAllByTestId('tenant-row');

		await fireEvent.input(screen.getByPlaceholderText('Search by name or ID…'), {
			target: { value: 'globex' }
		});

		const rows = screen.getAllByTestId('tenant-row');
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain('Globex');
		expect(screen.getByTestId('platform-summary').textContent).toContain('1 of 2 tenants');
		// Filtering is purely client-side — still a single fetch.
		expect(tenantsMock).toHaveBeenCalledTimes(1);
	});

	it('sorts the list client-side', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					name: 'Beta',
					status: 'active',
					project_count: 1,
					last_activity: '2026-06-12T10:00:00Z'
				},
				{
					tenant_id: 'tenant-bbb',
					name: 'Alpha',
					status: 'active',
					project_count: 1,
					last_activity: '2026-06-10T10:00:00Z'
				}
			],
			total: 2
		});
		render(Page);
		await screen.findAllByTestId('tenant-row');
		// Default sort = recent activity desc → Beta (newer) first.
		expect(screen.getAllByTestId('tenant-row')[0].textContent).toContain('Beta');

		await fireEvent.change(document.querySelector('select[name="tenants-sort"]')!, {
			target: { value: 'name:asc' }
		});
		// Name A–Z → Alpha first.
		await waitFor(() =>
			expect(screen.getAllByTestId('tenant-row')[0].textContent).toContain('Alpha')
		);
	});

	it('shows a search-specific empty state when nothing matches', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					name: 'Acme',
					status: 'active',
					project_count: 1,
					last_activity: null
				}
			],
			total: 1
		});
		render(Page);
		await screen.findByTestId('tenant-row');

		await fireEvent.input(screen.getByPlaceholderText('Search by name or ID…'), {
			target: { value: 'zzz' }
		});

		expect(await screen.findByText('No tenants match your search')).toBeTruthy();
		expect(screen.queryByTestId('tenant-row')).toBeNull();
	});

	// Suspend now goes through a confirm (a whole org loses access on one click),
	// so the happy path is: click Suspend → accept the confirm → PATCH + refetch.
	it('toggles status (active → suspended) and refetches, via the confirm', async () => {
		tenantsMock.mockResolvedValue({
			items: [
				{
					tenant_id: 'tenant-aaa',
					name: null,
					status: 'active',
					project_count: 1,
					last_activity: null
				}
			],
			total: 1
		});
		updateTenantMock.mockResolvedValue({
			tenant_id: 'tenant-aaa',
			name: null,
			status: 'suspended',
			project_count: 1,
			last_activity: null
		});
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
		const confirm = await screen.findByTestId('tenant-suspend-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Suspend tenant' }));

		await waitFor(() =>
			expect(updateTenantMock).toHaveBeenCalledWith('tenant-aaa', { status: 'suspended' })
		);
		await waitFor(() => expect(tenantsMock).toHaveBeenCalledTimes(2));
	});

	const ONE_ACTIVE = {
		items: [
			{
				tenant_id: 'tenant-aaa',
				name: 'Acme Corp',
				status: 'active',
				project_count: 1,
				last_activity: null
			}
		],
		total: 1
	};

	it('does NOT suspend on the first click — it confirms, naming the tenant', async () => {
		tenantsMock.mockResolvedValue(ONE_ACTIVE);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
		expect(updateTenantMock).not.toHaveBeenCalled();

		const confirm = await screen.findByTestId('tenant-suspend-confirm');
		expect(confirm.textContent).toContain('Acme Corp');
		expect(confirm.textContent).toContain('tenant-aaa');
	});

	it('suspends only after the confirm is accepted', async () => {
		tenantsMock.mockResolvedValue(ONE_ACTIVE);
		updateTenantMock.mockResolvedValue({});
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
		const confirm = await screen.findByTestId('tenant-suspend-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Suspend tenant' }));

		await waitFor(() =>
			expect(updateTenantMock).toHaveBeenCalledWith('tenant-aaa', { status: 'suspended' })
		);
	});

	it('cancelling the suspend confirm leaves the tenant active', async () => {
		tenantsMock.mockResolvedValue(ONE_ACTIVE);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
		const confirm = await screen.findByTestId('tenant-suspend-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

		expect(updateTenantMock).not.toHaveBeenCalled();
	});

	it('re-activating a suspended tenant stays a single click', async () => {
		tenantsMock.mockResolvedValue({
			items: [{ ...ONE_ACTIVE.items[0], status: 'suspended' }],
			total: 1
		});
		updateTenantMock.mockResolvedValue({});
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Activate' }));
		await waitFor(() =>
			expect(updateTenantMock).toHaveBeenCalledWith('tenant-aaa', { status: 'active' })
		);
	});

	it('surfaces the real error from a failed status change', async () => {
		tenantsMock.mockResolvedValue(ONE_ACTIVE);
		updateTenantMock.mockRejectedValue(new Error('409: tenant has running jobs'));
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
		const confirm = await screen.findByTestId('tenant-suspend-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Suspend tenant' }));

		const err = await screen.findByTestId('tenant-action-error');
		expect(err.textContent).toContain('409: tenant has running jobs');
		expect(err.textContent).not.toContain('Try again');
	});

	it('surfaces the real error from a failed rename', async () => {
		tenantsMock.mockResolvedValue(ONE_ACTIVE);
		updateTenantMock.mockRejectedValue(new Error('403: super_admin required'));
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		const err = await screen.findByTestId('tenant-action-error');
		expect(err.textContent).toContain('403: super_admin required');
	});

	it('disables Save on an empty / whitespace-only tenant name', async () => {
		tenantsMock.mockResolvedValue(ONE_ACTIVE);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
		const save = screen.getByRole('button', { name: 'Save' });
		expect((save as HTMLButtonElement).disabled).toBe(false);

		const input = screen.getByLabelText('Display name');
		await fireEvent.input(input, { target: { value: '   ' } });
		expect((save as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByTestId('tenant-rename-invalid')).toBeTruthy();

		// And a click that slips through must not blank the name.
		await fireEvent.click(save);
		expect(updateTenantMock).not.toHaveBeenCalled();
	});
});

describe('(platform)/tenants — YouTube platform channel', () => {
	const platformRow = {
		client_id: 'plat-cid',
		channel_id: 'UCplat',
		channel_title: 'George Dekker',
		default_for_tenants: true,
		has_client_secret: true,
		has_refresh_token: true
	};

	beforeEach(() => {
		tenantsMock.mockResolvedValue({
			items: [
				{ tenant_id: 'merqi', name: 'merqi', project_count: 1, last_activity: null },
				{ tenant_id: 'legacy', project_count: 0, last_activity: null },
				{ tenant_id: 'byo', project_count: 0, last_activity: null }
			],
			total: 3
		});
		ytMock.adminTenantSettings.mockResolvedValue([
			{
				tenant_id: 'merqi',
				platform_channel_allowed: false,
				has_grant: false,
				has_oauth_client: true
			},
			{ tenant_id: 'byo', platform_channel_allowed: true, has_grant: true, has_oauth_client: false }
		]);
	});

	const policySelect = (tenantId: string) =>
		document.querySelector<HTMLSelectElement>(`select[name="tenant-youtube-${tenantId}"]`)!;
	const row = (tenantId: string) =>
		screen.getAllByTestId('tenant-row').find((r) => r.textContent?.includes(tenantId))!;

	it('merges GET /admin/youtube/tenants by tenant_id; a tenant absent from it is Default', async () => {
		render(Page);
		await screen.findAllByTestId('tenant-row');
		await waitFor(() => expect(policySelect('merqi').value).toBe('deny'));
		expect(policySelect('byo').value).toBe('allow');
		expect(policySelect('legacy').value).toBe('default');
		expect(ytMock.adminTenantSettings).toHaveBeenCalledTimes(1);
		expect(within(row('byo')).queryByTestId('tenant-youtube-grant')).not.toBeNull();
		expect(within(row('merqi')).queryByTestId('tenant-youtube-grant')).toBeNull();
		expect(within(row('merqi')).queryByTestId('tenant-youtube-oauth-client')).not.toBeNull();
	});

	it('the YouTube list failing: policy is Unknown (not Default) and the upstream error shows', async () => {
		ytMock.adminTenantSettings.mockRejectedValue(new Error('502 Bad Gateway: youtube_upload down'));
		render(Page);
		await screen.findAllByTestId('tenant-row');
		expect((await screen.findByTestId('tenant-youtube-load-error')).textContent).toContain(
			'youtube_upload down'
		);
		expect(policySelect('merqi').value).toBe('');
		expect(policySelect('legacy').value).toBe('');
	});

	it.each([
		['deny', false],
		['allow', true],
		['default', null]
	] as const)('choosing %s PUTs platform_channel_allowed=%s', async (choice, allowed) => {
		ytMock.adminTenantSettings.mockResolvedValue([
			{
				tenant_id: 'legacy',
				platform_channel_allowed: choice === 'default' ? true : null,
				has_grant: false,
				has_oauth_client: false
			}
		]);
		ytMock.setTenantPlatformChannelAllowed.mockResolvedValue({});
		render(Page);
		await screen.findAllByTestId('tenant-row');
		const sel = policySelect('legacy');
		await waitFor(() => expect(sel.value).not.toBe(''));
		sel.value = choice;
		await fireEvent.change(sel);
		await waitFor(() =>
			expect(ytMock.setTenantPlatformChannelAllowed).toHaveBeenCalledWith('legacy', allowed)
		);
		expect(ytMock.setTenantPlatformChannelAllowed.mock.calls[0][1]).toStrictEqual(allowed);
		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
		await waitFor(() => expect(policySelect('legacy').value).toBe(choice));
	});

	it('an unrecognised select value sends nothing (never coerced to Default)', async () => {
		render(Page);
		await screen.findAllByTestId('tenant-row');
		const sel = policySelect('legacy');
		sel.value = '';
		await fireEvent.change(sel);
		expect(ytMock.setTenantPlatformChannelAllowed).not.toHaveBeenCalled();
	});

	it('a failed policy PUT shows the error and restores the control', async () => {
		ytMock.setTenantPlatformChannelAllowed.mockRejectedValue(new Error('forbidden'));
		render(Page);
		await screen.findAllByTestId('tenant-row');
		const sel = policySelect('merqi');
		await waitFor(() => expect(sel.value).toBe('deny'));
		sel.value = 'allow';
		await fireEvent.change(sel);
		expect((await screen.findByTestId('tenant-action-error')).textContent).toContain('forbidden');
		expect(sel.value).toBe('deny');
	});

	it('platform channel GET 404 is an error, not "Not configured"', async () => {
		const { ApiError } = await import('$lib/api/client');
		ytMock.platformChannel.mockRejectedValue(new ApiError(404, 'Not Found', 'no such route'));
		render(Page);
		const err = await screen.findByTestId('youtube-platform-load-error');
		expect(err.textContent).toContain('no such route');
		expect(screen.queryByTestId('youtube-platform-current')).toBeNull();
	});

	it('no platform row: says so; Save needs both secrets', async () => {
		render(Page);
		const panel = await screen.findByTestId('youtube-platform-channel');
		await waitFor(() =>
			expect(within(panel).getByTestId('youtube-platform-current').textContent).toMatch(
				/Not configured/
			)
		);
		const save = within(panel).getByRole('button', {
			name: 'Save platform channel'
		}) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
	});

	it('existing row: prefilled non-secrets, blank secrets are kept (omitted from the PUT)', async () => {
		ytMock.platformChannel.mockResolvedValue(platformRow);
		ytMock.setPlatformChannel.mockResolvedValue({ ...platformRow, default_for_tenants: false });
		render(Page);
		const panel = await screen.findByTestId('youtube-platform-channel');
		await waitFor(() =>
			expect(within(panel).getByTestId('youtube-platform-current').textContent).toContain(
				'George Dekker'
			)
		);
		const secret = document.querySelector<HTMLInputElement>(
			'input[name="yt-platform-client-secret"]'
		)!;
		expect(secret.value).toBe('');
		await fireEvent.click(within(panel).getByRole('switch', { name: 'Default for tenants' }));
		await fireEvent.click(within(panel).getByRole('button', { name: 'Save platform channel' }));
		await waitFor(() =>
			expect(ytMock.setPlatformChannel).toHaveBeenCalledWith({
				client_id: 'plat-cid',
				channel_id: 'UCplat',
				channel_title: 'George Dekker',
				default_for_tenants: false
			})
		);
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const overviewMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: { overview: (...a: unknown[]) => overviewMock(...a) }
}));
const { renameMock, fetchUserMock, isSuperAdminMock } = vi.hoisted(() => ({
	renameMock: vi.fn(),
	fetchUserMock: vi.fn(),
	isSuperAdminMock: vi.fn(() => false)
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	isSuperAdmin: () => isSuperAdminMock(),
	getUser: () => getUserMock(),
	getMembershipRole: () => getUserMock()?.role ?? null,
	fetchUser: () => fetchUserMock()
}));
vi.mock('$lib/api/tenancy.js', async () => {
	const actual: typeof import('$lib/api/tenancy.js') = await vi.importActual('$lib/api/tenancy.js');
	return { ...actual, tenancy: { renameTenant: (n: string) => renameMock(n) } };
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/api/tenant-offboarding.js', async () => {
	const actual: typeof import('$lib/api/tenant-offboarding.js') = await vi.importActual(
		'$lib/api/tenant-offboarding.js'
	);
	return {
		...actual,
		tenantOffboarding: { list: vi.fn(async () => ({ items: [] })), request: vi.fn() }
	};
});
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import Page from './+page.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	getUserMock.mockReturnValue({
		sub: 'u1',
		email: 'ada@acme.test',
		name: 'Ada',
		preferred_username: 'ada',
		roles: ['tenant_admin'],
		tenant_id: 'tenant-1',
		license_token: null
	});
});

describe('(tenant)/admin page', () => {
	it('renders the identity context (role; the raw tenant id is platform-only)', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 0,
			run_count: 0,
			total_cost_usd: 0
		});
		render(Page);
		const home = screen.getByTestId('admin-home');
		expect(home.textContent).not.toContain('tenant-1');
		expect(home.textContent).toContain('tenant_admin');
	});

	it('shows the org usage aggregate once /admin/overview resolves', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 5,
			run_count: 9,
			total_cost_usd: 3.75
		});
		render(Page);

		const stats = await screen.findByTestId('overview-stats');
		expect(stats.textContent).toContain('5'); // projects
		expect(stats.textContent).toContain('9'); // runs
		expect(stats.textContent).toContain('$3.7500'); // total cost
		expect(overviewMock).toHaveBeenCalledTimes(1);
	});

	it('renders an unavailable cost as "Cost unavailable" (reason in title), never the partial figure', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 5,
			run_count: 9,
			total_cost_usd: 1.25,
			cost_status: 'unavailable',
			cost_unavailable_reason: 'billing_credential_missing'
		});
		render(Page);

		const stats = await screen.findByTestId('overview-stats');
		expect(stats.textContent).toContain('Cost unavailable');
		expect(stats.textContent).not.toContain('$1.2500');
		expect(stats.textContent).not.toContain('$0.00');
		const dd = Array.from(stats.querySelectorAll('dd')).find((d) =>
			d.textContent?.includes('Cost unavailable')
		)!;
		expect(dd.getAttribute('title')).toMatch(/no billing credential/);
		expect(dd.getAttribute('title')).toContain('at least $1.2500');
	});

	it('renders a zero cost as $0.0000 when the status is ok', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 0,
			run_count: 0,
			total_cost_usd: 0,
			cost_status: 'ok'
		});
		render(Page);
		const stats = await screen.findByTestId('overview-stats');
		expect(stats.textContent).toContain('$0.0000');
		expect(stats.textContent).not.toContain('Cost unavailable');
	});

	it('wires the summary tiles to their drill-down views (projects + usage)', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 5,
			run_count: 9,
			total_cost_usd: 3.75
		});
		render(Page);

		const links = await screen.findAllByTestId('overview-stat-link');
		const hrefs = links.map((a) => a.getAttribute('href'));
		// Projects → the project list; Runs + Total cost → the Usage detail.
		expect(hrefs).toEqual(['/projects', '/usage', '/usage']);
		// Each tile keeps its label + value as an accessible name.
		expect(links.some((a) => a.getAttribute('aria-label') === 'Projects: 5')).toBe(true);
		expect(links.some((a) => a.getAttribute('aria-label') === 'Total cost: $3.7500')).toBe(true);
	});

	// REGRESSION: the header claimed "Member management and tenant settings arrive
	// in a later release" while /members ships full role grant/revoke and sits
	// directly above this page in the nav.
	it('does not claim member management is unreleased, and links to /members', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 0,
			run_count: 0,
			total_cost_usd: 0
		});
		render(Page);

		const home = screen.getByTestId('admin-home');
		expect(home.textContent).not.toContain('arrive in a later release');
		const link = screen.getByRole('link', { name: 'Members' });
		expect(link.getAttribute('href')).toBe('/members');
	});

	it('links to every sibling workspace screen', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 0,
			run_count: 0,
			total_cost_usd: 0
		});
		render(Page);
		const nav = screen.getByTestId('admin-sibling-links');
		const hrefs = Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual([
			'/music',
			'/services',
			'/providers',
			'/members',
			'/api-keys',
			'/usage',
			'/workspace-audit',
			'/settings'
		]);
	});

	it('hides the raw workspace id from a tenant admin, shows it to the platform operator', async () => {
		overviewMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			project_count: 0,
			run_count: 0,
			total_cost_usd: 0
		});
		getUserMock.mockReturnValue({ tenant_id: 'tenant-uuid-123', roles: ['tenant_admin'] });
		const first = render(Page);
		expect(screen.getByTestId('admin-home').textContent).not.toContain('tenant-uuid-123');
		first.unmount();

		isSuperAdminMock.mockReturnValue(true);
		render(Page);
		expect(screen.getByTestId('admin-workspace-id').textContent).toContain('tenant-uuid-123');
		isSuperAdminMock.mockReturnValue(false);
	});

	it('shows an error state when /admin/overview fails', async () => {
		overviewMock.mockRejectedValue(new Error('boom'));
		render(Page);

		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load usage");
	});

	describe('workspace rename', () => {
		beforeEach(() => {
			overviewMock.mockResolvedValue({
				tenant_id: 'tenant-1',
				project_count: 0,
				run_count: 0,
				total_cost_usd: 0
			});
			getUserMock.mockReturnValue({
				sub: 'u1',
				roles: [],
				role: 'tenant_admin',
				tenant_id: 'tenant-1',
				memberships: [{ tenant_id: 'tenant-1', name: 'Acme', role: 'tenant_admin' }],
				license_token: null
			});
		});

		it('prefills the current name; Save is disabled until it changes', async () => {
			render(Page);
			const input = screen.getByLabelText('Workspace name') as HTMLInputElement;
			expect(input.value).toBe('Acme');
			expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
				true
			);
		});

		it('PATCHes the new name and refreshes /auth/me', async () => {
			renameMock.mockResolvedValue({ tenant_id: 'tenant-1', name: 'Acme Two', status: 'active' });
			render(Page);
			await fireEvent.input(screen.getByLabelText('Workspace name'), {
				target: { value: '  Acme Two ' }
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
			await waitFor(() => expect(renameMock).toHaveBeenCalledWith('Acme Two'));
			await waitFor(() => expect(fetchUserMock).toHaveBeenCalled());
		});

		it('shows the server error when the rename fails', async () => {
			renameMock.mockRejectedValue(new ApiError(403, 'Forbidden', 'tenant admin required'));
			render(Page);
			await fireEvent.input(screen.getByLabelText('Workspace name'), { target: { value: 'X' } });
			await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
			expect((await screen.findByTestId('tenant-rename-error')).textContent).toContain(
				'tenant admin required'
			);
		});
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { roles } = vi.hoisted(() => ({ roles: { superAdmin: false } }));
vi.mock('$lib/stores/auth.svelte', () => ({ isSuperAdmin: () => roles.superAdmin }));
// The header's right-hand widgets have their own tests; stub them so this test is
// only about what the header itself renders.
vi.mock('./TenantSwitcher.svelte', async () => ({
	default: (await import('$lib/test-stubs/WorkspaceStub.svelte')).default
}));
vi.mock('./UserMenu.svelte', async () => ({
	default: (await import('$lib/test-stubs/WorkspaceStub.svelte')).default
}));

import { render, screen } from '@testing-library/svelte';
import Header from './Header.svelte';

beforeEach(() => {
	roles.superAdmin = false;
});

describe('Header', () => {
	it('renders no heading — the page h1 (PageHeader) is the only one', () => {
		render(Header, { healthStatus: 'healthy' });
		expect(screen.queryByRole('heading')).toBeNull();
	});

	it('hides the API health pill from tenant users', () => {
		render(Header, { healthStatus: 'healthy' });
		expect(screen.queryByTestId('api-health-pill')).toBeNull();
	});

	it('shows the API health pill to a super_admin', () => {
		roles.superAdmin = true;
		render(Header, { healthStatus: 'degraded' });
		expect(screen.getByTestId('api-health-pill').textContent).toContain('API degraded');
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const clearUserMock = vi.fn().mockResolvedValue(undefined);
const manageAccountMock = vi.fn().mockResolvedValue(undefined);
const canAccessAdminMock = vi.fn();
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/stores/auth.svelte.js', () => ({
	getUser: () => getUserMock(),
	clearUser: () => clearUserMock(),
	canAccessAdmin: () => canAccessAdminMock()
}));
vi.mock('$lib/services/keycloak.js', () => ({ manageAccount: () => manageAccountMock() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn() }));

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import UserMenu from './UserMenu.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	canAccessAdminMock.mockReturnValue(false);
	getUserMock.mockReturnValue({
		sub: 'u1',
		email: 'ada@acme.test',
		name: 'Ada Lovelace',
		preferred_username: 'ada',
		roles: ['admin'],
		license_token: null
	});
});

describe('UserMenu', () => {
	it('does not show the subject UUID as the name when an email exists', () => {
		const id = '01a0dd02-d324-77bb-acd8-7c31fb6e95ec';
		getUserMock.mockReturnValue({
			sub: id,
			subject_id: id,
			email: 'ada@acme.test',
			name: id,
			preferred_username: id,
			roles: [],
			license_token: null
		});
		render(UserMenu);
		const trigger = screen.getByTestId('user-menu');
		expect(trigger.textContent).not.toContain(id);
		expect(trigger.textContent).toContain('ada@acme.test');
		expect(trigger.textContent).toContain('AD');
	});

	it('shows the user initials and name on the trigger', () => {
		render(UserMenu);
		const trigger = screen.getByTestId('user-menu');
		expect(trigger.textContent).toContain('AL'); // Ada Lovelace
		expect(trigger.textContent).toContain('Ada Lovelace');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
	});

	it('opens the menu and reveals identity + actions', async () => {
		render(UserMenu);
		await fireEvent.click(screen.getByTestId('user-menu'));
		await tick();
		expect(screen.getByTestId('user-menu-panel')).toBeTruthy();
		expect(screen.getByText('ada@acme.test')).toBeTruthy();
		expect(screen.getByTestId('user-menu-settings').getAttribute('href')).toBe('/settings');
		expect(screen.getByTestId('user-menu-account')).toBeTruthy();
		expect(screen.getByTestId('user-menu-signout')).toBeTruthy();
	});

	it('renders no plan pill — identity only, like fr (plan lives on /license-upgrade)', async () => {
		render(UserMenu);
		await fireEvent.click(screen.getByTestId('user-menu'));
		await tick();
		const panel = screen.getByTestId('user-menu-panel');
		expect(panel.textContent).not.toMatch(/plan/i);
		expect(panel.textContent).not.toMatch(/unknown/i);
	});

	it('signs out via the auth store clearUser()', async () => {
		render(UserMenu);
		await fireEvent.click(screen.getByTestId('user-menu'));
		await tick();
		await fireEvent.click(screen.getByTestId('user-menu-signout'));
		expect(clearUserMock).toHaveBeenCalledOnce();
	});

	it('opens the Keycloak account page from Manage account', async () => {
		render(UserMenu);
		await fireEvent.click(screen.getByTestId('user-menu'));
		await tick();
		await fireEvent.click(screen.getByTestId('user-menu-account'));
		expect(manageAccountMock).toHaveBeenCalledOnce();
	});

	it('hides the Admin link for a non-admin user', async () => {
		canAccessAdminMock.mockReturnValue(false);
		render(UserMenu);
		await fireEvent.click(screen.getByTestId('user-menu'));
		await tick();
		expect(screen.queryByTestId('admin-link')).toBeNull();
	});

	it('shows the Admin link (→ /admin) for an admin user', async () => {
		canAccessAdminMock.mockReturnValue(true);
		render(UserMenu);
		await fireEvent.click(screen.getByTestId('user-menu'));
		await tick();
		const link = screen.getByTestId('admin-link');
		expect(link).toBeTruthy();
		expect(link.getAttribute('href')).toBe('/admin');
	});

	it('falls back to email initials when there is no name', () => {
		getUserMock.mockReturnValue({
			sub: 'u2',
			email: 'zed@acme.test',
			name: '',
			preferred_username: 'zed',
			roles: [],
			license_token: null
		});
		render(UserMenu);
		expect(screen.getByTestId('user-menu').textContent).toContain('ZE');
	});
});

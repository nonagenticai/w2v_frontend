import { describe, it, expect, vi, beforeEach } from 'vitest';

const { acceptMock, fetchUserMock, setActiveMock, gotoMock, pageState, authState } = vi.hoisted(
	() => ({
		authState: { role: 'member' as string | null, superAdmin: false },
		acceptMock: vi.fn(),
		fetchUserMock: vi.fn(),
		setActiveMock: vi.fn(),
		gotoMock: vi.fn(),
		pageState: { url: new URL('http://localhost/invite/accept') }
	})
);

vi.mock('$lib/api/tenancy.js', async () => {
	const actual: typeof import('$lib/api/tenancy.js') = await vi.importActual('$lib/api/tenancy.js');
	return { ...actual, tenancy: { acceptInvite: acceptMock } };
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/auth.svelte.js', () => ({
	ensureAuthReady: () => Promise.resolve(),
	fetchUser: () => fetchUserMock(),
	getUser: () => ({ email: 'me@x.co', role: authState.role }),
	isSuperAdmin: () => authState.superAdmin,
	clearUser: vi.fn()
}));
vi.mock('$lib/stores/tenant-switcher.svelte.js', () => ({
	tenantSwitcher: { setActive: (id: string | null) => setActiveMock(id) }
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock, replaceState: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (fn: (v: unknown) => void) => {
			fn(pageState);
			return () => {};
		}
	}
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import Page from './+page.svelte';

const TOKEN = 'tok-0123456789abcdef';
const KEY = 'w2v_invite_token';

function at(query: string): void {
	pageState.url = new URL(`http://localhost/invite/accept${query}`);
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	authState.role = 'member';
	authState.superAdmin = false;
	at('');
});

describe('/invite/accept', () => {
	it('accepts the URL token, switches into the joined workspace and goes home', async () => {
		at(`?token=${TOKEN}`);
		acceptMock.mockResolvedValue({
			tenant_id: 'T9',
			tenant_name: 'Nine',
			role: 'member',
			already_member: false
		});
		render(Page);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(acceptMock).toHaveBeenCalledWith(TOKEN);
		expect(setActiveMock).toHaveBeenCalledWith('T9');
		expect(fetchUserMock).toHaveBeenCalled();
		expect(sessionStorage.getItem(KEY)).toBeNull();
	});

	it('uses the token parked in sessionStorage when the login round-trip dropped the query', async () => {
		sessionStorage.setItem(KEY, TOKEN);
		acceptMock.mockResolvedValue({
			tenant_id: 'T9',
			tenant_name: null,
			role: 'member',
			already_member: true
		});
		render(Page);
		await waitFor(() => expect(acceptMock).toHaveBeenCalledWith(TOKEN));
	});

	it('no token anywhere → explains, never calls the API', async () => {
		render(Page);
		expect(await screen.findByTestId('invite-accept-missing')).toBeTruthy();
		expect(acceptMock).not.toHaveBeenCalled();
	});

	it('claim mode (role null) accepts WITHOUT persisting an active tenant the backend would ignore', async () => {
		authState.role = null;
		at(`?token=${TOKEN}`);
		acceptMock.mockResolvedValue({
			tenant_id: 'T9',
			tenant_name: 'Nine',
			role: 'member',
			already_member: false
		});
		render(Page);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(setActiveMock).not.toHaveBeenCalled();
		expect(fetchUserMock).toHaveBeenCalled();
	});

	it('claim mode still switches a super_admin into the joined workspace', async () => {
		authState.role = null;
		authState.superAdmin = true;
		at(`?token=${TOKEN}`);
		acceptMock.mockResolvedValue({
			tenant_id: 'T9',
			tenant_name: 'Nine',
			role: 'member',
			already_member: false
		});
		render(Page);
		await waitFor(() => expect(gotoMock).toHaveBeenCalled());
		expect(setActiveMock).toHaveBeenCalledWith('T9');
	});

	it('403 INVITE_EMAIL_MISMATCH → mismatch message, signed-in email, stored token CLEARED, in-page retry still works', async () => {
		at(`?token=${TOKEN}`);
		acceptMock.mockRejectedValue(new ApiError(403, 'Forbidden', 'x', 'INVITE_EMAIL_MISMATCH'));
		render(Page);
		const err = await screen.findByTestId('invite-accept-error');
		expect(err.getAttribute('data-code')).toBe('INVITE_EMAIL_MISMATCH');
		expect(err.textContent).toMatch(/sent to a different email address/i);
		expect(err.textContent).toContain('me@x.co');
		expect(screen.getByRole('button', { name: 'Sign out and switch account' })).toBeTruthy();
		expect(sessionStorage.getItem(KEY)).toBeNull();
		expect(gotoMock).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(2));
		expect(acceptMock).toHaveBeenLastCalledWith(TOKEN);
	});

	it('403 EMAIL_NOT_VERIFIED → asks to verify the email', async () => {
		at(`?token=${TOKEN}`);
		acceptMock.mockRejectedValue(new ApiError(403, 'Forbidden', 'x', 'EMAIL_NOT_VERIFIED'));
		render(Page);
		const msg = await screen.findByTestId('invite-accept-message');
		expect(msg.textContent).toMatch(/verify your email/i);
		expect(sessionStorage.getItem(KEY)).toBeNull();
	});

	it('410 INVITE_GONE → expired/revoked message and the dead token is forgotten', async () => {
		at(`?token=${TOKEN}`);
		acceptMock.mockRejectedValue(new ApiError(410, 'Gone', 'x', 'INVITE_GONE'));
		render(Page);
		const err = await screen.findByTestId('invite-accept-error');
		expect(err.textContent).toMatch(/no longer valid/i);
		expect(err.textContent).toMatch(/expired or was revoked/i);
		expect(sessionStorage.getItem(KEY)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
	});
});

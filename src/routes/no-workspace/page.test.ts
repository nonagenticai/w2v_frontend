import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchUserMock, hasNoWorkspaceMock, gotoMock, acceptByIdMock } = vi.hoisted(() => ({
	acceptByIdMock: vi.fn(),
	fetchUserMock: vi.fn(),
	hasNoWorkspaceMock: vi.fn(),
	gotoMock: vi.fn()
}));
vi.mock('$lib/stores/auth.svelte.js', () => ({
	fetchUser: () => fetchUserMock(),
	hasNoWorkspace: () => hasNoWorkspaceMock(),
	getUser: () => ({
		email: 'lost@x.co',
		pending_invites: [
			{
				id: 'inv-1',
				tenant_id: 'T1',
				tenant_name: 'Acme',
				role: 'member',
				expires_at: '2026-12-01T00:00:00Z'
			}
		]
	}),
	clearUser: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/api/tenancy.js', async () => {
	const actual: typeof import('$lib/api/tenancy.js') = await vi.importActual('$lib/api/tenancy.js');
	return { ...actual, tenancy: { acceptInviteById: acceptByIdMock } };
});
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Page from './+page.svelte';

beforeEach(() => vi.clearAllMocks());

describe('/no-workspace', () => {
	it('tells the user to ask an admin for an invite at their email', () => {
		render(Page);
		const box = screen.getByTestId('no-workspace');
		expect(box.textContent).toMatch(/ask an admin/i);
		expect(box.textContent).toContain('lost@x.co');
	});

	it('"Check again" goes home once /auth/me reports a workspace', async () => {
		hasNoWorkspaceMock.mockReturnValue(false);
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(fetchUserMock).toHaveBeenCalled();
	});

	it('"Check again" stays and says so while there is still none', async () => {
		hasNoWorkspaceMock.mockReturnValue(true);
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
		expect(await screen.findByTestId('no-workspace-still-none')).toBeTruthy();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('lists a pending invite; Accept joins it and goes home once a workspace exists', async () => {
		acceptByIdMock.mockResolvedValue({
			tenant_id: 'T1',
			tenant_name: 'Acme',
			role: 'member',
			already_member: false
		});
		hasNoWorkspaceMock.mockReturnValue(false);
		render(Page);
		const list = screen.getByTestId('no-workspace-invites');
		expect(list.textContent).toMatch(/invited to\s+Acme\s+as\s+member/);
		await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(acceptByIdMock).toHaveBeenCalledWith('inv-1');
		expect(fetchUserMock).toHaveBeenCalled();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { acceptByIdMock, fetchUserMock, toastSuccessMock, toastErrorMock, userState } = vi.hoisted(
	() => ({
		acceptByIdMock: vi.fn(),
		fetchUserMock: vi.fn(),
		toastSuccessMock: vi.fn(),
		toastErrorMock: vi.fn(),
		userState: { pending_invites: [] as unknown[] }
	})
);

vi.mock('$lib/api/tenancy.js', async () => {
	const actual: typeof import('$lib/api/tenancy.js') = await vi.importActual('$lib/api/tenancy.js');
	return { ...actual, tenancy: { acceptInviteById: acceptByIdMock } };
});
vi.mock('$lib/stores/auth.svelte.js', () => ({
	fetchUser: () => fetchUserMock(),
	getUser: () => ({ email: 'me@x.co', pending_invites: userState.pending_invites })
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: toastSuccessMock,
	toastError: toastErrorMock
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import PendingInvites from './PendingInvites.svelte';

const INV_A = {
	id: 'inv-a',
	tenant_id: 'T-A',
	tenant_name: 'Acme',
	role: 'tenant_admin',
	expires_at: '2026-12-01T00:00:00Z'
};
const INV_B = {
	id: 'inv-b',
	tenant_id: 'T-B',
	tenant_name: null,
	role: 'member',
	expires_at: '2026-12-01T00:00:00Z'
};

beforeEach(() => {
	vi.clearAllMocks();
	userState.pending_invites = [INV_A, INV_B];
	fetchUserMock.mockResolvedValue(undefined);
});

describe('PendingInvites', () => {
	it('renders nothing when /auth/me lists no pending invites', () => {
		userState.pending_invites = [];
		render(PendingInvites);
		expect(screen.queryByTestId('pending-invites')).toBeNull();
	});

	it('lists each invite with its workspace name and role', () => {
		render(PendingInvites);
		const rows = screen.getAllByTestId('pending-invite').map((r) => r.textContent ?? '');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatch(/invited to\s+Acme\s+as\s+admin/);
		expect(rows[1]).toMatch(/invited to\s+a workspace\s+as\s+member/);
	});

	it('Accept calls the BY-ID endpoint, refreshes /auth/me, then fires onaccepted', async () => {
		acceptByIdMock.mockResolvedValue({
			tenant_id: 'T-A',
			tenant_name: 'Acme',
			role: 'tenant_admin',
			already_member: false
		});
		const onaccepted = vi.fn();
		render(PendingInvites, { props: { onaccepted } });
		await fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
		await waitFor(() => expect(onaccepted).toHaveBeenCalled());
		expect(acceptByIdMock).toHaveBeenCalledWith('inv-a');
		expect(fetchUserMock).toHaveBeenCalledTimes(1);
		expect(fetchUserMock.mock.invocationCallOrder[0]).toBeLessThan(
			onaccepted.mock.invocationCallOrder[0]
		);
		expect(toastSuccessMock.mock.calls[0][1]).toContain('Acme');
	});

	it('a refused accept shows the coded message and does NOT fire onaccepted', async () => {
		acceptByIdMock.mockRejectedValue(new ApiError(403, 'Forbidden', 'x', 'EMAIL_NOT_VERIFIED'));
		const onaccepted = vi.fn();
		render(PendingInvites, { props: { onaccepted } });
		await fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
		await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
		expect(toastErrorMock.mock.calls[0][1]).toMatch(/verify your email/i);
		expect(onaccepted).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it('Dismiss hides the invite locally without calling the API', async () => {
		render(PendingInvites);
		await fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
		const rows = screen.getAllByTestId('pending-invite');
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).not.toContain('Acme');
		expect(acceptByIdMock).not.toHaveBeenCalled();
		expect(fetchUserMock).not.toHaveBeenCalled();
	});
});

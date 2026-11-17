import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tenancyMock, toastSuccessMock, getUserMock } = vi.hoisted(() => ({
	tenancyMock: {
		members: vi.fn(),
		setMemberRole: vi.fn(),
		removeMember: vi.fn(),
		invites: vi.fn(),
		createInvite: vi.fn(),
		resendInvite: vi.fn(),
		revokeInvite: vi.fn()
	},
	toastSuccessMock: vi.fn(),
	getUserMock: vi.fn()
}));

// Keep the REAL tenancyErrorMessage (code → copy) — it is part of the behaviour.
vi.mock('$lib/api/tenancy.js', async () => {
	const actual: typeof import('$lib/api/tenancy.js') = await vi.importActual('$lib/api/tenancy.js');
	return { ...actual, tenancy: tenancyMock };
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/auth.svelte.js', () => ({
	getUser: () => getUserMock(),
	ensureAuthReady: () => Promise.resolve()
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccessMock(...a)
}));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import Page from './+page.svelte';

const SELF = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const member = (subject_id: string, role: 'member' | 'tenant_admin', email: string) => ({
	subject_id,
	email,
	display_name: null,
	role,
	status: 'active',
	first_seen_at: '2026-06-01T10:00:00Z',
	last_seen_at: '2026-06-15T10:00:00Z'
});

const ROSTER = {
	items: [member(SELF, 'tenant_admin', 'me@x.co'), member(OTHER, 'member', 'bo@x.co')],
	total: 2,
	limit: 50,
	offset: 0
};
const INVITE = {
	id: 'inv-1',
	email: 'new@x.co',
	role: 'member',
	status: 'pending',
	expires_at: '2026-10-20T00:00:00Z',
	created_at: '2026-10-09T00:00:00Z',
	resent_at: null,
	invited_by: SELF
};
const created = (delivery: 'requested' | 'failed') => ({
	...INVITE,
	invite_url: 'https://w2v.example/invite/accept?token=SECRET-TOKEN',
	email_delivery: delivery
});

beforeEach(() => {
	vi.clearAllMocks();
	getUserMock.mockReturnValue({ sub: SELF });
	tenancyMock.members.mockResolvedValue(ROSTER);
	tenancyMock.invites.mockResolvedValue({ items: [INVITE] });
});

function rowFor(email: string): HTMLElement {
	return screen.getAllByTestId('members-row').find((r) => r.textContent?.includes(email))!;
}

describe('(tenant)/members — roster', () => {
	it('lists active members and pending invites', async () => {
		render(Page);
		expect(await screen.findAllByTestId('members-row')).toHaveLength(2);
		expect(tenancyMock.members).toHaveBeenCalledWith({ status: 'active', limit: 50, offset: 0 });
		expect((await screen.findByTestId('invites-row')).textContent).toContain('new@x.co');
		expect(tenancyMock.invites).toHaveBeenCalledWith('pending');
	});

	it('changing another member’s role PATCHes it directly', async () => {
		tenancyMock.setMemberRole.mockResolvedValue({});
		render(Page);
		await screen.findAllByTestId('members-row');
		await fireEvent.change(within(rowFor('bo@x.co')).getByRole('combobox'), {
			target: { value: 'tenant_admin' }
		});
		await waitFor(() =>
			expect(tenancyMock.setMemberRole).toHaveBeenCalledWith(OTHER, 'tenant_admin')
		);
	});

	it('demoting MYSELF asks first and only PATCHes after confirming', async () => {
		tenancyMock.setMemberRole.mockResolvedValue({});
		render(Page);
		await screen.findAllByTestId('members-row');
		await fireEvent.change(within(rowFor('me@x.co')).getByRole('combobox'), {
			target: { value: 'member' }
		});
		const confirm = await screen.findByTestId('members-self-demote-confirm');
		expect(tenancyMock.setMemberRole).not.toHaveBeenCalled();
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Make me a member' }));
		await waitFor(() => expect(tenancyMock.setMemberRole).toHaveBeenCalledWith(SELF, 'member'));
	});

	it('surfaces LAST_TENANT_ADMIN as "a workspace needs at least one admin"', async () => {
		tenancyMock.setMemberRole.mockRejectedValue(
			new ApiError(409, 'Conflict', 'server words', 'LAST_TENANT_ADMIN')
		);
		render(Page);
		await screen.findAllByTestId('members-row');
		await fireEvent.change(within(rowFor('me@x.co')).getByRole('combobox'), {
			target: { value: 'member' }
		});
		const confirm = await screen.findByTestId('members-self-demote-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Make me a member' }));
		const err = await screen.findByTestId('members-action-error');
		expect(err.textContent).toMatch(/workspace needs at least one admin/i);
	});

	it('removing a member requires confirmation, then DELETEs', async () => {
		tenancyMock.removeMember.mockResolvedValue({ subject_id: OTHER, status: 'removed' });
		render(Page);
		await screen.findAllByTestId('members-row');
		await fireEvent.click(within(rowFor('bo@x.co')).getByRole('button', { name: 'Remove' }));
		const confirm = await screen.findByTestId('members-remove-confirm');
		expect(tenancyMock.removeMember).not.toHaveBeenCalled();
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(tenancyMock.removeMember).toHaveBeenCalledWith(OTHER));
	});
});

describe('(tenant)/members — invites', () => {
	async function submitInvite(email: string, role = 'tenant_admin'): Promise<void> {
		render(Page);
		await screen.findAllByTestId('members-row');
		await fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		const form = await screen.findByTestId('invite-form');
		await fireEvent.input(within(form).getByLabelText('Email'), { target: { value: email } });
		await fireEvent.change(within(form).getByLabelText('Role'), { target: { value: role } });
		await fireEvent.submit(form);
	}

	it('sends email + role; a delivered invite toasts and shows NO link', async () => {
		tenancyMock.createInvite.mockResolvedValue(created('requested'));
		await submitInvite('new@x.co');
		await waitFor(() =>
			expect(tenancyMock.createInvite).toHaveBeenCalledWith('new@x.co', 'tenant_admin')
		);
		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
		// The backend only REQUESTS the email (provisioning sends it) — the copy
		// must not claim it was delivered.
		const [, body] = toastSuccessMock.mock.calls[0] as [string, string];
		expect(body).toMatch(/^An invite email was requested for \S+@x\.co\.$/);
		expect(body).not.toMatch(/went to/);
		expect(screen.queryByTestId('invite-delivery-failed')).toBeNull();
		expect(document.body.textContent).not.toContain('SECRET-TOKEN');
	});

	it('email_delivery=failed shows the warning, the copyable link and a Resend', async () => {
		tenancyMock.createInvite.mockResolvedValue(created('failed'));
		tenancyMock.resendInvite.mockResolvedValue(created('requested'));
		await submitInvite('new@x.co');
		const panel = await screen.findByTestId('invite-delivery-failed');
		expect(panel.textContent).toContain('Invite created but the email could not be sent');
		expect(within(panel).getByTestId('invite-link').textContent).toContain('SECRET-TOKEN');
		await fireEvent.click(within(panel).getByRole('button', { name: 'Resend' }));
		await waitFor(() => expect(tenancyMock.resendInvite).toHaveBeenCalledWith('inv-1'));
		// A delivered resend clears the failure panel.
		await waitFor(() => expect(screen.queryByTestId('invite-delivery-failed')).toBeNull());
	});

	it('INVITE_PENDING offers to resend the EXISTING invite by its id', async () => {
		tenancyMock.createInvite.mockRejectedValue(
			new ApiError(409, 'Conflict', 'pending', 'INVITE_PENDING', { invite_id: 'inv-77' })
		);
		tenancyMock.resendInvite.mockResolvedValue(created('requested'));
		await submitInvite('dup@x.co');
		const err = await screen.findByTestId('invite-error');
		expect(err.textContent).toMatch(/already invited/i);
		await fireEvent.click(screen.getByRole('button', { name: 'Resend invite' }));
		await waitFor(() => expect(tenancyMock.resendInvite).toHaveBeenCalledWith('inv-77'));
	});

	it('pending invite rows resend and revoke', async () => {
		tenancyMock.resendInvite.mockResolvedValue(created('requested'));
		tenancyMock.revokeInvite.mockResolvedValue(undefined);
		render(Page);
		const row = await screen.findByTestId('invites-row');
		await fireEvent.click(within(row).getByRole('button', { name: 'Resend' }));
		await waitFor(() => expect(tenancyMock.resendInvite).toHaveBeenCalledWith('inv-1'));
		await fireEvent.click(
			within(await screen.findByTestId('invites-row')).getByRole('button', { name: 'Revoke' })
		);
		await waitFor(() => expect(tenancyMock.revokeInvite).toHaveBeenCalledWith('inv-1'));
	});
});

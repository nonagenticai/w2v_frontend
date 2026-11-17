import { describe, it, expect, vi, beforeEach } from 'vitest';

const provisionMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: { provisionUser: (...a: unknown[]) => provisionMock(...a) }
}));

import { fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import Page from './+page.svelte';

const RESULT = {
	tenant_id: 't-1',
	invite_id: 'inv-123',
	tokens: { w2v: 'TOKEN-1' },
	license_ids: { w2v: 'lic-1' }
};

async function fillForm(): Promise<void> {
	await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
	await fireEvent.input(screen.getByLabelText('Full name'), { target: { value: 'New User' } });
	await fireEvent.input(screen.getByLabelText('Tenant slug'), { target: { value: 'acme-corp' } });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('(platform)/provision page', () => {
	it('submits the form and renders the invite + one-time token panel (no password)', async () => {
		provisionMock.mockResolvedValue(RESULT);
		render(Page);

		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));

		const panel = await screen.findByTestId('provision-result');
		expect(panel.textContent).toContain('Tenant provisioned');
		const invite = screen.getByTestId('provision-invite');
		expect(screen.getByTestId('provision-invite-notice').textContent?.trim()).toBe(
			'Invitation sent if the address can receive one; the user signs in from the link.'
		);
		expect(invite.textContent).toContain('Invite pending for new@example.com');
		// The identity invite API never reveals account existence or email delivery,
		// so the page must not claim either.
		expect(panel.textContent).not.toMatch(/already existed|magic link|emailed|created/i);
		expect(invite.textContent).toContain('inv-123');
		// P2: provisioning no longer mints a password — none may be rendered.
		expect(screen.queryByTestId('provision-temp-password')).toBeNull();
		expect(panel.textContent).not.toMatch(/password/i);
		expect(screen.getByTestId('provision-token').textContent).toContain('TOKEN-1');
		expect(provisionMock).toHaveBeenCalledWith({
			email: 'new@example.com',
			name: 'New User',
			tenant_slug: 'acme-corp',
			workspace_role: 'tenant_admin',
			llm_access: 'local_allowed'
		});
		// The request no longer carries a reset-email switch, and the form offers none.
		expect(provisionMock.mock.calls[0][0]).not.toHaveProperty('send_password_reset_email');
		expect(screen.queryByText(/password-reset email/i)).toBeNull();
	});

	it('service access defaults to "Platform services allowed" and offers all three modes', async () => {
		provisionMock.mockResolvedValue(RESULT);
		render(Page);
		const sel = screen.getByLabelText('Service access') as HTMLSelectElement;
		expect(sel.value).toBe('local_allowed');
		expect([...sel.options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['local_allowed', 'Platform services allowed'],
			['byo_required', 'Own providers required'],
			['platform_only', 'Platform services only']
		]);
		expect(screen.getByTestId('llm-access-hint').textContent).toMatch(/falls back/i);
		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));
		await screen.findByTestId('provision-result');
		expect(provisionMock.mock.calls[0][0]).toMatchObject({ llm_access: 'local_allowed' });
	});

	it.each(['platform_only', 'byo_required'] as const)('sends the chosen mode %s', async (mode) => {
		provisionMock.mockResolvedValue(RESULT);
		render(Page);
		const sel = screen.getByLabelText('Service access') as HTMLSelectElement;
		await fillForm();
		await fireEvent.change(sel, { target: { value: mode } });
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));
		await screen.findByTestId('provision-result');
		expect(provisionMock.mock.calls[0][0]).toMatchObject({ llm_access: mode });
	});

	it('warns visibly when the tenant was created but its LLM access was not set', async () => {
		provisionMock.mockResolvedValue({
			...RESULT,
			llm_access: { mode: 'platform_only', status: 'failed', detail: 'licences 503' }
		});
		render(Page);
		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));
		const warn = await screen.findByTestId('provision-llm-access-failed');
		expect(warn.textContent).toContain('Platform services only');
		expect(warn.textContent).toContain('licences 503');
		expect(warn.querySelector('a')?.getAttribute('href')).toBe('/tenants');
	});

	it('confirms the LLM access when it was applied', async () => {
		provisionMock.mockResolvedValue({
			...RESULT,
			llm_access: { mode: 'local_allowed', status: 'ok', detail: null }
		});
		render(Page);
		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));
		expect((await screen.findByTestId('provision-llm-access-ok')).textContent).toContain(
			'Platform services allowed'
		);
		expect(screen.queryByTestId('provision-llm-access-failed')).toBeNull();
	});

	it('says no invite was needed when the user was already a member', async () => {
		provisionMock.mockResolvedValue({ ...RESULT, invite_id: null });
		render(Page);
		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));
		const invite = await screen.findByTestId('provision-invite');
		expect(invite.textContent).toContain('already an active member');
		expect(screen.queryByTestId('provision-invite-notice')).toBeNull();
	});

	it('flags an invalid tenant slug and blocks submit', async () => {
		render(Page);
		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'new@example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Full name'), { target: { value: 'New User' } });
		await fireEvent.input(screen.getByLabelText('Tenant slug'), {
			target: { value: 'Bad Slug!' }
		});

		expect(screen.getByTestId('slug-error')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Provision' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('renders an error when provisioning fails', async () => {
		provisionMock.mockRejectedValue(new Error('boom'));
		render(Page);

		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));

		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't provision");
	});

	it('shows operator-facing copy when the identity provider refuses the invite', async () => {
		provisionMock.mockRejectedValue(
			new ApiError(502, 'Bad Gateway', 'raw server text', 'IDENTITY_PROVIDER_FORBIDDEN')
		);
		render(Page);

		await fillForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Provision' }));

		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain(
			"Identity service refused the request — the platform's invite permission is missing; contact the operator"
		);
		expect(err.textContent).not.toContain('raw server text');
	});
});

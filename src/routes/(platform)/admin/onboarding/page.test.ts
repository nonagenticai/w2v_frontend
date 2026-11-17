import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMock = vi.fn();
const getMock = vi.fn();
const inviteMock = vi.fn();
const approveMock = vi.fn();
const rejectMock = vi.fn();
const retryMock = vi.fn();
const removeMock = vi.fn();
const retryRemovalMock = vi.fn();
const resolveRemovalMock = vi.fn();
const replaceStateMock = vi.fn();
let pageState: { url: URL } = { url: new URL('http://localhost/admin/onboarding') };

vi.mock('$lib/api/signup-approvals.js', async (orig) => {
	const actual = await orig<typeof import('$lib/api/signup-approvals.js')>();
	return {
		...actual,
		signupApprovals: {
			list: (...a: unknown[]) => listMock(...a),
			get: (...a: unknown[]) => getMock(...a),
			invite: (...a: unknown[]) => inviteMock(...a),
			approve: (...a: unknown[]) => approveMock(...a),
			reject: (...a: unknown[]) => rejectMock(...a),
			retry: (...a: unknown[]) => retryMock(...a),
			remove: (...a: unknown[]) => removeMock(...a),
			retryRemoval: (...a: unknown[]) => retryRemovalMock(...a),
			resolveRemoval: (...a: unknown[]) => resolveRemovalMock(...a)
		}
	};
});
// Poll the queued removal quickly in tests (production: every 5 s).
vi.mock('$lib/components/onboarding/signup-onboarding.js', async (orig) => ({
	...(await orig<typeof import('$lib/components/onboarding/signup-onboarding.js')>()),
	REMOVAL_POLL_MS: 20
}));
vi.mock('$app/navigation', () => ({ replaceState: (...a: unknown[]) => replaceStateMock(...a) }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (fn: (v: unknown) => void) => {
			fn(pageState);
			return () => {};
		}
	}
}));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import type { SignupApproval } from '$lib/api/signup-approvals.js';
import Page from './+page.svelte';

function row(over: Partial<SignupApproval> = {}): SignupApproval {
	return {
		id: 'a1',
		email: 'ada@example.com',
		name: 'Ada Lovelace',
		company: 'Analytical Engines',
		message: 'We make explainer videos.\nLots of them.',
		locale: 'nl',
		source: 'web',
		status: 'pending',
		created_at: '2026-10-20T10:00:00+00:00',
		decided_at: null,
		decided_via: null,
		decider_actor: null,
		approving: false,
		tenant_name: null,
		tenant_slug: null,
		tenant_id: null,
		llm_access: null,
		suggested_tenant_name: 'Analytical Engines',
		steps: {},
		steps_not_ok: [],
		email_state: 'waiting',
		steps_attempts: 0,
		steps_next_attempt_at: null,
		...over
	};
}

const APPROVED = row({
	status: 'approved',
	decided_at: '2026-10-20T11:00:00+00:00',
	decided_via: 'onboarding',
	tenant_id: 't-1',
	tenant_name: 'Analytical Engines',
	tenant_slug: 'analytical-engines',
	llm_access: 'local_allowed',
	steps: {
		identity: { status: 'ok' },
		provision: { status: 'ok' },
		membership: { status: 'ok' },
		invite_email: { status: 'ok' }
	},
	email_state: 'sent'
});

const NOT_CONFIGURED = new ApiError(
	503,
	'Service Unavailable',
	'Early-access signup is not enabled on this deployment (W2V_SIGNUP_ENABLED).',
	'signup_not_configured'
);

beforeEach(() => {
	vi.clearAllMocks();
	pageState = { url: new URL('http://localhost/admin/onboarding') };
	listMock.mockResolvedValue({ items: [row()] });
	getMock.mockResolvedValue(row());
});

describe('(platform)/admin/onboarding page', () => {
	it('loads the pending queue by default and lists each request', async () => {
		render(Page);
		const list = await screen.findByTestId('onboarding-list');
		expect(listMock).toHaveBeenCalledWith('pending');
		const r = within(list).getByTestId('onboarding-row');
		expect(r.textContent).toContain('Ada Lovelace');
		expect(r.textContent).toContain('ada@example.com');
		expect(r.textContent).toContain('Analytical Engines');
		expect(r.textContent).toContain('Website form');
		expect(r.textContent).toContain('Nederlands (Dutch)');
		expect(screen.queryByTestId('onboarding-detail')).toBeNull();
	});

	it('switches the filter, reloads, and records it in the URL', async () => {
		render(Page);
		await screen.findByTestId('onboarding-list');
		listMock.mockResolvedValue({ items: [] });
		await fireEvent.click(screen.getByRole('tab', { name: 'Needs attention' }));
		await waitFor(() => expect(listMock).toHaveBeenLastCalledWith('needs_attention'));
		expect(replaceStateMock).toHaveBeenLastCalledWith(
			'/admin/onboarding?status=needs_attention',
			{}
		);
		expect((await screen.findByText('Nothing here')).textContent).toBeTruthy();
	});

	it('auto-opens the request named by ?signup= (the Telegram deep link)', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		expect(getMock).toHaveBeenCalledWith('a1');
		await waitFor(() => expect(detail.textContent).toContain('Ada Lovelace'));
		expect(screen.getByTestId('onboarding-message').textContent).toContain(
			'We make explainer videos.'
		);
		expect(within(detail).getByRole('button', { name: 'Approve' })).toBeTruthy();
		expect(within(detail).getByRole('button', { name: 'Decline' })).toBeTruthy();
	});

	it('clicking a row opens it and puts ?signup=<id> in the URL', async () => {
		render(Page);
		const list = await screen.findByTestId('onboarding-list');
		await fireEvent.click(within(list).getByRole('button'));
		expect(await screen.findByTestId('onboarding-detail')).toBeTruthy();
		expect(replaceStateMock).toHaveBeenLastCalledWith('/admin/onboarding?signup=a1', {});
	});

	it('approves with the suggested name (none sent) and shows the outcome', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		approveMock.mockResolvedValue({
			approval: APPROVED,
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: []
		});
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Approve' }));
		await fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
		// An untouched LLM access is NOT sent: the server's default applies.
		expect(approveMock).toHaveBeenCalledWith('a1', undefined, undefined);
		const notice = await screen.findByTestId('onboarding-notice');
		expect(notice.textContent).toContain('welcome email has been sent');
		const tenant = screen.getByTestId('onboarding-tenant');
		expect(tenant.textContent).toContain('Analytical Engines');
		expect(tenant.querySelector('a')?.getAttribute('href')).toBe('/tenants');
		expect(screen.getAllByTestId('onboarding-step')).toHaveLength(4);
		// Approved + all steps ok ⇒ no decide / retry buttons remain.
		expect(within(detail).queryByRole('button', { name: 'Approve' })).toBeNull();
		expect(within(detail).queryByRole('button', { name: 'Retry setup' })).toBeNull();
		// It left the pending filter.
		expect(screen.queryByTestId('onboarding-list')).toBeNull();
	});

	it('sends an edited workspace name', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		approveMock.mockResolvedValue({
			approval: APPROVED,
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Babbage & Co', slug: 'babbage-co' },
			emailState: 'waiting',
			stepsNotOk: []
		});
		render(Page);
		const input = (await screen.findByLabelText('Workspace name')) as HTMLInputElement;
		await waitFor(() => expect(input.value).toBe('Analytical Engines'));
		await fireEvent.input(input, { target: { value: 'Babbage & Co' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
		expect(approveMock).toHaveBeenCalledWith('a1', 'Babbage & Co', undefined);
	});

	it('approves with the chosen LLM access and shows it in the detail panel', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		const approved = { ...APPROVED, llm_access: 'platform_only' as const };
		approveMock.mockResolvedValue({
			approval: approved,
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: []
		});
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Approve' }));
		expect(within(detail).queryByTestId('onboarding-llm-access')).toBeNull();
		const select = within(screen.getByTestId('onboarding-approve-llm-access')).getByLabelText(
			'Service access'
		) as HTMLSelectElement;
		expect(select.value).toBe('local_allowed');
		expect([...select.options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['local_allowed', 'Platform services allowed'],
			['byo_required', 'Own providers required'],
			['platform_only', 'Platform services only']
		]);
		await fireEvent.change(select, { target: { value: 'platform_only' } });
		await fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
		expect(approveMock).toHaveBeenCalledWith('a1', undefined, 'platform_only');
		expect((await screen.findByTestId('onboarding-llm-access')).textContent).toContain(
			'Platform services only'
		);
	});

	it('declines only after confirming', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		rejectMock.mockResolvedValue(
			row({ status: 'rejected', decided_at: '2026-10-20T11:00:00+00:00' })
		);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Decline' }));
		await fireEvent.click(within(detail).getByRole('button', { name: 'Decline' }));
		expect(rejectMock).not.toHaveBeenCalled();
		const confirm = await screen.findByTestId('onboarding-reject-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Decline' }));
		expect(rejectMock).toHaveBeenCalledWith('a1');
		expect((await screen.findByTestId('onboarding-notice')).textContent).toContain('declined');
	});

	it('offers Retry for an approved request with unfinished steps', async () => {
		const stuck = row({
			...APPROVED,
			steps: {
				identity: { status: 'ok' },
				provision: { status: 'ok' },
				membership: { status: 'ok' },
				invite_email: { status: 'unknown', error: 'timeout talking to mailer' }
			},
			steps_not_ok: [{ step: 'invite_email', status: 'unknown', code: 'email_send_uncertain' }],
			email_state: 'waiting'
		});
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(stuck);
		retryMock.mockResolvedValue(APPROVED);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Retry setup' }));
		expect(screen.getByTestId('onboarding-email-uncertain')).toBeTruthy();
		// Operator sentence up front; the raw error only under "Technical details".
		expect(screen.getByTestId('onboarding-step-summary').textContent).toMatch(
			/may or may not have gone out/
		);
		const raw = screen.getByTestId('onboarding-step-error');
		expect(raw.textContent).toBe('timeout talking to mailer');
		expect(raw.closest('details')?.querySelector('summary')?.textContent).toBe('Technical details');
		expect(within(detail).queryByRole('button', { name: 'Approve' })).toBeNull();
		await fireEvent.click(within(detail).getByRole('button', { name: 'Retry setup' }));
		// Uncertain send ⇒ explicit confirm before a NEW email goes out.
		expect(retryMock).not.toHaveBeenCalled();
		const confirm = await screen.findByTestId('onboarding-retry-confirm');
		expect(confirm.textContent).toContain('link in any earlier email keeps working');
		await fireEvent.click(
			within(confirm).getByRole('button', { name: 'Retry and send a new email' })
		);
		expect(retryMock).toHaveBeenCalledWith('a1');
		expect((await screen.findByTestId('onboarding-notice')).textContent).toContain(
			'Setup finished'
		);
	});

	it('shows a decision error in operator language', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		approveMock.mockRejectedValue(new ApiError(409, 'Conflict', 'raw', 'approval_in_progress'));
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Approve' }));
		await fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
		const err = await screen.findByTestId('onboarding-action-error');
		expect(err.textContent).toContain('Another approval is in progress — try again in a minute.');
		expect(err.textContent).not.toContain('raw');
	});

	it('invites with the chosen language and opens the new request', async () => {
		inviteMock.mockResolvedValue({
			approval: { ...APPROVED, id: 'a2', source: 'invite', locale: 'de' },
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: [],
			reusedPending: false
		});
		render(Page);
		await screen.findByTestId('onboarding-list');
		const form = screen.getByTestId('onboarding-invite-form');
		const send = within(form).getByRole('button', { name: 'Send invitation' }) as HTMLButtonElement;
		const lang = within(form).getByLabelText('Email language') as HTMLSelectElement;
		expect(lang.value).toBe('en');
		expect([...lang.options].map((o) => o.value)).toEqual([
			'ar',
			'de',
			'en',
			'es',
			'fr',
			'he',
			'nl',
			'pl'
		]);
		expect(send.disabled).toBe(true);
		await fireEvent.input(within(form).getByLabelText('Email'), {
			target: { value: 'charles@example.com' }
		});
		await fireEvent.input(within(form).getByLabelText('Name'), {
			target: { value: 'Charles Babbage' }
		});
		await fireEvent.change(lang, { target: { value: 'de' } });
		expect(lang.value).toBe('de');
		expect(send.disabled).toBe(false);
		await fireEvent.click(send);
		expect(inviteMock).toHaveBeenCalledWith({
			email: 'charles@example.com',
			name: 'Charles Babbage',
			company: null,
			locale: 'de'
		});
		expect((await screen.findByTestId('invite-notice')).textContent).toContain(
			'Charles Babbage approved'
		);
		expect(replaceStateMock).toHaveBeenLastCalledWith('/admin/onboarding?signup=a2', {});
		expect(screen.getByTestId('onboarding-detail')).toBeTruthy();
	});

	it('pre-selects the server default LLM access and sends nothing unless changed', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		listMock.mockResolvedValue({ items: [row()], defaultLlmAccess: 'platform_only' });
		const result = {
			approval: { ...APPROVED, llm_access: 'platform_only' as const },
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: [],
			reusedPending: false
		};
		approveMock.mockResolvedValue(result);
		inviteMock.mockResolvedValue({ ...result, approval: { ...result.approval, id: 'a3' } });
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Approve' }));
		const approveSelect = within(
			screen.getByTestId('onboarding-approve-llm-access')
		).getByLabelText('Service access') as HTMLSelectElement;
		await waitFor(() => expect(approveSelect.value).toBe('platform_only'));
		const form = screen.getByTestId('onboarding-invite-form');
		const inviteSelect = within(form).getByLabelText('Service access') as HTMLSelectElement;
		expect(inviteSelect.value).toBe('platform_only');
		// Untouched: the approve carries no llmAccess — W2V_SIGNUP_LLM_ACCESS applies.
		await fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
		expect(approveMock).toHaveBeenCalledWith('a1', undefined, undefined);
		await fireEvent.input(within(form).getByLabelText('Email'), {
			target: { value: 'charles@example.com' }
		});
		await fireEvent.input(within(form).getByLabelText('Name'), {
			target: { value: 'Charles Babbage' }
		});
		await fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
		await screen.findByTestId('invite-notice');
		expect(inviteMock.mock.calls[0][0]).not.toHaveProperty('llmAccess');
		// Changed by the operator — even back to a non-default value — it is sent.
		await fireEvent.input(within(form).getByLabelText('Email'), {
			target: { value: 'ada2@example.com' }
		});
		await fireEvent.input(within(form).getByLabelText('Name'), { target: { value: 'Ada' } });
		await fireEvent.change(inviteSelect, { target: { value: 'local_allowed' } });
		await fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
		await waitFor(() => expect(inviteMock).toHaveBeenCalledTimes(2));
		expect(inviteMock.mock.calls[1][0]).toMatchObject({ llmAccess: 'local_allowed' });
		// After a send the select returns to the server default, untouched again.
		await waitFor(() => expect(inviteSelect.value).toBe('platform_only'));
	});

	it('invites with the chosen service access (byo_required is accepted)', async () => {
		inviteMock.mockResolvedValue({
			approval: { ...APPROVED, id: 'a3', source: 'invite', llm_access: 'byo_required' },
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: [],
			reusedPending: false
		});
		render(Page);
		await screen.findByTestId('onboarding-list');
		const form = screen.getByTestId('onboarding-invite-form');
		const llm = within(form).getByLabelText('Service access') as HTMLSelectElement;
		expect(llm.value).toBe('local_allowed');
		await fireEvent.input(within(form).getByLabelText('Email'), {
			target: { value: 'charles@example.com' }
		});
		await fireEvent.input(within(form).getByLabelText('Name'), {
			target: { value: 'Charles Babbage' }
		});
		await fireEvent.change(llm, { target: { value: 'byo_required' } });
		await fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
		expect(inviteMock).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'charles@example.com', llmAccess: 'byo_required' })
		);
		await screen.findByTestId('invite-notice');
		expect(llm.value).toBe('local_allowed');
		expect(screen.getByTestId('onboarding-llm-access').textContent).toContain(
			'Own providers required'
		);
	});

	it('blocks an invalid invite email', async () => {
		render(Page);
		await screen.findByTestId('onboarding-list');
		const form = screen.getByTestId('onboarding-invite-form');
		await fireEvent.input(within(form).getByLabelText('Email'), { target: { value: 'nope' } });
		await fireEvent.input(within(form).getByLabelText('Name'), { target: { value: 'X' } });
		expect(form.textContent).toContain('Enter a valid email address.');
		expect(
			(within(form).getByRole('button', { name: 'Send invitation' }) as HTMLButtonElement).disabled
		).toBe(true);
	});

	it('explains a 503 signup_not_configured instead of an error', async () => {
		listMock.mockRejectedValue(NOT_CONFIGURED);
		render(Page);
		const banner = await screen.findByTestId('onboarding-not-configured');
		expect(banner.textContent).toContain('Early-access sign-up is not enabled');
		expect(banner.textContent).not.toContain('W2V_SIGNUP_ENABLED');
		expect(screen.queryByTestId('error-state')).toBeNull();
		expect(
			(screen.getByRole('button', { name: 'Send invitation' }) as HTMLButtonElement).disabled
		).toBe(true);
	});

	it('shows a retryable error when the queue fails to load', async () => {
		listMock.mockRejectedValue(new ApiError(500, 'Internal Server Error', 'Traceback…'));
		render(Page);
		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load requests");
		expect(err.textContent).not.toContain('Traceback');
	});

	it('an in_flight email send also needs the confirm before Retry', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(
			row({
				...APPROVED,
				steps: {
					identity: { status: 'ok' },
					provision: { status: 'ok' },
					membership: { status: 'ok' },
					invite_email: { status: 'in_flight', code: 'email_sending' }
				},
				steps_not_ok: [{ step: 'invite_email', status: 'in_flight', code: 'email_sending' }],
				email_state: 'waiting'
			})
		);
		retryMock.mockResolvedValue(APPROVED);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Retry setup' }));
		expect(detail.textContent).toContain('Sending email');
		expect(screen.getByTestId('onboarding-email-uncertain')).toBeTruthy();
		await fireEvent.click(within(detail).getByRole('button', { name: 'Retry setup' }));
		const confirm = await screen.findByTestId('onboarding-retry-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
		expect(retryMock).not.toHaveBeenCalled();
	});

	it('a plain failed step with retries exhausted retries without a confirm', async () => {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(
			row({
				...APPROVED,
				steps: {
					identity: { status: 'ok' },
					provision: { status: 'ok' },
					membership: { status: 'failed', code: 'membership_failed', error: 'X' },
					invite_email: { status: 'waiting', code: 'waiting_for_steps' }
				},
				steps_not_ok: [
					{ step: 'membership', status: 'failed', code: 'membership_failed' },
					{ step: 'invite_email', status: 'waiting', code: 'waiting_for_steps' }
				],
				steps_attempts: 10,
				steps_next_attempt_at: null,
				email_state: 'waiting'
			})
		);
		retryMock.mockResolvedValue(APPROVED);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Retry setup' }));
		expect(detail.textContent).toContain('Failed — retry manually');
		expect(detail.textContent).not.toContain('will be retried');
		await fireEvent.click(within(detail).getByRole('button', { name: 'Retry setup' }));
		expect(retryMock).toHaveBeenCalledWith('a1');
	});

	it('only the latest selection is shown; stale detail and action answers are dropped', async () => {
		const A = row({ id: 'a1', name: 'Ada Lovelace', email: 'ada@example.com' });
		const B = row({ id: 'b2', name: 'Bea Babbage', email: 'bea@example.com' });
		listMock.mockResolvedValue({ items: [A, B] });
		let resolveA!: (v: SignupApproval) => void;
		getMock.mockImplementation((id: string) =>
			id === 'a1'
				? new Promise<SignupApproval>((r) => (resolveA = r))
				: Promise.resolve({ ...B, company: 'Fresh B' })
		);
		render(Page);
		const list = await screen.findByTestId('onboarding-list');
		const [rowA, rowB] = within(list).getAllByRole('button');
		await fireEvent.click(rowA);
		await fireEvent.click(rowB);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => expect(detail.textContent).toContain('Fresh B'));
		// A's slow GET answers last — it must not replace B in the panel.
		resolveA({ ...A, company: 'Stale A' });
		await new Promise((r) => setTimeout(r, 0));
		expect(detail.textContent).toContain('Bea Babbage');
		expect(detail.textContent).not.toContain('Ada Lovelace');
		expect(detail.textContent).not.toContain('Stale A');

		// Approve B, but switch back to A before B's answer arrives.
		let resolveApprove!: (v: unknown) => void;
		approveMock.mockImplementation(() => new Promise((r) => (resolveApprove = r)));
		getMock.mockImplementation((id: string) => Promise.resolve(id === 'a1' ? A : B));
		await fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
		expect(approveMock).toHaveBeenCalledWith('b2', undefined, undefined);
		await fireEvent.click(rowA);
		await waitFor(() => expect(detail.textContent).toContain('Ada Lovelace'));
		resolveApprove({
			approval: { ...APPROVED, id: 'b2', name: 'Bea Babbage', email: 'bea@example.com' },
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: []
		});
		await new Promise((r) => setTimeout(r, 0));
		// The panel still shows A, undecided, with no notice from B's approval.
		expect(detail.textContent).toContain('Ada Lovelace');
		expect(screen.queryByTestId('onboarding-tenant')).toBeNull();
		expect(screen.queryByTestId('onboarding-notice')).toBeNull();
		expect(within(detail).getByRole('button', { name: 'Approve' })).toBeTruthy();
		// B left the pending queue all the same.
		await waitFor(() => expect(within(list).getAllByTestId('onboarding-row')).toHaveLength(1));
		// And acting now targets A, the selected row.
		approveMock.mockResolvedValue({
			approval: { ...APPROVED, id: 'a1' },
			tenantId: 't-1',
			tenant: { id: 't-1', name: 'Analytical Engines', slug: 'analytical-engines' },
			emailState: 'sent',
			stepsNotOk: []
		});
		await fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
		expect(approveMock).toHaveBeenLastCalledWith('a1', undefined, undefined);
	});

	it('an invite for someone who already has a workspace links to their request', async () => {
		inviteMock.mockRejectedValue(
			new ApiError(
				409,
				'Conflict',
				'ada@example.com already has an early-access workspace',
				'early_access_workspace_exists',
				undefined,
				null,
				{
					error: 'early_access_workspace_exists',
					detail: 'raw detail',
					signupId: 'old-1',
					tenantId: 't-old'
				}
			)
		);
		getMock.mockResolvedValue({ ...APPROVED, id: 'old-1' });
		render(Page);
		await screen.findByTestId('onboarding-list');
		const form = screen.getByTestId('onboarding-invite-form');
		await fireEvent.input(within(form).getByLabelText('Email'), {
			target: { value: 'ada@example.com' }
		});
		await fireEvent.input(within(form).getByLabelText('Name'), { target: { value: 'Ada' } });
		await fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
		const err = await screen.findByTestId('invite-error');
		expect(err.textContent).toContain('This person already has an early-access workspace');
		expect(err.textContent).not.toContain('raw detail');
		await fireEvent.click(screen.getByTestId('invite-open-existing'));
		expect(getMock).toHaveBeenCalledWith('old-1');
		expect(replaceStateMock).toHaveBeenLastCalledWith('/admin/onboarding?signup=old-1', {});
		await waitFor(() =>
			expect(screen.getByTestId('onboarding-tenant').textContent).toContain('Analytical Engines')
		);
	});

	// ── early-access removal ────────────────────────────────────────────────

	function removedRow(over: Partial<SignupApproval> = {}): SignupApproval {
		return row({
			...APPROVED,
			status: 'removed',
			removal: {
				state: 'done',
				attempts: 1,
				requested_at: '2026-10-21T00:00:00+00:00',
				requested_via: 'admin',
				tenant_slug: 'analytical-engines',
				steps: [
					{ step: 'blockers', status: 'ok' },
					{ step: 'close_access', status: 'ok' },
					{ step: 'licences', status: 'ok' },
					{ step: 'identity', status: 'ok', code: 'deleted' },
					{ step: 'export', status: 'ok' },
					{ step: 'tenant_delete', status: 'ok' },
					{ step: 'licences_archive', status: 'ok' },
					{ step: 'finalize', status: 'ok' }
				],
				blockers: [],
				last_error: null,
				legacy_identity: null,
				allow_credentialed_delete: false,
				resolved: null,
				finished_at: '2026-10-21T00:01:00+00:00',
				next_attempt_at: null
			},
			...over
		});
	}

	async function openApproved(r: SignupApproval): Promise<HTMLElement> {
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(r);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() =>
			within(detail).getByRole('button', { name: 'Remove early-access workspace' })
		);
		return detail;
	}

	it('removes an approved workspace only after the slug is typed back', async () => {
		const detail = await openApproved({ ...APPROVED, has_identity_step: true });
		const queued = removedRow();
		queued.removal = { ...queued.removal!, state: 'pending', attempts: 0, steps: [] };
		removeMock.mockResolvedValue(queued);
		await fireEvent.click(
			within(detail).getByRole('button', { name: 'Remove early-access workspace' })
		);
		const dialog = await screen.findByTestId('onboarding-remove-confirm');
		expect(within(dialog).queryByTestId('onboarding-remove-legacy')).toBeNull();
		// Accurate on every run: "without changing anything" holds only before the first change.
		expect(dialog.textContent).not.toContain('It stops — without changing anything — if');
		expect(within(dialog).getByTestId('onboarding-remove-stop-note').textContent).toContain(
			'what was already done'
		);
		const submit = within(dialog).getByRole('button', { name: 'Remove workspace' });
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		const slug = within(dialog).getByLabelText('Type analytical-engines to confirm');
		await fireEvent.input(slug, { target: { value: 'analytical' } });
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.input(slug, { target: { value: 'analytical-engines' } });
		expect((submit as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() =>
			expect(removeMock).toHaveBeenCalledWith('a1', {
				confirm: 'analytical-engines',
				legacy_identity: undefined,
				allow_credentialed_delete: undefined
			})
		);
		// 202: only QUEUED — the page says so, then polls until the background pass finished.
		expect((await screen.findByTestId('onboarding-notice')).textContent).toContain('queued');
		expect((await screen.findByTestId('onboarding-removal-progress')).textContent).toContain(
			'Queued'
		);
		getMock.mockResolvedValue(removedRow());
		await waitFor(() =>
			expect(screen.getByTestId('onboarding-notice').textContent).toContain(
				'login deleted; the export archive and the personal data were erased'
			)
		);
		expect(screen.queryByTestId('onboarding-removal-progress')).toBeNull();
		const panel = screen.getByTestId('onboarding-removal');
		expect(within(panel).getAllByTestId('onboarding-removal-step')).toHaveLength(8);
		expect(panel.textContent).toContain('The login was deleted.');
		expect(screen.queryByRole('button', { name: 'Remove early-access workspace' })).toBeNull();
	});

	it('a legacy approval needs the login id and evidence before it can be removed', async () => {
		const detail = await openApproved({
			...APPROVED,
			has_identity_step: false,
			needs_legacy_identity: true
		});
		removeMock.mockResolvedValue(removedRow());
		await fireEvent.click(
			within(detail).getByRole('button', { name: 'Remove early-access workspace' })
		);
		const dialog = await screen.findByTestId('onboarding-remove-confirm');
		within(dialog).getByTestId('onboarding-remove-legacy');
		expect(within(dialog).getByTestId('onboarding-evidence-fingerprint').textContent).toContain(
			'Stored as a fingerprint only'
		);
		const submit = within(dialog).getByRole('button', { name: 'Remove workspace' });
		await fireEvent.input(within(dialog).getByLabelText('Type analytical-engines to confirm'), {
			target: { value: 'analytical-engines' }
		});
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.input(within(dialog).getByLabelText('Login user id'), {
			target: { value: '4c51c243-ce57-4034-acab-709c4c391e40' }
		});
		await fireEvent.input(within(dialog).getByLabelText('How you know it is theirs'), {
			target: { value: 'provisioning log line' }
		});
		await fireEvent.click(within(dialog).getByRole('checkbox'));
		expect((submit as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() =>
			expect(removeMock).toHaveBeenCalledWith('a1', {
				confirm: 'analytical-engines',
				legacy_identity: {
					user_id: '4c51c243-ce57-4034-acab-709c4c391e40',
					evidence: 'provisioning log line'
				},
				allow_credentialed_delete: true
			})
		);
	});

	it('a removal queued for over 15 minutes shows a warning', async () => {
		const stale = removedRow();
		stale.removal = { ...stale.removal!, state: 'pending', attempts: 0, steps: [], stale: true };
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(stale);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		const warning = await within(detail).findByTestId('onboarding-removal-stale');
		expect(warning.textContent).toContain('more than 15 minutes');
		expect(warning.getAttribute('role')).toBe('alert');
	});

	it('a fresh queued removal shows no stale warning', async () => {
		const queued = removedRow();
		queued.removal = { ...queued.removal!, state: 'pending', attempts: 0, steps: [], stale: false };
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(queued);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await within(detail).findByTestId('onboarding-removal-progress');
		expect(within(detail).queryByTestId('onboarding-removal-stale')).toBeNull();
	});

	it('a blocked removal shows why, and offers Retry and Close by hand', async () => {
		const blocked = removedRow();
		blocked.removal = {
			...blocked.removal!,
			state: 'blocked',
			steps: [{ step: 'blockers', status: 'blocked', code: 'other_member' }],
			blockers: [{ code: 'other_member', message: '1 other active member(s) use this workspace' }]
		};
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(blocked);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		const blockers = await within(detail).findByTestId('onboarding-removal-blockers');
		expect(blockers.textContent).toContain('Someone other than the requester');
		expect(within(detail).getByText('Removal stopped')).toBeTruthy();
		retryRemovalMock.mockResolvedValue(removedRow());
		await fireEvent.click(within(detail).getByRole('button', { name: 'Retry removal' }));
		await waitFor(() => expect(retryRemovalMock).toHaveBeenCalledWith('a1', undefined));
		expect((await screen.findByTestId('onboarding-notice')).textContent).toContain('removed');
	});

	it('closing a removal by hand needs a note and the acknowledgement', async () => {
		const failed = removedRow();
		failed.removal = {
			...failed.removal!,
			state: 'failed',
			attempts: 10,
			steps: [
				{ step: 'blockers', status: 'ok' },
				{ step: 'close_access', status: 'ok' }
			]
		};
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(failed);
		const resolved = removedRow();
		resolved.removal = {
			...failed.removal,
			state: 'resolved_manually',
			resolved: {
				at: '2026-10-21T01:00:00+00:00',
				by: 'x',
				note_sha256: 'a'.repeat(64),
				note_length: 24
			}
		};
		resolveRemovalMock.mockResolvedValue(resolved);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		await waitFor(() => within(detail).getByRole('button', { name: 'Close by hand' }));
		expect(detail.textContent).toContain('stopped after 10 attempts');
		await fireEvent.click(within(detail).getByRole('button', { name: 'Close by hand' }));
		const dialog = await screen.findByTestId('onboarding-resolve-confirm');
		const warning = within(dialog).getByTestId('onboarding-resolve-erase-warning').textContent;
		expect(warning).toContain('erases the requester’s name and email');
		expect(warning).toContain('fingerprint only');
		const submit = within(dialog).getByRole('button', { name: 'Close the removal' });
		await fireEvent.input(within(dialog).getByLabelText('What you did'), {
			target: { value: 'licences revoked by hand' }
		});
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(within(dialog).getByRole('checkbox'));
		expect((submit as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() =>
			expect(resolveRemovalMock).toHaveBeenCalledWith('a1', 'licences revoked by hand')
		);
		const shown = (await screen.findByTestId('onboarding-removal-resolved')).textContent ?? '';
		expect(shown).toContain('fingerprint only (24 characters)');
		expect(shown).not.toContain('licences revoked by hand');
	});

	it('a removal refusal reads in operator language', async () => {
		const detail = await openApproved({ ...APPROVED, has_identity_step: true });
		removeMock.mockRejectedValue(
			new ApiError(422, 'Unprocessable', 'raw', 'confirmation_mismatch')
		);
		await fireEvent.click(
			within(detail).getByRole('button', { name: 'Remove early-access workspace' })
		);
		const dialog = await screen.findByTestId('onboarding-remove-confirm');
		await fireEvent.input(within(dialog).getByLabelText('Type analytical-engines to confirm'), {
			target: { value: 'analytical-engines' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove workspace' }));
		expect((await screen.findByTestId('onboarding-action-error')).textContent).toContain(
			'Type the workspace slug exactly'
		);
	});

	it('a forced admin delete stops the removal with its own explanation', async () => {
		const blocked = removedRow();
		blocked.removal = {
			...blocked.removal!,
			state: 'blocked',
			steps: [
				{ step: 'blockers', status: 'ok' },
				{ step: 'tenant_delete', status: 'blocked', code: 'forced_job_exists' }
			],
			blockers: [{ code: 'forced_job_exists', message: 'an earlier admin delete was FORCED' }]
		};
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(blocked);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		const blockers = await within(detail).findByTestId('onboarding-removal-blockers');
		expect(blockers.textContent).toContain('never continues a forced delete');
		within(detail).getByRole('button', { name: 'Retry removal' });
		within(detail).getByRole('button', { name: 'Close by hand' });
	});

	it('a legacy login refused in the safety checks offers the correction on Retry', async () => {
		const blocked = removedRow({ has_identity_step: false });
		blocked.removal = {
			...blocked.removal!,
			state: 'blocked',
			steps: [{ step: 'blockers', status: 'blocked', code: 'legacy_identity_mismatch' }],
			blockers: [{ code: 'legacy_identity_mismatch', message: 'not the address login' }]
		};
		pageState = { url: new URL('http://localhost/admin/onboarding?signup=a1') };
		getMock.mockResolvedValue(blocked);
		render(Page);
		const detail = await screen.findByTestId('onboarding-detail');
		const fix = await within(detail).findByTestId('onboarding-removal-legacy-fix');
		await fireEvent.input(within(fix).getByLabelText('Login user id'), {
			target: { value: '4c51c243-ce57-4034-acab-709c4c391e40' }
		});
		await fireEvent.input(within(fix).getByLabelText('How you know it is theirs'), {
			target: { value: 'provisioning log line' }
		});
		const queued = removedRow();
		queued.removal = { ...queued.removal!, state: 'pending', attempts: 0, steps: [] };
		retryRemovalMock.mockResolvedValue(queued);
		await fireEvent.click(within(detail).getByRole('button', { name: 'Retry removal' }));
		await waitFor(() =>
			expect(retryRemovalMock).toHaveBeenCalledWith('a1', {
				legacy_identity: {
					user_id: '4c51c243-ce57-4034-acab-709c4c391e40',
					evidence: 'provisioning log line'
				},
				allow_credentialed_delete: false
			})
		);
		expect((await screen.findByTestId('onboarding-notice')).textContent).toContain('queued');
	});
});

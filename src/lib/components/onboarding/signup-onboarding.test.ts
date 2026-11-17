import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client.js';
import {
	NOT_CONFIGURED_MESSAGE,
	canDecide,
	canRetry,
	emailUncertain,
	existingSignupId,
	invalidFields,
	isNotConfigured,
	stepErrorSummary,
	stepStatusView,
	isValidEmail,
	localeLabel,
	parseFilter,
	requestStatusView,
	signupErrorMessage,
	sourceLabel,
	stepRows
} from './signup-onboarding.js';

describe('signup onboarding view logic', () => {
	it('parseFilter defaults to pending and accepts only known filters', () => {
		expect(parseFilter(null)).toBe('pending');
		expect(parseFilter('bogus')).toBe('pending');
		expect(parseFilter('needs_attention')).toBe('needs_attention');
		expect(parseFilter('rejected')).toBe('rejected');
	});

	it('stepRows lists every step in run order, filling missing ones as not started', () => {
		const rows = stepRows({
			steps: {
				identity: { status: 'ok', code: null },
				provision: { status: 'ok', code: null },
				invite_email: { status: 'failed', code: 'x', error: 'smtp down' }
			}
		});
		expect(rows.map((r) => [r.step, r.status])).toEqual([
			['identity', 'ok'],
			['provision', 'ok'],
			['membership', 'pending'],
			['invite_email', 'failed']
		]);
		expect(rows[0].label).toBe('Login account');
		expect(rows[1].statusLabel).toBe('Done');
		expect(rows[2].statusLabel).toBe('Not started');
		expect(rows[3].tone).toBe('danger');
		expect(rows[3].error).toBe('smtp down');
	});

	it('requestStatusView distinguishes approved from approved-but-unfinished', () => {
		const base = { approving: false, steps_not_ok: [] };
		expect(requestStatusView({ ...base, status: 'pending' }).label).toBe('Waiting for review');
		expect(requestStatusView({ ...base, status: 'rejected' }).label).toBe('Declined');
		expect(requestStatusView({ ...base, status: 'approved' }).label).toBe('Approved');
		expect(
			requestStatusView({
				...base,
				status: 'approved',
				steps_not_ok: [{ step: 'invite_email', status: 'failed', code: null }]
			}).label
		).toBe('Needs attention');
		expect(requestStatusView({ ...base, status: 'pending', approving: true }).label).toBe(
			'Approving…'
		);
	});

	it('canDecide only for an undecided request not being approved right now', () => {
		expect(canDecide({ status: 'pending', approving: false })).toBe(true);
		expect(canDecide({ status: 'pending', approving: true })).toBe(false);
		expect(canDecide({ status: 'approved', approving: false })).toBe(false);
		expect(canDecide({ status: 'rejected', approving: false })).toBe(false);
	});

	it('canRetry only for an approved request whose steps are not all done', () => {
		const notOk = [{ step: 'membership', status: 'failed' as const, code: null }];
		expect(canRetry({ status: 'approved', approving: false, steps_not_ok: notOk })).toBe(true);
		expect(canRetry({ status: 'approved', approving: false, steps_not_ok: [] })).toBe(false);
		expect(canRetry({ status: 'pending', approving: false, steps_not_ok: notOk })).toBe(false);
		expect(canRetry({ status: 'approved', approving: true, steps_not_ok: notOk })).toBe(false);
	});

	it('emailUncertain flags an unknown welcome-email send', () => {
		expect(emailUncertain({ steps: { invite_email: { status: 'unknown' } } })).toBe(true);
		// core.UNCERTAIN_SEND = (unknown, in_flight): a send that never reported back.
		expect(emailUncertain({ steps: { invite_email: { status: 'in_flight' } } })).toBe(true);
		expect(emailUncertain({ steps: { invite_email: { status: 'failed' } } })).toBe(false);
		expect(emailUncertain({ steps: {} })).toBe(false);
	});

	it('labels: locale endonyms, sources, unknown values passed through', () => {
		expect(localeLabel('nl')).toBe('Nederlands (Dutch)');
		expect(localeLabel(null)).toBe('English');
		expect(localeLabel('xx')).toBe('xx');
		expect(sourceLabel('web')).toBe('Website form');
		expect(sourceLabel('invite')).toBe('Invited by you');
		expect(sourceLabel('carrier-pigeon')).toBe('carrier-pigeon');
	});

	it('isValidEmail mirrors the server check', () => {
		expect(isValidEmail(' ada@example.com ')).toBe(true);
		expect(isValidEmail('ada@example')).toBe(false);
		expect(isValidEmail('a da@example.com')).toBe(false);
		expect(isValidEmail('')).toBe(false);
	});

	it('signupErrorMessage: not-configured, known codes, then status fallbacks', () => {
		const nc = new ApiError(503, 'Service Unavailable', 'raw', 'signup_not_configured');
		expect(isNotConfigured(nc)).toBe(true);
		expect(isNotConfigured(new Error('x'))).toBe(false);
		expect(signupErrorMessage(nc, 'fb')).toBe(NOT_CONFIGURED_MESSAGE);
		expect(
			signupErrorMessage(new ApiError(400, 'Bad', 'raw', 'approval_not_pending'), 'fb')
		).toMatch(/already been decided/);
		expect(signupErrorMessage(new ApiError(403, 'Forbidden', 'raw'), 'fb')).toMatch(/super-admin/);
		expect(signupErrorMessage(new ApiError(422, 'Unprocessable', 'raw'), 'fb')).toMatch(
			/not valid/
		);
		const s500 = signupErrorMessage(new ApiError(502, 'Bad Gateway', 'raw internal'), 'Could not.');
		expect(s500).toContain('Could not.');
		expect(s500).not.toContain('raw internal');
		expect(signupErrorMessage('weird', 'fb')).toBe('fb');
	});

	it('labels the in_flight email step for an operator', () => {
		const v = stepStatusView('in_flight');
		expect(v.label).toMatch(/^Sending email/);
		expect(v.tone).toBe('warning');
		const [, , , email] = stepRows({
			steps: { invite_email: { status: 'in_flight', code: 'email_sending' } },
			steps_next_attempt_at: null,
			steps_attempts: 0
		});
		expect(email.statusLabel).toMatch(/^Sending email/);
		expect(email.summary).toMatch(/may or may not have gone out/);
	});

	it('failed reads "will be retried" only while the backend still schedules a retry', () => {
		const failed = { invite_email: { status: 'failed' as const, code: 'x' } };
		expect(
			stepRows({
				steps: failed,
				steps_next_attempt_at: '2026-10-20T12:00:00+00:00',
				steps_attempts: 3
			})[3].statusLabel
		).toBe('Failed — will be retried');
		// Retries exhausted: the backend nulls steps_next_attempt_at.
		expect(
			stepRows({ steps: failed, steps_next_attempt_at: null, steps_attempts: 10 })[3].statusLabel
		).toBe('Failed — retry manually');
		// Defensive: attempts at the max even if a timestamp is still present.
		expect(
			stepRows({
				steps: failed,
				steps_next_attempt_at: '2026-10-20T12:00:00+00:00',
				steps_attempts: 10
			})[3].statusLabel
		).toBe('Failed — retry manually');
		expect(stepStatusView('failed', { steps_next_attempt_at: null, steps_attempts: 0 }).label).toBe(
			'Failed — retry manually'
		);
	});

	it('step errors get an operator sentence; the raw text stays separate', () => {
		const rows = stepRows({
			steps: {
				identity: { status: 'ok' },
				provision: {
					status: 'failed',
					code: 'licence_not_entitled',
					error: 'licence state=suspended'
				},
				membership: { status: 'failed', code: 'membership_failed_500', error: 'Boom: 500' }
			},
			steps_next_attempt_at: null,
			steps_attempts: 0
		});
		expect(rows[0].summary).toBeNull(); // done: nothing to explain
		expect(rows[1].summary).toMatch(/does not give access to Studio/);
		expect(rows[1].summary).not.toContain('suspended');
		expect(rows[1].error).toBe('licence state=suspended');
		expect(rows[2].summary).toBe('The person could not be added as workspace admin.');
		expect(rows[3].summary).toBeNull(); // not started: nothing to explain
		expect(stepErrorSummary('invite_email', 'unknown', null)).toMatch(/may or may not/);
		expect(stepErrorSummary('invite_email', 'failed', 'frontend_url_unset')).toMatch(/web address/);
	});

	it('identity step codes get operator sentences; the raw text stays under technical details', () => {
		const rows = stepRows({
			steps: {
				identity: {
					status: 'failed',
					code: 'identity_exists',
					error: 'a@b.c already has a login that this approval did not create'
				},
				invite_email: { status: 'waiting', code: 'waiting_for_steps' }
			},
			steps_next_attempt_at: null,
			steps_attempts: 0
		});
		expect(rows[0].label).toBe('Login account');
		expect(rows[0].summary).toBe(
			'This email already has a login that this request didn’t create — sign-in can’t be set up automatically. Remove or merge that account, then Retry.'
		);
		expect(rows[0].error).toContain('did not create');
		expect(rows[3].summary).toBeNull(); // waiting: nothing to explain
		for (const code of ['identity_failed', 'identity_attr_dropped', 'identity_not_owned']) {
			const msg = stepErrorSummary('identity', 'failed', code);
			expect(msg).not.toBe('The login account could not be created.');
			expect(msg).not.toContain(code);
		}
		expect(stepErrorSummary('identity', 'failed', 'identity_attr_dropped')).toMatch(/marker/);
		expect(stepErrorSummary('invite_email', 'failed', 'identity_not_owned')).toMatch(
			/no welcome email/
		);
		expect(stepErrorSummary('identity', 'failed', 'identity_gone')).toMatch(/was deleted/);
		expect(stepErrorSummary('invite_email', 'failed', 'seat_removed')).toMatch(
			/removed from the workspace after approval/
		);
		expect(stepErrorSummary('invite_email', 'failed', 'invite_email_failed')).toMatch(
			/refused to send/
		);
		expect(stepErrorSummary('identity', 'failed', 'something_new')).toBe(
			'The login account could not be created.'
		);
	});

	it('409s on invite / approve read as plain sentences; the existing request id is exposed', () => {
		const exists = new ApiError(
			409,
			'Conflict',
			'ada@example.com already has an early-access workspace ("A", a)...',
			'early_access_workspace_exists',
			undefined,
			null,
			{
				error: 'early_access_workspace_exists',
				detail: '...',
				signupId: 'sig-old',
				tenantId: 't-old'
			}
		);
		expect(signupErrorMessage(exists, 'fb')).toBe(
			'This person already has an early-access workspace.'
		);
		expect(existingSignupId(exists)).toBe('sig-old');
		expect(existingSignupId(new ApiError(409, 'Conflict', 'x', 'approval_in_progress'))).toBeNull();
		expect(existingSignupId(new Error('x'))).toBeNull();
		expect(
			signupErrorMessage(new ApiError(409, 'Conflict', 'raw', 'approval_in_progress'), 'fb')
		).toBe('Another approval is in progress — try again in a minute.');
	});

	it('a 422 names the invalid fields from the FastAPI detail list', () => {
		const err = new ApiError(
			422,
			'Unprocessable',
			'email: Value error...',
			undefined,
			undefined,
			null,
			{
				detail: [
					{ type: 'value_error', loc: ['body', 'email'], msg: 'Value error, not an email address' },
					{ type: 'string_too_short', loc: ['body', 'tenantName'], msg: 'too short' },
					{ type: 'value_error', loc: ['body', 'email'], msg: 'dup' }
				]
			}
		);
		expect(invalidFields(err)).toEqual(['Email', 'Workspace name']);
		expect(signupErrorMessage(err, 'fb')).toBe(
			'These details are not valid: Email, Workspace name. Check and try again.'
		);
		const one = new ApiError(422, 'U', 'x', undefined, undefined, null, {
			detail: [{ loc: ['body', 'locale'], msg: 'bad' }]
		});
		expect(signupErrorMessage(one, 'fb')).toBe(
			'This detail is not valid: Email language. Check and try again.'
		);
		expect(invalidFields(new ApiError(400, 'B', 'x'))).toEqual([]);
	});
});

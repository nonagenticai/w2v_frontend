import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client.js';
import {
	REMOVAL_STEPS,
	type SignupApproval,
	type SignupRemoval
} from '$lib/api/signup-approvals.js';
import {
	FILTER_ITEMS,
	REMOVAL_CODE_MESSAGES,
	canRemove,
	canResolveRemoval,
	canRetryRemoval,
	isUuid,
	legacyLoginCorrectable,
	parseFilter,
	removalCodeMessage,
	removalInFlight,
	removalProgressText,
	removalStaleText,
	EVIDENCE_FINGERPRINT_NOTE,
	REMOVE_STOP_NOTE,
	RESOLVE_ERASE_WARNING,
	removalDoneNotice,
	removalLoginOutcome,
	resolvedText,
	removalStepRows,
	removeConfirmReady,
	requestStatusView,
	signupErrorMessage
} from './signup-onboarding.js';

function removal(over: Partial<SignupRemoval> = {}): SignupRemoval {
	return {
		state: 'pending',
		attempts: 1,
		requested_at: null,
		requested_via: null,
		tenant_slug: 'acme',
		steps: [],
		blockers: [],
		last_error: null,
		legacy_identity: null,
		allow_credentialed_delete: false,
		resolved: null,
		finished_at: null,
		next_attempt_at: null,
		...over
	};
}

type Row = Pick<SignupApproval, 'status' | 'approving' | 'removal' | 'steps_not_ok'>;
const row = (over: Partial<Row> = {}): Row => ({
	status: 'removed',
	approving: false,
	removal: removal(),
	steps_not_ok: [],
	...over
});

describe('early-access removal view logic', () => {
	it('offers a Removed filter tab', () => {
		expect(FILTER_ITEMS.map((f) => f.value)).toContain('removed');
		expect(parseFilter('removed')).toBe('removed');
	});

	it('Remove is offered only on an approved request that is not being approved', () => {
		expect(canRemove({ status: 'approved', approving: false })).toBe(true);
		expect(canRemove({ status: 'approved', approving: true })).toBe(false);
		expect(canRemove({ status: 'pending', approving: false })).toBe(false);
		expect(canRemove({ status: 'removed', approving: false })).toBe(false);
	});

	it('Retry runs pending / blocked / failed removals; Resolve only blocked / failed', () => {
		for (const state of ['pending', 'blocked', 'failed'] as const)
			expect(canRetryRemoval(row({ removal: removal({ state }) }))).toBe(true);
		for (const state of ['done', 'resolved_manually'] as const)
			expect(canRetryRemoval(row({ removal: removal({ state }) }))).toBe(false);
		expect(canResolveRemoval(row({ removal: removal({ state: 'pending' }) }))).toBe(false);
		expect(canResolveRemoval(row({ removal: removal({ state: 'blocked' }) }))).toBe(true);
		expect(canResolveRemoval(row({ removal: removal({ state: 'failed' }) }))).toBe(true);
		expect(canRetryRemoval(row({ status: 'approved', removal: null }))).toBe(false);
	});

	it('a removed request reads its removal state as the badge', () => {
		expect(requestStatusView(row({ removal: removal({ state: 'done' }) })).label).toBe('Removed');
		expect(requestStatusView(row({ removal: removal({ state: 'blocked' }) }))).toEqual({
			label: 'Removal stopped',
			tone: 'danger'
		});
		expect(requestStatusView(row({ removal: removal({ state: 'pending' }) })).label).toBe(
			'Removing…'
		);
	});

	it('removalStepRows lists every step in run order with operator copy for each code', () => {
		const rows = removalStepRows({
			removal: removal({
				steps: [
					{ step: 'blockers', status: 'ok' },
					{ step: 'close_access', status: 'ok' },
					{ step: 'licences', status: 'pending', code: 'licence_failed', error: 'refused 1 of 3' }
				]
			})
		});
		expect(rows.map((r) => r.step)).toEqual([...REMOVAL_STEPS]);
		expect(rows[2]).toMatchObject({
			status: 'pending',
			statusLabel: 'Not finished — will be retried',
			error: 'refused 1 of 3'
		});
		expect(rows[2].summary).toMatch(/licence/);
		expect(rows[3]).toMatchObject({ status: 'waiting', statusLabel: 'Not started', summary: null });
	});

	it('every backend removal code has operator copy', () => {
		// The codes services/signup/removal.py records (blockers + step codes).
		for (const code of [
			'other_member',
			'foreign_invite',
			'tenant_content',
			'active_runs',
			'tenant_mismatch',
			'tenant_not_provisioned',
			'blockers_failed',
			'close_access_failed',
			'licence_failed',
			'dependency_still_required',
			'dependency_release_unsupported',
			'licence_archive_failed',
			'identity_failed',
			'deleted',
			'disabled',
			'disabled_unmarked',
			'absent',
			'no_identity',
			'identity_not_owned',
			'identity_kept_in_use',
			'legacy_identity_mismatch',
			'legacy_identity_window',
			'legacy_identity_foreign',
			'export_failed',
			'export_exists',
			'storage_unavailable',
			'in_progress',
			'tenant_delete_failed',
			'tenant_delete_blocked',
			'already_deleted',
			'tenant_deleted',
			'finalize_failed',
			'forced_job_exists'
		])
			expect(REMOVAL_CODE_MESSAGES[code], code).toBeTruthy();
	});

	it('every removal route error reads in operator language', () => {
		for (const code of [
			'confirmation_mismatch',
			'removal_exists',
			'legacy_identity_required',
			'legacy_identity_not_applicable',
			'removal_not_found',
			'removal_not_retryable',
			'removal_in_progress',
			'removal_not_resolvable',
			'acknowledgement_required',
			'identity_step_done',
			'early_access_removal_in_progress',
			'removal_worker_disabled'
		]) {
			const msg = signupErrorMessage(new ApiError(409, 'x', 'raw detail', code), 'fallback');
			expect(msg, code).not.toBe('raw detail');
			expect(msg, code).not.toBe('fallback');
		}
	});

	it('the confirmation needs the exact slug, plus a login id and evidence for a legacy row', () => {
		const stamped = { tenant_slug: 'acme', needs_legacy_identity: false };
		expect(removeConfirmReady(stamped, 'acm', '', '')).toBe(false);
		expect(removeConfirmReady(stamped, ' acme ', '', '')).toBe(true);
		const legacy = { tenant_slug: 'acme', needs_legacy_identity: true };
		const uid = '4c51c243-ce57-4034-acab-709c4c391e40';
		expect(removeConfirmReady(legacy, 'acme', '', '')).toBe(false);
		expect(removeConfirmReady(legacy, 'acme', 'not-a-uuid', 'log line')).toBe(false);
		expect(removeConfirmReady(legacy, 'acme', uid, '')).toBe(false);
		expect(removeConfirmReady(legacy, 'acme', uid, 'log line')).toBe(true);
		expect(removeConfirmReady({ tenant_slug: null }, '', '', '')).toBe(false);
		expect(isUuid(uid)).toBe(true);
	});

	it('a forced admin delete reads as an operator decision, not a retry', () => {
		expect(removalCodeMessage('forced_job_exists')).toContain('forced');
		expect(removalCodeMessage('forced_job_exists')).toContain('Retry');
	});

	it('a queued removal says it is queued; a running one says so; a retry names the attempt', () => {
		expect(removalProgressText(removal({ attempts: 0 }))).toContain('Queued');
		expect(removalProgressText(removal({ attempts: 1, running: true }))).toContain('Running now');
		expect(
			removalProgressText(removal({ attempts: 2, next_attempt_at: '2026-10-21T10:00:00+00:00' }))
		).toContain('Attempt 2 did not finish');
		expect(removalProgressText(removal({ state: 'done' }))).toBeNull();
	});

	it('a removal queued for more than 15 minutes warns that nothing picked it up', () => {
		expect(removalStaleText(removal({ state: 'pending', stale: true }))).toContain('15 minutes');
		expect(removalStaleText(removal({ state: 'pending', stale: false }))).toBeNull();
		expect(removalStaleText(removal({ state: 'pending' }))).toBeNull();
		expect(removalStaleText(removal({ state: 'done', stale: true }))).toBeNull();
	});

	it('the evidence note says it is kept as a fingerprint only', () => {
		expect(EVIDENCE_FINGERPRINT_NOTE).toContain('fingerprint only');
	});

	it('only a pending removal is polled', () => {
		const r = { status: 'removed' } as SignupApproval;
		expect(removalInFlight({ ...r, removal: removal({ state: 'pending' }) })).toBe(true);
		for (const state of ['blocked', 'failed', 'done', 'resolved_manually'] as const)
			expect(removalInFlight({ ...r, removal: removal({ state }) })).toBe(false);
		expect(removalInFlight({ status: 'approved', removal: null } as SignupApproval)).toBe(false);
	});

	it('a legacy login refused in the safety checks can be corrected', () => {
		const base = { status: 'removed', has_identity_step: false } as SignupApproval;
		const blocked = removal({
			state: 'blocked',
			blockers: [{ code: 'legacy_identity_mismatch', message: 'x' }],
			steps: [{ step: 'blockers', status: 'blocked', code: 'legacy_identity_mismatch' }]
		});
		expect(legacyLoginCorrectable({ ...base, removal: blocked })).toBe(true);
		expect(legacyLoginCorrectable({ ...base, has_identity_step: true, removal: blocked })).toBe(
			false
		);
		const other = removal({
			state: 'blocked',
			blockers: [{ code: 'other_member', message: 'x' }],
			steps: [{ step: 'blockers', status: 'blocked', code: 'other_member' }]
		});
		expect(legacyLoginCorrectable({ ...base, removal: other })).toBe(false);
	});

	it('the done notice says what happened to the login, like Telegram', () => {
		const withIdentity = (code: string | null) =>
			removal({
				state: 'done',
				steps: [{ step: 'identity', status: code === null ? 'skipped' : 'ok', code }]
			});
		expect(removalDoneNotice(withIdentity('deleted'))).toContain('login deleted');
		expect(removalDoneNotice(withIdentity('identity_kept_in_use'))).toContain(
			'login KEPT (another workspace uses it)'
		);
		expect(removalDoneNotice(withIdentity('identity_not_owned'))).toContain('login KEPT');
		expect(removalDoneNotice(withIdentity('disabled'))).toContain('switched off');
		expect(removalLoginOutcome(withIdentity('weird'))).toBe('login: unknown outcome (weird)');
		expect(removalLoginOutcome(removal({ steps: [] }))).toBe('login: unknown outcome (none)');
		expect(removalDoneNotice(withIdentity('identity_kept_in_use'))).not.toContain('deleted');
		expect(removalDoneNotice(withIdentity('deleted'))).toContain('export archive');
	});

	it('Resolve warns the name and email are erased and the note is a fingerprint', () => {
		expect(RESOLVE_ERASE_WARNING).toContain('erases the requester’s name and email');
		expect(RESOLVE_ERASE_WARNING).toContain('fingerprint only');
		const text = resolvedText({
			at: '2026-10-21T01:00:00+00:00',
			by: 'x',
			note_sha256: 'b'.repeat(64),
			note_length: 12
		});
		expect(text).toContain('fingerprint only (12 characters)');
	});

	it('the Remove dialog never claims a retry stops without changing anything', () => {
		expect(REMOVE_STOP_NOTE).toContain('Before its first change');
		expect(REMOVE_STOP_NOTE).toContain('stays done');
	});

	it('an export purge failure reads in operator language', () => {
		expect(removalCodeMessage('export_purge_failed')).toContain('export archive');
	});
});

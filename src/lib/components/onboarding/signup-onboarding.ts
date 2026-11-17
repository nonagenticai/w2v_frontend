// Pure view logic for the early-access onboarding screen
// (`(platform)/admin/onboarding`). Kept out of the component so labels, the
// action gates and the error copy are unit-testable without a DOM.

import { ApiError } from '$lib/api/client.js';
import {
	REMOVAL_STEPS,
	SIGNUP_STEPS,
	STEPS_MAX_ATTEMPTS,
	UNCERTAIN_SEND,
	type RemovalState,
	type RemovalStepName,
	type RemovalStepStatus,
	type SignupRemoval,
	type SignupApproval,
	type SignupListFilter,
	type SignupLocale,
	type SignupStepName,
	type SignupStepStatus
} from '$lib/api/signup-approvals.js';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** The queue filter tabs, in display order. `pending` is the default. */
export const FILTER_ITEMS: ReadonlyArray<{ value: SignupListFilter; label: string }> = [
	{ value: 'pending', label: 'Waiting for review' },
	{ value: 'needs_attention', label: 'Needs attention' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Declined' },
	{ value: 'removed', label: 'Removed' }
];

export const DEFAULT_FILTER: SignupListFilter = 'pending';

export function parseFilter(raw: string | null | undefined): SignupListFilter {
	return FILTER_ITEMS.some((f) => f.value === raw) ? (raw as SignupListFilter) : DEFAULT_FILTER;
}

/** Endonyms, so the operator sees the language the person will read. */
export const LOCALE_LABELS: Record<SignupLocale, string> = {
	ar: 'العربية (Arabic)',
	de: 'Deutsch (German)',
	en: 'English',
	es: 'Español (Spanish)',
	fr: 'Français (French)',
	he: 'עברית (Hebrew)',
	nl: 'Nederlands (Dutch)',
	pl: 'Polski (Polish)'
};

export function localeLabel(locale: string | null | undefined): string {
	if (!locale) return 'English';
	return LOCALE_LABELS[locale as SignupLocale] ?? locale;
}

const SOURCE_LABELS: Record<string, string> = {
	web: 'Website form',
	chat: 'Chat',
	invite: 'Invited by you'
};

export function sourceLabel(source: string | null | undefined): string {
	if (!source) return 'Unknown';
	return SOURCE_LABELS[source] ?? source;
}

export const STEP_LABELS: Record<SignupStepName, string> = {
	identity: 'Login account',
	provision: 'Create workspace',
	membership: 'Add as workspace admin',
	invite_email: 'Send welcome email'
};

const STEP_STATUS: Record<SignupStepStatus, { label: string; tone: Tone }> = {
	ok: { label: 'Done', tone: 'success' },
	skipped: { label: 'Not needed', tone: 'neutral' },
	waiting: { label: 'Waiting on an earlier step', tone: 'neutral' },
	pending: { label: 'Not started', tone: 'neutral' },
	failed: { label: 'Failed — will be retried', tone: 'danger' },
	unknown: { label: 'Unconfirmed — check before retrying', tone: 'warning' },
	in_flight: { label: 'Sending email… not confirmed yet', tone: 'warning' }
};

export const FAILED_MANUAL_LABEL = 'Failed — retry manually';

/** The automatic retry is still scheduled (the backend's tick will run again). */
export function autoRetryScheduled(
	row: Pick<SignupApproval, 'steps_next_attempt_at' | 'steps_attempts'> | null | undefined
): boolean {
	if (!row) return true;
	return !!row.steps_next_attempt_at && (row.steps_attempts ?? 0) < STEPS_MAX_ATTEMPTS;
}

/**
 * Status label for one step. A `failed` step reads "will be retried" only while
 * the backend still has an automatic attempt scheduled (`steps_next_attempt_at`
 * set, attempts below `STEPS_MAX_ATTEMPTS`); otherwise only the operator's
 * Retry runs it again.
 */
export function stepStatusView(
	status: string | null | undefined,
	row?: Pick<SignupApproval, 'steps_next_attempt_at' | 'steps_attempts'> | null
): { label: string; tone: Tone } {
	const key = (status ?? 'pending') as SignupStepStatus;
	if (key === 'failed' && row && !autoRetryScheduled(row)) {
		return { label: FAILED_MANUAL_LABEL, tone: 'danger' };
	}
	return STEP_STATUS[key] ?? { label: status!, tone: 'neutral' };
}

/** Operator-facing sentence per backend step code (`core._step(..., code=)`). */
const STEP_CODE_MESSAGES: Record<string, string> = {
	identity_exists:
		'This email already has a login that this request didn’t create — sign-in can’t be set up automatically. Remove or merge that account, then Retry.',
	identity_failed:
		'The login account could not be created. It will be retried; if it keeps failing, check the login service.',
	identity_attr_dropped:
		'The login service did not keep this request’s marker on the new login, so it cannot be safely used. Fix the login service’s user-profile settings, then Retry.',
	identity_not_owned:
		'The login for this request is missing or was not created by it, so no welcome email is sent to it. Check the login account, then Retry.',
	identity_gone:
		'The login for this request was deleted. A new login is created and the welcome email sent on the next retry.',
	invite_email_failed: 'The login service refused to send the welcome email. It will be retried.',
	seat_removed:
		'This person was removed from the workspace after approval, so no welcome email was sent and they are not added back automatically. If that was a mistake, add them to the workspace again, then Retry.',
	keyring_unavailable:
		'The server is missing the encryption keys needed to set up the workspace’s AI access.',
	llm_access_failed: 'The workspace’s AI access could not be set up.',
	licence_not_entitled:
		'The workspace’s licence was issued, but it does not give access to Studio yet.',
	frontend_url_unset:
		'The server does not know the app’s web address, so the welcome link could not be built.',
	invite_not_pending: 'The workspace invitation was used or withdrawn in the meantime.',
	email_send_uncertain:
		'The email service did not confirm the send — the welcome email may or may not have gone out.',
	email_sending:
		'The welcome email was being sent when the server stopped — it may or may not have gone out.'
};

const STEP_FAILURE_FALLBACK: Record<SignupStepName, string> = {
	identity: 'The login account could not be created.',
	provision: 'The workspace could not be created.',
	membership: 'The person could not be added as workspace admin.',
	invite_email: 'The welcome email could not be sent.'
};

/** Statuses whose step shows an explanation (and its raw error under "Technical details"). */
export function stepNeedsExplanation(status: SignupStepStatus): boolean {
	return status === 'failed' || UNCERTAIN_SEND.includes(status);
}

/** One plain sentence for a step that did not finish; the raw `error` is shown separately. */
export function stepErrorSummary(
	step: SignupStepName,
	status: SignupStepStatus,
	code: string | null | undefined
): string {
	if (code && STEP_CODE_MESSAGES[code]) return STEP_CODE_MESSAGES[code];
	if (status === 'in_flight') return STEP_CODE_MESSAGES.email_sending;
	if (status === 'unknown') return STEP_CODE_MESSAGES.email_send_uncertain;
	return STEP_FAILURE_FALLBACK[step];
}

export interface StepRow {
	step: SignupStepName;
	label: string;
	status: SignupStepStatus;
	statusLabel: string;
	tone: Tone;
	code: string | null;
	/** Raw backend error text — for "Technical details" only. */
	error: string | null;
	/** Operator-friendly sentence, set when the step failed or its send is uncertain. */
	summary: string | null;
	at: string | null;
}

/** The per-step status, always in the order the approval runs them. */
export function stepRows(
	row: Pick<SignupApproval, 'steps'> &
		Partial<Pick<SignupApproval, 'steps_next_attempt_at' | 'steps_attempts'>>
): StepRow[] {
	const schedule =
		'steps_next_attempt_at' in row
			? {
					steps_next_attempt_at: row.steps_next_attempt_at ?? null,
					steps_attempts: row.steps_attempts ?? 0
				}
			: null;
	return SIGNUP_STEPS.map((step) => {
		const rec = row.steps?.[step];
		const status = (rec?.status ?? 'pending') as SignupStepStatus;
		const view = stepStatusView(status, schedule);
		return {
			step,
			label: STEP_LABELS[step],
			status,
			statusLabel: view.label,
			tone: view.tone,
			code: rec?.code ?? null,
			error: rec?.error ?? null,
			summary: stepNeedsExplanation(status) ? stepErrorSummary(step, status, rec?.code) : null,
			at: rec?.at ?? null
		};
	});
}

/** A request's headline state, as one badge. */
export function requestStatusView(
	row: Pick<SignupApproval, 'status' | 'steps_not_ok' | 'approving'> &
		Partial<Pick<SignupApproval, 'removal'>>
): { label: string; tone: Tone } {
	if (row.status === 'removed') return removalStateView(row.removal?.state);
	if (row.approving) return { label: 'Approving…', tone: 'accent' };
	if (row.status === 'pending') return { label: 'Waiting for review', tone: 'accent' };
	if (row.status === 'rejected') return { label: 'Declined', tone: 'neutral' };
	if (row.status === 'approved') {
		return (row.steps_not_ok?.length ?? 0) > 0
			? { label: 'Needs attention', tone: 'warning' }
			: { label: 'Approved', tone: 'success' };
	}
	return { label: String(row.status), tone: 'neutral' };
}

/** Approve / Decline are offered only while the request is undecided. */
export function canDecide(row: Pick<SignupApproval, 'status' | 'approving'>): boolean {
	return row.status === 'pending' && !row.approving;
}

/** Retry is offered for an approved request whose setup did not finish. */
export function canRetry(
	row: Pick<SignupApproval, 'status' | 'approving' | 'steps_not_ok'>
): boolean {
	return row.status === 'approved' && !row.approving && (row.steps_not_ok?.length ?? 0) > 0;
}

/**
 * True when the welcome email may or may not have gone out (`core.UNCERTAIN_SEND`:
 * `unknown`, or an `in_flight` marker that never resolved). Retrying sends a
 * second email — confirm first. (Every email lands on the app root, so an
 * earlier one keeps working.)
 */
export function emailUncertain(row: Pick<SignupApproval, 'steps'>): boolean {
	const status = row.steps?.invite_email?.status;
	return !!status && UNCERTAIN_SEND.includes(status);
}

export const RETRY_UNCERTAIN_WARNING =
	'We couldn’t confirm whether the earlier welcome email was sent. Retrying sends another email; the link in any earlier email keeps working.';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(value: string): boolean {
	const v = value.trim();
	return v.length <= 320 && EMAIL_RE.test(v);
}

export const NOT_CONFIGURED_MESSAGE =
	'Early-access sign-up is switched off on this deployment, so there is nothing to review and invitations cannot be sent. Ask the platform operator to enable it.';

// ── early-access removal ─────────────────────────────────────────────────

export const REMOVAL_STEP_LABELS: Record<RemovalStepName, string> = {
	blockers: 'Check nothing else is in the workspace',
	close_access: 'Suspend workspace and cancel invitations',
	licences: 'Revoke licences',
	identity: 'Retire the login',
	export: 'Export the workspace data',
	tenant_delete: 'Delete the workspace',
	licences_archive: 'Archive the workspace in licences',
	finalize: 'Erase personal data'
};

const REMOVAL_STEP_STATUS: Record<RemovalStepStatus, { label: string; tone: Tone }> = {
	ok: { label: 'Done', tone: 'success' },
	skipped: { label: 'Not needed', tone: 'neutral' },
	waiting: { label: 'Not started', tone: 'neutral' },
	pending: { label: 'Not finished — will be retried', tone: 'warning' },
	in_progress: { label: 'Running', tone: 'accent' },
	blocked: { label: 'Stopped — needs you', tone: 'danger' }
};

const REMOVAL_STATE: Record<RemovalState, { label: string; tone: Tone }> = {
	pending: { label: 'Removing…', tone: 'accent' },
	blocked: { label: 'Removal stopped', tone: 'danger' },
	failed: { label: 'Removal failed', tone: 'danger' },
	done: { label: 'Removed', tone: 'neutral' },
	resolved_manually: { label: 'Removal closed by hand', tone: 'neutral' }
};

export function removalStateView(state: string | null | undefined): { label: string; tone: Tone } {
	return REMOVAL_STATE[state as RemovalState] ?? { label: 'Removed', tone: 'neutral' };
}

/**
 * Operator-facing sentence per removal blocker / step code
 * (`removal.py` codes). A code that reports a normal outcome reads as a fact.
 */
export const REMOVAL_CODE_MESSAGES: Record<string, string> = {
	// blockers — nothing was touched
	other_member:
		'Someone other than the requester is a member of this workspace. Remove them first, then Retry.',
	foreign_invite:
		'The workspace has a pending invitation for someone else. Withdraw it first, then Retry.',
	tenant_content:
		'The workspace already holds work (projects or other content). Export and delete it the normal way, or remove the content, then Retry.',
	active_runs: 'A video is being made in this workspace right now. Cancel it first, then Retry.',
	tenant_mismatch:
		'This request points at a different workspace than the one its setup created. Check it by hand; nothing was removed.',
	tenant_not_provisioned:
		'This request’s workspace was never created, so there is nothing to remove here. Resolve it by hand.',
	blockers_failed: 'The safety checks could not run. It will be retried.',
	// steps
	close_access_failed: 'The workspace could not be suspended. It will be retried.',
	licence_failed:
		'Not every licence of the workspace could be revoked and confirmed. It will be retried; if it keeps failing, check the licences service.',
	dependency_still_required:
		'A shared service licence of this workspace (see the technical details for which) is still needed by another licence in the workspace that this removal did not create. Check that licence in the licences service and revoke it or close this removal by hand, then Retry.',
	dependency_release_unsupported:
		'The licences service does not release this workspace’s shared service licences yet. It will be retried; once the licences service is updated, it finishes on its own (or press Retry).',
	licence_archive_failed:
		'The workspace could not be archived in the licences service. It will be retried.',
	identity_failed: 'The login could not be retired. It will be retried.',
	deleted: 'The login was deleted.',
	disabled:
		'The login has a password or a linked sign-in, so it was switched off and marked instead of deleted.',
	disabled_unmarked:
		'The login was switched off, but the login service did not keep the removal marker. If this person signs up again, re-enable the login by hand.',
	absent: 'The login was already gone.',
	no_identity: 'No login was ever created for this request.',
	identity_not_owned:
		'The login for this address was not created by this request, so it was left untouched.',
	identity_kept_in_use: 'This login is also used in another workspace, so it was left untouched.',
	legacy_identity_mismatch:
		'The login you named is not the login for this request’s email address. Check the user id and Retry with the right one.',
	legacy_identity_window:
		'The login you named was not created during this request’s approval, so it cannot be proven to be this request’s. Check the user id; Resolve by hand if you are sure.',
	legacy_identity_foreign:
		'The login you named carries roles, groups or markers this request never set, so it is not removed automatically. Retire it by hand, then Resolve.',
	export_failed: 'The workspace export failed. It will be retried.',
	export_exists: 'An export of the workspace already existed.',
	storage_unavailable: 'File storage is unavailable right now. It will be retried.',
	in_progress: 'Still running — check again in a moment.',
	tenant_delete_failed:
		'Deleting the workspace did not finish. It will be retried and continue where it stopped.',
	tenant_delete_blocked:
		'Deleting the workspace was refused (see the technical details). It will be retried.',
	forced_job_exists:
		'An earlier admin delete of this workspace was forced. The removal never continues a forced delete: finish or cancel that delete in the workspace admin, then Retry — or close this removal by hand.',
	already_deleted: 'The workspace was already deleted.',
	tenant_deleted: 'The workspace is already deleted.',
	finalize_failed: 'The personal data could not be erased yet. It will be retried.',
	export_purge_failed:
		'The workspace’s export archive (it holds the requester’s name and email) could not be deleted yet, so the personal data is not erased. It will be retried.'
};

/** One plain sentence for a removal code, or null when the code has none. */
export function removalCodeMessage(code: string | null | undefined): string | null {
	return code ? (REMOVAL_CODE_MESSAGES[code] ?? null) : null;
}

export interface RemovalStepRow {
	step: RemovalStepName;
	label: string;
	status: RemovalStepStatus;
	statusLabel: string;
	tone: Tone;
	code: string | null;
	summary: string | null;
	error: string | null;
	at: string | null;
}

/** The removal's steps, always in the order they run. */
export function removalStepRows(row: Pick<SignupApproval, 'removal'>): RemovalStepRow[] {
	const byStep = new Map((row.removal?.steps ?? []).map((s) => [s.step, s]));
	return REMOVAL_STEPS.map((step) => {
		const rec = byStep.get(step);
		const status = (rec?.status ?? 'waiting') as RemovalStepStatus;
		const view = REMOVAL_STEP_STATUS[status] ?? { label: String(status), tone: 'neutral' };
		return {
			step,
			label: REMOVAL_STEP_LABELS[step],
			status,
			statusLabel: view.label,
			tone: view.tone,
			code: rec?.code ?? null,
			summary: removalCodeMessage(rec?.code),
			error: rec?.error ?? null,
			at: rec?.at ?? null
		};
	});
}

/** "Remove early-access workspace" is offered on an approved request only. */
export function canRemove(row: Pick<SignupApproval, 'status' | 'approving'>): boolean {
	return row.status === 'approved' && !row.approving;
}

/** How often the open request is re-read while its removal is queued / running. */
export const REMOVAL_POLL_MS = 5000;

/** The removal is queued or running in the background (the page polls it). */
export function removalInFlight(row: Pick<SignupApproval, 'status' | 'removal'>): boolean {
	return row.status === 'removed' && row.removal?.state === 'pending';
}

/** One line on where a queued / running removal is. */
export function removalProgressText(
	removal: Pick<SignupRemoval, 'state' | 'attempts' | 'running' | 'next_attempt_at'>
): string | null {
	if (removal.state !== 'pending') return null;
	if (removal.running) return 'Running now. This page updates on its own.';
	if (!removal.attempts)
		return 'Queued. It starts with the next background pass (within about 5 minutes); this page updates on its own.';
	return removal.next_attempt_at
		? `Attempt ${removal.attempts} did not finish. Next automatic retry: ${formatDate(removal.next_attempt_at)}.`
		: `Attempt ${removal.attempts} did not finish. It is retried automatically.`;
}

/** A warning when a queued removal has waited more than 15 minutes for the
 *  background worker (the API's `removal.stale`); null otherwise. */
export function removalStaleText(removal: Pick<SignupRemoval, 'state' | 'stale'>): string | null {
	if (removal.state !== 'pending' || !removal.stale) return null;
	return 'This removal has been queued for more than 15 minutes and nothing has picked it up. The background worker may be stopped — check the orchestrator before relying on it.';
}

/** What happened to the login, per `removal.steps.identity.code` — the same
 *  outcomes the Telegram notice reports. */
const LOGIN_OUTCOMES: Record<string, string> = {
	deleted: 'login deleted',
	disabled: 'login switched off and marked',
	disabled_unmarked: 'login switched off (the removal marker did NOT stick: check it)',
	absent: 'login already gone',
	identity_kept_in_use: 'login KEPT (another workspace uses it)',
	identity_not_owned: 'login KEPT (it is not this request’s: never touched)',
	no_identity: 'no login to retire'
};

export function removalLoginOutcome(removal: Pick<SignupRemoval, 'steps'>): string {
	const code = removal.steps.find((s) => s.step === 'identity')?.code ?? null;
	return (code && LOGIN_OUTCOMES[code]) || `login: unknown outcome (${code ?? 'none'})`;
}

/** The notice once a removal is done: says what happened to the login. */
export function removalDoneNotice(removal: Pick<SignupRemoval, 'steps'>): string {
	return `The early-access workspace was removed: ${removalLoginOutcome(removal)}; the export archive and the personal data were erased. The address can sign up again.`;
}

/** The Remove dialog's line on when it stops (accurate on every run). */
export const REMOVE_STOP_NOTE =
	'Before its first change it checks that nobody else uses the workspace and that it holds no work; if either is true it stops without changing anything. The checks repeat on every retry: a problem found then stops it where it is, and what was already done (suspended workspace, revoked licences, a retired login) stays done.';

/** The Resolve dialog's warning: closing erases the requester's data, and the note is a fingerprint. */
export const RESOLVE_ERASE_WARNING =
	'Closing also erases the requester’s name and email (and company and message) from this request — they cannot be shown again. Your note is stored as a fingerprint only (a hash and its length), never its text, so do not put anything in it you need to read back.';

/** The line shown for a removal closed by hand. */
export function resolvedText(resolved: NonNullable<SignupRemoval['resolved']>): string {
	return `Closed by hand on ${formatDate(resolved.at)}. The note is stored as a fingerprint only (${resolved.note_length} characters), not its text.`;
}

/** The copy under the evidence field: what is kept of it. */
export const EVIDENCE_FINGERPRINT_NOTE =
	'Stored as a fingerprint only — the text itself is never saved, so do not rely on reading it back.';

/** A legacy login the removal refused (wrong login, outside the window, foreign
 *  marks) can be corrected on Retry — the check runs in the safety-check step. */
export function legacyLoginCorrectable(
	row: Pick<SignupApproval, 'status' | 'removal'> &
		Partial<Pick<SignupApproval, 'has_identity_step'>>
): boolean {
	if (row.status !== 'removed' || row.has_identity_step !== false) return false;
	const rm = row.removal;
	if (!rm || rm.state !== 'blocked') return false;
	const legacy = (code: string | null | undefined) => !!code?.startsWith('legacy_identity_');
	return (
		rm.blockers.some((b) => legacy(b.code)) ||
		rm.steps.some((st) => st.status === 'blocked' && legacy(st.code))
	);
}

/** Retry a removal that is still running automatically, stopped, or gave up. */
export function canRetryRemoval(row: Pick<SignupApproval, 'status' | 'removal'>): boolean {
	const state = row.removal?.state;
	return (
		row.status === 'removed' && (state === 'pending' || state === 'blocked' || state === 'failed')
	);
}

/** Resolve (close by hand) a removal that stopped or gave up. */
export function canResolveRemoval(row: Pick<SignupApproval, 'status' | 'removal'>): boolean {
	const state = row.removal?.state;
	return row.status === 'removed' && (state === 'blocked' || state === 'failed');
}

/** The removal is still in the operator's queue (`needs_attention`). */
export function removalNeedsAttention(row: Pick<SignupApproval, 'status' | 'removal'>): boolean {
	return canRetryRemoval(row);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID_RE.test(value.trim());
}

/** The Remove confirmation is complete: the slug typed back exactly, and — for a
 *  legacy approval — a login id and the evidence for it. */
export function removeConfirmReady(
	row: Pick<SignupApproval, 'tenant_slug'> & Partial<Pick<SignupApproval, 'needs_legacy_identity'>>,
	typed: string,
	legacyUserId: string,
	legacyEvidence: string
): boolean {
	if (!row.tenant_slug || typed.trim() !== row.tenant_slug) return false;
	if (!row.needs_legacy_identity) return true;
	return isUuid(legacyUserId) && legacyEvidence.trim().length >= 3;
}

const CODE_MESSAGES: Record<string, string> = {
	signup_not_configured: NOT_CONFIGURED_MESSAGE,
	approval_not_found: 'This request no longer exists. It may have been removed.',
	approval_not_pending: 'This request has already been decided. Reload to see the outcome.',
	approval_in_progress: 'Another approval is in progress — try again in a minute.',
	early_access_workspace_exists: 'This person already has an early-access workspace.',
	approval_claim_lost: 'Another decision got there first. Reload and try again.',
	approval_not_approved:
		'Only an approved request can be changed this way. Reload to see its state.',
	confirmation_mismatch: 'Type the workspace slug exactly as shown to confirm the removal.',
	removal_exists: 'This workspace is already being removed. Reload to see its progress.',
	legacy_identity_required:
		'This request was approved before logins were tracked: enter the login’s user id and how you know it is theirs.',
	legacy_identity_not_applicable:
		'This request created its own login, so no other login can be named. Clear the login fields and try again.',
	removal_not_found: 'This request has no removal to retry. Reload the page.',
	removal_not_retryable: 'This removal is finished; there is nothing to retry.',
	removal_in_progress: 'The removal is running right now. Reload in a moment.',
	removal_worker_disabled:
		'The background worker that runs removals is switched off, so nothing would run this removal. Turn it on first.',
	removal_not_resolvable:
		'Only a stopped or failed removal can be closed by hand. Reload the page.',
	acknowledgement_required:
		'Confirm that you understand the workspace, its licences or the login may still work.',
	identity_step_done: 'The login was already retired; it cannot be changed now.',
	early_access_removal_in_progress:
		'This person’s early-access workspace is being removed. Their address is free again once the removal finishes.',
	steps_in_progress: 'Setup is running for this request right now. Reload in a moment.',
	steps_lease_lost: 'Setup is running for this request right now. Reload in a moment.',
	tenant_name_unavailable:
		'That workspace name is already taken. Enter a different workspace name and approve again.',
	invalid_status_filter: 'That filter is not available. Pick another one.'
};

export function isNotConfigured(err: unknown): boolean {
	return err instanceof ApiError && err.code === 'signup_not_configured';
}

function bodyRecord(err: ApiError): Record<string, unknown> | null {
	const b = err.body;
	return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

/**
 * The existing request's id from an invite's 409 `early_access_workspace_exists`
 * (flat body `{error, detail, signupId, tenantId}`), else null.
 */
export function existingSignupId(err: unknown): string | null {
	if (!(err instanceof ApiError) || err.code !== 'early_access_workspace_exists') return null;
	const id = bodyRecord(err)?.signupId;
	return typeof id === 'string' && id ? id : null;
}

const FIELD_LABELS: Record<string, string> = {
	email: 'Email',
	name: 'Name',
	company: 'Company',
	tenantName: 'Workspace name',
	locale: 'Email language',
	confirm: 'Workspace slug',
	legacy_identity: 'Login user id and evidence',
	note: 'Note'
};

/**
 * The invalid fields of a FastAPI 422 (`detail: [{loc: ['body', field], msg}]`),
 * as operator labels, de-duplicated and in order. Empty when the body names none.
 */
export function invalidFields(err: unknown): string[] {
	if (!(err instanceof ApiError) || err.status !== 422) return [];
	const detail = bodyRecord(err)?.detail;
	if (!Array.isArray(detail)) return [];
	const out: string[] = [];
	for (const entry of detail) {
		const loc =
			entry && typeof entry === 'object' ? (entry as Record<string, unknown>).loc : undefined;
		if (!Array.isArray(loc)) continue;
		const field = loc.filter((p) => p !== 'body' && p !== 'query').map(String)[0];
		if (!field) continue;
		const label = FIELD_LABELS[field] ?? field;
		if (!out.includes(label)) out.push(label);
	}
	return out;
}

/** Operator-facing copy for any failure of the signup-approvals API. */
export function signupErrorMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		if (err.code && CODE_MESSAGES[err.code]) return CODE_MESSAGES[err.code];
		if (err.status === 401) return 'Your session has ended. Sign in again.';
		if (err.status === 403) return 'You need a super-admin role to do this.';
		if (err.status === 422) {
			const fields = invalidFields(err);
			return fields.length > 0
				? `${fields.length === 1 ? 'This detail is' : 'These details are'} not valid: ${fields.join(', ')}. Check and try again.`
				: 'Some of the details are not valid. Check them and try again.';
		}
		if (err.status >= 500) return `${fallback} The server had a problem — try again shortly.`;
		return err.detail || fallback;
	}
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}

export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

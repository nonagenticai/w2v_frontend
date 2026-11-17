/**
 * Early-access signup approvals — super_admin client (orchestrator
 * `src/api/routes/signup_approvals.py`, `admin_router`).
 *
 *   GET  /api/admin/signup-approvals?status=     the queue (newest first, ≤ 500) + `defaultLlmAccess`
 *   GET  /api/admin/signup-approvals/{id}        one request → `{ data }`
 *   POST /api/admin/signup-approvals/invite      invite straight into early access (approves)
 *   POST /api/admin/signup-approvals/{id}/approve  (optional `tenantName`, `llmAccess`)
 *   POST /api/admin/signup-approvals/{id}/reject
 *   POST /api/admin/signup-approvals/{id}/retry  re-run an approved request's unfinished steps
 *   POST /api/admin/signup-approvals/{id}/remove           REMOVE an approved early-access
 *        workspace end to end (`confirm` = the workspace slug; orchestrator
 *        `services/signup/removal.py`)
 *   POST /api/admin/signup-approvals/{id}/removal/retry    re-run a pending / blocked / failed removal
 *   POST /api/admin/signup-approvals/{id}/removal/resolve  blocked / failed → resolved_manually
 *
 * Every route answers `503 {"error": "signup_not_configured"}` when signup is
 * disabled on the deployment. Errors are FLAT `{error: <code>, detail: <text>}`,
 * which `codeFromBody` / `detailFromBody` in client.ts already read into
 * `ApiError.code` / `ApiError.detail`.
 *
 * Wire keys are the orchestrator's: the row view is snake_case, the decision
 * envelope (`tenantId`, `emailState`, `stepsNotOk`) is camelCase. The routes
 * return hand-built JSONResponses, so they are not in the published OpenAPI —
 * the types live here.
 */

import { api } from './client.js';
import type { LlmAccessMode } from './providers.js';

/**
 * The approver's per-person service-access choice (CommonPractice's plan choice on
 * approve / invite). All three modes are accepted, as by `POST /api/admin/provision`.
 */
export type SignupLlmAccess = LlmAccessMode;

/** The languages the invitation email can be sent in (`SIGNUP_LOCALES`). */
export const SIGNUP_LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'he', 'nl', 'pl'] as const;
export type SignupLocale = (typeof SIGNUP_LOCALES)[number];

/** A request's own status. `removed`: its early-access workspace is being / was removed. */
export type SignupStatus = 'pending' | 'approved' | 'rejected' | 'removed';

/** The queue filter: the four statuses plus approved-but-unfinished / removal-needs-you. */
export const SIGNUP_LIST_FILTERS = [
	'pending',
	'approved',
	'rejected',
	'removed',
	'needs_attention'
] as const;
export type SignupListFilter = (typeof SIGNUP_LIST_FILTERS)[number];

/** Where the request came from: the website form, the chat, or an operator invite. */
export type SignupSource = 'web' | 'chat' | 'invite';

/** The setup steps an approval runs, in order (`core.STEPS`). */
export const SIGNUP_STEPS = ['identity', 'provision', 'membership', 'invite_email'] as const;
export type SignupStepName = (typeof SIGNUP_STEPS)[number];

/**
 * `core.StepStatus`, plus `pending` — synthesised here for a step that has not
 * run yet (no record). `in_flight` is written BEFORE the email call and only
 * survives when the send never reported back (process killed mid-send).
 */
export type SignupStepStatus =
	| 'ok'
	| 'skipped'
	| 'failed'
	| 'waiting'
	| 'unknown'
	| 'in_flight'
	| 'pending';

/**
 * `core.UNCERTAIN_SEND`: an email send whose outcome is not known. Never re-sent
 * automatically — only the super_admin Retry re-sends. The person was seated at
 * approval and the email lands on the app root, so an earlier email keeps working.
 */
export const UNCERTAIN_SEND: ReadonlyArray<SignupStepStatus> = ['unknown', 'in_flight'];

/** `core.STEPS_MAX_ATTEMPTS`: the automatic retries stop after this many. */
export const STEPS_MAX_ATTEMPTS = 10;

/** One `steps` jsonb record. */
export interface SignupStepRecord {
	status: SignupStepStatus;
	at?: string;
	code?: string | null;
	error?: string;
	detail?: Record<string, unknown>;
}

/** The removal's steps, in order (`removal.REMOVAL_STEPS`). */
export const REMOVAL_STEPS = [
	'blockers',
	'close_access',
	'licences',
	'identity',
	'export',
	'tenant_delete',
	'licences_archive',
	'finalize'
] as const;
export type RemovalStepName = (typeof REMOVAL_STEPS)[number];

/** `removal.StepStatus`, plus `waiting` — a step that has not run yet. */
export type RemovalStepStatus =
	| 'ok'
	| 'skipped'
	| 'pending'
	| 'in_progress'
	| 'blocked'
	| 'waiting';

/**
 * `removal.state`: `pending` (running / retried automatically), `blocked` (stopped
 * before touching anything it must not — the operator acts), `failed` (gave up after
 * STEPS_MAX_ATTEMPTS), `done`, `resolved_manually`.
 */
export type RemovalState = 'pending' | 'blocked' | 'failed' | 'done' | 'resolved_manually';

export interface RemovalStep {
	step: RemovalStepName;
	status: RemovalStepStatus;
	at?: string;
	code?: string | null;
	error?: string;
	detail?: Record<string, unknown>;
}

export interface RemovalBlocker {
	code: string;
	message: string;
	[key: string]: unknown;
}

/** `removal.removal_view(row)`. */
export interface SignupRemoval {
	state: RemovalState;
	attempts: number;
	requested_at: string | null;
	requested_via: string | null;
	tenant_slug: string | null;
	steps: RemovalStep[];
	blockers: RemovalBlocker[];
	last_error: { step: string; code: string | null; error?: string | null } | null;
	/** The named legacy login + its evidence's FINGERPRINT (the text is never stored). */
	legacy_identity: {
		user_id: string;
		evidence_sha256_prefix: string | null;
		evidence_length: number | null;
		evidence_created_at: string | null;
	} | null;
	allow_credentialed_delete: boolean;
	/** A Resolve note is kept as a FINGERPRINT only (sha256 + length) — never its text. */
	resolved: { at: string; by: string; note_sha256: string; note_length: number } | null;
	finished_at: string | null;
	next_attempt_at: string | null;
	/** A background pass is running it right now (its lease is held). */
	running?: boolean;
	/** Queued (pending, not running) and due for more than 15 minutes: the
	 *  background worker is not picking it up. */
	stale?: boolean;
}

/** A login the request created before logins were stamped (legacy approvals). */
export interface LegacyIdentityInput {
	user_id: string;
	evidence: string;
}

export interface SignupRemoveInput {
	/** The workspace slug, typed back. */
	confirm: string;
	legacy_identity?: LegacyIdentityInput;
	allow_credentialed_delete?: boolean;
}

export interface SignupStepNotOk {
	step: SignupStepName | string;
	status: SignupStepStatus;
	code: string | null;
}

/** `signup_view(row)` — one request as the onboarding screen shows it. */
export interface SignupApproval {
	id: string;
	email: string;
	name: string;
	company: string | null;
	message: string | null;
	locale: string | null;
	source: SignupSource | string;
	status: SignupStatus;
	created_at: string | null;
	decided_at: string | null;
	decided_via: string | null;
	decider_actor: string | null;
	/** An approve is being carried out right now (claim held). */
	approving: boolean;
	tenant_name: string | null;
	tenant_slug: string | null;
	tenant_id: string | null;
	/** The LLM access chosen at approval (recorded with the decision); null while pending. */
	llm_access: SignupLlmAccess | null;
	suggested_tenant_name: string;
	steps: Partial<Record<SignupStepName, SignupStepRecord>> & Record<string, SignupStepRecord>;
	/** Unfinished steps — only ever non-empty for an approved request. */
	steps_not_ok: SignupStepNotOk[];
	email_state: 'sent' | 'waiting';
	/** Automatic attempts so far (reset by a manual Retry). */
	steps_attempts: number;
	/** When the 5-minute tick next retries; null = no automatic retry is scheduled
	 *  (finished, waiting on the operator, or STEPS_MAX_ATTEMPTS reached). */
	steps_next_attempt_at: string | null;
	/** The early-access removal; null until a super-admin removes the workspace.
	 *  Absent from an older orchestrator. */
	removal?: SignupRemoval | null;
	/** The approval minted its own (stamped) login. False = a legacy approval. */
	has_identity_step?: boolean;
	/** Removing this approved request needs the operator to name its legacy login. */
	needs_legacy_identity?: boolean;
}

export interface SignupApprovalList {
	items: SignupApproval[];
	/**
	 * What an approve / invite WITHOUT `llmAccess` gets (`W2V_SIGNUP_LLM_ACCESS`):
	 * the page pre-selects it and sends nothing unless the operator changes it.
	 * Absent from an older orchestrator.
	 */
	defaultLlmAccess?: SignupLlmAccess;
}

/** The approve / invite envelope (`_approve_body`). */
export interface SignupApproveResult {
	approval: SignupApproval;
	tenantId: string | null;
	tenant: { id: string | null; name: string | null; slug: string | null };
	emailState: 'sent' | 'waiting';
	stepsNotOk: SignupStepNotOk[];
	/** Invite only: the address already had a pending request, which was approved. */
	reusedPending?: boolean;
}

export interface SignupInviteInput {
	email: string;
	name: string;
	company?: string | null;
	locale: SignupLocale;
	tenantName?: string;
	llmAccess?: SignupLlmAccess;
}

const BASE = '/admin/signup-approvals';

function path(id: string, action?: string): string {
	const p = `${BASE}/${encodeURIComponent(id)}`;
	return action ? `${p}/${action}` : p;
}

export const signupApprovals = {
	/** The queue; omit `status` for every request. */
	list(status?: SignupListFilter): Promise<SignupApprovalList> {
		const qs = status ? `?status=${encodeURIComponent(status)}` : '';
		return api.get<SignupApprovalList>(`${BASE}${qs}`);
	},

	async get(id: string): Promise<SignupApproval> {
		const res = await api.get<{ data: SignupApproval }>(path(id));
		return res.data;
	},

	/** Invite a person straight into early access — records the request AND approves it. */
	invite(input: SignupInviteInput): Promise<SignupApproveResult> {
		const body: Record<string, string> = {
			email: input.email,
			name: input.name,
			locale: input.locale
		};
		if (input.company) body.company = input.company;
		if (input.tenantName) body.tenantName = input.tenantName;
		if (input.llmAccess) body.llmAccess = input.llmAccess;
		return api.post<SignupApproveResult>(`${BASE}/invite`, body);
	},

	approve(
		id: string,
		tenantName?: string,
		llmAccess?: SignupLlmAccess
	): Promise<SignupApproveResult> {
		const body: Record<string, string> = {};
		if (tenantName) body.tenantName = tenantName;
		if (llmAccess) body.llmAccess = llmAccess;
		return api.post<SignupApproveResult>(path(id, 'approve'), body);
	},

	async reject(id: string): Promise<SignupApproval> {
		const res = await api.post<{ approval: SignupApproval }>(path(id, 'reject'));
		return res.approval;
	},

	async retry(id: string): Promise<SignupApproval> {
		const res = await api.post<{ approval: SignupApproval }>(path(id, 'retry'));
		return res.approval;
	},

	/** Remove an approved early-access workspace. 202: the removal is QUEUED (due at
	 *  once); the orchestrator's background pass runs it — poll the request. */
	async remove(id: string, input: SignupRemoveInput): Promise<SignupApproval> {
		const body: Record<string, unknown> = { confirm: input.confirm };
		if (input.legacy_identity) body.legacy_identity = input.legacy_identity;
		if (input.allow_credentialed_delete) body.allow_credentialed_delete = true;
		const res = await api.post<{ approval: SignupApproval }>(path(id, 'remove'), body);
		return res.approval;
	},

	/** Re-run a pending / blocked / failed removal (optionally correcting the legacy
	 *  login). 202: queued like the remove — poll the request for progress. */
	async retryRemoval(
		id: string,
		input?: { legacy_identity?: LegacyIdentityInput; allow_credentialed_delete?: boolean }
	): Promise<SignupApproval> {
		const res = await api.post<{ approval: SignupApproval }>(
			path(id, 'removal/retry'),
			input ?? {}
		);
		return res.approval;
	},

	/** Close a blocked / failed removal by hand (the operator acknowledges access may be live). */
	async resolveRemoval(id: string, note: string): Promise<SignupApproval> {
		const res = await api.post<{ approval: SignupApproval }>(path(id, 'removal/resolve'), {
			note,
			acknowledge_live_access: true
		});
		return res.approval;
	}
};

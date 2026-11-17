// Which run-level actions the UI may offer for a given run status, and how a
// run failure is explained to a person. Pure functions so the guards are unit
// tested once and every surface (run page, workspace, project delete) shares
// the same answer.
//
// The backend contract these mirror (w2v_orchestrator api/routes/runs/lifecycle.py):
//   * cancel   — allowed unless the run is already terminal, so `paused` IS
//                cancellable (a rejected gate must not leave a zombie run that
//                holds its deliverable in `awaiting_review`).
//   * resume   — 409 unless the run is `paused`. Offering it on a failed run was
//                a silent no-op from the user's point of view.
//   * regenerate (Restart / Rerun) — spawns a NEW paid run off a run that is no
//                longer executing (`failed` / `cancelled` / `completed`); the
//                restart plan keeps every finished step the change does not affect.
//                Always confirmed first, with that plan as the preview.
//   * checkpoints PATCH — 409 on completed / failed / cancelled runs.

import { runs } from '$lib/api';
import { ApiError } from '$lib/api';
import type { RunDetail } from '$lib/types/runs';

export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export const ACTIVE_RUN_STATUSES = ['pending', 'running', 'paused'] as const;

export function isTerminalRunStatus(status: string | null | undefined): boolean {
	return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status ?? '');
}

/** A run that is still executing or waiting at a checkpoint (still spending or
 *  still holding its deliverable). */
export function isActiveRunStatus(status: string | null | undefined): boolean {
	return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status ?? '');
}

/** Cancel is offered for every non-terminal run, including `paused`. */
export function canCancelRun(status: string | null | undefined): boolean {
	return isActiveRunStatus(status);
}

/** Resume continues a run IN PLACE; the backend accepts it only from `paused`. */
export function canResumeRun(status: string | null | undefined): boolean {
	return status === 'paused';
}

/** Restart / Rerun (regenerate) spawns a new paid run from any run the pipeline is
 *  not executing and that is not waiting at a review gate: failed, cancelled — and
 *  COMPLETED (George 2026-10-27: "users can rerun every part of the project, even
 *  when it completed successfully"). A paused run is resumed instead. The confirmation
 *  previews which finished steps are kept (`GET /runs/{id}/restart-plan`). */
export function canRestartRun(status: string | null | undefined): boolean {
	return status === 'failed' || status === 'cancelled' || status === 'completed';
}

/** "Rerun from here" on one step: the run must not be executing (the backend 409s a
 *  regenerate off a pending/running parent). Paused is allowed — rejecting a gate by
 *  re-running the step is the review flow. */
export function canRerunFromStep(status: string | null | undefined): boolean {
	return status !== 'pending' && status !== 'running' && Boolean(status);
}

/** Label for the run header's "when did it end" tile. A run that FAILED or was
 *  CANCELLED also carries `completed_at` (it is the end timestamp, not a
 *  success flag), so keying the label off `completed_at` alone told the reader
 *  a failed run had "Completed". */
export function runEndLabel(
	status: string | null | undefined,
	completedAt: string | null | undefined
): 'Completed' | 'Failed' | 'Cancelled' | 'Ended' | 'Started' {
	if (!completedAt) return 'Started';
	if (status === 'failed') return 'Failed';
	if (status === 'cancelled') return 'Cancelled';
	if (status === 'completed') return 'Completed';
	return 'Ended';
}

/** Checkpoints can only change while the run can still pause. */
export function canEditCheckpoints(status: string | null | undefined): boolean {
	return !isTerminalRunStatus(status);
}

// ── Failure explanation ─────────────────────────────────────────────────────

export type FailureClass = 'our_defect' | 'customer_input' | 'external' | 'unknown';

export interface RunFailureMessage {
	title: string;
	body: string;
}

/**
 * Human explanation for a failed run, keyed on the orchestrator's structural
 * `failure_class` (models/failure_class.py). Never derived from the raw error
 * prose, which is an exception dump with internal service URLs.
 */
export function failureMessage(
	failureClass: string | null | undefined,
	failedStage: string | null | undefined,
	stageName: (s: string) => string = (s) => s.replace(/_/g, ' ')
): RunFailureMessage {
	const where = failedStage ? ` at the “${stageName(failedStage)}” step` : '';
	switch (failureClass) {
		case 'external':
			return {
				title: 'A service the pipeline depends on was unavailable',
				body: `The run stopped${where} because a service it relies on did not respond correctly. This is on our side, not a problem with your project. Restart the run in a few minutes; if it keeps failing, contact support.`
			};
		case 'our_defect':
			return {
				title: 'Something went wrong on our side',
				body: `The run stopped${where} because of a problem in our pipeline. Nothing in your project caused this. You can restart the run; if it fails the same way again, contact support.`
			};
		case 'customer_input':
			return {
				title: 'The run could not continue with the current project settings',
				body: `The run stopped${where} because of something in the project’s setup (brief, uploads, or provider settings). Check those, then restart the run.`
			};
		default:
			return {
				title: 'The run failed',
				body: `The run stopped${where}. Restart it to try again; if it fails the same way again, contact support.`
			};
	}
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The stage a failed run stopped at. The server's `RunDetail.failed_stage`
 * (w2v_orchestrator#1116) is authoritative; `guessed` (the first stage the live
 * view saw fail) is only the fallback for a server that does not send it.
 */
export function resolveFailedStage(
	run: Pick<Partial<RunDetail>, 'failed_stage'> | null | undefined,
	guessed: string | null | undefined
): string | null {
	const server = run?.failed_stage;
	return typeof server === 'string' && server ? server : (guessed ?? null);
}

// ── upstream_auth: whose credential was rejected ────────────────────────────

export const UPSTREAM_AUTH = 'upstream_auth';

export type UpstreamAuthScope = 'platform' | 'tenant';

export interface UpstreamAuthFailure extends RunFailureMessage {
	/** `tenant` ⇒ the tenant's own provider key; the fix is on the Providers page. */
	scope: UpstreamAuthScope;
}

/**
 * `failure_detail: {code: "upstream_auth", scope, message}` → what to tell the
 * person. `scope="tenant"` is THEIR provider key (they can fix it); `"platform"` is
 * our service credential (only support can). An unknown/missing scope reads as
 * platform: never send someone to fix a key that may not be theirs.
 */
export function upstreamAuthFailure(detail: unknown): UpstreamAuthFailure | null {
	if (!isRecord(detail) || detail.code !== UPSTREAM_AUTH) return null;
	if (detail.scope === 'tenant') {
		return {
			scope: 'tenant',
			title: 'Your provider key was rejected',
			body: 'The provider rejected the API key configured for this workspace, so the run stopped. Fix the key on the Providers page, then restart the run.'
		};
	}
	return {
		scope: 'platform',
		title: 'Service configuration problem',
		body: 'One of our service credentials was rejected, so the run stopped. This is on our side, not a problem with your project or your keys — please contact support.'
	};
}

/** `upstreamAuthFailure` of a run's `RunDetail.failure_detail`. */
export function upstreamAuthFailureFromRun(
	run: Pick<Partial<RunDetail>, 'failure_detail'> | null | undefined
): UpstreamAuthFailure | null {
	return run ? upstreamAuthFailure(run.failure_detail) : null;
}

// ── site_login_failed: the saved source-site sign-in did not work ───────────

export const SITE_LOGIN_FAILED = 'site_login_failed';

export interface SiteLoginFailure extends RunFailureMessage {
	/** The host the capture could not sign in to (`app.example.com`). */
	site: string;
}

/**
 * `failure_detail: {code: "site_login_failed", site, message}` (orchestrator
 * `SiteCaptureLoginError`) → what to tell the person. The fix is theirs: the
 * sign-in saved on the project's Brief page. Recording on signed out would have
 * produced a video of the sign-in screen, so the run stopped instead.
 */
export function siteLoginFailure(detail: unknown): SiteLoginFailure | null {
	if (!isRecord(detail) || detail.code !== SITE_LOGIN_FAILED) return null;
	// Structured fields from the orchestrator (`failure_detail.site` / `.reason`,
	// w2v_orchestrator#1163) — never parsed out of the prose `message`.
	const site = typeof detail.site === 'string' && detail.site ? detail.site : 'your site';
	const why = typeof detail.reason === 'string' && detail.reason ? detail.reason : null;
	return {
		site,
		title: `Couldn’t sign in to ${site}`,
		body: `${why ? `${why[0].toUpperCase()}${why.slice(1)}. ` : ''}The run stopped instead of recording the sign-in screen. Check the source site sign-in on the Brief page, then rerun this step.`
	};
}

/** `siteLoginFailure` of a run's `RunDetail.failure_detail`. */
export function siteLoginFailureFromRun(
	run: Pick<Partial<RunDetail>, 'failure_detail'> | null | undefined
): SiteLoginFailure | null {
	return run ? siteLoginFailure(run.failure_detail) : null;
}

// ── Resume 409 ──────────────────────────────────────────────────────────────

/** `error.details.code` of the 409 `POST /runs/{id}/resume` answers for a run
 *  that is not paused (w2v_orchestrator#1116). */
export const RUN_NOT_RESUMABLE = 'run_not_resumable';

type KnownRunStatus = (typeof TERMINAL_RUN_STATUSES)[number] | (typeof ACTIVE_RUN_STATUSES)[number];

function asKnownRunStatus(v: unknown): KnownRunStatus | null {
	return typeof v === 'string' && (isTerminalRunStatus(v) || isActiveRunStatus(v))
		? (v as KnownRunStatus)
		: null;
}

export interface RunNotResumable {
	/** The run's CURRENT status per the server, when it named a known one. */
	status: KnownRunStatus | null;
	message: string;
}

/**
 * A resume refused because the run is no longer paused, or null for any other
 * error. Duck-typed on `status` + `details` (what `ApiError` carries).
 */
export function runNotResumable(err: unknown): RunNotResumable | null {
	if (!isRecord(err) || err.status !== 409) return null;
	const d = err.details;
	if (!isRecord(d) || d.code !== RUN_NOT_RESUMABLE) return null;
	const status = asKnownRunStatus(d.status);
	const message =
		typeof d.message === 'string' && d.message
			? d.message
			: status
				? `This run is now ${status} and can no longer be resumed.`
				: 'This run is no longer paused; reload to see its current state.';
	return { status, message };
}

/**
 * The raw error, made safe to show under a "technical details" disclosure:
 * internal service URLs are replaced so tenants never see cluster hostnames.
 */
export function redactRunError(raw: string | null | undefined): string {
	if (!raw) return '';
	return raw.replace(/\bhttps?:\/\/[^\s'")]+/gi, '[internal service]');
}

// ── Cancel-before-delete ────────────────────────────────────────────────────

/** Run lists come back newest-first and the backend caps a page at 200. */
export const RUN_LIST_MAX_PAGE = 200;

/** Runs of a project that are still executing or paused. */
export async function listActiveRuns(projectId: string): Promise<{ id: string; status: string }[]> {
	const all: { id: string; status: string }[] = [];
	for (let offset = 0; ; offset += RUN_LIST_MAX_PAGE) {
		const page = await runs.listForProject(projectId, { limit: RUN_LIST_MAX_PAGE, offset });
		all.push(...page);
		if (page.length < RUN_LIST_MAX_PAGE) break;
	}
	return all.filter((r) => isActiveRunStatus(r.status));
}

/**
 * Cancel every listed run. A 409 means the run finished in the meantime, which
 * is the outcome we wanted. Returns the ids that could NOT be cancelled.
 */
export async function cancelRuns(runIds: string[]): Promise<string[]> {
	const failed: string[] = [];
	for (const id of runIds) {
		try {
			await runs.cancel(id);
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) continue;
			failed.push(id);
		}
	}
	return failed;
}

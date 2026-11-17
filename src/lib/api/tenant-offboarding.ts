import { api, ApiError } from './client.js';
import { downloadAndSave } from './downloads.js';

// ---------------------------------------------------------------------------
// Tenant offboarding (P6 ORCH-6) — export + delete.
//
// Tenant side (`/api/tenant/offboarding`, tenant_admin): REQUEST only — a
// super_admin decides and executes. Reachable without a live licence.
// Operator side (`/api/admin/...`, super_admin): the queue, approve/reject, a
// direct export, and the two-step delete (`GET .../offboarding-plan` → the
// operator types the plan's `confirm_token` → `DELETE /api/admin/tenants/{t}
// ?confirm=<token>[&force=true]`).
//
// Approve, the direct export and the delete answer **202** with the job (status
// `running`); the work runs detached on the orchestrator. The UI polls the job
// (`GET /api/admin/offboarding/{id}`; the tenant side re-lists — it has no
// single-job GET) with backoff until a terminal status, and re-attaches to any
// `running` job it finds when the page loads, so a reload loses nothing.
// A delete that answers 200 is the idempotent re-run of a finished one.
//
// A finished delete is NOT complete: other w2v services keep their own tenant
// rows (`result.complete === false`, `result.not_deleted`). The UI must say so.
//
// `download_url` is a same-origin `/api/...` path the orchestrator streams; it is
// fetched with the auth headers (`downloadAndSave`), never handed to the browser.
//
// Hand-mirrored from `src/api/schemas/tenant_offboarding.py` (the pinned OpenAPI
// package predates the routes). Names avoid the schema names `OffboardingJob` /
// `OffboardingJobList` / `OffboardingPlan` / `OffboardingBlocker` so the next
// codegen bump does not collide (type-drift-check); alias them then.
// ---------------------------------------------------------------------------

export type OffboardingKindName = 'export' | 'delete';
export type OffboardingStatusName = 'requested' | 'running' | 'done' | 'failed' | 'rejected';

/** One downstream service that keeps its own rows for the tenant. */
export interface OffboardingNotDeletedItem {
	service: string;
	data?: string[];
	[key: string]: unknown;
}

/** `OffboardingJob`. */
export interface OffboardingJobItem {
	id: string;
	tenant_id: string;
	kind: OffboardingKindName;
	status: OffboardingStatusName;
	requested_by?: string | null;
	/** Withheld (null) on the tenant_admin view. */
	decided_by?: string | null;
	reason?: string | null;
	force: boolean;
	error?: string | null;
	progress: Record<string, unknown>;
	result?: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
	started_at?: string | null;
	finished_at?: string | null;
	/** Same-origin download path of a finished export. */
	download_url?: string | null;
}

/** `OffboardingJobList`. */
export interface OffboardingJobItems {
	items: OffboardingJobItem[];
}

/** `OffboardingBlocker`. */
export interface OffboardingBlockerItem {
	code: string;
	message: string;
	overridable: boolean;
}

/** `OffboardingPlan` — step 1 of the two-step delete. */
export interface OffboardingPlanView {
	tenant_id: string;
	tenant_name?: string | null;
	tenant_status: string;
	confirm_token: string;
	deletable: boolean;
	blockers: OffboardingBlockerItem[];
	rows: Record<string, number>;
	object_prefixes: string[];
	retained: Record<string, string>[];
	not_deleted: OffboardingNotDeletedItem[];
}

export interface OffboardingQueueFilter {
	status?: OffboardingStatusName;
	kind?: OffboardingKindName;
	tenant_id?: string;
	limit?: number;
}

function query(filter: OffboardingQueueFilter): string {
	const p = new URLSearchParams();
	if (filter.status) p.set('status', filter.status);
	if (filter.kind) p.set('kind', filter.kind);
	if (filter.tenant_id) p.set('tenant_id', filter.tenant_id);
	if (filter.limit) p.set('limit', String(filter.limit));
	const q = p.toString();
	return q ? `?${q}` : '';
}

/** `download_url` is `/api/...`; the download helpers take the path after `/api`. */
export function apiRelative(path: string): string {
	return path.startsWith('/api/') ? path.slice(4) : path;
}

export function exportFilename(job: OffboardingJobItem): string {
	return `tenant-${job.tenant_id}-export-${job.id}.zip`;
}

/** Save a finished export through an authenticated fetch. */
export function downloadExport(job: OffboardingJobItem): Promise<void> {
	if (!job.download_url) return Promise.reject(new Error('This export has no download.'));
	return downloadAndSave(apiRelative(job.download_url), exportFilename(job), 'application/zip');
}

export const tenantOffboarding = {
	request(kind: OffboardingKindName, reason?: string): Promise<OffboardingJobItem> {
		const r = reason?.trim();
		return api.post<OffboardingJobItem>('/tenant/offboarding', r ? { kind, reason: r } : { kind });
	},
	list(): Promise<OffboardingJobItems> {
		return api.get<OffboardingJobItems>('/tenant/offboarding');
	}
};

export const adminOffboarding = {
	list(filter: OffboardingQueueFilter = {}): Promise<OffboardingJobItems> {
		return api.get<OffboardingJobItems>(`/admin/offboarding${query(filter)}`);
	},
	/** One job — the poll target of a running export/delete. */
	get(jobId: string): Promise<OffboardingJobItem> {
		return api.get<OffboardingJobItem>(`/admin/offboarding/${encodeURIComponent(jobId)}`);
	},
	/** Approve = execute. A delete request needs the plan's confirm token. */
	approve(
		jobId: string,
		body: { confirm?: string; force?: boolean } = {}
	): Promise<OffboardingJobItem> {
		return api.post<OffboardingJobItem>(`/admin/offboarding/${encodeURIComponent(jobId)}/approve`, {
			confirm: body.confirm ?? null,
			force: body.force ?? false
		});
	},
	reject(jobId: string, reason?: string): Promise<OffboardingJobItem> {
		const r = reason?.trim();
		return api.post<OffboardingJobItem>(`/admin/offboarding/${encodeURIComponent(jobId)}/reject`, {
			reason: r ? r : null
		});
	},
	exportTenant(tenantId: string): Promise<OffboardingJobItem> {
		return api.post<OffboardingJobItem>(`/admin/tenants/${encodeURIComponent(tenantId)}/export`);
	},
	plan(tenantId: string): Promise<OffboardingPlanView> {
		return api.get<OffboardingPlanView>(
			`/admin/tenants/${encodeURIComponent(tenantId)}/offboarding-plan`
		);
	},
	deleteTenant(tenantId: string, confirm: string, force = false): Promise<OffboardingJobItem> {
		const p = new URLSearchParams({ confirm });
		if (force) p.set('force', 'true');
		return api.delete<OffboardingJobItem>(
			`/admin/tenants/${encodeURIComponent(tenantId)}?${p.toString()}`
		);
	}
};

/** What a finished delete reports. `complete` is false while any downstream
 *  service still holds the tenant's rows — the honest default when absent. */
export interface DeleteOutcome {
	complete: boolean;
	notDeleted: OffboardingNotDeletedItem[];
	note: string | null;
}

export function deleteOutcome(job: OffboardingJobItem): DeleteOutcome | null {
	if (job.kind !== 'delete' || job.status !== 'done' || !job.result) return null;
	const r = job.result;
	const notDeleted = Array.isArray(r.not_deleted)
		? (r.not_deleted as unknown[]).filter(
				(d): d is OffboardingNotDeletedItem =>
					typeof d === 'object' &&
					d !== null &&
					typeof (d as { service?: unknown }).service === 'string'
			)
		: [];
	return {
		complete: r.complete === true && notDeleted.length === 0,
		notDeleted,
		note: typeof r.note === 'string' ? r.note : null
	};
}

/** User copy for an offboarding error; the API message wins. */
export function offboardingError(err: unknown, fallback = 'Something went wrong.'): string {
	if (!(err instanceof ApiError))
		return err instanceof Error && err.message ? err.message : fallback;
	if (err.code === 'OFFBOARDING_ALREADY_REQUESTED')
		return 'A request of this kind is already open for this workspace.';
	if (err.code === 'CONFIRMATION_MISMATCH')
		return 'The confirmation does not match. Type the confirmation token exactly.';
	if (err.status === 403) return 'You are not allowed to do this.';
	return err.detail || fallback;
}

export const OFFBOARDING_STATUS_LABEL: Record<OffboardingStatusName, string> = {
	requested: 'Requested',
	running: 'Running',
	done: 'Done',
	failed: 'Failed',
	rejected: 'Rejected'
};

/** No further change will happen without a new operator action. */
export const TERMINAL_STATUSES: ReadonlySet<OffboardingStatusName> = new Set([
	'done',
	'failed',
	'rejected'
]);

/** A job the orchestrator is working on right now (worth polling). `requested`
 *  waits on an operator, not on the server, so it is not polled. */
export function isInFlight(job: Pick<OffboardingJobItem, 'status'>): boolean {
	return job.status === 'running';
}

/** Backoff for a job poll: 2 s, ×1.5 each tick, capped at 15 s. */
export const POLL_INITIAL_MS = 2_000;
export const POLL_MAX_MS = 15_000;
export const POLL_FACTOR = 1.5;
/** Consecutive transient failures before a poll gives up (and says so). */
export const POLL_MAX_ERRORS = 5;

export function nextPollDelay(prev: number): number {
	return Math.min(POLL_MAX_MS, Math.round(prev * POLL_FACTOR));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const t = setTimeout(done, ms);
		function done(): void {
			clearTimeout(t);
			signal.removeEventListener('abort', done);
			resolve();
		}
		signal.addEventListener('abort', done);
	});
}

/** A 4xx other than 408/429 will not heal by asking again. */
function isPermanent(err: unknown): boolean {
	return (
		err instanceof ApiError &&
		err.status >= 400 &&
		err.status < 500 &&
		err.status !== 408 &&
		err.status !== 429
	);
}

/**
 * Call `tick` with backoff until it reports nothing is left in flight (`false`),
 * the signal aborts, a permanent error occurs, or `POLL_MAX_ERRORS` transient
 * errors happen in a row. Each error is handed to `onError`; a later successful
 * tick clears it (`onError(null)`). Resolves when polling stops — never rejects.
 */
export async function pollWithBackoff(
	tick: () => Promise<boolean>,
	opts: { signal: AbortSignal; onError?: (err: unknown) => void }
): Promise<void> {
	let delay = POLL_INITIAL_MS;
	let errors = 0;
	while (!opts.signal.aborted) {
		await sleep(delay, opts.signal);
		if (opts.signal.aborted) return;
		try {
			const more = await tick();
			errors = 0;
			opts.onError?.(null);
			if (!more) return;
		} catch (err) {
			if (opts.signal.aborted) return;
			opts.onError?.(err);
			errors += 1;
			if (isPermanent(err) || errors >= POLL_MAX_ERRORS) return;
		}
		delay = nextPollDelay(delay);
	}
}

function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function sumCounts(v: unknown): number | null {
	if (!v || typeof v !== 'object') return null;
	return Object.values(v as Record<string, unknown>).reduce<number>(
		(acc, n) => acc + (num(n) ?? 0),
		0
	);
}

/**
 * One line of what a RUNNING job has done so far, from its `progress` heartbeat
 * (orchestrator `tenant_offboarding.py`):
 *  - delete: `{forced_over}` before the rows go, then `{rows_deleted: true,
 *    deleted_rows, prefixes_pending, prefixes_done}` while storage is purged;
 *  - export: `{phase: 'tables', tables}` then `{phase: 'objects', tables, objects}`.
 * Null when the job is not running.
 */
export function progressSummary(job: OffboardingJobItem): string | null {
	if (!isInFlight(job)) return null;
	const p = job.progress ?? {};
	if (job.kind === 'delete') {
		if (p.rows_deleted !== true) return 'Deleting database rows…';
		const done = Array.isArray(p.prefixes_done) ? p.prefixes_done.length : 0;
		const pending = Array.isArray(p.prefixes_pending) ? p.prefixes_pending.length : 0;
		const rows = sumCounts(p.deleted_rows);
		const rowsPart = rows === null ? 'Rows deleted' : `${rows.toLocaleString()} rows deleted`;
		return `${rowsPart} · purging storage: ${done} of ${done + pending} prefixes`;
	}
	const rows = sumCounts(p.tables);
	const tables = p.tables && typeof p.tables === 'object' ? Object.keys(p.tables).length : 0;
	if (p.phase === 'objects') {
		const objects = num(p.objects) ?? 0;
		return `Copying files: ${objects.toLocaleString()} so far (${tables} tables exported)`;
	}
	if (p.phase === 'tables') {
		return `Exporting tables: ${tables} done, ${(rows ?? 0).toLocaleString()} rows`;
	}
	return 'Starting…';
}

/** A failed delete whose rows are already gone resumes at the storage purge; the
 *  tenant is tombstoned then, so the plan reports `ALREADY_DELETED` — which does
 *  NOT block the resume (the orchestrator skips the preflight for it). */
export function isResumableAfterRows(job: OffboardingJobItem | null | undefined): boolean {
	return (
		!!job && job.kind === 'delete' && job.status === 'failed' && job.progress?.rows_deleted === true
	);
}

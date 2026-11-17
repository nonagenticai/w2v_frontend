import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn(async () => 'jwt-1'),
	getToken: vi.fn(() => 'jwt-1')
}));

import { ApiError } from './client.js';
import {
	adminOffboarding,
	apiRelative,
	deleteOutcome,
	downloadExport,
	isResumableAfterRows,
	pollWithBackoff,
	POLL_INITIAL_MS,
	POLL_MAX_ERRORS,
	POLL_MAX_MS,
	progressSummary,
	tenantOffboarding,
	type OffboardingJobItem
} from './tenant-offboarding.js';

const JOB: OffboardingJobItem = {
	id: 'job-1',
	tenant_id: 'ten-1',
	kind: 'export',
	status: 'done',
	force: false,
	progress: {},
	created_at: '2026-10-09T10:00:00Z',
	updated_at: '2026-10-09T10:00:00Z',
	download_url: '/api/tenant/offboarding/job-1/download'
};

const ok = (body: unknown) => ({
	ok: true,
	status: 200,
	headers: new Headers({ 'content-type': 'application/json' }),
	json: async () => body,
	text: async () => JSON.stringify(body)
});

describe('tenant offboarding api', () => {
	const fetchMock = vi.fn();
	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(ok(JOB));
	});

	it('tenant request POSTs {kind, reason} to /tenant/offboarding (reason dropped when blank)', async () => {
		await tenantOffboarding.request('delete', '  leaving  ');
		await tenantOffboarding.request('export', '   ');
		const [u1, i1] = fetchMock.mock.calls[0];
		expect(u1).toContain('/api/tenant/offboarding');
		expect(i1.method).toBe('POST');
		expect(JSON.parse(i1.body)).toEqual({ kind: 'delete', reason: 'leaving' });
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ kind: 'export' });
	});

	it('the delete is step 2: DELETE /admin/tenants/{t}?confirm=<token>&force=true', async () => {
		await adminOffboarding.deleteTenant('ten-1', 'Acme & Co', true);
		const [url, init] = fetchMock.mock.calls[0];
		expect(init.method).toBe('DELETE');
		expect(url).toContain('/api/admin/tenants/ten-1?confirm=Acme+%26+Co&force=true');
		await adminOffboarding.deleteTenant('ten-1', 'acme');
		expect(fetchMock.mock.calls[1][0]).not.toContain('force');
	});

	it('plan + queue + approve hit the operator routes', async () => {
		fetchMock.mockResolvedValue(ok({ items: [] }));
		await adminOffboarding.plan('ten-1');
		await adminOffboarding.list({ status: 'requested', kind: 'delete' });
		await adminOffboarding.approve('job-1', { confirm: 'acme', force: false });
		expect(fetchMock.mock.calls[0][0]).toContain('/api/admin/tenants/ten-1/offboarding-plan');
		expect(fetchMock.mock.calls[1][0]).toContain(
			'/api/admin/offboarding?status=requested&kind=delete'
		);
		expect(fetchMock.mock.calls[2][0]).toContain('/api/admin/offboarding/job-1/approve');
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ confirm: 'acme', force: false });
	});

	it('get() reads one job — the poll target', async () => {
		await adminOffboarding.get('job-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/api/admin/offboarding/job-1');
		expect(init.method ?? 'GET').toBe('GET');
	});

	it('downloads an export through an AUTHENTICATED fetch of the same-origin path', async () => {
		const createObjectURL = vi.fn(() => 'blob:x');
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
		fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['zip']) });
		await downloadExport(JOB);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/tenant/offboarding/job-1/download');
		expect(init.headers.Authorization).toBe('Bearer jwt-1');
		expect(apiRelative('/api/admin/offboarding/x/download')).toBe('/admin/offboarding/x/download');
	});
});

describe('deleteOutcome', () => {
	const done = (result: Record<string, unknown>): OffboardingJobItem => ({
		...JOB,
		kind: 'delete',
		download_url: null,
		result
	});

	it('reports complete:false and the services whose data was NOT deleted', () => {
		const o = deleteOutcome(
			done({
				complete: false,
				not_deleted: [{ service: 'youtube_upload_service', data: ['oauth_tokens'] }],
				note: 'downstream keeps rows'
			})
		);
		expect(o).toEqual({
			complete: false,
			notDeleted: [{ service: 'youtube_upload_service', data: ['oauth_tokens'] }],
			note: 'downstream keeps rows'
		});
	});

	it('never claims complete when the flag is absent, or when services are listed', () => {
		expect(deleteOutcome(done({}))?.complete).toBe(false);
		expect(deleteOutcome(done({ complete: true, not_deleted: [{ service: 'x' }] }))?.complete).toBe(
			false
		);
		expect(deleteOutcome(done({ complete: true, not_deleted: [] }))?.complete).toBe(true);
	});

	it('is null for an export or an unfinished delete', () => {
		expect(deleteOutcome(JOB)).toBeNull();
		expect(deleteOutcome({ ...done({}), status: 'running' })).toBeNull();
	});
});

describe('pollWithBackoff', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('backs off from the initial delay, caps it, and stops once nothing is in flight', async () => {
		const at: number[] = [];
		const start = Date.now();
		let n = 0;
		const tick = vi.fn(async () => {
			at.push(Date.now() - start);
			return ++n < 8;
		});
		const done = pollWithBackoff(tick, { signal: new AbortController().signal });
		await vi.runAllTimersAsync();
		await done;
		expect(tick).toHaveBeenCalledTimes(8);
		expect(at[0]).toBe(POLL_INITIAL_MS);
		const gaps = at.slice(1).map((t, i) => t - at[i]);
		for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
		expect(Math.max(...gaps)).toBe(POLL_MAX_MS);
	});

	it('stops at once on abort', async () => {
		const ctl = new AbortController();
		const tick = vi.fn(async () => true);
		const done = pollWithBackoff(tick, { signal: ctl.signal });
		await vi.advanceTimersByTimeAsync(POLL_INITIAL_MS);
		expect(tick).toHaveBeenCalledTimes(1);
		ctl.abort();
		await done;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(tick).toHaveBeenCalledTimes(1);
	});

	it('gives up on a permanent 4xx, reporting it', async () => {
		const onError = vi.fn();
		const err = new ApiError(
			404,
			'Not Found',
			'offboarding job not found',
			'OFFBOARDING_NOT_FOUND'
		);
		const tick = vi.fn(async () => {
			throw err;
		});
		const done = pollWithBackoff(tick, { signal: new AbortController().signal, onError });
		await vi.runAllTimersAsync();
		await done;
		expect(tick).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(err);
	});

	it('retries transient errors, clears the error on success, gives up after the cap', async () => {
		const onError = vi.fn();
		const tick = vi
			.fn<() => Promise<boolean>>()
			.mockRejectedValueOnce(new ApiError(503, 'Unavailable', 'down'))
			.mockResolvedValueOnce(true)
			.mockRejectedValue(new ApiError(502, 'Bad Gateway', 'down'));
		const done = pollWithBackoff(tick, { signal: new AbortController().signal, onError });
		await vi.runAllTimersAsync();
		await done;
		expect(tick).toHaveBeenCalledTimes(2 + POLL_MAX_ERRORS);
		expect(onError).toHaveBeenCalledWith(null);
	});
});

describe('progressSummary', () => {
	const running = (kind: 'export' | 'delete', progress: Record<string, unknown>) =>
		({ ...JOB, kind, status: 'running', progress }) as OffboardingJobItem;

	it('describes each delete phase from the heartbeat', () => {
		expect(progressSummary(running('delete', { forced_over: [] }))).toBe('Deleting database rows…');
		expect(
			progressSummary(
				running('delete', {
					rows_deleted: true,
					deleted_rows: { projects: 3, runs: 7 },
					prefixes_done: ['a/'],
					prefixes_pending: ['b/', 'c/']
				})
			)
		).toBe('10 rows deleted · purging storage: 1 of 3 prefixes');
	});

	it('describes each export phase from the heartbeat', () => {
		expect(progressSummary(running('export', {}))).toBe('Starting…');
		expect(progressSummary(running('export', { phase: 'tables', tables: { a: 2, b: 3 } }))).toBe(
			'Exporting tables: 2 done, 5 rows'
		);
		expect(
			progressSummary(running('export', { phase: 'objects', tables: { a: 2 }, objects: 4 }))
		).toBe('Copying files: 4 so far (1 tables exported)');
	});

	it('is null for a job that is not running', () => {
		expect(progressSummary(JOB)).toBeNull();
		expect(progressSummary({ ...JOB, status: 'requested' })).toBeNull();
	});
});

describe('isResumableAfterRows', () => {
	it('only a FAILED delete whose rows are gone', () => {
		const d = { ...JOB, kind: 'delete' as const, status: 'failed' as const };
		expect(isResumableAfterRows({ ...d, progress: { rows_deleted: true } })).toBe(true);
		expect(isResumableAfterRows({ ...d, progress: {} })).toBe(false);
		expect(
			isResumableAfterRows({ ...d, status: 'running', progress: { rows_deleted: true } })
		).toBe(false);
		expect(isResumableAfterRows(null)).toBe(false);
	});
});

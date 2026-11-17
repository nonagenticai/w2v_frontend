import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { tenantMock, adminMock, downloadMock } = vi.hoisted(() => ({
	tenantMock: { list: vi.fn(), request: vi.fn() },
	adminMock: {
		list: vi.fn(),
		get: vi.fn(),
		approve: vi.fn(),
		reject: vi.fn(),
		exportTenant: vi.fn(),
		plan: vi.fn(),
		deleteTenant: vi.fn()
	},
	downloadMock: vi.fn()
}));
vi.mock('$lib/api/tenant-offboarding.js', async () => {
	const actual: typeof import('$lib/api/tenant-offboarding.js') = await vi.importActual(
		'$lib/api/tenant-offboarding.js'
	);
	return {
		...actual,
		tenantOffboarding: tenantMock,
		adminOffboarding: adminMock,
		downloadExport: downloadMock
	};
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { OffboardingJobItem, OffboardingPlanView } from '$lib/api/tenant-offboarding.js';
import TenantOffboardingCard from './TenantOffboardingCard.svelte';
import OffboardingQueue from './OffboardingQueue.svelte';
import TenantDeleteDialog from './TenantDeleteDialog.svelte';

const base: OffboardingJobItem = {
	id: 'job-e',
	tenant_id: 'ten-1',
	kind: 'export',
	status: 'done',
	force: false,
	progress: {},
	created_at: '2026-10-09T10:00:00Z',
	updated_at: '2026-10-09T10:00:00Z',
	download_url: '/api/tenant/offboarding/job-e/download'
};
const DELETED: OffboardingJobItem = {
	...base,
	id: 'job-d',
	kind: 'delete',
	download_url: null,
	result: {
		complete: false,
		not_deleted: [
			{ service: 'youtube_upload_service', data: ['oauth_tokens', 'upload_jobs'] },
			{ service: 'video_compiler_service', data: ['compile_jobs'] }
		],
		note: 'orchestrator data deleted; downstream services keep their own tenant rows'
	}
};
const PLAN: OffboardingPlanView = {
	tenant_id: 'ten-1',
	tenant_name: 'acme',
	tenant_status: 'suspended',
	confirm_token: 'acme',
	deletable: false,
	blockers: [{ code: 'EXPORT_MISSING', message: 'no completed export', overridable: true }],
	rows: { projects: 3, runs: 7 },
	object_prefixes: ['tenants/ten-1/'],
	retained: [{ what: 'tenants row (tombstone)', why: 'audit' }],
	not_deleted: [{ service: 'youtube_upload_service', data: ['oauth_tokens'] }]
};

beforeEach(() => {
	vi.clearAllMocks();
	tenantMock.list.mockResolvedValue({ items: [base, DELETED] });
	adminMock.list.mockResolvedValue({ items: [] });
	adminMock.plan.mockResolvedValue(PLAN);
	adminMock.get.mockImplementation(async (id: string) => ({ ...base, id }));
});

describe('TenantOffboardingCard (tenant_admin)', () => {
	it('lists requests, downloads an export via the authenticated helper, and shows NOT-deleted services', async () => {
		render(TenantOffboardingCard);
		const rows = await screen.findAllByTestId('tenant-offboarding-job');
		expect(rows).toHaveLength(2);
		await fireEvent.click(within(rows[0]).getByRole('button', { name: 'Download export' }));
		expect(downloadMock).toHaveBeenCalledWith(base);

		const notice = within(rows[1]).getByTestId('offboarding-delete-incomplete');
		expect(notice).toHaveTextContent('Deletion is NOT complete');
		expect(notice).toHaveTextContent('2 services were not deleted');
		expect(notice).toHaveTextContent('youtube_upload_service');
		expect(notice).toHaveTextContent('video_compiler_service');
	});

	it('requests a deletion with a reason after confirming', async () => {
		tenantMock.list.mockResolvedValue({ items: [] });
		tenantMock.request.mockResolvedValue({ ...base, kind: 'delete', status: 'requested' });
		render(TenantOffboardingCard);
		const btn = await screen.findByRole('button', { name: 'Request deletion' });
		await waitFor(() => expect(btn).not.toBeDisabled());
		await fireEvent.click(btn);
		const dialog = await screen.findByTestId('tenant-offboarding-request');
		const reason = dialog.querySelector('input[name="offboarding-reason"]') as HTMLInputElement;
		await fireEvent.input(reason, { target: { value: 'closing down' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Request deletion' }));
		await waitFor(() => expect(tenantMock.request).toHaveBeenCalledWith('delete', 'closing down'));
		// An open delete request disables a second one.
		await waitFor(() =>
			expect(screen.getAllByRole('button', { name: 'Request deletion' })[0]).toBeDisabled()
		);
	});
});

describe('OffboardingQueue (super_admin)', () => {
	it('approves a requested export and rejects a request', async () => {
		const req: OffboardingJobItem = {
			...base,
			id: 'job-r',
			status: 'requested',
			download_url: null
		};
		adminMock.list.mockResolvedValue({ items: [req] });
		adminMock.approve.mockResolvedValue({ ...req, status: 'running' });
		render(OffboardingQueue, { tenantName: () => 'Acme' });
		const row = await screen.findByTestId('offboarding-job');
		expect(row).toHaveTextContent('Acme');
		await fireEvent.click(within(row).getByRole('button', { name: 'Approve export' }));
		await waitFor(() => expect(adminMock.approve).toHaveBeenCalledWith('job-r'));
		await waitFor(() =>
			expect(screen.getByTestId('offboarding-job').getAttribute('data-status')).toBe('running')
		);
	});

	it('a requested delete opens the two-step dialog and approves with the typed token', async () => {
		const req: OffboardingJobItem = { ...DELETED, status: 'requested', result: null };
		adminMock.list.mockResolvedValue({ items: [req] });
		adminMock.approve.mockResolvedValue(DELETED);
		render(OffboardingQueue);
		const row = await screen.findByTestId('offboarding-job');
		await fireEvent.click(within(row).getByRole('button', { name: 'Review & delete…' }));
		const dialog = await screen.findByTestId('tenant-delete-dialog');
		await within(dialog).findByTestId('tenant-delete-not-deleted');
		await fireEvent.click(within(dialog).getByTestId('tenant-delete-force'));
		const input = dialog.querySelector('input[name="tenant-delete-confirm"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'acme' } });
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'Delete tenant permanently' })
		);
		await waitFor(() =>
			expect(adminMock.approve).toHaveBeenCalledWith('job-d', { confirm: 'acme', force: true })
		);
		expect(adminMock.deleteTenant).not.toHaveBeenCalled();
		expect(await within(dialog).findByTestId('offboarding-delete-incomplete')).toHaveTextContent(
			'NOT complete'
		);
	});
});

describe('TenantDeleteDialog (two-step delete)', () => {
	const del = () =>
		screen.getByRole('button', { name: 'Delete tenant permanently' }) as HTMLButtonElement;
	const typeToken = async (v: string) => {
		const input = document.querySelector('input[name="tenant-delete-confirm"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: v } });
	};

	it('shows the plan, and stays disabled until the token matches AND the soft blocker is forced', async () => {
		render(TenantDeleteDialog, { open: true, tenantId: 'ten-1' });
		const notDeleted = await screen.findByTestId('tenant-delete-not-deleted');
		expect(notDeleted).toHaveTextContent('Will NOT be deleted');
		expect(notDeleted).toHaveTextContent('youtube_upload_service');
		expect(screen.getByTestId('tenant-delete-counts')).toHaveTextContent('10 rows in 2 tables');
		expect(screen.getByTestId('tenant-delete-blockers')).toHaveTextContent('EXPORT_MISSING');

		await typeToken('acm');
		expect(del()).toBeDisabled();
		await typeToken('acme');
		expect(del()).toBeDisabled(); // soft blocker not yet forced
		await fireEvent.click(screen.getByTestId('tenant-delete-force'));
		expect(del()).not.toBeDisabled();

		adminMock.deleteTenant.mockResolvedValue(DELETED);
		await fireEvent.click(del());
		await waitFor(() => expect(adminMock.deleteTenant).toHaveBeenCalledWith('ten-1', 'acme', true));
		const notice = await screen.findByTestId('offboarding-delete-incomplete');
		expect(within(notice).getByTestId('offboarding-not-deleted')).toHaveTextContent(
			'video_compiler_service'
		);
	});

	it('a hard blocker removes the confirm input entirely', async () => {
		adminMock.plan.mockResolvedValue({
			...PLAN,
			tenant_status: 'active',
			blockers: [{ code: 'NOT_SUSPENDED', message: 'suspend the tenant first', overridable: false }]
		});
		render(TenantDeleteDialog, { open: true, tenantId: 'ten-1' });
		expect(await screen.findByTestId('tenant-delete-blockers')).toHaveTextContent(
			'cannot be overridden'
		);
		expect(document.querySelector('input[name="tenant-delete-confirm"]')).toBeNull();
		expect(del()).toBeDisabled();
	});
});

describe('202 + polling (the work runs detached on the orchestrator)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const RUNNING_DEL: OffboardingJobItem = {
		...DELETED,
		status: 'running',
		result: null,
		progress: { forced_over: ['EXPORT_MISSING'] }
	};
	const PURGING: OffboardingJobItem = {
		...RUNNING_DEL,
		progress: {
			rows_deleted: true,
			deleted_rows: { projects: 3, runs: 7 },
			prefixes_done: ['a/'],
			prefixes_pending: ['b/']
		}
	};

	it('the dialog polls the 202 job, shows its progress, then the honest final report', async () => {
		adminMock.deleteTenant.mockResolvedValue(RUNNING_DEL);
		adminMock.get.mockResolvedValueOnce(PURGING).mockResolvedValueOnce(DELETED);
		const onStarted = vi.fn();
		const onDone = vi.fn();
		render(TenantDeleteDialog, { open: true, tenantId: 'ten-1', onStarted, onDone });
		await screen.findByTestId('tenant-delete-not-deleted');
		await fireEvent.click(screen.getByTestId('tenant-delete-force'));
		const input = document.querySelector('input[name="tenant-delete-confirm"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'acme' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete tenant permanently' }));

		expect(await screen.findByTestId('tenant-delete-progress')).toHaveTextContent(
			'Deleting database rows'
		);
		expect(onStarted).toHaveBeenCalledWith(RUNNING_DEL);
		expect(onDone).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2_000);
		await waitFor(() =>
			expect(screen.getByTestId('tenant-delete-progress')).toHaveTextContent(
				'10 rows deleted · purging storage: 1 of 2 prefixes'
			)
		);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(await screen.findByTestId('offboarding-delete-incomplete')).toHaveTextContent(
			'NOT complete'
		);
		expect(screen.queryByTestId('tenant-delete-progress')).toBeNull();
		expect(adminMock.get).toHaveBeenCalledWith('job-d');
		expect(onDone).toHaveBeenCalledWith(DELETED);
		// Terminal: no further polling.
		const calls = adminMock.get.mock.calls.length;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(adminMock.get.mock.calls.length).toBe(calls);
	});

	it('a failed background delete shows the job error', async () => {
		adminMock.deleteTenant.mockResolvedValue(RUNNING_DEL);
		adminMock.get.mockResolvedValue({
			...PURGING,
			status: 'failed',
			error: "STORAGE: could not purge 'b/' (2 object(s) left)"
		});
		render(TenantDeleteDialog, { open: true, tenantId: 'ten-1' });
		await screen.findByTestId('tenant-delete-not-deleted');
		await fireEvent.click(screen.getByTestId('tenant-delete-force'));
		const input = document.querySelector('input[name="tenant-delete-confirm"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'acme' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete tenant permanently' }));
		await vi.advanceTimersByTimeAsync(2_000);
		expect(await screen.findByTestId('tenant-delete-job-error')).toHaveTextContent(
			'could not purge'
		);
	});

	it('the queue re-attaches to a RUNNING job found on load (a page reload loses nothing)', async () => {
		adminMock.list.mockResolvedValue({ items: [PURGING] });
		adminMock.get.mockResolvedValueOnce(DELETED);
		render(OffboardingQueue);
		expect(await screen.findByTestId('offboarding-progress')).toHaveTextContent(
			'purging storage: 1 of 2 prefixes'
		);
		await vi.advanceTimersByTimeAsync(2_000);
		await waitFor(() =>
			expect(screen.getByTestId('offboarding-job').getAttribute('data-status')).toBe('done')
		);
		expect(adminMock.get).toHaveBeenCalledWith('job-d');
		expect(screen.getByTestId('offboarding-delete-incomplete')).toBeInTheDocument();
		expect(adminMock.get).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(adminMock.get).toHaveBeenCalledTimes(1);
	});

	it('the queue polls an export it just approved (202) until done, then offers the download', async () => {
		const req: OffboardingJobItem = {
			...base,
			id: 'job-r',
			status: 'requested',
			download_url: null
		};
		adminMock.list.mockResolvedValue({ items: [req] });
		adminMock.approve.mockResolvedValue({ ...req, status: 'running', progress: {} });
		adminMock.get.mockResolvedValueOnce({ ...base, id: 'job-r' });
		render(OffboardingQueue);
		const row = await screen.findByTestId('offboarding-job');
		await fireEvent.click(within(row).getByRole('button', { name: 'Approve export' }));
		expect(await screen.findByTestId('offboarding-progress')).toHaveTextContent('Starting');
		await vi.advanceTimersByTimeAsync(2_000);
		expect(
			await within(screen.getByTestId('offboarding-job')).findByRole('button', {
				name: 'Download'
			})
		).toBeInTheDocument();
	});

	it('the tenant card re-lists while a job is running and stops once it is not', async () => {
		const running: OffboardingJobItem = {
			...base,
			status: 'running',
			download_url: null,
			progress: { phase: 'objects', tables: { a: 1 }, objects: 2 }
		};
		tenantMock.list
			.mockResolvedValueOnce({ items: [running] })
			.mockResolvedValueOnce({ items: [base] });
		render(TenantOffboardingCard);
		expect(await screen.findByTestId('tenant-offboarding-progress')).toHaveTextContent(
			'Copying files: 2 so far'
		);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(await screen.findByRole('button', { name: 'Download export' })).toBeInTheDocument();
		expect(tenantMock.list).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(tenantMock.list).toHaveBeenCalledTimes(2);
	});
});

describe('resuming a failed delete', () => {
	it('past the rows phase, ALREADY_DELETED does not block the resume (the API skips the preflight)', async () => {
		adminMock.plan.mockResolvedValue({
			...PLAN,
			tenant_name: null,
			tenant_status: 'deleted',
			confirm_token: 'ten-1',
			blockers: [{ code: 'ALREADY_DELETED', message: 'the tenant was deleted', overridable: false }]
		});
		const failed: OffboardingJobItem = {
			...DELETED,
			status: 'failed',
			result: null,
			error: 'STORAGE: could not purge',
			progress: { rows_deleted: true, prefixes_done: [], prefixes_pending: ['b/'] }
		};
		adminMock.deleteTenant.mockResolvedValue(DELETED);
		render(TenantDeleteDialog, { open: true, tenantId: 'ten-1', job: failed });
		expect(await screen.findByTestId('tenant-delete-resuming')).toBeInTheDocument();
		expect(screen.queryByTestId('tenant-delete-blockers')).toBeNull();
		const btn = screen.getByRole('button', { name: 'Delete tenant permanently' });
		expect(btn).toBeDisabled();
		const input = document.querySelector('input[name="tenant-delete-confirm"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'ten-1' } });
		expect(btn).not.toBeDisabled();
		await fireEvent.click(btn);
		await waitFor(() =>
			expect(adminMock.deleteTenant).toHaveBeenCalledWith('ten-1', 'ten-1', false)
		);
		expect(adminMock.approve).not.toHaveBeenCalled();
	});

	it('a deleted tenant WITHOUT a resumable job stays hard-blocked', async () => {
		adminMock.plan.mockResolvedValue({
			...PLAN,
			tenant_status: 'deleted',
			blockers: [{ code: 'ALREADY_DELETED', message: 'the tenant was deleted', overridable: false }]
		});
		render(TenantDeleteDialog, { open: true, tenantId: 'ten-1' });
		expect(await screen.findByTestId('tenant-delete-blockers')).toHaveTextContent(
			'ALREADY_DELETED'
		);
		expect(document.querySelector('input[name="tenant-delete-confirm"]')).toBeNull();
	});
});

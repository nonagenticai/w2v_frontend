<script lang="ts">
	// Super-admin offboarding queue (P6 ORCH-6) — GET /api/admin/offboarding.
	// Requested exports are approved in one click (approve = execute; the export
	// builds in the background). A requested — or failed, resumable — delete goes
	// through the two-step TenantDeleteDialog (plan → typed confirm token). Reject
	// closes a request with an optional reason. Finished exports download through
	// an authenticated fetch; finished deletes show what was NOT deleted.
	// Approve / export / delete answer 202 with a `running` job: every running job
	// in the list is polled (GET /admin/offboarding/{id}, backoff) until terminal,
	// including the ones found on load — a page reload re-attaches.
	import { onDestroy, onMount } from 'svelte';
	import {
		adminOffboarding,
		deleteOutcome,
		downloadExport,
		isInFlight,
		offboardingError,
		pollWithBackoff,
		progressSummary,
		OFFBOARDING_STATUS_LABEL,
		type OffboardingJobItem,
		type OffboardingStatusName
	} from '$lib/api/tenant-offboarding.js';
	import { formatDateTime } from '$lib/utils/format';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import {
		Button,
		Card,
		Dialog,
		ErrorState,
		Input,
		Pill,
		Select,
		Skeleton
	} from '$lib/components/ui';
	import DeleteOutcomeNotice from './DeleteOutcomeNotice.svelte';
	import TenantDeleteDialog from './TenantDeleteDialog.svelte';

	let {
		tenantName = () => null
	}: {
		/** Display name for a tenant id (from the page's tenant list). */
		tenantName?: (tenantId: string) => string | null;
	} = $props();

	let jobs = $state<OffboardingJobItem[]>([]);
	let loading = $state(true);
	let loadError = $state<unknown>(null);
	let statusFilter = $state<'' | OffboardingStatusName>('');

	const statusOptions = [
		{ value: '', label: 'All statuses' },
		{ value: 'requested', label: 'Requested' },
		{ value: 'running', label: 'Running' },
		{ value: 'done', label: 'Done' },
		{ value: 'failed', label: 'Failed' },
		{ value: 'rejected', label: 'Rejected' }
	];

	async function load(): Promise<void> {
		loadError = null;
		try {
			jobs = (await adminOffboarding.list(statusFilter ? { status: statusFilter } : {})).items;
			ensurePolling();
		} catch (e) {
			loadError = e;
		} finally {
			loading = false;
		}
	}
	onMount(() => void load());

	// --- Poll every running job until it is terminal ---
	let pollAbort: AbortController | null = null;
	let destroyed = false;
	let pollError = $state('');
	function ensurePolling(): void {
		if (destroyed || pollAbort || !jobs.some(isInFlight)) return;
		const ctl = new AbortController();
		pollAbort = ctl;
		void pollWithBackoff(
			async () => {
				const running = jobs.filter(isInFlight);
				if (running.length === 0) return false;
				const fresh = await Promise.all(running.map((j) => adminOffboarding.get(j.id)));
				if (ctl.signal.aborted) return false;
				for (const j of fresh) replace(j, false);
				return fresh.some(isInFlight);
			},
			{
				signal: ctl.signal,
				onError: (e) => {
					pollError = e ? offboardingError(e, "Couldn't refresh the running jobs.") : '';
				}
			}
		).finally(() => {
			if (pollAbort === ctl) pollAbort = null;
			// A job started while the last tick was finishing is picked up here.
			if (!ctl.signal.aborted && !pollError) ensurePolling();
		});
	}
	onDestroy(() => {
		destroyed = true;
		pollAbort?.abort();
	});

	/** Re-read the queue (the page calls this after a direct export/delete). */
	export function reload(): Promise<void> {
		return load();
	}

	function onFilter(e: Event): void {
		statusFilter = (e.currentTarget as HTMLSelectElement).value as '' | OffboardingStatusName;
		loading = true;
		void load();
	}

	const label = (j: OffboardingJobItem): string => tenantName(j.tenant_id) ?? j.tenant_id;
	const statusTone = (s: OffboardingStatusName) =>
		s === 'done' ? 'success' : s === 'failed' || s === 'rejected' ? 'danger' : 'warning';

	let busyId = $state<string | null>(null);
	let rowError = $state<Record<string, string>>({});
	const setRowError = (id: string, msg: string): void => {
		rowError = { ...rowError, [id]: msg };
	};
	const replace = (job: OffboardingJobItem, poll = true): void => {
		jobs = jobs.some((j) => j.id === job.id)
			? jobs.map((j) => (j.id === job.id ? job : j))
			: [job, ...jobs];
		if (poll) ensurePolling();
	};

	async function approveExport(job: OffboardingJobItem): Promise<void> {
		busyId = job.id;
		setRowError(job.id, '');
		try {
			replace(await adminOffboarding.approve(job.id));
			toastSuccess('Export started', label(job));
		} catch (e) {
			setRowError(job.id, offboardingError(e, 'Approving the export failed.'));
		} finally {
			busyId = null;
		}
	}

	async function download(job: OffboardingJobItem): Promise<void> {
		busyId = job.id;
		setRowError(job.id, '');
		try {
			await downloadExport(job);
		} catch (e) {
			setRowError(job.id, offboardingError(e, 'The download failed.'));
		} finally {
			busyId = null;
		}
	}

	// --- Reject (with an optional reason) ---
	let rejectOpen = $state(false);
	let rejectTarget = $state<OffboardingJobItem | null>(null);
	let rejectReason = $state('');
	let rejecting = $state(false);
	let rejectError = $state('');
	function openReject(job: OffboardingJobItem): void {
		rejectTarget = job;
		rejectReason = '';
		rejectError = '';
		rejectOpen = true;
	}
	async function confirmReject(): Promise<void> {
		const job = rejectTarget;
		if (!job || rejecting) return;
		rejecting = true;
		rejectError = '';
		try {
			replace(await adminOffboarding.reject(job.id, rejectReason));
			rejectOpen = false;
			toastSuccess('Request rejected', label(job));
		} catch (e) {
			rejectError = offboardingError(e, 'Rejecting failed.');
		} finally {
			rejecting = false;
		}
	}

	// --- Two-step delete ---
	let deleteOpen = $state(false);
	let deleteJob = $state<OffboardingJobItem | null>(null);
	function openDelete(job: OffboardingJobItem): void {
		deleteJob = job;
		deleteOpen = true;
	}
</script>

<div class="mb-6" data-testid="offboarding-queue">
	<Card class="p-5">
		<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-[var(--color-text)]">Offboarding queue</h2>
				<p class="text-xs text-[var(--color-text-muted)]">
					Tenant requests to export or delete their data, and operator-started jobs.
				</p>
			</div>
			<Select
				name="offboarding-status"
				value={statusFilter}
				options={statusOptions}
				placeholder=""
				onchange={onFilter}
				class="min-w-[10rem]"
			/>
		</div>

		{#if loading}
			<Skeleton height="2.5rem" />
		{:else if loadError}
			<ErrorState
				title="Couldn't load the offboarding queue"
				error={loadError}
				onRetry={() => void load()}
			/>
		{:else if jobs.length === 0}
			<p class="text-sm text-[var(--color-text-muted)]" data-testid="offboarding-queue-empty">
				No offboarding jobs.
			</p>
		{:else}
			{#if pollError}
				<p class="mb-2 text-sm text-status-failed" data-testid="offboarding-poll-error">
					{pollError}
				</p>
			{/if}
			<ul class="divide-y divide-[var(--color-border)]">
				{#each jobs as job (job.id)}
					{@const outcome = deleteOutcome(job)}
					{@const progress = progressSummary(job)}
					<li
						class="py-3"
						data-testid="offboarding-job"
						data-kind={job.kind}
						data-status={job.status}
					>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="min-w-0 text-sm text-[var(--color-text)]">
								<span class="font-medium">{job.kind === 'export' ? 'Export' : 'Delete'}</span>
								<span class="ml-1">{label(job)}</span>
								<span class="ml-1">
									<Pill tone={statusTone(job.status)}>{OFFBOARDING_STATUS_LABEL[job.status]}</Pill>
								</span>
								{#if job.force}<span class="ml-1"><Pill tone="danger">forced</Pill></span>{/if}
								<p class="mt-0.5 text-xs text-[var(--color-text-muted)]">
									{formatDateTime(job.created_at)}{#if job.reason}
										· {job.reason}{/if}
								</p>
							</div>
							<div class="flex shrink-0 gap-2">
								{#if job.status === 'requested' && job.kind === 'export'}
									<Button
										variant="primary"
										size="sm"
										loading={busyId === job.id}
										onclick={() => approveExport(job)}
									>
										Approve export
									</Button>
								{/if}
								{#if job.status === 'requested' && job.kind === 'delete'}
									<Button variant="danger" size="sm" onclick={() => openDelete(job)}>
										Review &amp; delete…
									</Button>
								{/if}
								{#if job.status === 'failed' && job.kind === 'delete'}
									<Button variant="danger" size="sm" onclick={() => openDelete(job)}>
										Resume delete…
									</Button>
								{/if}
								{#if job.status === 'requested'}
									<Button variant="ghost" size="sm" onclick={() => openReject(job)}>Reject</Button>
								{/if}
								{#if job.download_url}
									<Button
										variant="secondary"
										size="sm"
										loading={busyId === job.id}
										onclick={() => download(job)}
									>
										Download
									</Button>
								{/if}
							</div>
						</div>
						{#if progress}
							<p
								class="mt-1 text-xs text-[var(--color-text-muted)]"
								data-testid="offboarding-progress"
							>
								{progress}
							</p>
						{/if}
						{#if job.error}
							<p class="mt-1 text-xs text-status-failed">{job.error}</p>
						{/if}
						{#if outcome}
							<DeleteOutcomeNotice {outcome} />
						{/if}
						{#if rowError[job.id]}
							<p class="mt-1 text-sm text-status-failed" data-testid="offboarding-row-error">
								{rowError[job.id]}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>

<Dialog bind:open={rejectOpen} title="Reject this request?">
	{#if rejectOpen && rejectTarget}
		<div class="flex flex-col gap-4" data-testid="offboarding-reject-dialog">
			<p class="text-sm text-[var(--color-text)]">
				{rejectTarget.kind === 'export' ? 'Export' : 'Deletion'} request from
				<strong>{label(rejectTarget)}</strong>. The tenant sees the reason.
			</p>
			<Input name="offboarding-reject-reason" label="Reason (optional)" bind:value={rejectReason} />
			{#if rejectError}
				<p class="text-sm text-status-failed">{rejectError}</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (rejectOpen = false)}>Cancel</Button>
				<Button
					variant="danger"
					size="sm"
					loading={rejecting}
					disabled={rejectReason.trim().length > 1000}
					onclick={confirmReject}
				>
					Reject
				</Button>
			</div>
		</div>
	{/if}
</Dialog>

<TenantDeleteDialog
	bind:open={deleteOpen}
	tenantId={deleteJob?.tenant_id ?? null}
	tenantLabel={deleteJob ? label(deleteJob) : undefined}
	job={deleteJob}
	onStarted={(job) => replace(job)}
	onDone={(job) => replace(job)}
/>

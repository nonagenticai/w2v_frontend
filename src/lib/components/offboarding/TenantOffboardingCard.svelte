<script lang="ts">
	// Tenant-admin offboarding (P6 ORCH-6): REQUEST an export of the workspace's
	// data, or its deletion. Nothing happens until a platform operator approves —
	// the copy says so. Lists this workspace's requests with their status, the
	// export download (an authenticated fetch of the same-origin `download_url`),
	// and — for a finished delete — the services whose data was NOT deleted.
	// A running job (approved by the operator; the work runs in the background) is
	// polled by re-listing — the tenant side has no single-job GET — with backoff
	// until nothing is running; a page reload re-attaches via the same list.
	import { onDestroy, onMount } from 'svelte';
	import {
		deleteOutcome,
		downloadExport,
		isInFlight,
		offboardingError,
		pollWithBackoff,
		progressSummary,
		tenantOffboarding,
		OFFBOARDING_STATUS_LABEL,
		type OffboardingJobItem,
		type OffboardingKindName
	} from '$lib/api/tenant-offboarding.js';
	import { formatDateTime } from '$lib/utils/format';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { Button, Card, Dialog, ErrorState, Input, Pill, Skeleton } from '$lib/components/ui';
	import DeleteOutcomeNotice from './DeleteOutcomeNotice.svelte';

	let jobs = $state<OffboardingJobItem[]>([]);
	let loading = $state(true);
	let loadError = $state<unknown>(null);

	async function load(): Promise<void> {
		loadError = null;
		try {
			jobs = (await tenantOffboarding.list()).items;
			ensurePolling();
		} catch (e) {
			loadError = e;
		} finally {
			loading = false;
		}
	}
	onMount(() => void load());

	let pollAbort: AbortController | null = null;
	let destroyed = false;
	let pollError = $state('');
	function ensurePolling(): void {
		if (destroyed || pollAbort || !jobs.some(isInFlight)) return;
		const ctl = new AbortController();
		pollAbort = ctl;
		void pollWithBackoff(
			async () => {
				const items = (await tenantOffboarding.list()).items;
				if (ctl.signal.aborted) return false;
				jobs = items;
				return items.some(isInFlight);
			},
			{
				signal: ctl.signal,
				onError: (e) => {
					pollError = e ? offboardingError(e, "Couldn't refresh the requests.") : '';
				}
			}
		).finally(() => {
			if (pollAbort === ctl) pollAbort = null;
		});
	}
	onDestroy(() => {
		destroyed = true;
		pollAbort?.abort();
	});

	const isOpen = (kind: OffboardingKindName): boolean =>
		jobs.some((j) => j.kind === kind && (j.status === 'requested' || j.status === 'running'));

	// --- Request (confirmed, with an optional reason) ---
	let requestKind = $state<OffboardingKindName | null>(null);
	let requestOpen = $state(false);
	let reason = $state('');
	let submitting = $state(false);
	let requestError = $state('');

	function openRequest(kind: OffboardingKindName): void {
		requestKind = kind;
		reason = '';
		requestError = '';
		requestOpen = true;
	}

	async function submitRequest(): Promise<void> {
		const kind = requestKind;
		if (!kind || submitting) return;
		submitting = true;
		requestError = '';
		try {
			const job = await tenantOffboarding.request(kind, reason);
			jobs = [job, ...jobs];
			requestOpen = false;
			toastSuccess(
				kind === 'export' ? 'Export requested' : 'Deletion requested',
				'A platform operator will review the request.'
			);
		} catch (e) {
			requestError = offboardingError(e, 'The request failed. Try again.');
		} finally {
			submitting = false;
		}
	}

	// --- Download ---
	let downloadingId = $state<string | null>(null);
	let rowError = $state<Record<string, string>>({});
	async function download(job: OffboardingJobItem): Promise<void> {
		downloadingId = job.id;
		rowError = { ...rowError, [job.id]: '' };
		try {
			await downloadExport(job);
		} catch (e) {
			rowError = { ...rowError, [job.id]: offboardingError(e, 'The download failed.') };
		} finally {
			downloadingId = null;
		}
	}

	const statusTone = (s: OffboardingJobItem['status']) =>
		s === 'done' ? 'success' : s === 'failed' || s === 'rejected' ? 'danger' : 'warning';

	const rejectionReason = (j: OffboardingJobItem): string | null => {
		const r = j.result?.rejection_reason;
		return typeof r === 'string' && r ? r : null;
	};
</script>

<div data-testid="tenant-offboarding">
	<Card class="p-5">
		<h2 class="text-sm font-semibold text-[var(--color-text)]">Export or delete workspace data</h2>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Request a full export of this workspace's data, or its deletion. A platform operator reviews
			and carries out each request; nothing is exported or deleted until then. A deletion is
			permanent.
		</p>
		<div class="mt-4 flex flex-wrap gap-2">
			<Button
				variant="secondary"
				size="sm"
				disabled={loading || isOpen('export')}
				onclick={() => openRequest('export')}>Request export</Button
			>
			<Button
				variant="danger"
				size="sm"
				disabled={loading || isOpen('delete')}
				onclick={() => openRequest('delete')}>Request deletion</Button
			>
		</div>

		<div class="mt-4">
			{#if loading}
				<Skeleton height="2.5rem" />
			{:else if loadError}
				<ErrorState
					title="Couldn't load offboarding requests"
					error={loadError}
					onRetry={() => void load()}
				/>
			{:else if jobs.length > 0}
				{#if pollError}
					<p class="mb-2 text-sm text-status-failed" data-testid="tenant-offboarding-poll-error">
						{pollError}
					</p>
				{/if}
				<ul class="divide-y divide-[var(--color-border)]" data-testid="tenant-offboarding-jobs">
					{#each jobs as job (job.id)}
						{@const outcome = deleteOutcome(job)}
						{@const progress = progressSummary(job)}
						<li class="py-3" data-testid="tenant-offboarding-job" data-kind={job.kind}>
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="flex items-center gap-2 text-sm text-[var(--color-text)]">
									<span class="font-medium">{job.kind === 'export' ? 'Export' : 'Deletion'}</span>
									<Pill tone={statusTone(job.status)}>{OFFBOARDING_STATUS_LABEL[job.status]}</Pill>
									<span class="text-xs text-[var(--color-text-muted)]"
										>requested {formatDateTime(job.created_at)}</span
									>
								</div>
								{#if job.download_url}
									<Button
										variant="secondary"
										size="sm"
										loading={downloadingId === job.id}
										onclick={() => download(job)}>Download export</Button
									>
								{/if}
							</div>
							{#if job.reason}
								<p class="mt-1 text-xs text-[var(--color-text-muted)]">Reason: {job.reason}</p>
							{/if}
							{#if job.status === 'rejected' && rejectionReason(job)}
								<p class="mt-1 text-xs text-[var(--color-text-muted)]">
									Rejected: {rejectionReason(job)}
								</p>
							{/if}
							{#if progress}
								<p
									class="mt-1 text-xs text-[var(--color-text-muted)]"
									data-testid="tenant-offboarding-progress"
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
								<p
									class="mt-1 text-sm text-status-failed"
									data-testid="tenant-offboarding-row-error"
								>
									{rowError[job.id]}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</Card>
</div>

<Dialog
	bind:open={requestOpen}
	title={requestKind === 'delete'
		? 'Request deletion of this workspace?'
		: 'Request a data export?'}
>
	{#if requestOpen && requestKind}
		<div class="flex flex-col gap-4" data-testid="tenant-offboarding-request">
			<p class="text-sm text-[var(--color-text)]">
				{#if requestKind === 'delete'}
					Once an operator approves, this workspace's projects, runs, media and settings are deleted
					permanently. Request an export first if you need a copy.
				{:else}
					An operator will build a zip of this workspace's data; it appears here to download once it
					is ready.
				{/if}
			</p>
			<Input name="offboarding-reason" label="Reason (optional)" bind:value={reason} />
			{#if requestError}
				<p class="text-sm text-status-failed" data-testid="tenant-offboarding-request-error">
					{requestError}
				</p>
			{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (requestOpen = false)}>Cancel</Button>
				<Button
					variant={requestKind === 'delete' ? 'danger' : 'primary'}
					size="sm"
					loading={submitting}
					disabled={reason.trim().length > 1000}
					onclick={submitRequest}
					>{requestKind === 'delete' ? 'Request deletion' : 'Request export'}</Button
				>
			</div>
		</div>
	{/if}
</Dialog>

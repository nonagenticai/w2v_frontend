<script lang="ts">
	// Super-admin two-step tenant delete (P6 ORCH-6).
	//   1. GET /api/admin/tenants/{t}/offboarding-plan — what would go, what stays,
	//      the blockers, and the `confirm_token`.
	//   2. The operator TYPES that token; then either approve the tenant's delete
	//      request (`job` requested → POST /admin/offboarding/{id}/approve) or delete
	//      directly (DELETE /admin/tenants/{t}?confirm=…&force=; also the resume of
	//      a failed delete).
	//   3. The 202 job runs in the background: poll GET /admin/offboarding/{id}
	//      (backoff) and show its progress until done / failed.
	// A hard blocker (not overridable) disables the delete outright; overridable
	// blockers need the explicit, audited `force` box. The finished job's
	// `complete:false` + `not_deleted` services are shown loudly — the delete never
	// claims more than it did.
	import { onDestroy } from 'svelte';
	import {
		adminOffboarding,
		deleteOutcome,
		isInFlight,
		isResumableAfterRows,
		offboardingError,
		pollWithBackoff,
		progressSummary,
		type OffboardingJobItem,
		type OffboardingPlanView
	} from '$lib/api/tenant-offboarding.js';
	import { Button, Dialog, Input, Skeleton } from '$lib/components/ui';
	import DeleteOutcomeNotice from './DeleteOutcomeNotice.svelte';

	let {
		open = $bindable(false),
		tenantId,
		tenantLabel,
		job = null,
		onStarted,
		onDone
	}: {
		open?: boolean;
		tenantId: string | null;
		tenantLabel?: string;
		/** The tenant's delete job this dialog acts on: a `requested` one is APPROVED
		 *  (POST /admin/offboarding/{id}/approve); a `failed` one is RESUMED by a
		 *  direct DELETE. Null for an operator-initiated delete. */
		job?: OffboardingJobItem | null;
		/** The 202: the delete is running in the background. */
		onStarted?: (job: OffboardingJobItem) => void;
		/** The job reached a terminal status (done / failed). */
		onDone?: (job: OffboardingJobItem) => void;
	} = $props();

	let plan = $state<OffboardingPlanView | null>(null);
	let planError = $state('');
	let loadingPlan = $state(false);
	let typed = $state('');
	let force = $state(false);
	let deleting = $state(false);
	let deleteError = $state('');
	/** The delete job once started — polled until terminal. */
	let current = $state<OffboardingJobItem | null>(null);
	let pollError = $state('');
	let loadedFor = $state<string | null>(null);
	let pollAbort: AbortController | null = null;

	const approveId = $derived(job?.status === 'requested' ? job.id : null);
	/** Rows already gone: the orchestrator skips the preflight on resume. */
	const resuming = $derived(isResumableAfterRows(job));

	function stopPolling(): void {
		pollAbort?.abort();
		pollAbort = null;
	}
	onDestroy(stopPolling);

	async function loadPlan(id: string): Promise<void> {
		loadingPlan = true;
		planError = '';
		plan = null;
		try {
			plan = await adminOffboarding.plan(id);
		} catch (e) {
			planError = offboardingError(e, "Couldn't load the deletion plan.");
		} finally {
			loadingPlan = false;
		}
	}

	// (Re)load the plan each time the dialog opens; reset the form with it. Closing
	// stops this dialog's poll (the queue keeps tracking the running job).
	$effect(() => {
		if (!open) {
			loadedFor = null;
			stopPolling();
			return;
		}
		const key = `${tenantId}:${job?.id ?? ''}`;
		if (!tenantId || loadedFor === key) return;
		loadedFor = key;
		typed = '';
		force = false;
		deleteError = '';
		pollError = '';
		current = null;
		void loadPlan(tenantId);
	});

	const blockers = $derived(
		(plan?.blockers ?? []).filter((b) => !(resuming && b.code === 'ALREADY_DELETED'))
	);
	const hard = $derived(blockers.filter((b) => !b.overridable));
	const soft = $derived(blockers.filter((b) => b.overridable));
	const totalRows = $derived(
		plan ? Object.values(plan.rows).reduce((sum, n) => sum + (Number(n) || 0), 0) : 0
	);
	const tokenMatches = $derived(plan !== null && typed === plan.confirm_token);
	const canDelete = $derived(
		plan !== null &&
			tokenMatches &&
			hard.length === 0 &&
			(soft.length === 0 || force) &&
			!deleting &&
			current === null
	);
	const outcome = $derived(current ? deleteOutcome(current) : null);
	const progress = $derived(current ? progressSummary(current) : null);

	function track(started: OffboardingJobItem): void {
		current = started;
		if (!isInFlight(started)) {
			onDone?.(started);
			return;
		}
		onStarted?.(started);
		stopPolling();
		const ctl = new AbortController();
		pollAbort = ctl;
		void pollWithBackoff(
			async () => {
				const fresh = await adminOffboarding.get(started.id);
				if (ctl.signal.aborted) return false;
				current = fresh;
				if (isInFlight(fresh)) return true;
				onDone?.(fresh);
				return false;
			},
			{
				signal: ctl.signal,
				onError: (e) => {
					pollError = e ? offboardingError(e, "Couldn't refresh the delete's progress.") : '';
				}
			}
		);
	}

	async function runDelete(): Promise<void> {
		if (!plan || !tenantId || !canDelete) return;
		deleting = true;
		deleteError = '';
		const useForce = soft.length > 0 && force;
		try {
			track(
				approveId
					? await adminOffboarding.approve(approveId, { confirm: typed, force: useForce })
					: await adminOffboarding.deleteTenant(tenantId, typed, useForce)
			);
		} catch (e) {
			deleteError = offboardingError(e, 'The delete failed.');
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog bind:open title="Delete tenant">
	{#if open}
		<div
			class="flex flex-col gap-4 text-sm text-[var(--color-text)]"
			data-testid="tenant-delete-dialog"
		>
			<p>
				<strong>{plan?.tenant_name ?? tenantLabel ?? tenantId}</strong>
				<span class="ml-1 font-mono text-xs text-[var(--color-text-muted)]">{tenantId}</span>
				{#if plan}<span class="ml-1 text-xs text-[var(--color-text-muted)]"
						>· status {plan.tenant_status}</span
					>{/if}
			</p>

			{#if loadingPlan}
				<Skeleton height="6rem" />
			{:else if planError}
				<p class="text-status-failed" data-testid="tenant-delete-plan-error">{planError}</p>
			{:else if plan}
				{#if current}
					<p data-testid="tenant-delete-finished">
						Delete job <span class="font-mono text-xs">{current.id}</span>: {current.status}.
					</p>
					{#if progress}
						<p class="text-xs text-[var(--color-text-muted)]" data-testid="tenant-delete-progress">
							{progress} You can close this dialog; the delete keeps running.
						</p>
					{/if}
					{#if current.status === 'failed' && current.error}
						<p class="text-status-failed" data-testid="tenant-delete-job-error">
							{current.error}
						</p>
					{/if}
					{#if pollError}
						<p class="text-status-failed" data-testid="tenant-delete-poll-error">{pollError}</p>
					{/if}
					{#if outcome}
						<DeleteOutcomeNotice {outcome} />
					{/if}
				{:else}
					{#if resuming}
						<p data-testid="tenant-delete-resuming">
							Resuming a failed delete: the database rows are already deleted; this finishes purging
							the stored files.
						</p>
					{/if}
					{#if blockers.length > 0}
						<div data-testid="tenant-delete-blockers">
							<p class="font-medium">Blockers</p>
							<ul class="mt-1 list-disc pl-5">
								{#each blockers as b (b.code)}
									<li class={b.overridable ? '' : 'text-status-failed'}>
										<span class="font-mono text-xs">{b.code}</span> — {b.message}
										{#if !b.overridable}<strong>(cannot be overridden)</strong>{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					<div>
						<p class="font-medium">Will be deleted</p>
						<p
							class="mt-1 text-xs text-[var(--color-text-muted)]"
							data-testid="tenant-delete-counts"
						>
							{totalRows.toLocaleString()} rows in {Object.keys(plan.rows).length} tables · {plan
								.object_prefixes.length} object prefixes
						</p>
					</div>

					<div
						role="alert"
						class="rounded-[var(--radius-md)] border border-[var(--color-danger)] p-3"
						data-testid="tenant-delete-not-deleted"
					>
						<p class="font-semibold text-[var(--color-danger)]">
							Will NOT be deleted — {plan.not_deleted.length}
							{plan.not_deleted.length === 1 ? 'service keeps' : 'services keep'} this tenant's data
						</p>
						<ul class="mt-1 list-disc pl-5">
							{#each plan.not_deleted as d (d.service)}
								<li>
									<span class="font-mono">{d.service}</span>{#if d.data && d.data.length > 0}
										<span class="text-xs text-[var(--color-text-muted)]">
											— {d.data.join(', ')}</span
										>
									{/if}
								</li>
							{/each}
						</ul>
					</div>

					{#if plan.retained.length > 0}
						<div>
							<p class="font-medium">Retained deliberately</p>
							<ul class="mt-1 list-disc pl-5 text-xs text-[var(--color-text-muted)]">
								{#each plan.retained as r, i (i)}
									<li>
										{r.what}{#if r.why}
											— {r.why}{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if hard.length === 0}
						{#if soft.length > 0}
							<label class="flex items-start gap-2">
								<input
									type="checkbox"
									name="tenant-delete-force"
									bind:checked={force}
									class="mt-0.5"
									data-testid="tenant-delete-force"
								/>
								<span>Override the blockers above (force). This is recorded in the audit log.</span>
							</label>
						{/if}
						<Input
							name="tenant-delete-confirm"
							label={`Type ${plan.confirm_token} to confirm`}
							bind:value={typed}
							autocomplete="off"
							spellcheck={false}
						/>
					{/if}
				{/if}
			{/if}

			{#if deleteError}
				<p class="text-status-failed" data-testid="tenant-delete-error">{deleteError}</p>
			{/if}

			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (open = false)}
					>{current ? 'Close' : 'Cancel'}</Button
				>
				{#if !current}
					<Button
						variant="danger"
						size="sm"
						loading={deleting}
						disabled={!canDelete}
						onclick={runDelete}>Delete tenant permanently</Button
					>
				{/if}
			</div>
		</div>
	{/if}
</Dialog>

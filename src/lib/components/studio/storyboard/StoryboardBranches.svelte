<script lang="ts">
	// Storyboard branches — fork the whole board into a hidden child project.
	//
	// A branch is an escape hatch for "what if we cut act 2 differently?": the
	// server copies panels + scenes + assets into a child project the user can
	// rework freely, leaving THIS board untouched. Opening a branch navigates to
	// that child project's workspace; abandoning it closes the fork for good.
	//
	// Branch-of-branch is supported: forking a branch mints a chain (root ← B ← C),
	// closed bottom-up on the way back. So creating a branch here no longer fails on
	// "this is already a branch" — the only create error is a missing/cross-tenant
	// root (404), surfaced plainly.
	//
	// Abandon is a one-way door, so it goes through an inline two-step confirm,
	// mirroring the restore/delete flows in StoryboardVersions. `window.confirm`
	// is deliberately NOT used: a native dialog is invisible to Playwright and
	// blocks the e2e suite.
	import { resolve } from '$app/paths';
	import { Badge, Pagination } from '$lib/components/ui';
	import StoryboardBranchMerge from './StoryboardBranchMerge.svelte';
	import {
		loadBranches,
		getBranches,
		getBranchList,
		getBranchesPage,
		areBranchesLoading,
		createBranch,
		abandonBranch,
		PAGE_SIZE
	} from '$lib/stores/storyboard.svelte.js';
	import { ApiError } from '$lib/api';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { formatRelativeTime } from '$lib/utils/format';
	import type { StoryboardBranch } from '$lib/types';

	let { projectId }: { projectId: string } = $props();

	let name = $state('');
	let creating = $state(false);
	// The branch id awaiting an abandon confirmation, or null. Only ever one —
	// opening a second confirm implicitly cancels the first.
	let confirmingAbandonId = $state<string | null>(null);
	let abandoningId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	// The branch whose merge review is open, or null. The review is a heavyweight
	// three-column diff, so only one is open at a time and it renders inline under
	// its row rather than in a dialog (a dialog would fight the horizontal scroll).
	let reviewingId = $state<string | null>(null);

	const busy = $derived(creating || abandoningId !== null);
	// A branch must be named — an unnamed fork is unfindable later.
	const canCreate = $derived(name.trim() !== '' && !busy);

	function errMessage(e: unknown, fallback = 'Something went wrong'): string {
		return e instanceof ApiError ? e.detail : fallback;
	}

	// Lazy first load. Mirrors StoryboardVersions' mount effect: only fetch when
	// this project has no cached list and nothing is already in flight, so the
	// refresh a create/abandon triggers can't re-enter here.
	$effect(() => {
		if (getBranches(projectId) === undefined && !areBranchesLoading(projectId)) {
			loadBranches(projectId).catch((e) => {
				loadError = errMessage(e, 'Could not load branches');
			});
		}
	});

	const branches = $derived(getBranchList(projectId));
	const loading = $derived(getBranches(projectId) === undefined && areBranchesLoading(projectId));
	// Server-authoritative total (not the page length) drives the pager; the page
	// number is derived from the store's remembered offset so it stays the single
	// source of truth after an abandon refetch.
	const total = $derived(getBranches(projectId)?.total ?? 0);
	const page = $derived(getBranchesPage(projectId));

	function handlePageChange(next: number): void {
		loadBranches(projectId, { limit: PAGE_SIZE, offset: (next - 1) * PAGE_SIZE }).catch((e) => {
			loadError = errMessage(e, 'Could not load branches');
		});
	}

	function statusVariant(status: StoryboardBranch['status']): 'default' | 'success' | 'info' {
		if (status === 'open') return 'info';
		if (status === 'merged') return 'success';
		return 'default';
	}

	async function handleCreate(): Promise<void> {
		const trimmed = name.trim();
		if (trimmed === '') return;
		creating = true;
		loadError = null;
		try {
			await createBranch(projectId, trimmed);
			name = '';
			toastSuccess('Branch created', 'Open it to rework the board without touching this one.');
		} catch (e) {
			toastError('Could not create a branch', errMessage(e));
		} finally {
			creating = false;
		}
	}

	function handleReviewClick(id: string): void {
		// Opening a review closes any pending abandon confirm — the two are mutually
		// exclusive intents on the same row.
		confirmingAbandonId = null;
		reviewingId = reviewingId === id ? null : id;
	}

	// Called both on Close and on a successful merge; the store has already refetched
	// the branch list by then, so the row re-renders as 'merged' (no actions).
	function handleReviewClose(): void {
		reviewingId = null;
	}

	function handleAbandonClick(id: string): void {
		confirmingAbandonId = id;
	}

	function handleCancelAbandon(): void {
		confirmingAbandonId = null;
	}

	async function handleConfirmAbandon(id: string): Promise<void> {
		abandoningId = id;
		try {
			await abandonBranch(projectId, id);
			confirmingAbandonId = null;
			toastSuccess('Branch abandoned', 'Its board is no longer in play.');
		} catch (e) {
			// Any failure surfaces as a toast; the confirm stays open so the user can
			// retry or cancel out.
			toastError('Could not abandon this branch', errMessage(e));
		} finally {
			abandoningId = null;
		}
	}
</script>

<div class="space-y-3" data-testid="storyboard-branches">
	<div class="flex flex-wrap items-center gap-2">
		<input
			type="text"
			aria-label="Branch name"
			placeholder="Branch name (e.g. shorter cold open)"
			bind:value={name}
			disabled={busy}
			class="flex-1 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-strong)] focus:outline-none disabled:opacity-40"
			data-testid="branch-name"
		/>
		<button
			type="button"
			class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			disabled={!canCreate}
			onclick={handleCreate}
			data-testid="branch-create"
		>
			{creating ? 'Branching…' : 'Branch'}
		</button>
	</div>

	{#if loadError}
		<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="branch-error">
			{loadError}
		</p>
	{/if}

	{#if loading}
		<p
			class="text-sm text-[var(--color-text-muted)]"
			role="status"
			aria-live="polite"
			data-testid="branch-loading"
		>
			Loading branches…
		</p>
	{:else if branches.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="branch-empty">
			No branches yet. Branch the board to try an alternative cut without losing this one.
		</p>
	{:else}
		<ul class="space-y-2" data-testid="branch-list">
			{#each branches as b (b.id)}
				<li
					class="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
					data-testid="branch-item"
					data-branch-id={b.id}
				>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0 space-y-1">
							<div class="flex items-center gap-2">
								<Badge variant={statusVariant(b.status)}>{b.status}</Badge>
								<span class="truncate text-sm text-[var(--color-text)]">{b.name}</span>
							</div>
							<p class="text-xs text-[var(--color-text-muted)]">
								{formatRelativeTime(b.created_at)}
							</p>
						</div>

						{#if confirmingAbandonId === b.id}
							<div class="flex items-center gap-2" data-testid="branch-abandon-prompt">
								<span class="text-sm text-[var(--color-text-muted)]">
									Abandon this branch permanently?
								</span>
								<button
									type="button"
									class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-colors disabled:opacity-40"
									disabled={busy}
									onclick={() => handleConfirmAbandon(b.id)}
									data-testid="branch-abandon-confirm"
								>
									{abandoningId === b.id ? 'Abandoning…' : 'Abandon'}
								</button>
								<button
									type="button"
									class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
									disabled={busy}
									onclick={handleCancelAbandon}
									data-testid="branch-abandon-cancel"
								>
									Cancel
								</button>
							</div>
						{:else if b.status === 'open'}
							<!-- Merged/abandoned branches are read-only history: no actions. -->
							<div class="flex items-center gap-2">
								<a
									href={resolve(`/projects/${b.child_project_id}`)}
									class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)]"
									data-testid="branch-open-{b.id}"
								>
									Open
								</a>
								<button
									type="button"
									class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
									disabled={busy}
									onclick={() => handleReviewClick(b.id)}
									data-testid="branch-review-{b.id}"
								>
									{reviewingId === b.id ? 'Hide review' : 'Review & merge'}
								</button>
								<button
									type="button"
									class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-danger)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
									disabled={busy}
									onclick={() => handleAbandonClick(b.id)}
									data-testid="branch-abandon-{b.id}"
								>
									Abandon
								</button>
							</div>
						{/if}
					</div>

					{#if reviewingId === b.id && b.status === 'open'}
						<StoryboardBranchMerge {projectId} branch={b} onClose={handleReviewClose} />
					{/if}
				</li>
			{/each}
		</ul>
		<div data-testid="branches-pagination">
			<Pagination
				{page}
				pageSize={PAGE_SIZE}
				{total}
				onPageChange={handlePageChange}
				class="mt-1"
			/>
		</div>
	{/if}
</div>

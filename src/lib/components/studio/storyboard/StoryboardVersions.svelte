<script lang="ts">
	// Storyboard versions — snapshot / restore the whole board.
	//
	// A snapshot is a restore point for panels + scenes + assets together. Two
	// kinds exist: `manual` (the user pressed Snapshot) and `auto` (the server
	// takes one of the pre-restore board every time a restore overwrites it, so a
	// restore is never a one-way door).
	//
	// Restore is destructive-ish — it replaces the live board — so it goes through
	// an inline two-step confirm, mirroring the `draft-confirm` 409 flow in
	// StoryboardSection. `window.confirm` is deliberately NOT used: a native dialog
	// is invisible to Playwright and blocks the e2e suite.
	//
	// Deliberately NOT mounted inside StoryboardBoard: the board is a dual-mode
	// component the create-wizard also renders, and a wizard draft has no project
	// to snapshot.
	import { Badge, Pagination } from '$lib/components/ui';
	import {
		loadSnapshots,
		getSnapshots,
		getSnapshotList,
		getSnapshotsPage,
		areSnapshotsLoading,
		createSnapshot,
		restoreSnapshot,
		deleteSnapshot,
		PAGE_SIZE
	} from '$lib/stores/storyboard.svelte.js';
	import { ApiError } from '$lib/api';
	import type { SnapshotKind } from '$lib/types';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { formatRelativeTime, shortId } from '$lib/utils/format';

	let { projectId }: { projectId: string } = $props();

	let note = $state('');
	let creating = $state(false);
	// The snapshot id awaiting a restore confirmation, or null. Only ever one —
	// opening a second confirm implicitly cancels the first.
	let confirmingId = $state<string | null>(null);
	let restoringId = $state<string | null>(null);
	// Delete mirrors the same two-step inline-confirm UX as restore.
	let confirmingDeleteId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let loadError = $state<string | null>(null);

	const busy = $derived(creating || restoringId !== null || deletingId !== null);

	function errMessage(e: unknown, fallback = 'Something went wrong'): string {
		return e instanceof ApiError ? e.detail : fallback;
	}

	// Lazy first load. Mirrors StoryboardSection's mount effect: only fetch when
	// this project has no cached list and nothing is already in flight, so the
	// refresh a create/restore triggers can't re-enter here.
	$effect(() => {
		if (getSnapshots(projectId) === undefined && !areSnapshotsLoading(projectId)) {
			loadSnapshots(projectId).catch((e) => {
				loadError = errMessage(e, 'Could not load versions');
			});
		}
	});

	const snapshots = $derived(getSnapshotList(projectId));
	const loading = $derived(getSnapshots(projectId) === undefined && areSnapshotsLoading(projectId));
	// Server-authoritative total (not the page length) drives the pager; the page
	// number is derived from the store's remembered offset so it stays the single
	// source of truth after a delete refetch.
	const total = $derived(getSnapshots(projectId)?.total ?? 0);
	const page = $derived(getSnapshotsPage(projectId));

	function handlePageChange(next: number): void {
		loadSnapshots(projectId, { limit: PAGE_SIZE, offset: (next - 1) * PAGE_SIZE }).catch((e) => {
			loadError = errMessage(e, 'Could not load versions');
		});
	}

	async function handleCreate(): Promise<void> {
		creating = true;
		loadError = null;
		try {
			const trimmed = note.trim();
			await createSnapshot(projectId, trimmed === '' ? undefined : trimmed);
			note = '';
			toastSuccess('Snapshot taken', 'You can restore the board to this point later.');
		} catch (e) {
			toastError('Could not take a snapshot', errMessage(e));
		} finally {
			creating = false;
		}
	}

	function handleRestoreClick(id: string): void {
		confirmingId = id;
	}

	function handleCancelRestore(): void {
		confirmingId = null;
	}

	async function handleConfirmRestore(id: string): Promise<void> {
		restoringId = id;
		try {
			await restoreSnapshot(projectId, id);
			confirmingId = null;
			toastSuccess('Board restored', 'An auto-snapshot of the previous board was saved.');
		} catch (e) {
			toastError('Could not restore this version', errMessage(e));
		} finally {
			restoringId = null;
		}
	}

	function handleDeleteClick(id: string): void {
		confirmingDeleteId = id;
	}

	function handleCancelDelete(): void {
		confirmingDeleteId = null;
	}

	async function handleConfirmDelete(id: string): Promise<void> {
		deletingId = id;
		try {
			await deleteSnapshot(projectId, id);
			confirmingDeleteId = null;
			toastSuccess('Version deleted', 'The snapshot was removed.');
		} catch (e) {
			// 409 (auto snapshots are machine-managed) and any other failure surface
			// as a toast; the confirm stays open so the user can cancel out.
			toastError('Could not delete this version', errMessage(e));
		} finally {
			deletingId = null;
		}
	}

	// Panel/scene/asset counts are optional on the wire; only render the line when
	// the server actually stamped them.
	function counts(s: { panel_count?: number | null; scene_count?: number | null }): string | null {
		if (s.panel_count == null && s.scene_count == null) return null;
		return `${s.panel_count ?? 0} panels · ${s.scene_count ?? 0} scenes`;
	}

	// The board mints THREE snapshot kinds, and the raw wire value is not a label:
	// 'branch_base' would render as literal "branch_base" in the badge. It is the
	// fork point a branch pins as its merge base (orch 0052) — neither user-authored
	// nor a disposable safety copy, so it is not deletable (the Delete button is
	// gated on 'manual', which already excludes it).
	function kindLabel(kind: SnapshotKind): string {
		if (kind === 'branch_base') return 'fork point';
		return kind;
	}

	function kindVariant(kind: SnapshotKind): 'default' | 'info' {
		// 'auto' and 'branch_base' are both machine-minted → muted; 'manual' is the
		// one the user deliberately took.
		return kind === 'manual' ? 'info' : 'default';
	}
</script>

<div class="space-y-3" data-testid="storyboard-versions">
	<div class="flex flex-wrap items-center gap-2">
		<input
			type="text"
			aria-label="Snapshot note"
			placeholder="Optional note (e.g. before re-shooting act 2)"
			bind:value={note}
			disabled={busy}
			class="flex-1 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-strong)] focus:outline-none disabled:opacity-40"
			data-testid="snapshot-note"
		/>
		<button
			type="button"
			class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			disabled={busy}
			onclick={handleCreate}
			data-testid="snapshot-create"
		>
			{creating ? 'Snapshotting…' : 'Snapshot'}
		</button>
	</div>

	{#if loadError}
		<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="snapshot-error">
			{loadError}
		</p>
	{/if}

	{#if loading}
		<p
			class="text-sm text-[var(--color-text-muted)]"
			role="status"
			aria-live="polite"
			data-testid="snapshot-loading"
		>
			Loading versions…
		</p>
	{:else if snapshots.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="snapshot-empty">
			No versions yet. Take a snapshot to create a restore point for the board.
		</p>
	{:else}
		<ul class="space-y-2" data-testid="snapshot-list">
			{#each snapshots as s (s.id)}
				<li
					class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
					data-testid="snapshot-item"
					data-snapshot-id={s.id}
				>
					<div class="min-w-0 space-y-1">
						<div class="flex items-center gap-2">
							<Badge variant={kindVariant(s.kind)}>{kindLabel(s.kind)}</Badge>
							<span class="text-sm text-[var(--color-text)]">
								{formatRelativeTime(s.created_at)}
							</span>
							{#if s.actor_subject}
								<span class="text-xs text-[var(--color-text-muted)]">
									by {shortId(s.actor_subject)}
								</span>
							{/if}
						</div>
						{#if s.note}
							<p class="truncate text-sm text-[var(--color-text-muted)]">{s.note}</p>
						{/if}
						{#if counts(s)}
							<p class="text-xs text-[var(--color-text-muted)]">{counts(s)}</p>
						{/if}
					</div>

					{#if confirmingId === s.id}
						<div class="flex items-center gap-2" data-testid="snapshot-restore-prompt">
							<span class="text-sm text-[var(--color-text-muted)]">
								Replace the current board with this version?
							</span>
							<button
								type="button"
								class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-colors disabled:opacity-40"
								disabled={busy}
								onclick={() => handleConfirmRestore(s.id)}
								data-testid="snapshot-restore-confirm"
							>
								{restoringId === s.id ? 'Restoring…' : 'Restore'}
							</button>
							<button
								type="button"
								class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
								disabled={busy}
								onclick={handleCancelRestore}
								data-testid="snapshot-restore-cancel"
							>
								Cancel
							</button>
						</div>
					{:else if confirmingDeleteId === s.id}
						<div class="flex items-center gap-2" data-testid="snapshot-delete-prompt">
							<span class="text-sm text-[var(--color-text-muted)]">
								Delete this version permanently?
							</span>
							<button
								type="button"
								class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-colors disabled:opacity-40"
								disabled={busy}
								onclick={() => handleConfirmDelete(s.id)}
								data-testid="snapshot-delete-confirm"
							>
								{deletingId === s.id ? 'Deleting…' : 'Delete'}
							</button>
							<button
								type="button"
								class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
								disabled={busy}
								onclick={handleCancelDelete}
								data-testid="snapshot-delete-cancel"
							>
								Cancel
							</button>
						</div>
					{:else}
						<div class="flex items-center gap-2">
							<button
								type="button"
								class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
								disabled={busy}
								onclick={() => handleRestoreClick(s.id)}
								data-testid="snapshot-restore-{s.id}"
							>
								Restore
							</button>
							{#if s.kind === 'manual'}
								<button
									type="button"
									class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-danger)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
									disabled={busy}
									onclick={() => handleDeleteClick(s.id)}
									data-testid="delete-snapshot"
								>
									Delete
								</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		<div data-testid="snapshots-pagination">
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

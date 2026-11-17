<script lang="ts">
	// Branch merge review — fold a branch's board back into the root, panel by panel.
	//
	// The server hands us a THREE-WAY diff, and this component renders it as three
	// columns per changed panel:
	//
	//   base   — the panel at the fork point (the branch's base snapshot)
	//   main   — the panel as THIS board has it now (it may have moved on since)
	//   branch — the panel as the branch has it
	//
	// Resolution semantics (mirrored 1:1 from the orchestrator's merge service):
	//   * Non-conflict entries default to 'branch' — the whole point of merging is
	//     to take the fork's work. The user may override to 'main' (keep the root's
	//     version) or 'skip' (leave it out of the merge entirely).
	//   * A 'conflict' entry (both sides changed the same panel since the fork) has
	//     NO default. The server 422s if any conflict is unresolved, so we block the
	//     merge button and mark every undecided conflict instead of letting the user
	//     discover that as a backend error.
	//   * A 409 means the ROOT board moved while this diff was open (stale
	//     `root_fingerprint`), or the branch is no longer open. Neither is a retry —
	//     the diff itself is stale, so we offer to reload it rather than resubmit.
	//
	// Merge auto-snapshots the root board first, so it is fully reversible from the
	// Versions panel. That is said out loud in the UI: it is the difference between
	// a scary button and a safe one.
	//
	// Approval state is NOT merged (content only) — a merged panel keeps the root's
	// approval, so merging can never silently un-approve a signed-off board.
	import { Badge } from '$lib/components/ui';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		diffBranch,
		mergeBranch,
		diffAgainstBranch,
		mergeIntoBranch,
		getBranchList,
		loadBranches
	} from '$lib/stores/storyboard.svelte.js';
	import { ApiError } from '$lib/api';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import type {
		StoryboardBranch,
		BranchDiffResponse,
		DiffEntry,
		DiffEntryKind,
		DiffPanelView,
		MergeResolution,
		FieldResolution
	} from '$lib/types';
	import { conflictingFields, isFieldMergeable } from './merge-fields.js';

	let {
		projectId,
		branch,
		onClose
	}: { projectId: string; branch: StoryboardBranch; onClose: () => void } = $props();

	// '' = the DEFAULT branch→root merge (unchanged). A non-empty id = SIBLING mode: diff and
	// merge against another OPEN branch of the same project instead of the root board.
	let targetId = $state<string>('');
	// The project's OTHER open branches — the eligible sibling targets. `getBranchList` reads the
	// store's reactive branch cache, so this re-derives when the list loads/changes.
	const siblingOptions = $derived(
		getBranchList(projectId).filter((b) => b.id !== branch.id && b.status === 'open')
	);
	const siblingMode = $derived(targetId !== '');
	const targetBranch = $derived(siblingOptions.find((b) => b.id === targetId));
	// Ensure the branch list is populated so the sibling picker has options to show.
	$effect(() => {
		void loadBranches(projectId);
	});

	let diff = $state<BranchDiffResponse | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let merging = $state(false);
	// Set when the merge 409s: the diff on screen is stale, so the only sane next
	// step is to reload it (NOT to resubmit the same fingerprint).
	let staleError = $state<string | null>(null);

	// key → whole-row resolution. Non-conflict entries are seeded with 'branch'; conflicts are
	// deliberately absent until the user picks (that is what `unresolved` keys off).
	const resolutions = new SvelteMap<string, MergeResolution>();
	// key → (field → 'branch'|'main') for a conflict resolved PER COLUMN. Mutually exclusive
	// with a whole-row verdict in `resolutions`: the setters keep exactly one populated for a key.
	const fieldResolutions = new SvelteMap<string, SvelteMap<string, FieldResolution>>();

	const entries = $derived(diff?.entries ?? []);
	// The server's per-field ALLOWLIST for this diff — empty until the diff loads (fences all).
	const mergeableFields = $derived(diff?.mergeable_fields ?? []);
	// The middle diff column is the ROOT board by default; in sibling mode it is the target
	// branch's board, so name it after the target.
	const mainColumnTitle = $derived(
		siblingMode ? `${targetBranch?.name ?? 'Target branch'} (target)` : 'Main (current board)'
	);
	// A conflict is resolved when it has a whole-row verdict OR (it is field-mergeable and every
	// one of its conflicting fields has a branch/main pick). Mirrors the server's gate so the
	// user never discovers an incomplete resolution as a 422.
	function conflictResolved(e: DiffEntry): boolean {
		if (resolutions.has(e.key)) return true;
		if (!isFieldMergeable(e, mergeableFields)) return false;
		const picks = fieldResolutions.get(e.key);
		return picks !== undefined && conflictingFields(e, mergeableFields).every((f) => picks.has(f));
	}
	const unresolved = $derived(entries.filter((e) => e.kind === 'conflict' && !conflictResolved(e)));
	const canMerge = $derived(
		diff !== null && entries.length > 0 && unresolved.length === 0 && !merging && !loading
	);

	function errMessage(e: unknown, fallback = 'Something went wrong'): string {
		return e instanceof ApiError ? e.detail : fallback;
	}

	async function load(): Promise<void> {
		// Read `targetId` synchronously so the $effect below re-runs `load` when the sibling
		// target changes (branch→root when '', sibling diff otherwise).
		const target = targetId;
		loading = true;
		loadError = null;
		staleError = null;
		try {
			const resp =
				target === ''
					? await diffBranch(projectId, branch.id)
					: await diffAgainstBranch(projectId, branch.id, target);
			diff = resp;
			resolutions.clear();
			fieldResolutions.clear();
			for (const e of resp.entries) {
				if (e.kind !== 'conflict') resolutions.set(e.key, 'branch');
			}
		} catch (e) {
			diff = null;
			// The merge routes ship with the orchestrator's merge service, which may not
			// be deployed yet — a 404 here is "not on this server", not "broken".
			loadError =
				e instanceof ApiError && e.status === 404
					? 'Merge review is not available on this server yet. Nothing was changed.'
					: errMessage(e, 'Could not load the branch diff');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Re-run whenever the sibling target changes (branch→root at '', a sibling diff
		// otherwise). Track targetId explicitly: load() reads it only in its synchronous
		// prefix (behind `loading = true` and an await), so make the dependency unambiguous
		// — switching targets must always re-fetch the diff.
		void targetId;
		void load();
	});

	// Whole-row and per-field are mutually exclusive for a key: choosing one clears the other so
	// exactly one path resolves the conflict (and the payload never sends both — the server 422s
	// a resolution carrying both).
	function setResolution(key: string, value: MergeResolution): void {
		fieldResolutions.delete(key);
		resolutions.set(key, value);
	}

	function setFieldResolution(key: string, field: string, value: FieldResolution): void {
		resolutions.delete(key);
		let picks = fieldResolutions.get(key);
		if (picks === undefined) {
			picks = new SvelteMap<string, FieldResolution>();
			fieldResolutions.set(key, picks);
		}
		picks.set(field, value);
	}

	async function handleMerge(): Promise<void> {
		if (diff === null || !canMerge) return;
		merging = true;
		staleError = null;
		try {
			// Every entry is submitted, including the ones defaulted to 'branch' — the server's
			// contract is a full resolution set, not a delta. A conflict resolved per column sends
			// `field_resolutions` (and no whole-row verdict); everything else sends its whole-row
			// `resolution`.
			const resolutionPayload = entries.map((e) => {
				const picks = fieldResolutions.get(e.key);
				if (picks !== undefined && picks.size > 0) {
					return { key: e.key, field_resolutions: Object.fromEntries(picks) };
				}
				return { key: e.key, resolution: resolutions.get(e.key) as MergeResolution };
			});
			if (siblingMode) {
				// Sibling merge: `root_fingerprint` on the diff-against response IS the target
				// board's token — echo it back as `target_fingerprint`. Both branches stay open.
				await mergeIntoBranch(projectId, branch.id, {
					target_branch_id: targetId,
					target_fingerprint: diff.root_fingerprint,
					resolutions: resolutionPayload
				});
			} else {
				await mergeBranch(projectId, branch.id, {
					root_fingerprint: diff.root_fingerprint,
					resolutions: resolutionPayload
				});
			}
			toastSuccess(
				'Branch merged',
				'The board before the merge was auto-snapshotted — restore it from Versions to undo.'
			);
			onClose();
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				staleError =
					'This board changed while you were reviewing, so the merge was not applied. Reload the diff to see what moved, then merge again.';
			} else {
				toastError('Could not merge this branch', errMessage(e));
			}
		} finally {
			merging = false;
		}
	}

	function kindLabel(kind: DiffEntryKind): string {
		if (kind === 'added') return 'added in branch';
		if (kind === 'deleted') return 'deleted in branch';
		if (kind === 'conflict') return 'conflict';
		return 'modified in branch';
	}

	function kindVariant(kind: DiffEntryKind): 'default' | 'success' | 'warning' | 'error' | 'info' {
		if (kind === 'conflict') return 'error';
		if (kind === 'added') return 'success';
		if (kind === 'deleted') return 'warning';
		return 'info';
	}

	// The fields worth showing for an entry: what the branch touched, plus what main
	// touched (a conflict's whole point). Falls back to every field present on any
	// side, so an `added`/`deleted` entry (which may carry no changed_fields at all)
	// still renders its content rather than an empty column.
	// Deduped by hand rather than with a Set: svelte/prefer-svelte-reactivity bans
	// the mutable built-in even in a pure helper, and SvelteSet here would be a
	// reactive object allocated per render for no reason.
	function dedupe(values: string[]): string[] {
		return values.filter((v, i) => values.indexOf(v) === i);
	}

	function fieldsFor(e: DiffEntry): string[] {
		const named = dedupe([...e.changed_fields, ...e.main_changed_fields]);
		if (named.length > 0) return named;
		const all: string[] = [];
		for (const view of [e.branch, e.main, e.base]) {
			if (view) all.push(...Object.keys(view));
		}
		return dedupe(all);
	}

	function label(field: string): string {
		return field.replace(/_/g, ' ');
	}

	// Views are normalised, not the panel wire shape — values are whatever the merge
	// service put there (string, number, list of character ids, null on a side where
	// the field is unset).
	function display(view: DiffPanelView | null, field: string): string {
		if (view === null) return '—';
		const v = view[field];
		if (v === null || v === undefined || v === '') return '—';
		if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(String).join(', ');
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	const COLUMN_CLASS =
		'min-w-0 space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2';
	const CHANGED_CLASS =
		'rounded-[var(--radius-sm)] bg-[var(--color-surface-strong)] px-1 font-medium text-[var(--color-text)]';
</script>

<div
	class="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
	data-testid="branch-merge-review"
	data-branch-id={branch.id}
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="min-w-0">
			<h3 class="text-sm font-medium text-[var(--color-text)]">
				Review & merge “{branch.name}”
			</h3>
			<p class="text-xs text-[var(--color-text-muted)]">
				Merging snapshots this board first, so you can always restore it from Versions. Panel
				approvals are not merged — a merged panel keeps this board's approval.
			</p>
		</div>
		<button
			type="button"
			class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			disabled={merging}
			onclick={onClose}
			data-testid="merge-close"
		>
			Close
		</button>
	</div>

	{#if siblingOptions.length > 0}
		<div class="flex flex-wrap items-center gap-2" data-testid="merge-target-picker">
			<label class="text-xs font-medium text-[var(--color-text-muted)]" for="merge-target-select">
				Merge into
			</label>
			<select
				id="merge-target-select"
				class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]"
				value={targetId}
				onchange={(e) => (targetId = e.currentTarget.value)}
				disabled={merging}
				data-testid="merge-target-select"
			>
				<option value="">This board (root)</option>
				{#each siblingOptions as opt (opt.id)}
					<option value={opt.id}>{opt.name}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if staleError}
		<div
			class="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-2"
			role="alert"
			data-testid="merge-stale"
		>
			<span class="text-sm text-[var(--color-danger)]">{staleError}</span>
			<button
				type="button"
				class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
				disabled={merging}
				onclick={load}
				data-testid="merge-reload"
			>
				Reload the diff
			</button>
		</div>
	{/if}

	{#if loading}
		<p
			class="text-sm text-[var(--color-text-muted)]"
			role="status"
			aria-live="polite"
			data-testid="merge-loading"
		>
			Loading the diff…
		</p>
	{:else if loadError}
		<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="merge-error">
			{loadError}
		</p>
	{:else if entries.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="merge-empty">
			Nothing to merge — this branch's board is identical to the current one.
		</p>
	{:else}
		<ul class="space-y-3" data-testid="merge-entries">
			{#each entries as e (e.key)}
				{@const chosen = resolutions.get(e.key)}
				{@const mergeable = isFieldMergeable(e, mergeableFields)}
				{@const picks = fieldResolutions.get(e.key)}
				{@const needsChoice = e.kind === 'conflict' && !conflictResolved(e)}
				<li
					class="space-y-2 rounded-[var(--radius-md)] border px-3 py-2 {needsChoice
						? 'border-[var(--color-danger)]'
						: 'border-[var(--color-border)]'}"
					data-testid="merge-entry"
					data-entry-key={e.key}
					data-entry-kind={e.kind}
				>
					<div class="flex flex-wrap items-center gap-2">
						<Badge variant={kindVariant(e.kind)}>{kindLabel(e.kind)}</Badge>
						<span class="text-sm text-[var(--color-text)]">{e.shot_key}</span>
						{#if needsChoice}
							<span
								class="text-xs font-medium text-[var(--color-danger)]"
								data-testid="merge-needs-choice"
							>
								Both sides changed this — pick a version
							</span>
						{/if}
					</div>

					<div class="grid gap-2 md:grid-cols-3" data-testid="merge-columns">
						{#each [{ side: 'base', view: e.base, title: 'Base (fork point)', changed: [] as string[] }, { side: 'main', view: e.main, title: mainColumnTitle, changed: e.main_changed_fields }, { side: 'branch', view: e.branch, title: 'Branch', changed: e.changed_fields }] as col (col.side)}
							<div class={COLUMN_CLASS} data-testid="merge-column-{col.side}">
								<p class="text-xs font-medium text-[var(--color-text-muted)]">{col.title}</p>
								{#if col.view === null}
									<p class="text-xs text-[var(--color-text-muted)]" data-testid="merge-absent">
										No panel on this side
									</p>
								{:else}
									<dl class="space-y-0.5">
										{#each fieldsFor(e) as f (f)}
											<div class="text-xs">
												<dt class="text-[var(--color-text-muted)]">{label(f)}</dt>
												<dd
													class="break-words text-[var(--color-text)] {col.changed.includes(f)
														? CHANGED_CLASS
														: ''}"
													data-field={f}
													data-changed={col.changed.includes(f) ? 'true' : 'false'}
												>
													{display(col.view, f)}
												</dd>
											</div>
										{/each}
									</dl>
								{/if}
							</div>
						{/each}
					</div>

					{#if mergeable}
						<div class="space-y-1" data-testid="merge-field-picks">
							<p class="text-xs font-medium text-[var(--color-text-muted)]">
								Or resolve field by field — pick a side for each changed field:
							</p>
							{#each conflictingFields(e, mergeableFields) as f (f)}
								{@const pick = picks?.get(f)}
								<div
									class="flex flex-wrap items-center gap-2"
									role="group"
									aria-label="{label(f)} for {e.shot_key}"
								>
									<span class="min-w-24 text-xs text-[var(--color-text-muted)]">{label(f)}</span>
									{#each [{ value: 'branch' as const, text: 'Branch' }, { value: 'main' as const, text: 'Main' }] as opt (opt.value)}
										<button
											type="button"
											class="inline-flex items-center rounded-[var(--radius-md)] border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-40 {pick ===
											opt.value
												? 'border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] text-[var(--color-text)]'
												: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'}"
											aria-pressed={pick === opt.value}
											disabled={merging}
											onclick={() => setFieldResolution(e.key, f, opt.value)}
											data-testid="merge-field-{e.key}-{f}-{opt.value}"
										>
											{opt.text}
										</button>
									{/each}
								</div>
							{/each}
						</div>
					{/if}

					<div
						class="flex flex-wrap items-center gap-2"
						role="group"
						aria-label="Resolution for {e.shot_key}"
					>
						{#each [{ value: 'branch' as const, text: 'Take branch' }, { value: 'main' as const, text: 'Keep main' }, { value: 'keep_both' as const, text: 'Keep both' }, { value: 'skip' as const, text: 'Skip' }] as opt (opt.value)}
							<button
								type="button"
								class="inline-flex items-center rounded-[var(--radius-md)] border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 {chosen ===
								opt.value
									? 'border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] text-[var(--color-text)]'
									: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'}"
								aria-pressed={chosen === opt.value}
								disabled={merging}
								onclick={() => setResolution(e.key, opt.value)}
								data-testid="merge-resolution-{e.key}-{opt.value}"
							>
								{opt.text}
							</button>
						{/each}
					</div>
				</li>
			{/each}
		</ul>

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
				disabled={!canMerge}
				onclick={handleMerge}
				data-testid="merge-confirm"
			>
				{merging ? 'Merging…' : 'Merge into this board'}
			</button>
			{#if unresolved.length > 0}
				<span class="text-sm text-[var(--color-danger)]" data-testid="merge-blocked">
					{unresolved.length}
					{unresolved.length === 1 ? 'conflict needs' : 'conflicts need'} a choice before you can merge.
				</span>
			{/if}
		</div>
	{/if}
</div>

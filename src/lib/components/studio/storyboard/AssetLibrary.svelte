<script lang="ts">
	// Asset library CRUD surface (Phase 1). Lists a project's storyboard assets
	// grouped into Characters / Locations / Props, each group with an inline
	// "+ Add" control and per-row Edit/Delete. Loads once per project on mount
	// (mirrors StoryboardSection's $effect load), derives the list from the
	// store, and delegates create/update via an inline AssetEditor. Delete calls
	// the store then toasts. No modal — the editor expands inline so focus is
	// never trapped.
	import type { StoryboardAssetResponse, AssetKind } from '$lib/types';
	import { Plus, Pencil, Trash2 } from '@lucide/svelte';
	import { ApiError } from '$lib/api';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { SvelteSet } from 'svelte/reactivity';
	import { loadAssets, getAssetList, deleteAsset } from '$lib/stores/storyboard.svelte.js';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import AssetEditor from './AssetEditor.svelte';

	interface Props {
		projectId: string;
		/** Read-only mode: the project is archived or a merged/abandoned branch child.
		 *  Gates every create/edit/delete affordance (the backend also 409s these). */
		disabled?: boolean;
	}

	let { projectId, disabled = false }: Props = $props();

	const GROUPS: Array<{ kind: AssetKind; label: string; singular: string }> = [
		{ kind: 'character', label: 'Characters', singular: 'character' },
		{ kind: 'location', label: 'Locations', singular: 'location' },
		{ kind: 'prop', label: 'Props', singular: 'prop' }
	];

	// Load the asset list at most once per project id (the store has no
	// isLoading probe for assets, so guard locally; re-fires if projectId swaps).
	let loadedFor = $state<string | null>(null);
	// A failed load is NOT an empty library. Without this the three "No
	// characters yet." placeholders render on a transport failure, which states
	// something about the project the app never learned. `loadedFor` is
	// deliberately left set on failure so the effect does not re-fire into an
	// unbounded retry — the user retries by reopening the section.
	let loadFailed = $state(false);
	$effect(() => {
		if (loadedFor !== projectId) {
			loadedFor = projectId;
			loadFailed = false;
			loadAssets(projectId).catch((e) => {
				loadFailed = true;
				toastError('Asset library failed to load', e instanceof Error ? e.message : undefined);
			});
		}
	});

	const assets = $derived(getAssetList(projectId));

	function inGroup(kind: AssetKind): StoryboardAssetResponse[] {
		return assets.filter((a) => a.kind === kind);
	}

	// Inline editor target: a new asset for a kind (no `asset`) or an existing
	// row being edited. `null` ⇒ no editor open.
	let editing = $state<{ kind: AssetKind; asset?: StoryboardAssetResponse } | null>(null);

	function startAdd(kind: AssetKind) {
		editing = { kind };
	}
	function startEdit(asset: StoryboardAssetResponse) {
		editing = { kind: asset.kind, asset };
	}
	function closeEditor() {
		editing = null;
	}

	const isAdding = (kind: AssetKind) =>
		editing !== null && editing.asset === undefined && editing.kind === kind;
	const isEditing = (asset: StoryboardAssetResponse) => editing?.asset?.id === asset.id;

	// The BE refuses to orphan panel references: `DELETE /storyboard/assets/{id}`
	// answers 409 with `{"detail": {"message": ..., "panels": [{id, shot_key}]}}`.
	// `client.ts` passes `body.detail` through verbatim onto `ApiError.detail`, so
	// on THIS route it is an object at runtime even though the field is declared
	// `string` (the common case) — hence the `unknown` narrowing below.
	const MAX_LISTED_PANELS = 5;

	function referencingPanels(e: unknown): Array<{ id: string; shot_key?: string | null }> | null {
		if (!(e instanceof ApiError) || e.status !== 409) return null;
		const detail: unknown = e.detail;
		if (typeof detail !== 'object' || detail === null) return null;
		const panels = (detail as { panels?: unknown }).panels;
		if (!Array.isArray(panels)) return null;
		return panels.filter(
			(p): p is { id: string; shot_key?: string | null } =>
				typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string'
		);
	}

	function inUseMessage(panels: Array<{ id: string; shot_key?: string | null }>): string {
		const labels = panels.map((p) => p.shot_key || `panel ${p.id.slice(0, 8)}`);
		if (labels.length === 0) return 'Used by storyboard panels — remove the references first.';
		const shown = labels.slice(0, MAX_LISTED_PANELS).join(', ');
		const extra = labels.length - MAX_LISTED_PANELS;
		const listed = extra > 0 ? `${shown} and ${extra} more` : shown;
		return `Used by ${listed} — remove the references first.`;
	}

	// Row thumbnail = the FIRST reference image, when there is one. An asset with
	// no references (the common case) must render exactly as it did before this
	// existed — no placeholder box, no reserved column, no broken-image glyph —
	// so the <img> is conditional and a 404 removes it rather than showing the
	// browser's broken icon.
	const failedThumbs = new SvelteSet<string>();

	function firstReference(asset: StoryboardAssetResponse): string | null {
		const url = asset.reference_images?.[0];
		return url && !failedThumbs.has(url) ? url : null;
	}

	async function remove(asset: StoryboardAssetResponse) {
		try {
			await deleteAsset(projectId, asset.id);
			toastSuccess('Asset deleted', asset.name);
		} catch (e) {
			const panels = referencingPanels(e);
			if (panels) {
				toastError('Asset is in use', inUseMessage(panels));
				return;
			}
			toastError('Failed to delete asset', e instanceof Error ? e.message : undefined);
		}
	}
</script>

<div class="space-y-6" data-testid="asset-library">
	{#if loadFailed}
		<p
			class="rounded-[var(--radius-md)] border border-[var(--color-danger-border,var(--color-border))] p-4 text-center text-sm text-[var(--color-text-muted)]"
			role="status"
			data-testid="asset-library-unavailable"
		>
			The asset library could not be loaded, so it is not showing what this project has. Reopen the
			section to try again.
		</p>
	{/if}
	{#each GROUPS as group (group.kind)}
		{@const rows = inGroup(group.kind)}
		<section class="space-y-3" data-testid={`asset-group-${group.kind}`}>
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold text-[var(--color-text)]">{group.label}</h3>
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
					disabled={isAdding(group.kind) || disabled}
					onclick={() => startAdd(group.kind)}
					data-testid={`add-asset-${group.kind}`}
				>
					<Plus class="h-4 w-4" />
					Add {group.singular}
				</button>
			</div>

			{#if rows.length === 0 && !isAdding(group.kind) && !loadFailed}
				<p
					class="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-text-muted)]"
					data-testid={`asset-empty-${group.kind}`}
				>
					No {group.label.toLowerCase()} yet.
				</p>
			{:else}
				<ul class="space-y-2">
					{#each rows as asset (asset.id)}
						<li data-testid="asset-row" data-asset-id={asset.id}>
							{#if isEditing(asset)}
								<AssetEditor {projectId} {asset} kind={asset.kind} onDone={closeEditor} />
							{:else}
								{@const thumb = firstReference(asset)}
								<div
									class="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
								>
									{#if thumb}
										<!-- Alt avoids "image"/"photo"/"picture" (svelte's
										     a11y_img_redundant_alt rule) and names the asset, so
										     the row still reads as "Hero, visual reference" rather
										     than an anonymous graphic. -->
										<img
											src={scopedMediaUrl(thumb)}
											alt={`Visual reference for ${asset.name}`}
											loading="lazy"
											class="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] object-cover"
											data-testid="asset-row-thumb"
											onerror={() => failedThumbs.add(thumb)}
										/>
									{/if}
									<div class="min-w-0 flex-1">
										<p
											class="truncate text-sm font-medium text-[var(--color-text)]"
											data-testid="asset-name"
										>
											{asset.name}
										</p>
										{#if asset.canonical_descriptor}
											<p
												class="truncate text-xs text-[var(--color-text-muted)]"
												data-testid="asset-descriptor"
											>
												{asset.canonical_descriptor}
											</p>
										{/if}
									</div>
									<button
										type="button"
										class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
										aria-label={`Edit ${asset.name}`}
										{disabled}
										onclick={() => startEdit(asset)}
										data-testid="asset-edit"
									>
										<Pencil class="h-4 w-4" />
									</button>
									<button
										type="button"
										class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
										aria-label={`Delete ${asset.name}`}
										{disabled}
										onclick={() => remove(asset)}
										data-testid="asset-delete"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if isAdding(group.kind)}
				<AssetEditor {projectId} kind={group.kind} onDone={closeEditor} />
			{/if}
		</section>
	{/each}
</div>

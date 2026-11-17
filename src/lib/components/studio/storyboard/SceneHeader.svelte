<script lang="ts">
	// Read-only header row for one storyboard scene. Shows the scene name (with a
	// fallback) plus a compact int_ext / location / time_of_day metadata line
	// (empties omitted), and the row controls: Edit, Delete, Move up, Move down.
	// Move buttons are real <button>s so Enter/Space are native; each icon button
	// carries an aria-label. Mirrors the AssetLibrary row idiom (lucide icons,
	// shared tokens). Reorder/edit/delete are delegated to the parent via
	// callbacks — this component owns no store state.
	import type { StoryboardSceneResponse } from '$lib/types';
	import { Pencil, Trash2, ChevronUp, ChevronDown } from '@lucide/svelte';

	interface Props {
		scene: StoryboardSceneResponse;
		canMoveUp: boolean;
		canMoveDown: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onMove: (dir: -1 | 1) => void;
		/** Read-only mode: gates edit / delete / reorder for an archived or
		 *  merged/abandoned project (the backend also 409s these). */
		disabled?: boolean;
	}

	let {
		scene,
		canMoveUp,
		canMoveDown,
		onEdit,
		onDelete,
		onMove,
		disabled = false
	}: Props = $props();

	const title = $derived(scene.name?.trim() ? scene.name.trim() : 'Untitled scene');
	// Deleting a scene is destructive and cannot be undone from this row, so it is a
	// two-step inline confirm rather than a single click on a bare trash icon —
	// mirroring `snapshot-delete-prompt` in StoryboardVersions.svelte and the
	// `draft-confirm` flow in StoryboardSection.svelte. `window.confirm` is
	// deliberately NOT used: a native dialog is invisible to Playwright and blocks
	// the e2e suite.
	let confirmingDelete = $state(false);

	function handleDeleteClick(): void {
		confirmingDelete = true;
	}

	function handleCancelDelete(): void {
		confirmingDelete = false;
	}

	function handleConfirmDelete(): void {
		confirmingDelete = false;
		onDelete();
	}
	// Compact metadata line — drop empty parts so we never render stray separators.
	const meta = $derived(
		[scene.int_ext, scene.location, scene.time_of_day]
			.map((v) => v?.trim())
			.filter((v): v is string => !!v)
			.join(' · ')
	);
</script>

<div
	class="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
	data-testid="scene-header"
>
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-medium text-[var(--color-text)]" data-testid="scene-name">
			{title}
		</p>
		{#if meta}
			<p class="truncate text-xs text-[var(--color-text-muted)]" data-testid="scene-meta">
				{meta}
			</p>
		{/if}
	</div>

	{#if confirmingDelete}
		<div class="flex items-center gap-2" data-testid="scene-delete-prompt">
			<span class="text-sm text-[var(--color-text-muted)]">
				Delete “{title}” permanently?
			</span>
			<button
				type="button"
				class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-colors disabled:opacity-40"
				{disabled}
				onclick={handleConfirmDelete}
				data-testid="scene-delete-confirm"
			>
				Delete
			</button>
			<button
				type="button"
				class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
				onclick={handleCancelDelete}
				data-testid="scene-delete-cancel"
			>
				Cancel
			</button>
		</div>
	{:else}
		<button
			type="button"
			class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
			aria-label={`Move ${title} up`}
			disabled={!canMoveUp || disabled}
			onclick={() => onMove(-1)}
			data-testid="scene-move-up"
		>
			<ChevronUp class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
			aria-label={`Move ${title} down`}
			disabled={!canMoveDown || disabled}
			onclick={() => onMove(1)}
			data-testid="scene-move-down"
		>
			<ChevronDown class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
			aria-label={`Edit ${title}`}
			{disabled}
			onclick={onEdit}
			data-testid="scene-edit"
		>
			<Pencil class="h-4 w-4" />
		</button>
		<button
			type="button"
			class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
			aria-label={`Delete ${title}`}
			{disabled}
			onclick={handleDeleteClick}
			data-testid="scene-delete"
		>
			<Trash2 class="h-4 w-4" />
		</button>
	{/if}
</div>

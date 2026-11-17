<script lang="ts">
	import { VerbatimTwoTrack } from '$lib/components/studio';
	import { ApiError } from '$lib/api';
	import {
		createForProject,
		deleteForProject,
		updateForProject,
		reorderProject,
		getProjectList,
		getProject,
		loadProject,
		isProjectLoading
	} from '$lib/stores/verbatim.svelte.js';
	import { planMove } from '$lib/verbatim/reorder.js';
	import { ErrorState, Skeleton } from '$lib/components/ui';
	import type { ProjectDetailResponse, VerbatimItemUpdateRequest } from '$lib/types';

	let { project }: { project: ProjectDetailResponse } = $props();

	let loadError = $state<unknown>(null);

	// The workspace loader doesn't seed verbatim, so fetch on mount if the store
	// has no snapshot for this project yet. Re-renders flow via getProjectList.
	//
	// The `loadError === null` term is load-bearing: without it a failed fetch
	// leaves the store empty, the guard true, and the effect re-fires forever.
	$effect(() => {
		if (
			getProject(project.id) === undefined &&
			!isProjectLoading(project.id) &&
			loadError === null
		) {
			loadProject(project.id).catch((err: unknown) => {
				// A swallowed failure here used to render as "this project has no
				// verbatim items" — indistinguishable from an empty project, and the
				// add-forms invited the user to re-enter text that already exists.
				loadError = err;
			});
		}
	});

	function retry() {
		loadError = null;
		loadProject(project.id).catch((err: unknown) => {
			loadError = err;
		});
	}

	const items = $derived(getProjectList(project.id));
	const loading = $derived(getProject(project.id) === undefined && isProjectLoading(project.id));

	async function handleCreate(body: Parameters<typeof createForProject>[1]) {
		try {
			await createForProject(project.id, body);
		} catch (err) {
			throw new Error(
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to create item',
				{ cause: err }
			);
		}
	}

	async function handleDelete(itemId: string) {
		try {
			await deleteForProject(project.id, itemId);
		} catch (err) {
			throw new Error(
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to delete item',
				{ cause: err }
			);
		}
	}

	async function handleUpdate(itemId: string, body: VerbatimItemUpdateRequest) {
		try {
			await updateForProject(project.id, itemId, body);
		} catch (err) {
			throw new Error(
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to update item',
				{ cause: err }
			);
		}
	}

	async function handleMove(itemId: string, dir: -1 | 1) {
		// Moves are within-track: an item only ever swaps with its neighbour of
		// the SAME kind, because that is the sequence each consumer stage reads.
		// Planning against the merged list would swap a slide past a tts row and
		// change nothing the user can see.
		const moved = items.find((i) => i.id === itemId);
		if (!moved) return;
		const track = items
			.filter((i) => i.kind === moved.kind)
			// created_at is nullable on our hand-written type; it only feeds the
			// sort tiebreak, so an empty string is a harmless stand-in.
			.map((i) => ({ ...i, created_at: i.created_at ?? '' }));
		const updates = planMove(track, itemId, dir);
		if (updates.length === 0) return;
		try {
			await reorderProject(project.id, updates);
		} catch (err) {
			throw new Error(
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to reorder items',
				{ cause: err }
			);
		}
	}
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
>
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Verbatim items</h2>
		<p class="text-sm text-[var(--color-text-muted)] mt-1">
			Literal text the pipeline must surface. Project-scoped items inherit to every deliverable
			started from this project; the orchestrator auto-retries (up to 2x) if a stage's first output
			misses an item before forcing a pause for review.
		</p>
	</div>

	{#if loading}
		<Skeleton variant="box" height="8rem" />
	{:else if loadError !== null}
		<div data-testid="verbatim-error">
			<ErrorState error={loadError} title="Couldn't load verbatim items" onRetry={retry} />
		</div>
	{:else}
		<VerbatimTwoTrack
			{items}
			onCreate={handleCreate}
			onDelete={handleDelete}
			onUpdate={handleUpdate}
			onMove={handleMove}
			defaultScope="pipeline"
		/>
	{/if}
</section>

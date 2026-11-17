<script lang="ts">
	// Section-mode container that replaces the flat StoryboardBoard: renders one
	// SceneGroup per scene (in scene order) plus a trailing "Unassigned" group for
	// panels with no scene. Grouping comes from the store's getPanelsByScene; the
	// store stays authoritative for order. Panel reorder is scene-local — a group
	// emits the ordered ids WITHIN its scene, and this component merges that into a
	// GLOBAL ordered id list (every scene's panels in scene order, then unassigned)
	// before delegating to the section's onReorderPanels (→ store.reorderPanels,
	// which is optimistic-with-revert). Scene create/edit toggle an inline
	// SceneEditor; scene delete + move call the store directly and toast on error.
	import type { StoryboardPanelDraft } from '$lib/types';
	import { getPanelsByScene, reorderScenes, deleteScene } from '$lib/stores/storyboard.svelte.js';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import SceneGroup from './SceneGroup.svelte';
	import SceneEditor from './SceneEditor.svelte';

	interface Props {
		projectId: string;
		/** Add a panel. The group that raises it binds its own scene id, so a shot
		 *  added inside a scene lands in that scene; the unassigned group (and any
		 *  caller with no scene context) passes null/undefined. */
		onAddPanel: (sceneId?: string | null) => void;
		onUpdatePanel: (id: string, patch: Partial<StoryboardPanelDraft>) => void | Promise<unknown>;
		onDeletePanel: (id: string) => void;
		onReorderPanels: (orderedIds: string[]) => void;
		onRewritePanel?: (id: string, instruction: string, fields?: string[]) => void;
		isPanelBusy?: (id: string) => boolean;
		onMovePanelToScene: (panelId: string, sceneId: string | null) => void;
		onEditSceneDone?: () => void;
		/** Read-only mode: the project is archived or a merged/abandoned branch child.
		 *  Gates scene create/edit/delete/reorder and the embedded panel boards. */
		disabled?: boolean;
	}

	let {
		projectId,
		onAddPanel,
		onUpdatePanel,
		onDeletePanel,
		onReorderPanels,
		onRewritePanel,
		isPanelBusy,
		onMovePanelToScene,
		onEditSceneDone,
		disabled = false
	}: Props = $props();

	const grouped = $derived(getPanelsByScene(projectId));

	// Scene picker options for the per-panel "Move to scene" selects: every scene
	// (by id) plus the null bucket last.
	const sceneOptions = $derived<{ id: string | null; label: string }[]>([
		...grouped.scenes.map((s) => ({ id: s.id, label: s.name ?? 'Untitled scene' })),
		{ id: null, label: 'Unassigned' }
	]);

	const unassigned = $derived(grouped.groups.get(null) ?? []);

	// Inline editor state: create (addingScene) or edit a specific scene id.
	let addingScene = $state(false);
	let editingSceneId = $state<string | null>(null);

	function idsFor(sceneKey: string | null): string[] {
		return (grouped.groups.get(sceneKey) ?? []).map((p) => p.id);
	}

	// Merge a scene-local reorder into the global ordered id list: walk scenes in
	// order (then unassigned), substituting the reordered segment for `overrideKey`.
	function mergedOrder(overrideKey: string | null, overrideIds: string[]): string[] {
		const out: string[] = [];
		for (const scene of grouped.scenes) {
			out.push(...(scene.id === overrideKey ? overrideIds : idsFor(scene.id)));
		}
		out.push(...(overrideKey === null ? overrideIds : idsFor(null)));
		return out;
	}

	function reorderGroup(sceneKey: string | null, orderedIds: string[]) {
		onReorderPanels(mergedOrder(sceneKey, orderedIds));
	}

	async function moveScene(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= grouped.scenes.length) return;
		const ids = grouped.scenes.map((s) => s.id);
		[ids[index], ids[target]] = [ids[target], ids[index]];
		try {
			await reorderScenes(projectId, ids);
		} catch (e) {
			toastError('Failed to reorder scenes', e instanceof Error ? e.message : undefined);
		}
	}

	async function removeScene(sceneId: string) {
		try {
			await deleteScene(projectId, sceneId);
		} catch (e) {
			toastError('Failed to delete scene', e instanceof Error ? e.message : undefined);
		}
	}

	function closeEditor() {
		addingScene = false;
		editingSceneId = null;
		onEditSceneDone?.();
	}
</script>

<div class="space-y-6" data-testid="scene-board">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold text-[var(--color-text)]">Scenes</h3>
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			disabled={addingScene || disabled}
			onclick={() => (addingScene = true)}
			data-testid="add-scene"
		>
			Add scene
		</button>
	</div>

	{#if addingScene}
		<SceneEditor {projectId} onDone={closeEditor} />
	{/if}

	{#each grouped.scenes as scene, i (scene.id)}
		{#if editingSceneId === scene.id}
			<SceneEditor {projectId} {scene} onDone={closeEditor} />
		{:else}
			<SceneGroup
				{scene}
				panels={grouped.groups.get(scene.id) ?? []}
				sceneCount={grouped.scenes.length}
				index={i}
				onEditScene={() => (editingSceneId = scene.id)}
				onDeleteScene={() => removeScene(scene.id)}
				onMoveScene={(dir) => moveScene(i, dir)}
				onReorderPanels={(orderedIds) => reorderGroup(scene.id, orderedIds)}
				onAddPanel={() => onAddPanel(scene.id)}
				{onUpdatePanel}
				{onDeletePanel}
				{onRewritePanel}
				{isPanelBusy}
				{onMovePanelToScene}
				{sceneOptions}
				{disabled}
			/>
		{/if}
	{/each}

	<!-- Also mount the unassigned group when there are NO scenes at all: it is the
	     only board a brand-new project has, so without it nothing renders and the
	     Add-shot affordance is unreachable (the first panel could then only be
	     created by "Draft from brief" or the raw API). -->
	{#if unassigned.length > 0 || grouped.scenes.length === 0}
		<SceneGroup
			scene={null}
			panels={unassigned}
			sceneCount={grouped.scenes.length}
			index={grouped.scenes.length}
			onEditScene={() => {}}
			onDeleteScene={() => {}}
			onMoveScene={() => {}}
			onReorderPanels={(orderedIds) => reorderGroup(null, orderedIds)}
			onAddPanel={() => onAddPanel(null)}
			{onUpdatePanel}
			{onDeletePanel}
			{onRewritePanel}
			{isPanelBusy}
			{onMovePanelToScene}
			{sceneOptions}
			{disabled}
		/>
	{/if}
</div>

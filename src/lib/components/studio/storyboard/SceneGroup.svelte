<script lang="ts">
	// One scene group in the Scenes UI: a SceneHeader (or a plain "Unassigned"
	// heading for the null bucket) above a StoryboardBoard scoped to THIS scene's
	// panels. The embedded board runs header-less and with a UNIQUE dnd `type`
	// (`storyboard-scene-<sceneId|unassigned>`) so svelte-dnd-action confines drag
	// to within the scene — reusing one type across groups would let panels be
	// dragged across scene boundaries. A compact "Move shots" row under the board
	// gives each panel a labeled <select> to reassign it to another scene (or to
	// the unassigned bucket), the only cross-scene move affordance in v1.
	//
	// The group owns its OWN "Add shot" button (`add-shot-scene`), sitting beside
	// the scene header: the embedded board runs header-less, so its own `add-shot`
	// control is not rendered here and would otherwise be unreachable in the
	// workspace (scene-grouped is the only workspace mode). The parent binds this
	// group's scene id into `onAddPanel`, so a shot added here lands in THIS scene.
	import type {
		StoryboardSceneResponse,
		StoryboardPanelResponse,
		StoryboardPanelDraft
	} from '$lib/types';
	import { Plus } from '@lucide/svelte';
	import SceneHeader from './SceneHeader.svelte';
	import StoryboardBoard from './StoryboardBoard.svelte';

	interface Props {
		scene: StoryboardSceneResponse | null;
		panels: StoryboardPanelResponse[];
		sceneCount: number;
		index: number;
		onEditScene: () => void;
		onDeleteScene: () => void;
		onMoveScene: (dir: -1 | 1) => void;
		onReorderPanels: (orderedIds: string[]) => void;
		onAddPanel: () => void;
		onUpdatePanel: (id: string, patch: Partial<StoryboardPanelDraft>) => void | Promise<unknown>;
		onDeletePanel: (id: string) => void;
		onRewritePanel?: (id: string, instruction: string, fields?: string[]) => void;
		isPanelBusy?: (id: string) => boolean;
		onMovePanelToScene: (panelId: string, sceneId: string | null) => void;
		sceneOptions: { id: string | null; label: string }[];
		/** Read-only mode: the project is archived or a merged/abandoned branch child.
		 *  Gates the panel board, scene controls, add-shot and per-panel move. */
		disabled?: boolean;
	}

	let {
		scene,
		panels,
		sceneCount,
		index,
		onEditScene,
		onDeleteScene,
		onMoveScene,
		onReorderPanels,
		onAddPanel,
		onUpdatePanel,
		onDeletePanel,
		onRewritePanel,
		isPanelBusy,
		onMovePanelToScene,
		sceneOptions,
		disabled = false
	}: Props = $props();

	// Isolate drag to this scene: a per-group dnd type prevents cross-scene drops.
	const dndType = $derived(`storyboard-scene-${scene ? scene.id : 'unassigned'}`);

	// Label for the group's Add-shot aria-label (mirrors SceneHeader's fallback).
	const groupTitle = $derived(
		scene ? (scene.name?.trim() ? scene.name.trim() : 'Untitled scene') : 'Unassigned'
	);

	function shotLabel(panel: StoryboardPanelResponse, i: number): string {
		return panel.shot_key ?? `clip-${i + 1}`;
	}

	function handleMove(panelId: string, e: Event) {
		const raw = (e.currentTarget as HTMLSelectElement).value;
		onMovePanelToScene(panelId, raw === '' ? null : raw);
	}
</script>

<section class="space-y-3" data-testid="scene-group" data-scene-id={scene ? scene.id : ''}>
	<div class="flex items-center gap-2">
		<div class="min-w-0 flex-1">
			{#if scene}
				<SceneHeader
					{scene}
					canMoveUp={index > 0}
					canMoveDown={index < sceneCount - 1}
					onEdit={onEditScene}
					onDelete={onDeleteScene}
					onMove={onMoveScene}
					{disabled}
				/>
			{:else}
				<h3
					class="text-sm font-semibold text-[var(--color-text-muted)]"
					data-testid="scene-unassigned"
				>
					Unassigned
				</h3>
			{/if}
		</div>

		<button
			type="button"
			class="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			aria-label={`Add shot to ${groupTitle}`}
			{disabled}
			onclick={onAddPanel}
			data-testid="add-shot-scene"
		>
			<Plus class="h-4 w-4" />
			Add shot
		</button>
	</div>

	<StoryboardBoard
		{panels}
		title=""
		hideHeader={true}
		{dndType}
		onReorder={onReorderPanels}
		onAdd={onAddPanel}
		onUpdate={onUpdatePanel}
		onDelete={onDeletePanel}
		onRewrite={onRewritePanel}
		isBusy={isPanelBusy}
		{disabled}
	/>

	{#if panels.length > 0}
		<div class="space-y-2" data-testid="scene-move-shots">
			<p class="text-xs font-medium text-[var(--color-text-muted)]">Move shots</p>
			<ul class="space-y-1.5">
				{#each panels as panel, i (panel.id)}
					<li class="flex items-center gap-2" data-testid="scene-move-row" data-panel-id={panel.id}>
						<span class="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]">
							{shotLabel(panel, i)}
						</span>
						<select
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] disabled:opacity-40"
							aria-label={`Move shot ${shotLabel(panel, i)} to scene`}
							data-testid="scene-move-select"
							value={panel.scene_id ?? ''}
							{disabled}
							onchange={(e) => handleMove(panel.id, e)}
						>
							{#each sceneOptions as opt (opt.id ?? '__null__')}
								<option value={opt.id ?? ''}>{opt.label}</option>
							{/each}
						</select>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

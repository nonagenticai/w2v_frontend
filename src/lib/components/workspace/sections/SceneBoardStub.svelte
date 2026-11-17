<!--
  Test-only stub for WS-A2's `SceneBoard.svelte`. StoryboardSection.test.ts
  mocks the real component with this so the section test doesn't couple to
  SceneBoard's internals or fire network. Renders `data-testid="scene-board"`
  and a button that invokes `onMovePanelToScene` so the section's handler wiring
  can be asserted. The index signature accepts (and ignores) every other prop
  the section passes.
-->
<script lang="ts">
	interface Props {
		onMovePanelToScene?: (panelId: string, sceneId: string | null) => void | Promise<void>;
		onAddPanel?: (sceneId?: string | null) => void;
		[key: string]: unknown;
	}
	let { onMovePanelToScene, onAddPanel, ..._rest }: Props = $props();
</script>

<div data-testid="scene-board">
	<button
		type="button"
		data-testid="mock-move-panel"
		onclick={() => onMovePanelToScene?.('panel-x', 'scene-y')}
	>
		move
	</button>
	<!-- Stand-ins for a SceneGroup's Add-shot: one bound to a scene id, one for the
	     unassigned group — so the section's handleAdd → createPanel payload
	     (scene_id present vs omitted) can be asserted. -->
	<button type="button" data-testid="mock-add-panel-scene" onclick={() => onAddPanel?.('scene-y')}>
		add in scene
	</button>
	<button type="button" data-testid="mock-add-panel-unassigned" onclick={() => onAddPanel?.(null)}>
		add unassigned
	</button>
</div>

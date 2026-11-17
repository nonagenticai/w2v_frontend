<script lang="ts">
	import type { StoryboardPanelDraft } from '$lib/types';
	// Dependency-free stand-in for StoryboardBoard (the in-memory fallback board),
	// declaring `panels` bindable so the fallback `bind:panels` mounts cleanly.
	let { panels = $bindable<StoryboardPanelDraft[]>([]) } = $props();
</script>

<div data-testid="storyboard-board-stub" data-panel-count={panels.length}></div>

<script lang="ts">
	// Test-only harness: a panel that throws during render, wrapped in a
	// PanelBoundary, next to a sibling panel that must survive.
	import PanelBoundary from './PanelBoundary.svelte';

	let { shouldThrow = false }: { shouldThrow?: boolean } = $props();

	function boom(): string {
		throw new Error('https://svelte.dev/e/each_key_duplicate');
	}
</script>

<PanelBoundary name="Outputs">
	<p data-testid="boundary-child">{shouldThrow ? boom() : 'ok'}</p>
</PanelBoundary>

<p data-testid="sibling-panel">sibling</p>

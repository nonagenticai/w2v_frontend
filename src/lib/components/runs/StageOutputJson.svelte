<script lang="ts">
	// Fallback pretty-printer for stage outputs without a dedicated view.
	let { output, title }: { output: unknown; title?: string } = $props();
	const json = $derived(JSON.stringify(output ?? null, null, 2));
</script>

<div class="space-y-3">
	{#if title}
		<h2 class="text-base font-semibold text-[var(--color-text)]">{title}</h2>
	{/if}
	<pre
		class="text-xs leading-relaxed font-mono bg-[var(--color-surface-strong)] text-[var(--color-text)] rounded-lg p-4 overflow-auto max-h-[70vh] whitespace-pre-wrap break-words">{json}</pre>
</div>

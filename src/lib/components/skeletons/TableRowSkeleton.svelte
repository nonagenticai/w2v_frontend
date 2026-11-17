<script lang="ts">
	let { columns = 4 }: { columns?: number } = $props();
</script>

<div
	aria-hidden="true"
	class="animate-pulse grid gap-3 p-3"
	style="grid-template-columns: repeat({columns}, minmax(0, 1fr));"
>
	{#each Array.from({ length: columns }) as _, i (i)}
		<div class="h-4 rounded bg-surface-raised"></div>
	{/each}
</div>

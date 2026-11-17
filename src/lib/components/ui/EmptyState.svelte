<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		icon,
		action
	}: {
		title: string;
		description?: string;
		icon?: Snippet;
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 px-4 text-center">
	{#if icon}
		<div class="text-[var(--color-text-muted)] mb-4">
			{@render icon()}
		</div>
	{/if}
	<h3 class="text-lg font-medium text-[var(--color-text)] mb-1">{title}</h3>
	{#if description}
		<p class="text-sm text-[var(--color-text-muted)] max-w-md">{description}</p>
	{/if}
	{#if action}
		<div class="mt-4">
			{@render action()}
		</div>
	{/if}
</div>

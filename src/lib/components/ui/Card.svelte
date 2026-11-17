<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		hover = false,
		children,
		class: className = ''
	}: {
		hover?: boolean;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<div
	class="bg-surface border border-border rounded-2xl glass {hover
		? 'hover:border-primary-300/70 hover:shadow-soft transition-all duration-200 cursor-pointer'
		: ''} {className}"
>
	{@render children()}
</div>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'default',
		children
	}: {
		variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
		children: Snippet;
	} = $props();

	const variantClasses = {
		default: 'bg-surface-raised text-text-secondary border border-border',
		success: 'bg-status-completed/15 text-status-completed border border-status-completed/20',
		warning: 'bg-status-pending/15 text-status-pending border border-status-pending/20',
		error: 'bg-status-failed/15 text-status-failed border border-status-failed/20',
		info: 'bg-status-running/15 text-status-running border border-status-running/20'
	};
</script>

<span
	class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {variantClasses[
		variant
	]}"
>
	{@render children()}
</span>

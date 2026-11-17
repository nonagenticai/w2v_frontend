<script lang="ts">
	import { CheckCircle, XCircle, AlertTriangle, Info, X } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import type { ToastItem } from '$lib/stores/toast.svelte';
	import { removeToast } from '$lib/stores/toast.svelte';

	let { toast }: { toast: ToastItem } = $props();

	const icons = {
		success: CheckCircle,
		error: XCircle,
		warning: AlertTriangle,
		info: Info
	};

	const Icon = $derived(icons[toast.variant]);

	const colorMap = {
		success: 'text-status-completed',
		error: 'text-status-failed',
		warning: 'text-status-pending',
		info: 'text-status-running'
	};

	const borderMap = {
		success: 'border-status-completed/30',
		error: 'border-status-failed/30',
		warning: 'border-status-pending/30',
		info: 'border-status-running/30'
	};
</script>

<div
	class="flex items-start gap-3 w-80 rounded-xl border bg-surface-raised glass p-4 shadow-lg {borderMap[
		toast.variant
	]}"
	transition:fly={{ x: 100, duration: 200 }}
	role="alert"
>
	<Icon class="h-5 w-5 shrink-0 {colorMap[toast.variant]}" />

	<div class="flex-1 min-w-0">
		<p class="text-sm font-medium text-text">{toast.title}</p>
		{#if toast.description}
			<p class="mt-1 text-xs text-text-secondary">{toast.description}</p>
		{/if}
	</div>

	<button
		onclick={() => removeToast(toast.id)}
		class="shrink-0 rounded p-0.5 text-text-muted hover:text-text-secondary hover:bg-surface"
	>
		<X class="h-4 w-4" />
	</button>
</div>

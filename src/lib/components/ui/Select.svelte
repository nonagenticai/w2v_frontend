<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';

	let {
		label,
		name,
		value = $bindable(''),
		options,
		placeholder = 'Select...',
		error,
		required = false,
		disabled = false,
		onchange,
		class: className = ''
	}: {
		label?: string;
		name: string;
		value?: string;
		options: Array<{ value: string; label: string }>;
		placeholder?: string;
		error?: string;
		required?: boolean;
		disabled?: boolean;
		onchange?: (e: Event) => void;
		class?: string;
	} = $props();
</script>

<div class="flex flex-col gap-1.5 {className}">
	{#if label}
		<label
			for={name}
			class="text-sm font-medium {error
				? 'text-[var(--color-danger)]'
				: 'text-[var(--color-text-muted)]'}"
		>
			{label}
		</label>
	{/if}
	<div class="relative">
		<select
			{name}
			id={name}
			bind:value
			{required}
			{disabled}
			{onchange}
			class="w-full appearance-none rounded-[var(--radius-md)] border px-3 py-2 pr-9 text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] transition-all duration-200 {error
				? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/20'
				: 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-accent)] focus:ring-[var(--color-accent)]/20'} {disabled
				? 'opacity-50 cursor-not-allowed'
				: ''}"
		>
			{#if placeholder}
				<option value="" disabled>{placeholder}</option>
			{/if}
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
		<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
			<ChevronDown class="h-4 w-4 text-[var(--color-text-muted)]" />
		</div>
	</div>
	{#if error}
		<p class="text-xs text-[var(--color-danger)] mt-0.5">{error}</p>
	{/if}
</div>

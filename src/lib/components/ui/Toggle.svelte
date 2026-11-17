<script lang="ts">
	let {
		checked = $bindable(false),
		label,
		description,
		disabled = false,
		class: className = ''
	}: {
		checked: boolean;
		label?: string;
		description?: string;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<div class="flex items-center justify-between {className}">
	{#if label || description}
		<div>
			{#if label}<p class="text-sm font-medium text-text">{label}</p>{/if}
			{#if description}<p class="text-xs text-text-secondary">{description}</p>{/if}
		</div>
	{/if}
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-label={label}
		{disabled}
		onclick={() => (checked = !checked)}
		class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2 focus:ring-offset-background {checked
			? 'bg-primary-500'
			: 'bg-text-muted'} {disabled ? 'opacity-40 cursor-not-allowed' : ''}"
	>
		<span
			class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 mt-0.5 {checked
				? 'translate-x-4 ml-0.5'
				: 'translate-x-0 ml-0.5'}"
		></span>
	</button>
</div>

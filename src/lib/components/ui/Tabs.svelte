<script lang="ts">
	let {
		items,
		value = $bindable(''),
		onValueChange,
		class: className = ''
	}: {
		items: Array<{ value: string; label: string; count?: number }>;
		value: string;
		/** Called with the newly-selected value on click/keyboard. Lets callers
		 *  drive navigation imperatively instead of via a two-way `bind:value`. */
		onValueChange?: (value: string) => void;
		class?: string;
	} = $props();

	function select(next: string) {
		value = next;
		onValueChange?.(next);
	}

	function handleKeydown(e: KeyboardEvent) {
		const idx = items.findIndex((item) => item.value === value);
		let target = -1;

		if (e.key === 'ArrowRight') target = (idx + 1) % items.length;
		else if (e.key === 'ArrowLeft') target = (idx - 1 + items.length) % items.length;
		else if (e.key === 'Home') target = 0;
		else if (e.key === 'End') target = items.length - 1;

		if (target >= 0) {
			e.preventDefault();
			select(items[target].value);
			document.getElementById(`tab-${target}`)?.focus();
		}
	}
</script>

<!-- Scrolls sideways when the tabs outgrow the screen (5 status tabs at 390px
     ran past the edge). The baseline is an inset shadow, not border-b +
     -mb-px on the tabs: an overflow container clips that 1px overlap. -->
<div
	role="tablist"
	class="flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] {className}"
>
	{#each items as item, i (item.value)}
		{@const isActive = value === item.value}
		<button
			id="tab-{i}"
			type="button"
			role="tab"
			aria-selected={isActive}
			tabindex={isActive ? 0 : -1}
			onclick={() => select(item.value)}
			onkeydown={handleKeydown}
			class="shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 transition-all duration-200 {isActive
				? 'text-[var(--color-accent)] border-[var(--color-accent)]'
				: 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] border-transparent'}"
		>
			{item.label}
			{#if item.count !== undefined}
				<span
					class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs {isActive
						? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]'
						: 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]'}">{item.count}</span
				>
			{/if}
		</button>
	{/each}
</div>

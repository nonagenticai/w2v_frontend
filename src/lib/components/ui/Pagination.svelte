<script lang="ts">
	import Button from './Button.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		page = $bindable(1),
		pageSize,
		total,
		onPageChange,
		class: className = ''
	}: {
		page: number;
		pageSize: number;
		total: number;
		/** Called with the new page number on any page change. Lets callers drive
		 *  navigation imperatively instead of via a two-way `bind:page`. */
		onPageChange?: (page: number) => void;
		class?: string;
	} = $props();

	function go(next: number) {
		page = next;
		onPageChange?.(next);
	}

	let totalPages = $derived(Math.ceil(total / pageSize));
	let showingFrom = $derived((page - 1) * pageSize + 1);
	let showingTo = $derived(Math.min(page * pageSize, total));

	let pages = $derived.by(() => {
		if (totalPages <= 7) {
			return Array.from({ length: totalPages }, (_, i) => i + 1) as (number | null)[];
		}

		const nums = new SvelteSet<number>();
		nums.add(1);
		nums.add(totalPages);
		nums.add(page);
		if (page - 1 >= 1) nums.add(page - 1);
		if (page + 1 <= totalPages) nums.add(page + 1);

		const sorted = [...nums].sort((a, b) => a - b);
		const result: (number | null)[] = [];

		for (let i = 0; i < sorted.length; i++) {
			if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
				result.push(null);
			}
			result.push(sorted[i]);
		}

		return result;
	});
</script>

{#if totalPages > 1}
	<div class="flex items-center justify-between {className}">
		<p class="text-sm text-[var(--color-text-muted)]">
			Showing <span class="font-medium text-[var(--color-text)]">{showingFrom}</span>–<span
				class="font-medium text-[var(--color-text)]">{showingTo}</span
			>
			of <span class="font-medium text-[var(--color-text)]">{total}</span>
		</p>
		<div class="flex items-center gap-1">
			<Button variant="secondary" size="sm" disabled={page <= 1} onclick={() => go(page - 1)}
				>Previous</Button
			>
			{#each pages as p, i (i)}
				{#if p === null}
					<span class="px-2 text-[var(--color-text-muted)]">&hellip;</span>
				{:else}
					<button
						type="button"
						onclick={() => go(p)}
						class="h-8 min-w-8 rounded-[var(--radius-md)] px-2 text-sm font-medium transition-all duration-200 {p ===
						page
							? 'bg-[var(--color-accent)] text-[var(--color-on-primary)]'
							: 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'}"
						>{p}</button
					>
				{/if}
			{/each}
			<Button
				variant="secondary"
				size="sm"
				disabled={page >= totalPages}
				onclick={() => go(page + 1)}>Next</Button
			>
		</div>
	</div>
{/if}

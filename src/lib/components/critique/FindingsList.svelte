<script lang="ts">
	import type { CritiqueCategory, CritiqueFinding, CritiqueSeverity } from '$lib/types';
	import FindingCard from './FindingCard.svelte';
	import { Filter, X } from '@lucide/svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { withUniqueKeys } from '$lib/utils/unique-keys.js';

	// Default to [] so an absent/partial critique payload can't crash the
	// `for (const f of findings)` loops below with "findings is undefined".
	let { findings = [] }: { findings?: CritiqueFinding[] } = $props();

	let activeCategory = $state<string>('');
	let activeSeverities = new SvelteSet<CritiqueSeverity>();

	// Severity sort order (critical first)
	const severityOrder: Record<CritiqueSeverity, number> = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
		info: 4
	};

	const severities: {
		value: CritiqueSeverity;
		label: string;
		color: string;
		activeColor: string;
	}[] = [
		{
			value: 'critical',
			label: 'Critical',
			color: 'text-severity-critical border-severity-critical/30',
			activeColor: 'bg-severity-critical text-white border-severity-critical'
		},
		{
			value: 'high',
			label: 'High',
			color: 'text-severity-high border-severity-high/30',
			activeColor: 'bg-severity-high text-white border-severity-high'
		},
		{
			value: 'medium',
			label: 'Medium',
			color: 'text-severity-medium border-severity-medium/30',
			activeColor: 'bg-severity-medium text-white border-severity-medium'
		},
		{
			value: 'low',
			label: 'Low',
			color: 'text-severity-low border-severity-low/30',
			activeColor: 'bg-severity-low text-white border-severity-low'
		},
		{
			value: 'info',
			label: 'Info',
			color: 'text-severity-info border-severity-info/30',
			activeColor: 'bg-severity-info text-white border-severity-info'
		}
	];

	const categoryLabels: Record<CritiqueCategory, string> = {
		seo: 'SEO',
		a11y: 'Accessibility',
		security: 'Security',
		performance: 'Performance',
		ux: 'UX'
	};

	// Available categories from findings
	const availableCategories = $derived.by(() => {
		const cats = new SvelteMap<CritiqueCategory, number>();
		for (const f of findings) {
			cats.set(f.category, (cats.get(f.category) ?? 0) + 1);
		}
		return Array.from(cats.entries()).map(([cat, count]) => ({
			value: cat,
			label: categoryLabels[cat],
			count
		}));
	});

	// Severity counts
	const severityCounts = $derived.by(() => {
		const counts = new SvelteMap<CritiqueSeverity, number>();
		for (const f of findings) {
			counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
		}
		return counts;
	});

	function toggleSeverity(sev: CritiqueSeverity) {
		if (activeSeverities.has(sev)) {
			activeSeverities.delete(sev);
		} else {
			activeSeverities.add(sev);
		}
	}

	function clearFilters() {
		activeCategory = '';
		activeSeverities.clear();
	}

	const hasFilters = $derived(activeCategory !== '' || activeSeverities.size > 0);

	const filtered = $derived.by(() => {
		let result = findings;
		if (activeCategory) result = result.filter((f) => f.category === activeCategory);
		if (activeSeverities.size > 0) result = result.filter((f) => activeSeverities.has(f.severity));
		return result.toSorted((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
	});
</script>

<div class="space-y-4">
	<!-- Filter bar -->
	<div class="bg-surface rounded-xl border border-border p-4 space-y-3">
		<div class="flex items-center gap-2 text-sm text-text-secondary">
			<Filter class="h-4 w-4" />
			<span class="font-medium">Filters</span>
			{#if hasFilters}
				<button
					type="button"
					onclick={clearFilters}
					class="ml-auto text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors"
				>
					<X class="h-3 w-3" />
					Clear all
				</button>
			{/if}
		</div>

		<!-- Severity pills -->
		<div class="flex flex-wrap gap-2">
			{#each severities as sev (sev.value)}
				{@const count = severityCounts.get(sev.value) ?? 0}
				{@const isActive = activeSeverities.has(sev.value)}
				{#if count > 0}
					<button
						type="button"
						onclick={() => toggleSeverity(sev.value)}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
              {isActive ? sev.activeColor : sev.color + ' bg-surface hover:bg-surface-raised'}"
					>
						{sev.label}
						<span class="tabular-nums {isActive ? 'text-white/80' : 'opacity-60'}">{count}</span>
					</button>
				{/if}
			{/each}
		</div>

		<!-- Category select -->
		{#if availableCategories.length > 1}
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => (activeCategory = '')}
					class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border
            {activeCategory === ''
						? 'bg-primary-500/10 text-primary-400 border-primary-500/20'
						: 'bg-surface text-text-secondary border-border hover:border-primary-500/20 hover:bg-primary-500/5'}"
				>
					All
					<span class="tabular-nums opacity-60">{findings.length}</span>
				</button>
				{#each availableCategories as cat (cat.value)}
					<button
						type="button"
						onclick={() => (activeCategory = activeCategory === cat.value ? '' : cat.value)}
						class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border
              {activeCategory === cat.value
							? 'bg-primary-500/10 text-primary-400 border-primary-500/20'
							: 'bg-surface text-text-secondary border-border hover:border-primary-500/20 hover:bg-primary-500/5'}"
					>
						{cat.label}
						<span class="tabular-nums opacity-60">{cat.count}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Results count -->
	<p class="text-xs text-text-muted px-1">
		Showing {filtered.length} of {findings.length} finding{findings.length !== 1 ? 's' : ''}
	</p>

	<!-- Findings list -->
	{#if filtered.length === 0}
		<div class="text-center py-10">
			<p class="text-sm text-text-secondary">No findings match the current filters.</p>
			{#if hasFilters}
				<button
					type="button"
					onclick={clearFilters}
					class="mt-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
				>
					Clear filters
				</button>
			{/if}
		</div>
	{:else}
		<div class="space-y-2">
			{#each withUniqueKeys(filtered, (f) => f.finding_id) as { item: finding, key } (key)}
				<FindingCard {finding} />
			{/each}
		</div>
	{/if}
</div>

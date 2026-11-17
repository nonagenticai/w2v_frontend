<script lang="ts">
	import type { FeatureReview } from '$lib/types';
	import { Card, Badge } from '$lib/components/ui';
	import { withUniqueKeys } from '$lib/utils/unique-keys.js';

	let { review }: { review: FeatureReview } = $props();

	function scoreColor(score: number): string {
		if (score >= 8) return 'text-status-completed';
		if (score >= 6) return 'text-status-pending';
		return 'text-status-failed';
	}

	function completenessColor(level: string): 'default' | 'success' | 'warning' | 'error' {
		const l = level.toLowerCase();
		if (l === 'solid' || l === 'complete' || l === 'comprehensive') return 'success';
		if (l === 'partial' || l === 'moderate') return 'warning';
		return 'error';
	}

	function importanceColor(level: string): 'default' | 'success' | 'warning' | 'error' {
		const l = level.toLowerCase();
		if (l === 'high' || l === 'critical') return 'error';
		if (l === 'medium') return 'warning';
		return 'default';
	}

	const featureGroups = $derived(Object.entries(review.present_features));

	// Every list below is keyed on an LLM-authored feature NAME. Two rows sharing
	// a name is normal model output — `missing_features` routinely repeats a
	// feature with a different `reason`, and a group can list the same string
	// twice. Svelte throws `each_key_duplicate` on that, and an uncaught throw
	// during render blanks the WHOLE panel (in PROD only — dev logs a warning
	// instead, so this never shows up locally). `withUniqueKeys` keeps the name
	// as the key for the common case and only disambiguates the repeats.
	const missingRows = $derived(withUniqueKeys(review.missing_features ?? [], (m) => m.feature));
	const differentiatorRows = $derived(
		withUniqueKeys(review.differentiators ?? [], (d) => d.feature)
	);
	const suggestionRows = $derived(withUniqueKeys(review.suggestions ?? [], (s) => s.feature));
</script>

<div class="space-y-6">
	<!-- Header with vertical + score -->
	<Card class="p-5">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-xs text-text-muted uppercase tracking-wide mb-1">Vertical</p>
				<p class="text-lg font-semibold text-text">{review.vertical}</p>
			</div>
			<div class="text-center">
				<p class="text-3xl font-bold {scoreColor(review.feature_completeness_score)}">
					{review.feature_completeness_score}
				</p>
				<p class="text-[10px] text-text-muted uppercase tracking-wide">Completeness / 10</p>
			</div>
		</div>
	</Card>

	<!-- Present features -->
	{#if featureGroups.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-text mb-3">Present Features</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				{#each featureGroups as [group, data] (group)}
					<Card class="p-4">
						<div class="flex items-center justify-between mb-2">
							<h4 class="text-sm font-medium text-text">
								{group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
							</h4>
							<Badge variant={completenessColor(data.completeness)}>
								{data.completeness}
							</Badge>
						</div>
						{#if data.features.length > 0}
							<ul class="space-y-1 mb-2">
								{#each withUniqueKeys(data.features, (f) => f) as { item: feature, key } (key)}
									<li class="flex items-start gap-2 text-xs text-text-secondary">
										<span class="shrink-0 mt-1 h-1 w-1 rounded-full bg-text-muted"></span>
										{feature}
									</li>
								{/each}
							</ul>
						{/if}
						{#if data.notes}
							<p class="text-[11px] text-text-muted italic">{data.notes}</p>
						{/if}
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Missing features -->
	{#if review.missing_features.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-status-pending mb-3">Missing Features</h3>
			<div class="space-y-2">
				{#each missingRows as { item, key } (key)}
					<Card class="p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="space-y-1">
								<p class="text-sm font-medium text-text">{item.feature}</p>
								<p class="text-xs text-text-secondary">{item.reason}</p>
							</div>
							<Badge variant={importanceColor(item.importance)}>
								{item.importance}
							</Badge>
						</div>
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Differentiators -->
	{#if review.differentiators.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-status-completed mb-3">Differentiators</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				{#each differentiatorRows as { item: diff, key } (key)}
					<Card class="p-4 border-status-completed/20">
						<div class="space-y-1">
							<div class="flex items-center justify-between">
								<p class="text-sm font-medium text-text">{diff.feature}</p>
								<Badge variant="success">{diff.impact}</Badge>
							</div>
							<p class="text-xs text-text-secondary">{diff.description}</p>
						</div>
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Feature suggestions -->
	{#if review.suggestions.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-primary-400 mb-3">Suggestions</h3>
			<div class="space-y-2">
				{#each suggestionRows as { item: sug, key } (key)}
					<Card class="p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="space-y-1">
								<p class="text-sm font-medium text-text">{sug.feature}</p>
								<p class="text-xs text-text-secondary">{sug.rationale}</p>
							</div>
							<Badge variant="default">{sug.priority}</Badge>
						</div>
					</Card>
				{/each}
			</div>
		</div>
	{/if}
</div>

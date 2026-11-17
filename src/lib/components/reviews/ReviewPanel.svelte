<script lang="ts">
	import type { ScoredReview } from '$lib/types';
	import { Card } from '$lib/components/ui';

	let { review, type }: { review: ScoredReview; type: string } = $props();

	function scoreColor(score: number): string {
		if (score >= 8) return 'text-status-completed';
		if (score >= 6) return 'text-status-pending';
		return 'text-status-failed';
	}

	function strokeColor(score: number): string {
		if (score >= 8) return 'stroke-status-completed';
		if (score >= 6) return 'stroke-status-pending';
		return 'stroke-status-failed';
	}

	const circumference = 2 * Math.PI * 28;

	function formatCategoryName(name: string): string {
		return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	const categoryEntries = $derived(Object.entries(review.categories));
</script>

<div class="space-y-6">
	<!-- Category scores grid -->
	{#if categoryEntries.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-text mb-3">Category Scores</h3>
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
				{#each categoryEntries as [name, cat] (name)}
					<Card class="p-3 flex flex-col items-center gap-2">
						<div class="relative h-16 w-16">
							<svg class="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
								<circle cx="32" cy="32" r="28" fill="none" stroke-width="4" class="stroke-border" />
								<circle
									cx="32"
									cy="32"
									r="28"
									fill="none"
									stroke-width="4"
									class="{strokeColor(cat.score)} transition-all duration-700"
									stroke-linecap="round"
									stroke-dasharray={circumference}
									stroke-dashoffset={circumference - (cat.score / 10) * circumference}
								/>
							</svg>
							<div class="absolute inset-0 flex items-center justify-center">
								<span class="text-sm font-bold {scoreColor(cat.score)}">{cat.score}</span>
							</div>
						</div>
						<span class="text-xs text-text-secondary text-center leading-tight"
							>{formatCategoryName(name)}</span
						>
						{#if cat.observations && cat.observations.length > 0}
							<ul class="text-[11px] text-text-secondary list-disc list-inside mt-1 space-y-0.5">
								{#each cat.observations.slice(0, 2) as obs, i (i)}
									<li>{obs}</li>
								{/each}
							</ul>
						{/if}
						{#if cat.issues && cat.issues.length > 0}
							<ul class="text-[11px] text-status-failed/80 list-disc list-inside mt-1 space-y-0.5">
								{#each cat.issues.slice(0, 2) as issue, i (i)}
									<li>{issue}</li>
								{/each}
							</ul>
						{/if}
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Critical issues (usability) -->
	{#if review.critical_issues && review.critical_issues.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-status-failed mb-3">Critical Issues</h3>
			<div class="space-y-2">
				{#each review.critical_issues as issue, i (i)}
					<Card class="p-4 border-status-failed/30">
						<div class="flex items-start gap-3">
							<span
								class="shrink-0 px-2 py-0.5 rounded text-xs font-medium bg-status-failed/15 text-status-failed"
							>
								{issue.severity}
							</span>
							<div class="space-y-1">
								<p class="text-sm text-text">{issue.description}</p>
								<p class="text-xs text-text-secondary">{issue.recommendation}</p>
								{#if issue.affected_pages && issue.affected_pages.length > 0}
									<p class="text-[11px] text-text-muted">
										Pages: {issue.affected_pages.join(', ')}
									</p>
								{/if}
							</div>
						</div>
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Strengths -->
	{#if review.strengths && review.strengths.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-status-completed mb-3">Strengths</h3>
			<Card class="p-4">
				<ul class="space-y-2">
					{#each review.strengths as strength, i (i)}
						<li class="flex items-start gap-2 text-sm text-text-secondary">
							<span class="shrink-0 mt-1 h-1.5 w-1.5 rounded-full bg-status-completed"></span>
							{strength}
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<!-- Weaknesses / Issues -->
	{#if (review.weaknesses && review.weaknesses.length > 0) || (review.issues && review.issues.length > 0)}
		<div>
			<h3 class="text-sm font-semibold text-status-pending mb-3">
				{type === 'usability_review' || type === 'content_quality_review' ? 'Issues' : 'Weaknesses'}
			</h3>
			<Card class="p-4">
				<ul class="space-y-2">
					{#each review.weaknesses ?? review.issues ?? [] as item, i (i)}
						<li class="flex items-start gap-2 text-sm text-text-secondary">
							<span class="shrink-0 mt-1 h-1.5 w-1.5 rounded-full bg-status-pending"></span>
							{item}
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<!-- Recommendations -->
	{#if review.recommendations && review.recommendations.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-primary-400 mb-3">Recommendations</h3>
			<Card class="p-4">
				<ul class="space-y-2">
					{#each review.recommendations as rec, i (i)}
						<li class="flex items-start gap-2 text-sm text-text-secondary">
							<span class="shrink-0 mt-1 h-1.5 w-1.5 rounded-full bg-primary-400"></span>
							{rec}
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<!-- Quick wins (usability) -->
	{#if review.quick_wins && review.quick_wins.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-status-completed mb-3">Quick Wins</h3>
			<Card class="p-4">
				<ul class="space-y-2">
					{#each review.quick_wins as win, i (i)}
						<li class="flex items-start gap-2 text-sm text-text-secondary">
							<span class="shrink-0 mt-1 h-1.5 w-1.5 rounded-full bg-status-completed"></span>
							{win}
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<!-- Long-term improvements (usability) -->
	{#if review.long_term_improvements && review.long_term_improvements.length > 0}
		<div>
			<h3 class="text-sm font-semibold text-text-secondary mb-3">Long-term Improvements</h3>
			<Card class="p-4">
				<ul class="space-y-2">
					{#each review.long_term_improvements as item, i (i)}
						<li class="flex items-start gap-2 text-sm text-text-secondary">
							<span class="shrink-0 mt-1 h-1.5 w-1.5 rounded-full bg-text-muted"></span>
							{item}
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}
</div>

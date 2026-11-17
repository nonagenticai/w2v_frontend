<script lang="ts">
	import type { JobReviews } from '$lib/types';
	import { Palette, MousePointerClick, Package, FileText, Lightbulb } from '@lucide/svelte';

	type ReviewType = keyof JobReviews;

	let {
		reviews,
		activeTab,
		onselect
	}: {
		reviews: JobReviews;
		activeTab: ReviewType;
		onselect: (tab: ReviewType) => void;
	} = $props();

	const tabs: { key: ReviewType; label: string; icon: typeof Palette }[] = [
		{ key: 'design_review', label: 'Design', icon: Palette },
		{ key: 'usability_review', label: 'Usability', icon: MousePointerClick },
		{ key: 'feature_review', label: 'Features', icon: Package },
		{ key: 'content_quality_review', label: 'Content', icon: FileText },
		{ key: 'feature_suggestions', label: 'Suggestions', icon: Lightbulb }
	];

	function getScore(key: ReviewType): number | null {
		const review = reviews[key];
		if (!review) return null;
		if ('overall_score' in review) return review.overall_score;
		if ('feature_completeness_score' in review) return review.feature_completeness_score;
		if ('total_proposals' in review) return review.total_proposals;
		return null;
	}

	function scoreColor(score: number, isCount = false): string {
		if (isCount) return 'text-primary-400';
		if (score >= 8) return 'text-status-completed';
		if (score >= 6) return 'text-status-pending';
		return 'text-status-failed';
	}

	/** Check whether at least one other review exists (indicating the review stage ran). */
	const otherReviewsExist = $derived.by((): boolean => {
		const scored: ReviewType[] = [
			'design_review',
			'usability_review',
			'feature_review',
			'content_quality_review'
		];
		return scored.some((k) => reviews[k] != null);
	});
</script>

<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
	{#each tabs as tab (tab.key)}
		{@const score = getScore(tab.key)}
		{@const available = reviews[tab.key] != null}
		{@const isActive = activeTab === tab.key}
		{@const isCount = tab.key === 'feature_suggestions'}
		{@const isSuggestions = tab.key === 'feature_suggestions'}
		<button
			onclick={() => (available || isSuggestions) && onselect(tab.key)}
			disabled={!available && !isSuggestions}
			class="flex flex-col items-center gap-2 p-4 rounded-lg border transition-all
        {isActive
				? 'border-primary-500 bg-primary-500/10'
				: available
					? 'border-border bg-surface hover:border-border-hover hover:bg-surface-raised'
					: isSuggestions
						? 'border-border bg-surface hover:border-border-hover hover:bg-surface-raised'
						: 'border-border/50 bg-surface-raised opacity-50 cursor-not-allowed'}"
		>
			<tab.icon class="h-5 w-5 {isActive ? 'text-primary-400' : 'text-text-secondary'}" />
			<span class="text-xs font-medium {isActive ? 'text-primary-500' : 'text-text-secondary'}">
				{tab.label}
			</span>
			{#if score != null}
				<span class="text-2xl font-bold {scoreColor(score, isCount)}">
					{isCount ? score : score.toFixed(1)}
				</span>
				<span class="text-[10px] text-text-muted uppercase tracking-wide">
					{isCount ? 'proposals' : '/ 10'}
				</span>
			{:else if isSuggestions && otherReviewsExist}
				<span class="text-sm text-text-muted">N/A</span>
			{:else if isSuggestions}
				<span class="text-sm text-text-muted">--</span>
			{:else}
				<span class="text-sm text-text-muted">N/A</span>
			{/if}
		</button>
	{/each}
</div>

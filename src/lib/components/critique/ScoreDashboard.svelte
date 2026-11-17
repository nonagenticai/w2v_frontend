<script lang="ts">
	import type { CritiqueCategory } from '$lib/types';
	import ScoreCard from './ScoreCard.svelte';

	let {
		scores,
		categories
	}: {
		scores: Record<string, number>;
		categories: CritiqueCategory[];
	} = $props();

	// Compute composite score as the average of all available category scores
	const compositeScore = $derived.by(() => {
		const values = categories.map((cat) => scores[cat]).filter((v): v is number => v != null);
		if (values.length === 0) return null;
		return values.reduce((sum, v) => sum + v, 0) / values.length;
	});

	const compositeColor = $derived(
		compositeScore === null
			? 'text-text-muted'
			: compositeScore >= 80
				? 'text-status-completed'
				: compositeScore >= 60
					? 'text-status-pending'
					: 'text-status-failed'
	);

	const compositeStrokeColor = $derived(
		compositeScore === null
			? 'stroke-border'
			: compositeScore >= 80
				? 'stroke-status-completed'
				: compositeScore >= 60
					? 'stroke-status-pending'
					: 'stroke-status-failed'
	);

	// SVG circular gauge: radius 54, circumference ~339.3
	const circumference = 2 * Math.PI * 54;
	const dashOffset = $derived(
		compositeScore === null ? circumference : circumference - (compositeScore / 100) * circumference
	);

	const gradeLabel = $derived(
		compositeScore === null
			? '--'
			: compositeScore >= 90
				? 'A'
				: compositeScore >= 80
					? 'B'
					: compositeScore >= 70
						? 'C'
						: compositeScore >= 60
							? 'D'
							: 'F'
	);
</script>

<div class="space-y-6">
	<!-- Composite score hero -->
	<div
		class="bg-surface rounded-xl border border-border shadow-sm p-6 flex flex-col sm:flex-row items-center gap-6"
	>
		<!-- Large circular gauge -->
		<div class="relative h-36 w-36 shrink-0">
			<svg class="h-36 w-36 -rotate-90" viewBox="0 0 120 120">
				<!-- Background track -->
				<circle cx="60" cy="60" r="54" fill="none" stroke-width="7" class="stroke-border" />
				<!-- Score arc -->
				<circle
					cx="60"
					cy="60"
					r="54"
					fill="none"
					stroke-width="7"
					class="{compositeStrokeColor} transition-all duration-1000 ease-out"
					stroke-linecap="round"
					stroke-dasharray={circumference}
					stroke-dashoffset={dashOffset}
				/>
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center">
				<span class="text-3xl font-bold {compositeColor}">
					{compositeScore === null ? 'N/A' : compositeScore.toFixed(0)}
				</span>
				<span class="text-xs text-text-muted font-medium">/ 100</span>
			</div>
		</div>

		<div class="text-center sm:text-left">
			<div class="flex items-center gap-2 justify-center sm:justify-start">
				<h2 class="text-lg font-semibold text-text">Overall Score</h2>
				<span
					class="inline-flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold
          {compositeScore === null
						? 'bg-surface-raised text-text-muted'
						: compositeScore >= 80
							? 'bg-status-completed/15 text-status-completed'
							: compositeScore >= 60
								? 'bg-status-pending/15 text-status-pending'
								: 'bg-status-failed/15 text-status-failed'}"
				>
					{gradeLabel}
				</span>
			</div>
			<p class="text-sm text-text-secondary mt-1">
				{#if compositeScore === null}
					No scores available yet.
				{:else if compositeScore >= 80}
					Great overall quality. Minor improvements possible.
				{:else if compositeScore >= 60}
					Moderate quality. Several areas need attention.
				{:else}
					Significant issues detected across multiple categories.
				{/if}
			</p>
		</div>
	</div>

	<!-- Per-category score cards -->
	<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
		{#each categories as cat (cat)}
			<ScoreCard category={cat} score={scores[cat] ?? null} />
		{/each}
	</div>
</div>

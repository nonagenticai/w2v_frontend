<script lang="ts">
	import type { CritiqueFinding, FeatureSuggestionsReview } from '$lib/types';
	import { Card, Badge } from '$lib/components/ui';
	import { fixes, type FixRankResponse } from '$lib/api';

	let {
		review,
		critiqueFindings = []
	}: {
		review: FeatureSuggestionsReview;
		critiqueFindings?: CritiqueFinding[];
	} = $props();

	type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

	function categoryColor(cat: string): BadgeVariant {
		const c = cat.toLowerCase().replace(/\s+/g, '_');
		if (c === 'quick_win' || c === 'quick-win') return 'success';
		if (c === 'strategic') return 'info';
		if (c === 'long_term' || c === 'long-term') return 'warning';
		return 'default';
	}

	function impactColor(impact: string): BadgeVariant {
		const i = impact.toLowerCase();
		if (i === 'high' || i === 'critical') return 'error';
		if (i === 'medium') return 'warning';
		return 'default';
	}

	function complexityColor(complexity: string): BadgeVariant {
		const c = complexity.toLowerCase();
		if (c === 'low' || c === 'simple') return 'success';
		if (c === 'medium' || c === 'moderate') return 'warning';
		return 'error';
	}

	function severityColor(severity: string): BadgeVariant {
		const s = severity.toLowerCase();
		if (s === 'critical' || s === 'high') return 'error';
		if (s === 'medium') return 'warning';
		if (s === 'low') return 'info';
		return 'default';
	}

	function roiColor(roiScore: number): BadgeVariant {
		if (roiScore >= 1.75) return 'success';
		if (roiScore >= 1.25) return 'info';
		if (roiScore >= 0.9) return 'warning';
		return 'default';
	}

	function confidenceColor(level: 'strong' | 'moderate' | 'weak'): BadgeVariant {
		if (level === 'strong') return 'success';
		if (level === 'moderate') return 'warning';
		return 'error';
	}

	// Ranking + pricing is computed server-side (POST /api/fixes/rank) so the cost
	// model lives in one authoritative place (the orchestrator), never the shipped
	// browser bundle. Refetch whenever the proposals or matched findings change.
	let rankResult = $state<FixRankResponse | null>(null);
	let rankError = $state<string | null>(null);
	let rankLoading = $state(false);

	$effect(() => {
		const proposals = review.proposals;
		const findings = critiqueFindings;
		let cancelled = false;
		rankLoading = true;
		rankError = null;
		fixes
			.rank({ proposals, critique_findings: findings })
			.then((res) => {
				if (!cancelled) rankResult = res;
			})
			.catch((err) => {
				if (!cancelled) {
					rankError = err instanceof Error ? err.message : 'Failed to rank suggestions';
					rankResult = null;
				}
			})
			.finally(() => {
				if (!cancelled) rankLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const rankedProposals = $derived(rankResult?.ranked ?? []);
	const rankingConfidence = $derived(rankResult?.confidence ?? null);
	// The token→USD rate is server-owned; echo it from the response for display.
	const outputCostRate = $derived(rankedProposals[0]?.output_cost_per_million_usd ?? null);
</script>

<div class="space-y-6">
	<!-- Summary -->
	<Card class="p-4">
		<p class="text-sm text-text-secondary">
			<span class="font-bold text-text text-lg">{review.total_proposals}</span>
			<span class="ml-1">feature proposal{review.total_proposals === 1 ? '' : 's'} identified</span>
		</p>
		<p class="mt-2 text-xs text-text-muted">
			Ranked by fix ROI = (critique severity + video impact) / (redesign effort + Claude output
			token cost).{#if outputCostRate !== null}
				Cost model: ${outputCostRate.toFixed(2)} per 1M output tokens.{/if}
		</p>
		{#if rankLoading && !rankingConfidence}
			<p class="mt-3 text-xs text-text-muted">Ranking suggestions…</p>
		{:else if rankError}
			<p class="mt-3 text-xs text-error">Could not rank suggestions: {rankError}</p>
		{:else if rankingConfidence}
			<div class="mt-3 rounded-lg border border-border bg-surface/50 p-3">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-[10px] uppercase tracking-wide text-text-muted">Ranking confidence</span
					>
					<Badge variant={confidenceColor(rankingConfidence.level)}>
						{rankingConfidence.level.toUpperCase()}
					</Badge>
					<Badge variant="info">{Math.round(rankingConfidence.score * 100)}%</Badge>
				</div>
				<p class="mt-2 text-xs text-text-secondary">{rankingConfidence.summary}</p>
				<p class="mt-1 text-[11px] text-text-muted">
					{rankingConfidence.finding_count} finding{rankingConfidence.finding_count === 1
						? ''
						: 's'}
					· {rankingConfidence.severity_diversity} severity level{rankingConfidence.severity_diversity ===
					1
						? ''
						: 's'}
					· {Math.round(rankingConfidence.matched_proposal_ratio * 100)}% proposal-finding match
				</p>
				{#if rankingConfidence.uncertainty_signals.length > 0}
					<div class="mt-2 flex flex-wrap gap-2">
						{#each rankingConfidence.uncertainty_signals as signal (signal)}
							<Badge variant="warning">{signal}</Badge>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</Card>

	<!-- Proposals grid -->
	{#if rankedProposals.length > 0}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
			{#each rankedProposals as ranked, idx (ranked.proposal.id)}
				{@const proposal = ranked.proposal}
				<Card class="p-4">
					<div class="space-y-3">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<span class="text-xs font-semibold text-text-muted">#{idx + 1}</span>
								<Badge variant={roiColor(ranked.roi_score)}>{ranked.priority_label}</Badge>
								<Badge variant={roiColor(ranked.roi_score)}
									>ROI {ranked.roi_score.toFixed(2)}x</Badge
								>
							</div>
							<Badge variant={categoryColor(proposal.category)}>{proposal.category}</Badge>
						</div>

						<div class="flex items-start justify-between gap-2">
							<h4 class="text-sm font-medium text-text">{proposal.title}</h4>
						</div>

						<p class="text-xs text-text-secondary leading-relaxed">{proposal.description}</p>

						<div class="flex flex-wrap items-center gap-2">
							<span class="text-[10px] text-text-muted uppercase tracking-wide">Video impact:</span>
							<Badge variant={impactColor(proposal.impact)}>{proposal.impact}</Badge>
							<Badge variant="info">{Math.round(ranked.video_impact_score * 100)}/100</Badge>
							<span class="text-[10px] text-text-muted uppercase tracking-wide ml-1"
								>Complexity:</span
							>
							<Badge variant={complexityColor(proposal.complexity)}>{proposal.complexity}</Badge>
						</div>

						<div class="flex flex-wrap items-center gap-2">
							<span class="text-[10px] text-text-muted uppercase tracking-wide"
								>Critique severity:</span
							>
							<Badge variant={severityColor(ranked.critique_severity)}
								>{ranked.critique_severity}</Badge
							>
							{#if ranked.matched_finding_title}
								<span class="text-[11px] text-text-muted">
									Matched: <span class="text-text-secondary">{ranked.matched_finding_title}</span>
								</span>
							{/if}
						</div>

						{#if proposal.estimated_effort}
							<p class="text-[11px] text-text-muted">
								Effort: <span class="text-text-secondary">{proposal.estimated_effort}</span>
								<span class="ml-2 text-text-muted"
									>(~{ranked.redesign_effort_days.toFixed(1)} redesign days)</span
								>
							</p>
						{/if}

						<p class="text-[11px] text-text-muted">
							Estimated Claude output: <span class="text-text-secondary"
								>{ranked.estimated_output_tokens.toLocaleString()} tokens</span
							>
						</p>
						<p class="text-[11px] text-text-muted">
							Estimated token cost: <span class="text-text-secondary"
								>${ranked.estimated_token_cost_usd.toFixed(2)}</span
							>
							<span class="ml-2 text-text-muted"
								>(@ ${ranked.output_cost_per_million_usd.toFixed(2)} / 1M output tokens)</span
							>
						</p>

						{#if proposal.rationale}
							<p class="text-[11px] text-text-muted italic">{proposal.rationale}</p>
						{/if}
					</div>
				</Card>
			{/each}
		</div>
	{:else if !rankLoading && !rankError}
		<div class="text-center py-8 text-text-secondary">
			<p>No feature suggestions were generated for this site.</p>
		</div>
	{/if}
</div>

<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- the only anchor here
	   is the external reviewed-site URL from the run output, never an internal route. */
	// Critique output (WebsiteCritiqueOutput: findings[], overall_score,
	// category_scores, summary) → a scorecard: a headline score ring, per-category
	// score bars, and findings grouped by severity. Replaces the generic
	// findings-as-rows view for critique stages.
	import ScoreRing from './_shared/ScoreRing.svelte';
	import Markdown from './_shared/Markdown.svelte';
	import { Pill } from '$lib/components/ui';
	import { severityTone } from '$lib/utils/severity';
	import type { RendererProps } from './registry';
	import type { CritiqueOutput, CritiqueFinding } from './stage-outputs';

	let { output }: RendererProps = $props();

	type Rec = Record<string, unknown>;
	const data = $derived(output as unknown as CritiqueOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const overall = $derived(num(data.overall_score));
	const summary = $derived(str(data.summary));
	const url = $derived(str(data.url));
	const categories = $derived(
		data.category_scores && typeof data.category_scores === 'object'
			? Object.entries(data.category_scores as Rec).filter(([, v]) => num(v) != null)
			: []
	);

	const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	const findings = $derived(
		((Array.isArray(data.findings) ? data.findings : []) as CritiqueFinding[])
			.slice()
			.sort(
				(a, b) =>
					(SEV_RANK[str(a.severity)?.toLowerCase() ?? 'info'] ?? 9) -
					(SEV_RANK[str(b.severity)?.toLowerCase() ?? 'info'] ?? 9)
			)
	);

	const barTone = (v: number) =>
		v >= 0.8 ? 'var(--color-success)' : v >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)';
</script>

<div class="space-y-4" data-testid="critique-scorecard">
	<div class="flex flex-wrap items-center gap-4">
		{#if overall != null}
			<ScoreRing value={overall} size={84} caption="Overall" />
		{/if}
		<div class="min-w-0 flex-1 space-y-1">
			{#if url}
				<a
					href={safeHref(url)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-[var(--color-accent)] hover:underline break-all"
				>
					{url}
				</a>
			{/if}
			{#if summary}<Markdown text={summary} />{/if}
		</div>
	</div>

	{#if categories.length}
		<div class="space-y-1.5">
			{#each categories as [name, score] (name)}
				{@const v = num(score) ?? 0}
				<div class="grid grid-cols-[140px_1fr_auto] items-center gap-2 text-sm">
					<span class="text-[var(--color-text-muted)] truncate capitalize">
						{name.replace(/_/g, ' ')}
					</span>
					<span class="h-2 rounded-full bg-[var(--color-surface-strong)] overflow-hidden">
						<span
							class="block h-full rounded-full"
							style={`width:${Math.round(v * 100)}%;background:${barTone(v)}`}
						></span>
					</span>
					<span class="tabular-nums text-[var(--color-text-muted)] text-xs">
						{Math.round(v * 100)}
					</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if findings.length}
		<ol class="space-y-2">
			{#each findings as f, i (str(f.id) ?? i)}
				<li
					class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-1"
				>
					<div class="flex items-start justify-between gap-2">
						<p class="text-sm font-semibold text-[var(--color-text)]">
							{str(f.title) ?? 'Finding'}
						</p>
						<span class="flex shrink-0 items-center gap-1.5">
							{#if str(f.category)}<Pill tone="neutral">{f.category}</Pill>{/if}
							{#if str(f.severity)}<Pill tone={severityTone(str(f.severity))}>
									{f.severity}
								</Pill>{/if}
						</span>
					</div>
					{#if str(f.description)}<p class="text-sm text-[var(--color-text-muted)]">
							{f.description}
						</p>{/if}
					{#if str(f.recommendation)}
						<p class="text-sm text-[var(--color-text)]">
							<span class="font-medium">Fix:</span>
							{f.recommendation}
						</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>

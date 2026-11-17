<script lang="ts">
	// action_reel `shot_analysis` (ShotAnalysisOutput.sources[]{id, duration_s,
	// scene_boundaries[], motion_timeline[]{t, motion}, overall_score, error}) →
	// one compact row per source.
	//
	// The point of this renderer is what it does NOT print. A single source's
	// motion_timeline is hundreds of MotionPoints and scene_boundaries is a bare
	// float list; the generic fallback renders both as a wall of text that nobody
	// can review. Here the curve is downsampled to a fixed-width bar strip and the
	// cut list collapses to a COUNT. A source with a non-empty `error` contributed
	// nothing to the reel, so it is called out rather than shown as a flat curve.
	import Duration from './_shared/Duration.svelte';
	import ScoreRing from './_shared/ScoreRing.svelte';
	import { Pill } from '$lib/components/ui';
	import { AlertTriangle, Activity } from '@lucide/svelte';
	import type { RendererProps } from './registry';
	import type { ShotAnalysisOutput, AnalyzedSource, MotionPoint } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as ShotAnalysisOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	// A stage output is JSONB from the wire: an array element may be null or a
	// scalar. The registry matcher only inspects sources[0], so a payload whose
	// SECOND element is null passes the matcher and then TypeErrors below — and
	// StageOutputView has no error boundary, so the whole panel would vanish.
	// Drop non-object elements once, before any property access.
	const isRec = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	const sources = $derived<AnalyzedSource[]>(
		Array.isArray(data.sources) ? (data.sources.filter(isRec) as AnalyzedSource[]) : []
	);
	// Soft-degradation channel. The generic fallback used to print these; dropping
	// them made every stage-level degradation invisible on the review gate.
	const notes = $derived<string[]>(
		Array.isArray(data.notes) ? data.notes.filter((n): n is string => str(n) != null) : []
	);

	/** Fixed bar count — the strip is a shape, not a data table. */
	const BARS = 32;

	// Mean-bucket downsample: the curve is sampled at the analyzer's cadence, so
	// bucket COUNT (not stride) keeps every source's strip the same width no matter
	// how long the clip is. Non-numeric points are dropped, never coerced to 0 —
	// a hole in the curve must not read as "no motion".
	const strip = (s: AnalyzedSource): number[] => {
		const pts: MotionPoint[] = Array.isArray(s.motion_timeline) ? s.motion_timeline : [];
		const vals = pts.map((p) => num(p?.motion)).filter((v): v is number => v != null);
		if (vals.length === 0) return [];
		const out: number[] = [];
		for (let b = 0; b < BARS; b++) {
			const lo = Math.floor((b * vals.length) / BARS);
			const hi = Math.max(lo + 1, Math.floor(((b + 1) * vals.length) / BARS));
			const slice = vals.slice(lo, hi);
			const mean = slice.reduce((a, v) => a + v, 0) / slice.length;
			out.push(Math.max(0, Math.min(1, mean)));
		}
		return out;
	};

	// The INPUT sample count, not `bars.length` — that is the fixed bucket count,
	// so announcing it would tell a screen-reader "32 samples" for a 2-point curve.
	const sampleCount = (s: AnalyzedSource): number =>
		(Array.isArray(s.motion_timeline) ? s.motion_timeline : []).filter(
			(p) => num(p?.motion) != null
		).length;

	const cutCount = (s: AnalyzedSource): number =>
		Array.isArray(s.scene_boundaries) ? s.scene_boundaries.length : 0;
</script>

<div class="space-y-2" data-testid="shot-analysis-summary">
	<div class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
		<Activity class="h-3.5 w-3.5" />
		<span>{sources.length} sources analysed</span>
	</div>
	<!-- Index key: duplicate note strings are a legal payload and a duplicate key
	     is a Svelte 5 runtime error, which on this boundary-less page blanks the
	     entire output panel. -->
	{#each notes as note, i (i)}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="shot-analysis-note"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>{note}</span>
		</p>
	{/each}
	<ul class="space-y-2">
		{#each sources as source, i (str(source.id) ?? i)}
			{@const bars = strip(source)}
			{@const err = str(source.error)}
			{@const score = num(source.overall_score)}
			<li
				class="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
				data-testid="shot-analysis-source"
				data-source-id={str(source.id) ?? undefined}
			>
				<div class="min-w-0 flex-1 space-y-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span
							class="truncate font-mono text-xs text-[var(--color-text)]"
							data-testid="shot-analysis-source-id">{str(source.id) ?? `Source ${i + 1}`}</span
						>
						{#if num(source.duration_s) != null}
							<Duration seconds={num(source.duration_s)} class="text-xs" />
						{/if}
						<Pill tone="neutral"
							><span data-testid="shot-analysis-cut-count">{cutCount(source)} cuts</span></Pill
						>
					</div>
					{#if err}
						<p
							class="flex items-start gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger-bg)] px-2 py-1 text-xs text-[var(--color-danger-text)]"
							data-testid="shot-analysis-error"
						>
							<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span><strong>Not measured</strong> — {err}</span>
						</p>
					{:else if bars.length > 0}
						<!-- Downsampled motion curve. `preserveAspectRatio=none` lets the fixed
						     32-bar viewBox stretch to whatever width the row has. -->
						<svg
							viewBox={`0 0 ${BARS} 10`}
							preserveAspectRatio="none"
							role="img"
							aria-label={`Motion over time, ${sampleCount(source)} samples in ${bars.length} buckets`}
							class="h-5 w-full"
							data-testid="shot-analysis-sparkline"
							data-bars={bars.length}
						>
							{#each bars as v, b (b)}
								<rect
									x={b + 0.15}
									y={10 - Math.max(0.4, v * 10)}
									width="0.7"
									height={Math.max(0.4, v * 10)}
									fill="var(--color-accent)"
								/>
							{/each}
						</svg>
					{:else}
						<p class="text-xs text-[var(--color-text-muted)]" data-testid="shot-analysis-no-motion">
							No motion curve recorded.
						</p>
					{/if}
				</div>
				{#if score != null}
					<ScoreRing value={score} size={48} caption="score" class="shrink-0" />
				{/if}
			</li>
		{/each}
	</ul>
</div>

<script lang="ts">
	// action_reel `segment_select` (SegmentSelectOutput{segments[]{id, source_id,
	// in/out_seconds, seconds, score, rationale}, near_duplicates_dropped,
	// near_duplicates_kept_for_coverage, notes}) → the review surface for the
	// selection gate.
	//
	// Two jobs, in this order — same shape as CutPlanTimeline. FIRST the verdict:
	// how much footage was selected, and WHERE IT CAME FROM. The failure a
	// reviewer cannot see in a list of rows is one source dominating the reel —
	// twelve windows out of the same clip still reads as "12 segments". The
	// stacked coverage bar makes that a one-glance fact. THEN one row per segment
	// with its trim, score and rationale, so "approve" is a decision about the
	// selection rather than about JSON.
	import { SvelteMap } from 'svelte/reactivity';
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { AlertTriangle, Scissors, Copy } from '@lucide/svelte';
	import type { RendererProps } from './registry';
	import type { SegmentSelectOutput, SelectedSegment } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as SegmentSelectOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	// A stage output is JSONB from the wire: an array element may be null or a
	// scalar. The registry matcher only inspects segments[0], so a payload whose
	// SECOND element is null passes the matcher and then TypeErrors here — and
	// StageOutputView has no error boundary, so the whole output panel would
	// vanish. Drop non-object elements once, before any arithmetic or keying.
	const isRec = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	const segments = $derived<SelectedSegment[]>(
		Array.isArray(data.segments) ? (data.segments.filter(isRec) as SelectedSegment[]) : []
	);

	/** Length of one window. `seconds` is authoritative; the trim is the fallback
	 *  for a half-written payload so the bar never collapses on a real selection. */
	const lengthOf = (s: SelectedSegment): number => {
		const explicit = num(s.seconds);
		if (explicit != null && explicit > 0) return explicit;
		const a = num(s.in_seconds);
		const b = num(s.out_seconds);
		return a != null && b != null && b > a ? b - a : 0;
	};

	const totalSeconds = $derived(segments.reduce((acc, s) => acc + lengthOf(s), 0));

	// Per-source coverage, in first-appearance order so the bar's left-to-right
	// order matches the row order below. A segment with no source_id is bucketed
	// under an explicit "unattributed" key rather than silently merged into the
	// first source — merging would understate the dominance this bar exists to show.
	const UNATTRIBUTED = '(no source id)';
	const coverage = $derived.by<{ sourceId: string; seconds: number; percent: number }[]>(() => {
		// SvelteMap, not Map: `svelte/prefer-svelte-reactivity` is a blanket ban on
		// the built-in. This one is a throwaway local inside `$derived.by` and is
		// recomputed wholesale, so reactivity is not load-bearing here — but a plain
		// object is NOT a safe substitute either, because a numeric-looking
		// `source_id` would be reordered into integer-key position and silently
		// break the first-appearance ordering this bar depends on.
		const totals = new SvelteMap<string, number>();
		for (const s of segments) {
			const key = str(s.source_id) ?? UNATTRIBUTED;
			totals.set(key, (totals.get(key) ?? 0) + lengthOf(s));
		}
		const sum = [...totals.values()].reduce((a, v) => a + v, 0);
		if (sum <= 0) return [];
		return [...totals.entries()].map(([sourceId, seconds]) => ({
			sourceId,
			seconds,
			percent: (seconds / sum) * 100
		}));
	});

	// Fixed hue ramp rather than per-source random colour: the same source must get
	// the same swatch on every re-render of the same payload, or the bar reads as
	// changing when nothing changed. Cycles — >6 sources is already a varied reel.
	const SWATCHES = [
		'var(--color-accent)',
		'var(--color-success)',
		'var(--color-warning)',
		'var(--color-danger)',
		'var(--color-text-muted)',
		'var(--color-accent-text)'
	];

	// Read the two dedupe counters as a PAIR — this is the backend's own doctrine
	// (segment_select.py). `dropped === 0` ALONE used to be documented as "the
	// draw was already varied" while it was also what a selection full of
	// RE-ADMITTED duplicates reported, so a reviewer filtering on it got exactly
	// the repeated-shot reel the guard exists to surface. (0,0) is the only
	// "no near-duplicates existed" reading, and it is said in words: two zeros
	// printed side by side is not a finding a human reads as reassurance.
	const dropped = $derived(num(data.near_duplicates_dropped) ?? 0);
	const kept = $derived(num(data.near_duplicates_kept_for_coverage) ?? 0);
	const noDuplicates = $derived(dropped === 0 && kept === 0);

	// Soft-degradation channel. The generic fallback used to print these; dropping
	// them made every stage-level degradation invisible on the review gate.
	const notes = $derived<string[]>(
		Array.isArray(data.notes) ? data.notes.filter((n): n is string => str(n) != null) : []
	);
</script>

<div class="space-y-3" data-testid="segment-select-strip">
	<!-- Verdict strip — always before any segment row. -->
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
		data-testid="segment-select-verdict"
	>
		<span class="inline-flex items-center gap-1.5 text-[var(--color-text)]">
			<Scissors class="h-3.5 w-3.5" />
			<span class="font-medium tabular-nums">{segments.length} segments</span>
		</span>
		<span class="inline-flex items-center gap-1">
			<Duration seconds={totalSeconds} class="text-xs text-[var(--color-text)]" /> selected
		</span>
		<span class="tabular-nums" data-testid="segment-select-source-count">
			from {coverage.length}
			{coverage.length === 1 ? 'source' : 'sources'}
		</span>
	</div>

	<!-- Per-source coverage. One clip dominating the reel is the defect a row list
	     cannot show, so it gets its own bar above the rows. -->
	{#if coverage.length > 0}
		<div class="space-y-1" data-testid="segment-select-coverage">
			<div
				class="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-strong)]"
				role="img"
				aria-label={`Footage coverage by source: ${coverage
					.map((c) => `${c.sourceId} ${Math.round(c.percent)}%`)
					.join(', ')}`}
			>
				{#each coverage as slice, i (slice.sourceId)}
					<span
						class="h-full"
						style={`width:${slice.percent}%;background:${SWATCHES[i % SWATCHES.length]}`}
						data-testid="segment-select-coverage-slice"
						data-source-id={slice.sourceId}
						data-percent={slice.percent.toFixed(1)}
					></span>
				{/each}
			</div>
			<div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
				{#each coverage as slice, i (slice.sourceId)}
					<span class="inline-flex items-center gap-1" data-testid="segment-select-coverage-legend">
						<span
							class="h-2 w-2 shrink-0 rounded-full"
							style={`background:${SWATCHES[i % SWATCHES.length]}`}
						></span>
						<span class="font-mono">{slice.sourceId}</span>
						<span class="tabular-nums">{Math.round(slice.percent)}%</span>
					</span>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Near-duplicate guard, in plain words. Never two bare zeros. -->
	<p
		class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs {kept >
		0
			? 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]'
			: 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'}"
		data-testid="segment-select-duplicates"
	>
		<Copy class="mt-0.5 h-3.5 w-3.5 shrink-0" />
		<span>
			{#if noDuplicates}
				No near-duplicates found — every selected window is a distinct moment.
			{:else}
				{#if dropped > 0}<strong>{dropped}</strong>
					near-duplicate {dropped === 1 ? 'segment was' : 'segments were'} removed.{/if}
				{#if kept > 0}
					<strong>{kept}</strong>
					near-duplicate {kept === 1 ? 'segment was' : 'segments were'} KEPT ANYWAY — dropping
					{kept === 1 ? 'it' : 'them'} would have starved the cut planner, so expect repeated-looking
					shots in the reel.{/if}
			{/if}
		</span>
	</p>

	<!-- The selector's own prose channel (shortfall re-draws, coverage floor hits). -->
	<!-- Keyed by INDEX, not by the note string. `each_key_duplicate` is a runtime
	     ERROR in Svelte 5 (prod as well as dev), and segment_select.py emits
	     byte-identical notes by construction: `dropped unusable window on source
	     {source_id}` is appended once per rejected window inside a single loop, so
	     two bad windows on the SAME source produce two equal strings. This page has
	     no error boundary, so the whole output panel would blank out — on exactly
	     the degraded payload these notes exist to report. Index costs nothing here:
	     the list is re-rendered wholesale from a frozen stage payload, never
	     reordered or spliced, so there is no identity for a key to preserve. -->
	{#each notes as note, i (i)}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="segment-select-note"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>{note}</span>
		</p>
	{/each}

	<!-- One row per selected window, in selection order. -->
	<ul class="space-y-2">
		<!-- Index, not `segment.id`: ids are JSONB from the wire and nothing on the
		     read path guarantees they are distinct (two segments can carry the same
		     id, or both be null — and `str(id) ?? i` mixes the two namespaces, so a
		     literal id of "1" collides with index 1). A duplicate throws
		     each_key_duplicate and blanks the panel. Same reasoning as the notes
		     block above: frozen payload, wholesale re-render, no reordering. -->
		{#each segments as segment, i (i)}
			{@const inS = num(segment.in_seconds)}
			{@const outS = num(segment.out_seconds)}
			{@const score = num(segment.score)}
			<li
				class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
				data-testid="segment-select-segment"
				data-source-id={str(segment.source_id) ?? undefined}
			>
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-xs font-medium tabular-nums text-[var(--color-text)]">#{i + 1}</span>
					<span
						class="text-xs tabular-nums text-[var(--color-text-muted)]"
						data-testid="segment-select-segment-trim"
					>
						{#if inS != null && outS != null}
							{inS.toFixed(2)}→{outS.toFixed(2)}s
						{/if}
						· <Duration seconds={lengthOf(segment)} class="text-xs" />
					</span>
					{#if str(segment.source_id)}
						<span
							class="font-mono text-[11px] text-[var(--color-text-muted)]"
							data-testid="segment-select-segment-source"
						>
							{segment.source_id}
						</span>
					{/if}
					{#if score != null}
						<Pill tone={score >= 0.6 ? 'success' : score >= 0.35 ? 'neutral' : 'warning'}>
							<span data-testid="segment-select-segment-score">score {score.toFixed(2)}</span>
						</Pill>
					{/if}
				</div>
				{#if str(segment.rationale)}
					<p
						class="mt-1 text-xs text-[var(--color-text)]"
						data-testid="segment-select-segment-rationale"
					>
						{segment.rationale}
					</p>
				{/if}
			</li>
		{/each}
	</ul>
</div>

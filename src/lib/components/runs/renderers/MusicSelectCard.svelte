<script lang="ts">
	// action_reel `music_select` (MusicSelectOutput{track_id, track_key, track_url,
	// rationale, duration_s, bpm, bpm_confidence, beats[], downbeats[], onsets[],
	// meter, grid_source, notes}) → the review surface for the music gate.
	//
	// HEARING the bed is the review. Everything else on this card exists to answer
	// the one question a listener cannot answer by ear: will the reel actually be
	// CUT to this track? That is `grid_source` + `beats[]`, and when either is
	// empty the cut degrades to even spacing — a degradation that is invisible on
	// the finished reel unless you already know the track. So it gets a banner.
	//
	// The three float arrays (beats/downbeats/onsets) are hundreds of numbers; the
	// generic fallback dumped them as a wall of text nobody reviews. Here they
	// become a COUNT plus a tick strip — downbeats taller — which is the only
	// property of the grid a human can actually judge: is the pulse regular, and
	// does it cover the whole track or stop a third of the way in?
	import Duration from './_shared/Duration.svelte';
	import AudioPlayer from '$lib/components/audio/AudioPlayer.svelte';
	import { Pill } from '$lib/components/ui';
	import { AlertTriangle, Music } from '@lucide/svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type { MusicSelectOutput } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as MusicSelectOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	/** Finite, non-negative times only — a NaN or a string in the grid must be
	 *  dropped, never coerced to 0, or the strip grows a phantom tick at the head. */
	const times = (v: unknown): number[] =>
		Array.isArray(v) ? v.map((t) => num(t)).filter((t): t is number => t != null && t >= 0) : [];

	const beats = $derived(times(data.beats));
	const downbeats = $derived(times(data.downbeats));
	const onsets = $derived(times(data.onsets));

	// scopedMediaUrl: the bed is streamed back by our own /api/... proxy and
	// <audio> is fetched by the browser, which cannot carry X-Active-Tenant-Id —
	// so a super-admin browsing another tenant needs the switch in the query
	// string or playback 403s. Same helper NarrationTrack and CutPlanTimeline use.
	const src = $derived(scopedMediaUrl(str(data.track_url)));

	// 0.0 is the backend's "not measured", NOT a track at zero beats per minute.
	// On a review gate an UNKNOWN must never render as an affirmative measurement —
	// this is the same class of bug as shot_analysis printing "0 cuts" for a
	// payload it had never analysed.
	const bpm = $derived.by(() => {
		const v = num(data.bpm);
		return v != null && v > 0 ? v : undefined;
	});
	const bpmConfidence = $derived(num(data.bpm_confidence));
	const durationS = $derived(num(data.duration_s));

	// Strip span: the track duration when known, else the last tick — a grid must
	// not be drawn against a 0-width axis when duration_s was never written.
	const span = $derived.by(() => {
		const d = durationS;
		if (d != null && d > 0) return d;
		const last = Math.max(0, ...beats, ...downbeats);
		return last > 0 ? last : 0;
	});
	const pct = (t: number): number => (span > 0 ? Math.min(100, (t / span) * 100) : 0);

	// A downbeat is also a beat, so drawing both would double the ink at every bar
	// line. Draw the beats that are NOT downbeats short, and the downbeats tall.
	// Rounded to ms because the two arrays come from the same analyzer but through
	// different float paths, and an exact === would leave stacked ticks.
	const key = (t: number): number => Math.round(t * 1000);
	const downbeatKeys = $derived(new Set(downbeats.map(key)));
	const plainBeats = $derived(beats.filter((t) => !downbeatKeys.has(key(t))));

	// Deliberately `.length === 0` on the PARSED arrays, not on the raw field: a
	// `beats: "n/a"` payload has no usable grid either, and it must warn.
	const noGrid = $derived(beats.length === 0 || str(data.grid_source) == null);

	const notes = $derived<string[]>(
		Array.isArray(data.notes) ? data.notes.filter((n): n is string => str(n) != null) : []
	);
</script>

<div class="space-y-3" data-testid="music-select-card">
	<!-- Identity + measurements. -->
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
		data-testid="music-select-verdict"
	>
		<span class="inline-flex items-center gap-1.5 text-[var(--color-text)]">
			<Music class="h-3.5 w-3.5" />
			<span class="font-medium" data-testid="music-select-track">
				{str(data.track_key) ?? str(data.track_id) ?? 'Unnamed bed'}
			</span>
		</span>
		{#if durationS != null}
			<Duration seconds={durationS} class="text-xs" />
		{/if}
		<span class="tabular-nums" data-testid="music-select-bpm">
			{#if bpm != null}
				{Math.round(bpm)} BPM{#if bpmConfidence != null}<span
						data-testid="music-select-bpm-confidence"
					>
						, {Math.round(bpmConfidence * 100)}% confidence
					</span>{/if}
			{:else}
				BPM not measured
			{/if}
		</span>
		{#if str(data.meter)}
			<Pill tone="neutral"><span data-testid="music-select-meter">{data.meter}</span></Pill>
		{/if}
		{#if str(data.grid_source)}
			<Pill tone="neutral">
				<span data-testid="music-select-grid-source">grid: {data.grid_source}</span>
			</Pill>
		{/if}
	</div>

	<!-- Hearing it IS the review, so the player sits above every number. -->
	{#if src}
		<AudioPlayer {src} preload="none" />
	{:else}
		<p class="text-xs text-[var(--color-text-muted)]" data-testid="music-select-no-audio">
			No track URL on this output — the bed cannot be auditioned here.
		</p>
	{/if}

	<!-- The one thing you cannot hear: whether there is a grid to cut against. -->
	{#if noGrid}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="music-select-warning-no-grid"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>
				<strong>No beat grid</strong> — this bed could not be beat-tracked, so the cut will be EVEN-SPACED
				rather than musical.
			</span>
		</p>
	{:else}
		<div class="space-y-1" data-testid="music-select-grid">
			<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
				<span data-testid="music-select-beat-count">{beats.length} beats</span>
				· <span data-testid="music-select-downbeat-count">{downbeats.length} downbeats</span>
				{#if onsets.length > 0}
					· <span data-testid="music-select-onset-count">{onsets.length} onsets</span>
				{/if}
			</p>
			<!-- Tick strip. `preserveAspectRatio=none` lets the 0-100 (percent) viewBox
			     stretch to the row width, so a tick's x IS its position in the track. -->
			<svg
				viewBox="0 0 100 10"
				preserveAspectRatio="none"
				role="img"
				aria-label={`Beat grid: ${beats.length} beats and ${downbeats.length} downbeats across ${Math.round(span)} seconds`}
				class="h-6 w-full rounded-[var(--radius-md)] bg-[var(--color-surface-strong)]"
				data-testid="music-select-tick-strip"
			>
				<!-- Keyed by INDEX, not by the time value. A beat grid is a list of
				     floats and nothing forbids a repeat — `beats: [1.0, 1.0]` from a
				     stuttering analyzer, or two downbeats rounded onto the same value —
				     and a duplicate key is a runtime error in Svelte 5 (prod included)
				     that would blank the whole gate panel, which has no error boundary.
				     Ticks have no identity to preserve: the strip is redrawn wholesale
				     from a frozen payload. -->
				{#each plainBeats as t, i (i)}
					<rect x={pct(t)} y="5" width="0.15" height="5" fill="var(--color-text-muted)" />
				{/each}
				{#each downbeats as t, i (i)}
					<rect
						x={pct(t)}
						y="1"
						width="0.25"
						height="9"
						fill="var(--color-accent)"
						data-testid="music-select-downbeat-tick"
					/>
				{/each}
			</svg>
		</div>
	{/if}

	{#if str(data.rationale)}
		<p class="text-xs text-[var(--color-text)]" data-testid="music-select-rationale">
			{data.rationale}
		</p>
	{/if}

	<!-- Index key: two identical note strings are a legal payload (the stage
	     appends one note per rejected candidate), and a duplicate key throws in
	     production, taking the whole output panel with it. -->
	{#each notes as note, i (i)}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="music-select-note"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>{note}</span>
		</p>
	{/each}
</div>

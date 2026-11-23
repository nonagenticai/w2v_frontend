<script lang="ts">
	// action_reel `cut_plan` (CutPlanOutput{shots[]{source_id, video_url,
	// in/out_seconds, start_seconds, seconds, speed, beat_locked, rationale},
	// total_seconds, bpm, target_seconds, beat_grid_available, solver_stubbed,
	// shortfall_seconds}) → the review surface for the cut gate.
	//
	// Two jobs, in this order. FIRST the verdict: the honesty flags the backend
	// computes (solver_stubbed / beat_grid_available / shortfall_seconds) each get
	// a loud banner, because a degraded plan that LOOKS fine is the one failure a
	// reviewer must not be able to skim past. THEN one row per shot, in timeline
	// order, each with an in-point video frame so "approve" is a decision about
	// footage rather than about JSON.
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { AlertTriangle, Music, Play, Scissors, VideoOff } from '@lucide/svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { isPresignExpired } from '$lib/utils/presign';
	import type { RendererProps } from './registry';
	import type { CutPlanOutput, CutPlanShot } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as CutPlanOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	// The solver DERIVES speed from the emitted trim (out-in)/seconds, so a shot
	// that is conceptually 1.0x arrives as 1.0000909090909091 and a 0.9x as
	// 0.8999999999999999. Printed raw that is float noise on the one surface a
	// human is asked to approve. Round for display, and treat anything within
	// half a percent of 1.0 as "no time-warp" so the chip means what it says --
	// an exact `!== 1.0` showed a "1×" chip on shots that are not warped at all.
	// 3 decimals, not 2: the solver emits real 1.125x / 0.875x warps, and 2dp
	// would round those to 1.12x and lose a distinction the reviewer can see.
	const SPEED_EPSILON = 0.005;
	const formatSpeed = (speed: number): string => speed.toFixed(3).replace(/\.?0+$/, '');

	// A stage output is JSONB from the wire: an array element may be null or a
	// scalar. The registry matcher only inspects shots[0], so a payload whose
	// SECOND element is null passes the matcher and then TypeErrors here — and
	// StageOutputView has no error boundary, so the whole output panel would
	// vanish. Drop non-object elements once, before any arithmetic or keying.
	const isRec = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	const shots = $derived<CutPlanShot[]>(
		Array.isArray(data.shots) ? (data.shots.filter(isRec) as CutPlanShot[]) : []
	);
	// total_seconds is authoritative when present; summing the beat windows is the
	// fallback for a half-written payload so the strip never reads "0s" on a real plan.
	const totalSeconds = $derived(
		num(data.total_seconds) ?? shots.reduce((acc, s) => acc + (num(s.seconds) ?? 0), 0)
	);
	const targetSeconds = $derived(num(data.target_seconds));
	const bpm = $derived(num(data.bpm));
	// On a review gate, UNKNOWN must never read as HEALTHY. Every honesty signal
	// below therefore tests for the healthy value EXPLICITLY (`=== true` /
	// `!== false`-free), so a null / missing / non-boolean field falls to the
	// degraded side. The previous `beat_locked !== false` failed OPEN: a payload
	// with `beat_locked: null` and `solver_stubbed: true` read "1 of 1 beat-locked"
	// directly above the "NOT cut to the beat" banner.
	const lockedCount = $derived(shots.filter((s) => s.beat_locked === true).length);
	// Shots whose lock state was never recorded. Counted separately so the tally is
	// not silently pessimistic either — "0 of 3 beat-locked" alone would read as a
	// measured failure when in fact nothing was measured.
	const unknownLockCount = $derived(shots.filter((s) => typeof s.beat_locked !== 'boolean').length);
	const shortfall = $derived(num(data.shortfall_seconds) ?? 0);
	const solverStubbed = $derived(data.solver_stubbed === true);
	// Deliberately `=== false`, NOT `!== true`: an explicit false is the backend
	// saying "the bed could not be beat-tracked", which the banner asserts as fact.
	// An ABSENT flag is unknown, and asserting that sentence about a payload that
	// merely omitted the field would be the mirror-image lie. Unknown does not read
	// as healthy here because the locked tally above surfaces it explicitly.
	const noBeatGrid = $derived(data.beat_grid_available === false);
	// Soft-degradation channel (cut_plan.py emits `TRUNCATED: …` and solver-clamp
	// notes here). The generic fallback used to print these; dropping them made
	// every degradation outside the three banners invisible on the gate. Rendered
	// visibly, never behind a <details>.
	const notes = $derived<string[]>(
		Array.isArray(data.notes) ? data.notes.filter((n): n is string => str(n) != null) : []
	);

	// scopedMediaUrl appends `?active_tenant=` by string concat to the END of the
	// url, so it MUST run before the media fragment is attached — otherwise the
	// query lands inside the fragment and the tenant switch is silently dropped.
	// `#t=<in_seconds>` makes the browser seek the source trim's in-point, which
	// gives a real poster frame with no backend thumbnail work.
	const shotSrc = (s: CutPlanShot): string | undefined => {
		const url = scopedMediaUrl(str(s.video_url));
		if (!url) return undefined;
		const t = num(s.in_seconds);
		return t != null && t > 0 ? `${url}#t=${t}` : url;
	};

	// Presigned source urls carry a 1 h TTL: a gate paused overnight has dead
	// links, and a silently-black <video> reads as "bad footage" rather than
	// "expired link". Track the failures so the row can say which it is.
	//
	// Keyed by SOURCE, not by shot index. A cut plan draws ~20 shots from ~10
	// sources, so an index key made every shot re-discover the SAME source's
	// expiry — one 128 MiB+ request each. One dead source now marks every shot
	// cut from it. Falls back to the index when the payload carries no
	// source_id, which is exactly the old per-shot behaviour.
	const failKey = (s: CutPlanShot, i: number): string => str(s.source_id) ?? `#${i}`;
	let failed = $state<Record<string, boolean>>({});
	const markExpired = (key: string) => {
		failed = { ...failed, [key]: true };
	};
	// The expiry is IN the url (X-Amz-Date + X-Amz-Expires), so a provably dead
	// link must never be requested at all: `src` is not set, no request fires,
	// and the same expired state renders. `isPresignExpired` fails OPEN — an
	// unsigned or unparseable url returns false and we fall back to <video>
	// onerror below, so a parsing miss can never hide a working preview.
	const isExpired = (s: CutPlanShot, i: number, src: string): boolean =>
		failed[failKey(s, i)] === true || isPresignExpired(src);

	// Click-to-open, exactly as StageStoryline does it, and for the same reason.
	// A cut plan draws ~20 shots, each a FULL source clip (up to 512 MiB); with
	// `preload="metadata"` every tile fetched on mount, and a non-faststart mp4
	// (moov at EOF) plus the `#t=` seek makes the browser walk large tail ranges
	// to answer it. Measured on one live gate: ~1.2 GB of requests, 50 console
	// errors, 6x `502 artifact unreachable`, and the orchestrator's pgbouncer
	// pool exhausted (every open stream pins a connection). `preload="none"`
	// shows the SAME thing -- metadata is not a poster, so no frame renders
	// either way -- for zero bytes. The clip is fetched only when a reviewer
	// clicks that specific tile.
	let opened = $state<Record<string, boolean>>({});
	const openShot = (key: string) => {
		opened = { ...opened, [key]: true };
	};
</script>

<div class="space-y-3" data-testid="cut-plan-timeline">
	<!-- Verdict strip — always before any shot. -->
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
		data-testid="cut-plan-verdict"
	>
		<span class="inline-flex items-center gap-1.5 text-[var(--color-text)]">
			<Scissors class="h-3.5 w-3.5" />
			<span class="font-medium tabular-nums">{shots.length} shots</span>
		</span>
		<span class="inline-flex items-center gap-1">
			<Duration seconds={totalSeconds} class="text-xs text-[var(--color-text)]" />
			{#if targetSeconds}<span data-testid="cut-plan-target">
					of <Duration seconds={targetSeconds} class="text-xs" /> requested
				</span>{/if}
		</span>
		{#if bpm}
			<span class="inline-flex items-center gap-1" data-testid="cut-plan-bpm">
				<Music class="h-3.5 w-3.5" />
				<span class="tabular-nums">{Math.round(bpm)} BPM</span>
			</span>
		{/if}
		<span class="tabular-nums" data-testid="cut-plan-locked-count">
			{lockedCount} of {shots.length} beat-locked{#if unknownLockCount > 0}<span
					data-testid="cut-plan-locked-unknown"
				>
					({unknownLockCount} not recorded)
				</span>{/if}
		</span>
	</div>

	<!-- Honesty flags. Each renders ONLY when it applies; a degraded plan must be
	     obvious at a glance, never buried under the shot list. -->
	{#if solverStubbed}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-text)]"
			data-testid="cut-plan-warning-stubbed"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>
				<strong>Even-spacing fallback</strong> — the beat-fit solver did not run. This reel is NOT cut
				to the beat.
			</span>
		</p>
	{/if}
	{#if noBeatGrid}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="cut-plan-warning-no-grid"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>
				<strong>No beat grid</strong> — the bed could not be beat-tracked, so shot starts are not musical.
			</span>
		</p>
	{/if}
	{#if shortfall > 0}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="cut-plan-warning-shortfall"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>
				<strong>Short reel</strong> — this cut is {shortfall.toFixed(1)}s shorter than requested.
			</span>
		</p>
	{/if}

	<!-- The planner's own prose channel. The three banners above cover the flags it
	     computes numerically; everything else it wants a reviewer to know (TRUNCATED,
	     per-segment solver clamps, dropped sources) arrives only here, so dropping it
	     made those degradations invisible on the gate. -->
	<!-- Index key, same reason as the other action_reel gate renderers: notes are
	     appended per rejected candidate inside one loop, so two identical strings
	     are a legal payload, and a duplicate key is a Svelte 5 runtime error that
	     would blank this whole panel (the gate page has no error boundary). -->
	{#each notes as note, i (i)}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="cut-plan-note"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>{note}</span>
		</p>
	{/each}

	<!-- One row per shot, in timeline order. -->
	<ul class="space-y-2">
		{#each shots as shot, i (str(shot.id) ?? i)}
			{@const src = shotSrc(shot)}
			{@const start = num(shot.start_seconds)}
			{@const beatWindow = num(shot.seconds)}
			{@const inS = num(shot.in_seconds)}
			{@const outS = num(shot.out_seconds)}
			{@const speed = num(shot.speed)}
			<li
				class="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
				data-testid="cut-plan-shot"
				data-source-id={str(shot.source_id) ?? undefined}
			>
				<div
					class="relative flex h-[72px] w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-strong)]"
				>
					{#if !src}
						<span
							class="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-[var(--color-text-muted)]"
							data-testid="cut-plan-shot-no-url"
						>
							<VideoOff class="h-4 w-4" />
							no source URL
						</span>
					{:else if isExpired(shot, i, src)}
						<span
							class="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-[var(--color-danger-text)]"
							data-testid="cut-plan-shot-expired"
						>
							<VideoOff class="h-4 w-4" />
							source link expired — re-run cut_plan
						</span>
					{:else if opened[failKey(shot, i)]}
						<!-- Opened by an explicit click: now, and only now, may this clip fetch. -->
						<video
							{src}
							preload="metadata"
							autoplay
							muted
							playsinline
							controls
							class="h-full w-full object-cover"
							data-testid="cut-plan-shot-video"
							data-loaded="true"
							onerror={() => markExpired(failKey(shot, i))}
						>
							<track kind="captions" />
						</video>
					{:else}
						<button
							type="button"
							onclick={() => openShot(failKey(shot, i))}
							class="group relative block h-full w-full"
							aria-label={`Load clip for shot ${i + 1}`}
							data-testid="cut-plan-shot-load"
						>
							<video
								{src}
								preload="none"
								muted
								playsinline
								class="h-full w-full object-cover"
								data-testid="cut-plan-shot-video"
								onerror={() => markExpired(failKey(shot, i))}
							>
								<track kind="captions" />
							</video>
							<span
								class="absolute inset-0 flex items-center justify-center bg-black/15 group-hover:bg-black/25"
							>
								<span class="rounded-full bg-black/55 p-1.5 text-white">
									<Play class="h-4 w-4" />
								</span>
							</span>
						</button>
					{/if}
				</div>
				<div class="min-w-0 flex-1 space-y-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-xs font-medium tabular-nums text-[var(--color-text)]">#{i + 1}</span>
						{#if start != null}
							<span
								class="text-xs tabular-nums text-[var(--color-text-muted)]"
								data-testid="cut-plan-shot-placement"
							>
								<Duration seconds={start} class="text-xs" />{#if beatWindow != null}<span>
										→ <Duration seconds={start + beatWindow} class="text-xs" />
									</span>{/if}
							</span>
						{/if}
						{#if speed != null && Math.abs(speed - 1) >= SPEED_EPSILON}
							<Pill tone="accent">
								<span data-testid="cut-plan-shot-speed">{formatSpeed(speed)}×</span>
							</Pill>
						{/if}
						{#if shot.beat_locked === false}
							<Pill tone="warning">
								<span data-testid="cut-plan-shot-unlocked">not beat-locked</span>
							</Pill>
						{/if}
					</div>
					<p class="text-xs text-[var(--color-text-muted)]" data-testid="cut-plan-shot-trim">
						{#if inS != null && outS != null}
							source {inS.toFixed(2)}–{outS.toFixed(2)}s
						{/if}
						{#if str(shot.source_id)}
							· <span class="font-mono">{shot.source_id}</span>
						{/if}
					</p>
					{#if str(shot.rationale)}
						<p class="text-xs text-[var(--color-text)]" data-testid="cut-plan-shot-rationale">
							{shot.rationale}
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</div>

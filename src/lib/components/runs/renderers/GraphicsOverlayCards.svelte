<script lang="ts">
	// action_reel `graphics_design` (GraphicsDesignOutput{cards[]{id, shot_id, kind,
	// text, at_seconds, seconds, url}, cards_render_failed, notes}) → the review
	// surface for the graphics gate.
	//
	// The cards are ALPHA-CHANNEL VP9/WebM clips the compiler composites on top of
	// the footage — they are never full-frame. Rendered on the page surface, a
	// white lower-third on a light theme is literally invisible and a reviewer
	// approves a blank box. So each preview sits on a fixed neutral checkerboard
	// (see CHECKER below), which is also the universal "this has transparency"
	// convention.
	//
	// The other half of the job is the flag. `cards: []` has TWO meanings — a
	// render OUTAGE and an editorial "this brief has no title" — and the backend
	// says so only via `cards_render_failed`. Telling those apart is that flag's
	// entire purpose (graphics_design.py says so in as many words), so the empty
	// state here is two DIFFERENT states, one danger and one neutral, never one
	// shared "no cards" line.
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { AlertTriangle, Play, Sparkles, VideoOff } from '@lucide/svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type { GraphicsDesignOutput, GraphicsCard } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as GraphicsDesignOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	// JSONB from the wire — an array element may be null or a scalar, and the
	// matcher never inspects past the flag. Drop non-objects before any keying.
	const isRec = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	const cards = $derived<GraphicsCard[]>(
		Array.isArray(data.cards) ? (data.cards.filter(isRec) as GraphicsCard[]) : []
	);

	// Deliberately `=== true`: an ABSENT flag is unknown, and asserting "the render
	// failed" about a payload that merely omitted the field would be the
	// mirror-image lie of the bug this component exists to avoid.
	const renderFailed = $derived(data.cards_render_failed === true);

	// The checkerboard is DELIBERATELY theme-independent. A backdrop built from
	// --color-surface tokens follows the theme, which reproduces the exact bug in
	// whichever theme matches the artwork — a white title vanishes on the light
	// surface, a dark one on the dark surface. These two mid-greys contrast with
	// both black and white artwork in BOTH themes, which is why every alpha
	// preview in every editor looks like this. Do not "fix" it to match the theme.
	const CHECKER =
		'background-color:#8c8c8c;background-image:linear-gradient(45deg,#5c5c5c 25%,transparent 25%,transparent 75%,#5c5c5c 75%),linear-gradient(45deg,#5c5c5c 25%,transparent 25%,transparent 75%,#5c5c5c 75%);background-size:16px 16px;background-position:0 0,8px 8px;';

	const cardSrc = (c: GraphicsCard): string | null | undefined => scopedMediaUrl(str(c.url));

	const notes = $derived<string[]>(
		Array.isArray(data.notes) ? data.notes.filter((n): n is string => str(n) != null) : []
	);

	// Presigned overlay urls carry a TTL: a gate paused overnight has dead links,
	// and a silently-black <video> on a checkerboard reads as "the card is empty"
	// rather than "the link expired". Track failures so the tile can say which.
	let expired = $state<Record<number, boolean>>({});
	const markExpired = (i: number) => {
		expired = { ...expired, [i]: true };
	};

	// Click-to-open, the same treatment (and the same reason) as StageStoryline
	// and CutPlanTimeline. A gate page mounts every tile at once, and
	// `preload`/`autoplay` on all of them fires one request per card against the
	// same presigned artifact endpoint that the cut plan is already hammering --
	// which is what exhausted the orchestrator's connection pool on a live gate.
	// `preload="none"` costs zero bytes and shows the same checkerboard; the
	// animation is fetched and played only when a reviewer clicks that card.
	let opened = $state<Record<number, boolean>>({});
	const openCard = (i: number) => {
		opened = { ...opened, [i]: true };
	};
</script>

<div class="space-y-3" data-testid="graphics-overlay-cards">
	<div class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
		<Sparkles class="h-3.5 w-3.5" />
		<span data-testid="graphics-card-count"
			>{cards.length}
			{cards.length === 1 ? 'overlay' : 'overlays'} designed</span
		>
	</div>

	<!-- Outage. Renders whenever the flag is set, INCLUDING with zero cards —
	     that is precisely the payload the backend emits for a failed render, and
	     a cards-only condition would hide the one case a reviewer must see. -->
	{#if renderFailed}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-text)]"
			data-testid="graphics-warning-render-failed"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span
				><strong>Graphics failed to render</strong> — the reel will ship with NO graphics on it. The footage
				and the cut are unaffected; re-run this stage to try again.</span
			>
		</p>
	{:else if cards.length === 0}
		<!-- The editorial half of the same empty list. NEUTRAL on purpose: nothing
		     went wrong, the designer had no title to render. -->
		<p
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
			data-testid="graphics-no-cards"
		>
			This brief has no title card — the designer chose no overlays, and nothing failed. The reel
			renders as clean footage.
		</p>
	{/if}

	<!-- Index key: two identical note strings are a legal payload, and a duplicate
	     key throws in production, blanking the panel that reports the failure. -->
	{#each notes as note, i (i)}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="graphics-note"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>{note}</span>
		</p>
	{/each}

	<ul class="space-y-2">
		<!-- Index, not `card.id`: ids are JSONB from the wire and may repeat or be
		     null, and `str(id) ?? i` mixes ids with indices so "1" collides with 1.
		     A duplicate key is a Svelte 5 runtime error, not a dev warning. The
		     `expired` map is already index-addressed, so index is also the identity
		     the rest of this component uses. -->
		{#each cards as card, i (i)}
			{@const src = cardSrc(card)}
			{@const at = num(card.at_seconds)}
			{@const seconds = num(card.seconds)}
			<li
				class="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
				data-testid="graphics-card"
				data-shot-id={str(card.shot_id) ?? undefined}
			>
				<div
					class="relative flex h-[72px] w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)]"
					style={CHECKER}
					data-testid="graphics-card-backdrop"
				>
					{#if !src}
						<span
							class="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-white"
							data-testid="graphics-card-no-url"
						>
							<VideoOff class="h-4 w-4" />
							no overlay URL
						</span>
					{:else if expired[i]}
						<span
							class="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-white"
							data-testid="graphics-card-expired"
						>
							<VideoOff class="h-4 w-4" />
							overlay link expired — re-run graphics_design
						</span>
					{:else if opened[i]}
						<!-- Muted + looping + autoplay: the card is a 3s animation and the
						     review question is "does the entrance look right", so once the
						     reviewer has asked for it, it loops without a second click. -->
						<video
							{src}
							preload="metadata"
							muted
							loop
							autoplay
							playsinline
							class="h-full w-full object-contain"
							data-testid="graphics-card-video"
							data-loaded="true"
							onerror={() => markExpired(i)}
						>
							<track kind="captions" />
						</video>
					{:else}
						<button
							type="button"
							onclick={() => openCard(i)}
							class="group relative block h-full w-full"
							aria-label={`Play overlay card ${i + 1}`}
							data-testid="graphics-card-load"
						>
							<video
								{src}
								preload="none"
								muted
								playsinline
								class="h-full w-full object-contain"
								data-testid="graphics-card-video"
								onerror={() => markExpired(i)}
							>
								<track kind="captions" />
							</video>
							<span class="absolute inset-0 flex items-center justify-center">
								<span class="rounded-full bg-black/55 p-1.5 text-white"
									><Play class="h-4 w-4" /></span
								>
							</span>
						</button>
					{/if}
				</div>
				<div class="min-w-0 flex-1 space-y-1">
					<div class="flex flex-wrap items-center gap-1.5">
						{#if str(card.kind)}
							<Pill tone="accent"><span data-testid="graphics-card-kind">{card.kind}</span></Pill>
						{/if}
						{#if at != null && seconds != null}
							<span
								class="text-xs tabular-nums text-[var(--color-text-muted)]"
								data-testid="graphics-card-window"
							>
								<Duration seconds={at} class="text-xs" /> → <Duration
									seconds={at + seconds}
									class="text-xs"
								/>
							</span>
						{/if}
					</div>
					{#if str(card.text)}
						<p class="text-xs text-[var(--color-text)]" data-testid="graphics-card-text">
							{card.text}
						</p>
					{/if}
					<p class="text-[11px] text-[var(--color-text-muted)]" data-testid="graphics-card-shot">
						{#if str(card.shot_id)}
							pinned to shot <span class="font-mono">{card.shot_id}</span>
						{:else}
							not pinned to a shot (full-frame)
						{/if}
					</p>
				</div>
			</li>
		{/each}
	</ul>
</div>

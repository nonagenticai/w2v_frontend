<script lang="ts">
	// The storyboard: the cross-stage line_id assembly (see utils/storyline.ts).
	// One card per narration line — its visual (slide/AI image/motion clip), its
	// script text, and its voiceover audio, side by side. This is the
	// marketing-facing "your video, line by line" view. Self-gates to nothing
	// when the run has no line-keyed stages.
	import type { RunDetail } from '$lib/types/runs';
	import { buildStoryline, storylineSummary } from '$lib/utils/storyline';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import AudioPlayer from '$lib/components/audio/AudioPlayer.svelte';
	import Lightbox, { type LightboxItem } from './renderers/_shared/Lightbox.svelte';
	import Duration from './renderers/_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { Play, Film, LayoutTemplate, Code2, Sparkles, Image as ImageIcon } from '@lucide/svelte';

	let { run }: { run: RunDetail } = $props();

	// Every URL here is handed straight to the browser (<img>/<video>/<audio>, the
	// Lightbox), which builds those requests itself and cannot carry the
	// X-Active-Tenant-Id header a fetch() would — so a tenant switch has to ride
	// along in the URL. Scoped once here; the Lightbox items derive from `lines`.
	const lines = $derived(
		buildStoryline(run).map((l) => ({
			...l,
			imageUrl: scopedMediaUrl(l.imageUrl) ?? undefined,
			motionUrl: scopedMediaUrl(l.motionUrl) ?? undefined,
			audioUrl: scopedMediaUrl(l.audioUrl) ?? undefined
		}))
	);
	const summary = $derived(storylineSummary(lines));

	const visualIcon = (t?: string) =>
		t === 'footage'
			? Film
			: t === 'slide'
				? LayoutTemplate
				: t === 'html'
					? Code2
					: t === 'ai_image'
						? Sparkles
						: ImageIcon;

	// Lightbox items, with a map from line index → lightbox index.
	const visuals = $derived(
		lines
			.map((l, i) => {
				const item: LightboxItem | null = l.motionUrl
					? { url: l.motionUrl, kind: 'video', label: `Line ${i + 1}` }
					: l.imageUrl
						? { url: l.imageUrl, kind: 'image', label: `Line ${i + 1}` }
						: null;
				return { i, item };
			})
			.filter((v): v is { i: number; item: LightboxItem } => v.item !== null)
	);
	const lbItems = $derived(visuals.map((v) => v.item));

	let lbOpen = $state(false);
	let lbIndex = $state(0);
	function openLine(lineIdx: number) {
		const idx = visuals.findIndex((v) => v.i === lineIdx);
		if (idx >= 0) {
			lbIndex = idx;
			lbOpen = true;
		}
	}
</script>

{#if lines.length > 0}
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
		data-testid="stage-storyline"
	>
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<p class="text-kicker text-[var(--color-text-muted)]">Storyboard</p>
				<h2
					class="text-lg font-semibold text-[var(--color-text)]"
					style="font-family:var(--font-display)"
				>
					Your video, line by line
				</h2>
			</div>
			<div class="flex flex-wrap items-center gap-1.5">
				<Pill tone="accent">{summary.count} lines</Pill>
				{#if summary.totalSeconds > 0}<Pill tone="neutral">
						<Duration seconds={summary.totalSeconds} />
					</Pill>{/if}
				<Pill tone={summary.withAudio === summary.count ? 'success' : 'neutral'}>
					{summary.withAudio}/{summary.count} voiced
				</Pill>
				<Pill tone={summary.withVisual === summary.count ? 'success' : 'neutral'}>
					{summary.withVisual}/{summary.count} visuals
				</Pill>
			</div>
		</div>

		<ol class="space-y-3">
			{#each lines as line, i (line.lineId)}
				{@const Icon = visualIcon(line.visualType)}
				<li
					class="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
					data-testid="storyline-line"
					data-line-id={line.lineId}
				>
					<!-- Visual -->
					<div class="relative">
						{#if line.imageUrl || line.motionUrl}
							<button
								type="button"
								onclick={() => openLine(i)}
								class="group relative block w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-black/5 aspect-video"
							>
								{#if line.imageUrl}
									<img
										src={line.imageUrl}
										alt={`Line ${i + 1} visual`}
										loading="lazy"
										class="h-full w-full object-contain transition-transform group-hover:scale-[1.03]"
									/>
								{:else if line.motionUrl}
									<!-- preload="none": the tile only opens the Lightbox (which autoplays)
									     on click; preload="metadata" mounted a fetch-per-line metadata storm
									     at terminal render on long video runs. No frame shows either way
									     (metadata is not a poster) so this is visually identical, far cheaper. -->
									<video
										src={line.motionUrl}
										preload="none"
										muted
										class="h-full w-full object-cover"
									></video>
								{/if}
								{#if line.motionUrl}
									<span
										class="absolute inset-0 flex items-center justify-center bg-black/15 group-hover:bg-black/25"
									>
										<span class="rounded-full bg-black/55 p-1.5 text-white">
											<Play class="h-4 w-4" />
										</span>
									</span>
								{/if}
							</button>
						{:else}
							<div
								class="flex aspect-video w-full items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)]"
							>
								<Icon class="h-6 w-6 opacity-50" />
							</div>
						{/if}
					</div>

					<!-- Script + audio -->
					<div class="min-w-0 space-y-1.5">
						<div class="flex flex-wrap items-center gap-2 text-[var(--color-text-muted)]">
							<span class="text-[10px] uppercase tracking-wide tabular-nums">Line {i + 1}</span>
							{#if line.speaker}<Pill tone="neutral">
									Speaker {line.speaker.toUpperCase()}
								</Pill>{/if}
							{#if line.seconds != null}<Duration seconds={line.seconds} class="text-[10px]" />{/if}
							{#if line.previewSource}
								<span class="text-[10px]">{line.previewSource}</span>
							{:else if line.visualType}
								<span class="inline-flex items-center gap-1 text-[10px]">
									<Icon class="h-3 w-3" />{line.visualType}
								</span>
							{/if}
						</div>
						{#if line.text}
							<p class="text-sm leading-relaxed text-[var(--color-text)]">{line.text}</p>
						{/if}
						{#if line.shot}
							<p class="text-xs text-[var(--color-text-muted)]">
								<span class="font-medium">Shot:</span>
								{line.shot}
							</p>
						{/if}
						{#if line.audioUrl}
							<AudioPlayer src={line.audioUrl} preload="none" />
						{/if}
					</div>
				</li>
			{/each}
		</ol>

		<Lightbox items={lbItems} bind:open={lbOpen} bind:index={lbIndex} />
	</section>
{/if}

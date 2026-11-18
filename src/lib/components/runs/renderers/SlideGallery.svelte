<script lang="ts">
	// Visual assets keyed by line: PromoSlidesOutput.slides {image_url,
	// motion_video_url?}, AI images {artifact_url|image_url}, motion_clips
	// {artifact_url} → a thumbnail grid. A motion clip gets a play badge; clicking
	// any tile opens the lightbox (full image or the motion video).
	import { Play } from '@lucide/svelte';
	import Lightbox, { type LightboxItem } from './_shared/Lightbox.svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type { GalleryOutput } from './stage-outputs';
	import { withUniqueKeys } from '$lib/utils/unique-keys';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as GalleryOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

	type Tile = {
		key: string;
		thumb?: string | null;
		video?: string | null;
		image?: string | null;
		line?: string;
	};

	// scopedMediaUrl on every asset URL: <img>/<video> are fetched by the browser,
	// which cannot send our X-Active-Tenant-Id header, so a super-admin viewing
	// another tenant's run needs the tenant carried in the query string instead.
	const tiles = $derived.by((): Tile[] => {
		const out: Tile[] = [];
		// slides: still image, optional motion video overlay
		for (const s of arr(data.slides)) {
			const image = scopedMediaUrl(str(s.image_url));
			const video = scopedMediaUrl(str(s.motion_video_url));
			out.push({
				key: `slide-${str(s.id) ?? out.length}`,
				thumb: image,
				image,
				video,
				line: str(s.line_id)
			});
		}
		// AI images: artifact_url or image_url.
		// ⚠️ `im.id` is NOT unique. It is `deterministic_media_id(prompt, job_key,
		// line_id)` (w2v_orchestrator src/services/stages/generic/ai_image_gen.py:131)
		// — content-addressed, with NO index term — and `_resolve_prompts` does not
		// dedupe, so two identical (prompt, line_id) pairs mint the SAME id twice.
		// Hence `withUniqueKeys` on the keyed `{#each}` below: an `each_key_duplicate`
		// throw here blanks the whole run page, not just this grid.
		for (const im of arr(data.images)) {
			const image = scopedMediaUrl(str(im.image_url) ?? str(im.artifact_url));
			out.push({
				key: `img-${str(im.id) ?? out.length}`,
				thumb: image,
				image,
				line: str(im.line_id)
			});
		}
		// motion clips: video only (use the video element itself as the thumb)
		for (const m of arr(data.motion_clips)) {
			const video = scopedMediaUrl(str(m.artifact_url));
			out.push({ key: `motion-${out.length}`, video, line: str(m.line_id) });
		}
		return out;
	});

	const lbItems = $derived(
		tiles.map((t): LightboxItem =>
			t.video
				? {
						url: t.video,
						kind: 'video',
						label: t.line ? `Line ${t.line.slice(0, 6)}` : undefined
					}
				: {
						url: t.image ?? '',
						kind: 'image',
						label: t.line ? `Line ${t.line.slice(0, 6)}` : undefined
					}
		)
	);

	let lbOpen = $state(false);
	let lbIndex = $state(0);
	function openAt(i: number) {
		lbIndex = i;
		lbOpen = true;
	}
</script>

<div data-testid="slide-gallery">
	<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
		{#each withUniqueKeys(tiles, (t) => t.key) as { item: tile, index: i, key } (key)}
			<button
				type="button"
				onclick={() => openAt(i)}
				class="group relative block w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] aspect-video"
				data-line-id={tile.line ?? undefined}
			>
				{#if tile.thumb}
					<img
						src={tile.thumb}
						alt={tile.line ? `Line ${tile.line.slice(0, 6)}` : `Asset ${i + 1}`}
						loading="lazy"
						class="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
					/>
				{:else if tile.video}
					<video src={tile.video} preload="metadata" muted class="h-full w-full object-cover"
					></video>
				{/if}
				{#if tile.video}
					<span
						class="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/25"
					>
						<span class="rounded-full bg-black/55 p-2 text-white"><Play class="h-5 w-5" /></span>
					</span>
				{/if}
			</button>
		{/each}
	</div>
	<Lightbox items={lbItems} bind:open={lbOpen} bind:index={lbIndex} />
</div>

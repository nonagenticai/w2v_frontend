<script lang="ts">
	// Media discovery (MediaDiscoveryOutput.items[]{title, url, thumbnail_url,
	// media_type, source, quality_score}) → an asset-picker grid with a quality
	// meter; click opens the lightbox. Header shows the query + sources searched.
	import Lightbox, { type LightboxItem } from './_shared/Lightbox.svelte';
	import { Pill } from '$lib/components/ui';
	import { Search } from '@lucide/svelte';
	import { thumbnailSrc } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type { MediaDiscoveryOutput, MediaDiscoveryItem } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as MediaDiscoveryOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const items = $derived<MediaDiscoveryItem[]>(Array.isArray(data.items) ? data.items : []);
	const query = $derived(str(data.query));
	const sources = $derived(
		Array.isArray(data.sources_queried) ? data.sources_queried.length : undefined
	);

	// Results mix third-party stock URLs (i.ytimg.com &c.) with our own composites.
	// The SPA's CSP is `img-src 'self' data: blob:`, so an external thumbnail put
	// straight into <img src> is blocked outright — this grid was the last caller
	// still doing that, and produced a wall of CSP violations on the run page.
	// thumbnailSrc routes external URLs through the same-origin, SSRF-guarded
	// /api/media/thumb proxy and tenant-scopes our own `/api/…` ones exactly like
	// scopedMediaUrl did (an <img> fetch can't carry the X-Active-Tenant-Id header).
	const thumb = (it: MediaDiscoveryItem) =>
		thumbnailSrc(str(it.thumbnail_url) ?? str(it.composite_url) ?? str(it.url));
	const isVideo = (it: MediaDiscoveryItem) =>
		(str(it.media_type) ?? '').toLowerCase().includes('video');

	const lbItems = $derived(
		items.map((it): LightboxItem => {
			const url = (isVideo(it) ? str(it.url) : thumb(it)) ?? str(it.url) ?? '';
			return { url, kind: isVideo(it) ? 'video' : 'image', label: str(it.title) };
		})
	);
	let lbOpen = $state(false);
	let lbIndex = $state(0);
	const openAt = (i: number) => {
		lbIndex = i;
		lbOpen = true;
	};
</script>

<div class="space-y-3" data-testid="media-discovery-grid">
	{#if query || sources != null}
		<div class="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
			<Search class="h-3.5 w-3.5" />
			{#if query}<span class="text-[var(--color-text)]">"{query}"</span>{/if}
			{#if sources != null}<span>· {sources} sources</span>{/if}
			<span>· {items.length} results</span>
		</div>
	{/if}
	<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
		{#each items as it, i (str(it.id) ?? i)}
			{@const q = num(it.quality_score)}
			<div class="space-y-1">
				<button
					type="button"
					onclick={() => openAt(i)}
					class="group block aspect-video w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
				>
					{#if thumb(it)}
						<img
							src={thumb(it)}
							alt={str(it.title) ?? `Result ${i + 1}`}
							loading="lazy"
							data-testid="media-discovery-thumb"
							class="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
						/>
					{:else}
						<!-- Same placeholder shape as MediaFinder: a result with no usable
						     URL must still read as a result, not as an empty tile. -->
						<div
							class="flex h-full w-full items-center justify-center bg-[var(--color-surface-strong)] text-xs text-[var(--color-text-muted)]"
							data-testid="media-discovery-thumb-placeholder"
						>
							{str(it.media_type) ?? 'media'}
						</div>
					{/if}
				</button>
				<div class="flex items-center justify-between gap-1">
					<span class="truncate text-xs text-[var(--color-text-muted)]">
						{str(it.title) ?? str(it.source) ?? ''}
					</span>
					{#if str(it.media_type)}<Pill tone="neutral">{it.media_type}</Pill>{/if}
				</div>
				{#if q != null}
					<span class="block h-1 rounded-full bg-[var(--color-surface-strong)] overflow-hidden">
						<span
							class="block h-full rounded-full bg-[var(--color-accent)]"
							style={`width:${Math.round(q * 100)}%`}
						></span>
					</span>
				{/if}
			</div>
		{/each}
	</div>
	<Lightbox items={lbItems} bind:open={lbOpen} bind:index={lbIndex} />
</div>

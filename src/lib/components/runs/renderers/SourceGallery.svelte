<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- anchors here are the
	   external source/reference URLs from the run output, never internal routes. */
	// Source ingest (SourceIngestOutput: images[]{url, caption, source_ref},
	// grounding_text, references[]) → the "what we read from your site"
	// provenance: an ingested-image grid, the grounding text, and source links.
	import Markdown from './_shared/Markdown.svelte';
	import Lightbox, { type LightboxItem } from './_shared/Lightbox.svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type { SourceOutput, SourceImage } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as SourceOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const images = $derived<SourceImage[]>(Array.isArray(data.images) ? data.images : []);
	const grounding = $derived(str(data.grounding_text));
	const references = $derived(
		(Array.isArray(data.references) ? data.references : []).filter(
			(r): r is string => typeof r === 'string'
		)
	);

	// The ingested image itself is served back by us, and <img> is fetched by the
	// browser — which can't carry X-Active-Tenant-Id — so the tenant switch has to
	// ride along in the query string. The `references` links below stay untouched:
	// they point at the customer's own site, not at our API.
	const imgUrl = (im: SourceImage) => scopedMediaUrl(str(im.url));

	const lbItems = $derived(
		images
			.map((im) => imgUrl(im))
			.filter((u): u is string => !!u)
			.map((url): LightboxItem => ({ url, kind: 'image' }))
	);
	let lbOpen = $state(false);
	let lbIndex = $state(0);
	const openAt = (i: number) => {
		lbIndex = i;
		lbOpen = true;
	};
</script>

<div class="space-y-3" data-testid="source-gallery">
	{#if images.length}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			{#each images as im, i (str(im.id) ?? i)}
				<div class="space-y-1">
					<button
						type="button"
						onclick={() => openAt(i)}
						class="group block aspect-video w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
					>
						{#if imgUrl(im)}
							<img
								src={imgUrl(im)}
								alt={str(im.alt_text) ?? str(im.caption) ?? `Source ${i + 1}`}
								loading="lazy"
								class="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
							/>
						{/if}
					</button>
					{#if str(im.caption)}<p class="truncate text-xs text-[var(--color-text-muted)]">
							{im.caption}
						</p>{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if grounding}
		<details
			class="group rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
		>
			<summary
				class="flex cursor-pointer select-none items-center gap-1.5 text-sm font-medium text-[var(--color-text)]"
			>
				<ChevronDown class="h-4 w-4 transition-transform group-open:rotate-180" />
				What we read from your source
			</summary>
			<div class="mt-2"><Markdown text={grounding} /></div>
		</details>
	{/if}

	{#if references.length}
		<div class="space-y-1">
			<p class="text-kicker text-[var(--color-text-muted)]">Sources</p>
			<ul class="space-y-0.5">
				{#each references as ref, i (i)}
					<li>
						<a
							href={safeHref(ref)}
							target="_blank"
							rel="noopener noreferrer"
							class="text-xs text-[var(--color-accent)] hover:underline break-all">{ref}</a
						>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<Lightbox items={lbItems} bind:open={lbOpen} bind:index={lbIndex} />
</div>

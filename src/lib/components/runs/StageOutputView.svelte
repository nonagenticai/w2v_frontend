<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- every anchor/media src
	   here points at a backend artifact URL (already rewritten to the browser-
	   reachable /api/runs/{id}/artifact/... proxy), never an internal route. */
	import { Pill } from '$lib/components/ui';
	import { ChevronDown } from '@lucide/svelte';
	import { resolveRenderer } from './renderers/registry';
	import { scopedMediaUrl } from '$lib/api/client.js';

	// Readable renderer for ONE stage output (or an input config slice). It first
	// asks the shape registry for a dedicated rich renderer (script transcript,
	// storyboard strip, scorecard, …); when none matches it falls back to the
	// generic shape detector below — media URLs → thumbnails / inline players,
	// known arrays → compact lists, scalars → a key/value table. Raw JSON is
	// always offered beneath so nothing is ever hidden. Used by StageIOInspector
	// for both outputs and the upstream input previews.
	let {
		output,
		runId,
		dense = false,
		emptyLabel = 'No output recorded.'
	}: {
		output: Record<string, unknown> | null | undefined;
		runId?: string;
		dense?: boolean;
		emptyLabel?: string;
	} = $props();

	type MediaKind = 'image' | 'video' | 'audio' | 'link';
	type Media = { key: string; url: string; kind: MediaKind; label?: string };

	const isUrl = (v: unknown): v is string =>
		typeof v === 'string' &&
		(v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/'));

	function mediaKind(key: string, url: string): MediaKind {
		const k = key.toLowerCase();
		const u = url.toLowerCase();
		if (
			/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/.test(u) ||
			/image|thumb|screenshot|visual|poster/.test(k)
		)
			return 'image';
		if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(u) || k.includes('video')) return 'video';
		if (/\.(mp3|wav|m4a|ogg|flac)(\?|$)/.test(u) || k.includes('audio')) return 'audio';
		// artifact_url with no other signal is a produced video in nearly every stage.
		if (k === 'artifact_url' || k.endsWith('_artifact_url')) return 'video';
		return 'link';
	}

	const o = $derived((output ?? {}) as Record<string, unknown>);
	const entries = $derived(Object.entries(o));
	const isEmpty = $derived(entries.length === 0);

	// A dedicated rich renderer for this payload shape, or null → generic fallback.
	const renderer = $derived(resolveRenderer(o));

	// Top-level media (scalar URL values). The URLs are consumed by the browser
	// itself (<img>/<video>/<audio>/<a>), which cannot carry the
	// X-Active-Tenant-Id header a fetch() would, so an admin's tenant switch has
	// to ride along in the URL — see scopedMediaUrl.
	const media = $derived.by((): Media[] => {
		const out: Media[] = [];
		for (const [key, value] of entries) {
			if (isUrl(value))
				out.push({ key, url: scopedMediaUrl(value) ?? value, kind: mediaKind(key, value) });
		}
		return out;
	});
	const mediaKeys = $derived(new Set(media.map((m) => m.key)));

	// Arrays — rendered as compact lists (with per-item media where present).
	const lists = $derived(
		entries.filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0)
	);
	const listKeys = $derived(new Set(lists.map(([k]) => k)));

	// Everything else → a key/value table (scalars + nested objects).
	const scalars = $derived(
		entries.filter(
			([k, v]) => !mediaKeys.has(k) && !listKeys.has(k) && v !== null && v !== undefined
		)
	);

	const rawJson = $derived(JSON.stringify(output ?? null, null, 2));

	// ── per-item helpers for known array shapes ──
	const asRec = (v: unknown): Record<string, unknown> =>
		v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	function itemImage(item: Record<string, unknown>): string | undefined {
		for (const k of ['image_url', 'thumbnail_url', 'url', 'artifact_url']) {
			if (isUrl(item[k])) return scopedMediaUrl(item[k] as string) ?? (item[k] as string);
		}
		return undefined;
	}
	function itemText(item: Record<string, unknown>): string | undefined {
		return str(item.text) ?? str(item.title) ?? str(item.label) ?? str(item.criterion);
	}
	function severityTone(sev: string | undefined): 'danger' | 'warning' | 'neutral' {
		const s = (sev ?? '').toLowerCase();
		if (s === 'critical' || s === 'high') return 'danger';
		if (s === 'medium') return 'warning';
		return 'neutral';
	}
	function scalarText(v: unknown): string {
		if (typeof v === 'string') return v;
		if (typeof v === 'number' || typeof v === 'boolean') return String(v);
		return JSON.stringify(v);
	}
</script>

{#snippet rawJsonDisclosure()}
	<details class="group">
		<summary
			class="flex items-center gap-1.5 cursor-pointer text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] select-none"
		>
			<ChevronDown class="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
			Raw JSON
		</summary>
		<pre
			class="mt-2 text-xs leading-relaxed font-mono bg-[var(--color-surface-strong)] text-[var(--color-text)] rounded-lg p-3 overflow-auto max-h-80 whitespace-pre-wrap break-words">{rawJson}</pre>
	</details>
{/snippet}

{#if isEmpty}
	<p class="text-xs text-[var(--color-text-muted)]">{emptyLabel}</p>
{:else if renderer}
	{@const Renderer = renderer.component}
	<div class="space-y-3">
		<Renderer output={o} {runId} {dense} />
		{@render rawJsonDisclosure()}
	</div>
{:else}
	<div class="space-y-4">
		<!-- ── Media ── -->
		{#if media.length}
			<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
				{#each media as m (m.key)}
					<div class="space-y-1 min-w-0">
						<p class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] truncate">
							{m.key}
						</p>
						{#if m.kind === 'image'}
							<a href={safeHref(m.url)} target="_blank" rel="noopener noreferrer">
								<img
									src={m.url}
									alt={m.key}
									loading="lazy"
									class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
								/>
							</a>
						{:else if m.kind === 'video'}
							<!-- svelte-ignore a11y_media_has_caption -->
							<video
								src={m.url}
								controls
								preload="metadata"
								class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-black"
							></video>
						{:else if m.kind === 'audio'}
							<audio src={m.url} controls preload="metadata" class="w-full"></audio>
						{:else}
							<a
								href={safeHref(m.url)}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-[var(--color-accent)] hover:underline break-all font-mono"
							>
								{m.url}
							</a>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- ── Lists (script lines, slides, findings, visuals, chapters, …) ── -->
		{#each lists as [key, value] (key)}
			{@const items = value as unknown[]}
			<div class="space-y-1.5">
				<p class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
					{key} ({items.length})
				</p>
				{#if items.every((it) => it && typeof it === 'object' && itemImage(asRec(it)))}
					<!-- image-bearing items → thumbnail grid -->
					<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
						{#each items as it, i (i)}
							{@const rec = asRec(it)}
							<div class="space-y-1 min-w-0">
								<img
									src={itemImage(rec)}
									alt={itemText(rec) ?? `${key} ${i + 1}`}
									loading="lazy"
									class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
								/>
								{#if itemText(rec) || str(rec.role)}
									<p class="text-xs text-[var(--color-text-muted)] truncate">
										{itemText(rec) ?? ''}{rec.role ? ` · ${rec.role}` : ''}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else if items.every((it) => it && typeof it === 'object')}
					<!-- object items → compact rows -->
					<ol class="space-y-1.5">
						{#each items as it, i (i)}
							{@const rec = asRec(it)}
							<li
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
							>
								<div class="flex items-start justify-between gap-2">
									<span class="text-[var(--color-text)] min-w-0">
										<span class="text-[var(--color-text-muted)] tabular-nums mr-1.5">{i + 1}.</span>
										{itemText(rec) ?? JSON.stringify(rec)}
									</span>
									<span class="flex items-center gap-1.5 shrink-0">
										{#if str(rec.severity)}
											<Pill tone={severityTone(str(rec.severity))}>{rec.severity}</Pill>
										{/if}
										{#if str(rec.speaker)}
											<span class="text-xs text-[var(--color-text-muted)]">{rec.speaker}</span>
										{/if}
										{#if typeof rec.seconds === 'number'}
											<span class="text-xs text-[var(--color-text-muted)] tabular-nums">
												{(rec.seconds as number).toFixed(1)}s
											</span>
										{:else if typeof rec.score === 'number'}
											<span class="text-xs text-[var(--color-text-muted)] tabular-nums">
												{rec.score}
											</span>
										{:else if typeof rec.start_seconds === 'number'}
											<span class="text-xs text-[var(--color-text-muted)] tabular-nums">
												@{(rec.start_seconds as number).toFixed(0)}s
											</span>
										{/if}
									</span>
								</div>
								{#if str(rec.recommendation)}
									<p class="text-xs text-[var(--color-text-muted)] mt-1">
										<span class="font-medium text-[var(--color-text)]">Fix:</span>
										{rec.recommendation}
									</p>
								{:else if str(rec.description)}
									<p class="text-xs text-[var(--color-text-muted)] mt-1">{rec.description}</p>
								{/if}
							</li>
						{/each}
					</ol>
				{:else}
					<!-- scalar items -->
					<p class="text-sm text-[var(--color-text)]">{(items as unknown[]).join(', ')}</p>
				{/if}
			</div>
		{/each}

		<!-- ── Scalars / nested objects ── -->
		{#if scalars.length}
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				{#each scalars as [key, value] (key)}
					<dt class="text-[var(--color-text-muted)]">{key}</dt>
					<dd class="text-[var(--color-text)] break-words min-w-0">{scalarText(value)}</dd>
				{/each}
			</dl>
		{/if}

		<!-- ── Raw JSON (always available) ── -->
		{@render rawJsonDisclosure()}
	</div>
{/if}

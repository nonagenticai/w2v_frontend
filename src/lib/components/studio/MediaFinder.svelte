<script module lang="ts">
	// ── Thumbnail proxy failures ───────────────────────────────────────────────
	// `/api/media/thumb` allow-lists the upstream hosts it will fetch and returns
	// 400 for anything else. That used to render as a broken-image glyph with no
	// explanation. We now show a styled placeholder instead, and — when the proxy
	// says WHY — quote its reason.
	//
	// The proxy's typed body shape is deliberately NOT pinned here: it is owned by
	// the orchestrator and may be `{detail: ...}` (FastAPI's default envelope),
	// `{detail: {reason, message}}`, or a bare `{reason}` / `{message}`. Anything
	// unrecognised (HTML, empty, a network error) degrades to the generic line —
	// never to a broken image.
	//
	// ⚠️ The generic line names NO cause. It used to read "source not supported",
	// which is a DIAGNOSIS, and on 2026-09-15 it was measurably wrong in prod:
	// `/api/media/thumb` answered 502 on 21 of 22 requests and 400 on none, so the
	// allow-list reason it blamed was never emitted at all — the real cause was an
	// upstream 403. A placeholder must only name a cause the proxy actually
	// returned; until then it says it is still checking.
	export const THUMB_UNAVAILABLE = 'Preview unavailable';

	/** Shown while the verification fetch is still in flight. Names no cause. */
	export const THUMB_CHECKING = `${THUMB_UNAVAILABLE} — checking…`;

	/**
	 * Wall-clock deadline for the verification fetch.
	 *
	 * "checking…" is an honest interim state only if something guarantees it ends.
	 * A proxy that HANGS rather than answering is not hypothetical here: this is
	 * the same `/api/media/thumb` that answered 502 on 21 of 22 prod requests, and
	 * `fetch` has no client deadline of its own — without this the tile reads
	 * "checking…" until the browser's own timeout, i.e. indefinitely stale.
	 *
	 * 30s is `DEFAULT_REQUEST_TIMEOUT_MS` from `$lib/api/client.ts`, the deadline
	 * every other JSON call in the SPA already runs under. Deliberately not
	 * shorter: this verification can CLEAR the placeholder, so aborting a
	 * slow-but-live CDN early would latch a placeholder over a working image.
	 */
	export const THUMB_VERIFY_TIMEOUT_MS = 30_000;

	const REASON_KEYS = ['reason', 'message', 'detail', 'error'] as const;

	/**
	 * Render a proxy reason as a human phrase.
	 *
	 * Deliberately OPEN: only machine-shaped codes we have a better phrase for are
	 * rewritten; everything else is passed through (snake_case codes merely get
	 * readable spacing). The orchestrator keeps adding typed reasons — an SVG
	 * source, for one — and a closed set would silently drop them.
	 */
	export function thumbReasonText(reason: string): string {
		const key = reason.trim().toLowerCase();
		if (key === 'host_not_allowed' || key === 'host-not-allowed') return 'source not supported';
		if (/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(key)) return key.replace(/[_-]/g, ' ');
		return reason.trim();
	}

	/** Pull a short human reason out of an unknown proxy error body, or null. */
	export function thumbFailureReason(body: unknown, depth = 0): string | null {
		if (typeof body === 'string') {
			const s = body.trim();
			// An HTML error page is not a reason; neither is an empty body.
			if (!s || s.startsWith('<')) return null;
			return s.slice(0, 160);
		}
		if (!body || typeof body !== 'object' || depth > 3) return null;
		const rec = body as Record<string, unknown>;
		for (const key of REASON_KEYS) {
			if (key in rec) {
				const found = thumbFailureReason(rec[key], depth + 1);
				if (found) return found;
			}
		}
		return null;
	}

	/**
	 * The line shown in the placeholder once verification has come back.
	 *
	 * A body we cannot read resolves to the bare "Preview unavailable" — true of
	 * every failure — rather than to a specific claim we have not established.
	 */
	export function thumbFailureMessage(body: unknown): string {
		const reason = thumbFailureReason(body);
		if (!reason) return THUMB_UNAVAILABLE;
		const text = thumbReasonText(reason);
		return text ? `${THUMB_UNAVAILABLE} — ${text}` : THUMB_UNAVAILABLE;
	}
</script>

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { media, ApiError } from '$lib/api';
	import { thumbnailSrc } from '$lib/api/client.js';
	import type { MediaResult } from '$lib/api';
	import type { ProjectSource } from '$lib/types';
	import { mediaResultRef, mediaResultToSource } from '$lib/studio/media-source';
	import { Search, Loader2, Check, Plus, ImageOff } from '@lucide/svelte';

	// Pinned media are appended to the shared sources array as {kind:'media'}.
	let { sources = $bindable<ProjectSource[]>([]) }: { sources?: ProjectSource[] } = $props();

	let query = $state('');
	let loading = $state(false);
	let error = $state('');
	let results = $state<MediaResult[]>([]);
	let searched = $state(false);

	// Thumbnails that failed to load (proxy 4xx/5xx, dead upstream), id → the line
	// to show. Rendered as an explicit "preview unavailable" placeholder instead of
	// a broken-image glyph, so the operator knows the source — not the app — is at
	// fault and that the result is still pinnable.
	let brokenThumbs = $state<Record<string, string>>({});

	// Ids whose failure has already been re-verified once. A re-fetch that comes
	// back ok proves the resource IS retrievable (transient blip, slow CDN), so the
	// latch is cleared and the image gets exactly ONE more chance; a second error on
	// the same id skips the round-trip and keeps the placeholder. That bound is what
	// stops a genuinely dead thumbnail oscillating between error and retry forever.
	let reverified = new SvelteSet<string>();

	// Which search the latches belong to. A verification `fetch` outlives the
	// search that started it: the operator can run another search while it is in
	// flight, and the SAME id can come back with a thumbnail that now loads fine.
	// Writing that stale non-ok result would paint "preview unavailable" over a
	// visibly working image, so every branch that WRITES a message does so only
	// while its captured generation is still current.
	//
	// The ok branch is deliberately unguarded — but NOT because its key is absent:
	// that stopped being true when the pending write below started latching
	// THUMB_CHECKING before the fetch, so the key IS present for the whole
	// round-trip. It is unguarded because it only ever DELETES, and delete is the
	// safe direction: `runSearch` already reset `brokenThumbs` to `{}`, so a stale
	// ok removes a key that is by then gone, and even if it were not, removing one
	// can only reveal the <img> — never assert a failure that did not happen.
	let searchGeneration = 0;

	// An `<img>` error event carries no status and no body, so ask the proxy again
	// for its typed reason. Until that answer arrives the placeholder says only
	// that it is checking — guessing a cause here is how the UI came to blame the
	// host allow-list for a 502 it had never seen a 400 from.
	async function noteBrokenThumb(id: string, src: string | null | undefined) {
		if (brokenThumbs[id]) return;
		if (!src || reverified.has(id)) {
			// Nothing more will be learned (no src, or this id already spent its one
			// verification), so settle straight on the neutral line.
			brokenThumbs = { ...brokenThumbs, [id]: THUMB_UNAVAILABLE };
			return;
		}
		brokenThumbs = { ...brokenThumbs, [id]: THUMB_CHECKING };
		reverified.add(id);
		const generation = searchGeneration;
		// A manual controller rather than `AbortSignal.timeout`: it is the shape
		// `client.ts` already uses, and it needs no recent DOM lib typing, so it
		// checks identically under the TypeScript the lockfile resolves and the one
		// package.json pins.
		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => controller.abort(), THUMB_VERIFY_TIMEOUT_MS);
		try {
			const res = await fetch(src, { signal: controller.signal });
			if (res.ok) {
				// Retrievable after all — a placeholder here would be a lie for the
				// rest of the session. Drop the latch so the <img> renders again.
				const cleared = { ...brokenThumbs };
				delete cleared[id];
				brokenThumbs = cleared;
				return;
			}
			const body = await res.json().catch(() => null);
			if (generation !== searchGeneration) return;
			brokenThumbs = { ...brokenThumbs, [id]: thumbFailureMessage(body) };
		} catch {
			// The deadline firing lands HERE, alongside network/CORS. That is the
			// point: an abort rejects the promise, so it can never arrive as a
			// `Response` and can never reach the non-ok branch above — there is no
			// path on which a timeout is mistaken for a refusal and latches a cause
			// the proxy never gave. In all three cases we learned nothing, so
			// "checking…" resolves to the NEUTRAL line rather than staying pending
			// forever or naming a reason.
			if (generation !== searchGeneration) return;
			brokenThumbs = { ...brokenThumbs, [id]: THUMB_UNAVAILABLE };
		} finally {
			clearTimeout(timeoutHandle);
		}
	}

	const pinnedRefs = $derived(new Set(sources.filter((s) => s.kind === 'media').map((s) => s.ref)));

	async function runSearch() {
		const q = query.trim();
		if (!q) return;
		loading = true;
		error = '';
		searched = true;
		try {
			const res = await media.search(q, { limit: 12 });
			results = res.results;
			brokenThumbs = {};
			reverified = new SvelteSet();
			searchGeneration += 1;
		} catch (err) {
			error = err instanceof ApiError ? err.detail : 'Search failed';
			results = [];
		} finally {
			loading = false;
		}
	}

	function togglePin(item: MediaResult) {
		const ref = mediaResultRef(item);
		if (pinnedRefs.has(ref)) {
			sources = sources.filter((s) => !(s.kind === 'media' && s.ref === ref));
		} else {
			sources = [...sources, mediaResultToSource(item)];
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			runSearch();
		}
	}
</script>

<div class="space-y-3">
	<div class="flex gap-2">
		<div class="relative flex-1">
			<Search
				class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
			/>
			<input
				type="search"
				placeholder="Search images & clips (e.g. “team collaboration”)"
				bind:value={query}
				onkeydown={onKey}
				data-testid="media-search-input"
				class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
			/>
		</div>
		<button
			type="button"
			onclick={runSearch}
			disabled={loading || query.trim().length === 0}
			class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-primary)] hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
		>
			{#if loading}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Search class="h-4 w-4" />{/if}
			Find
		</button>
	</div>

	{#if error}
		<p class="text-xs text-[var(--color-danger)]" data-testid="media-search-error">{error}</p>
	{/if}

	{#if loading}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
			{#each Array(8) as _, i (i)}
				<div
					class="aspect-video animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-strong)]"
				></div>
			{/each}
		</div>
	{:else if results.length > 0}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
			{#each results as item (item.id)}
				{@const ref = item.url || item.id}
				{@const pinned = pinnedRefs.has(ref)}
				<button
					type="button"
					onclick={() => togglePin(item)}
					class="group relative overflow-hidden rounded-[var(--radius-md)] border text-left transition
						{pinned
						? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]'
						: 'border-[var(--color-border)] hover:border-[var(--color-accent)]'}"
				>
					<!-- Results are mostly third-party stock URLs, which the CSP (img-src 'self')
					     blocks outright — thumbnailSrc routes them through the same-origin
					     /api/media/thumb proxy (tenant-scoped like every other /api media URL). -->
					{#if item.thumbnail_url && !brokenThumbs[item.id]}
						{@const src = thumbnailSrc(item.thumbnail_url)}
						<img
							{src}
							alt={item.title}
							loading="lazy"
							data-testid="media-thumb"
							onerror={() => noteBrokenThumb(item.id, src)}
							class="block aspect-video w-full overflow-hidden bg-[var(--color-surface-strong)] object-cover text-[0px] text-transparent"
						/>
					{:else if brokenThumbs[item.id]}
						<div
							class="flex aspect-video w-full flex-col items-center justify-center gap-1 border-b border-dashed border-[var(--color-border)] bg-[var(--color-surface-strong)] px-2 py-1 text-center text-[10px] leading-tight text-[var(--color-text-muted)]"
							data-testid="media-thumb-unavailable"
							role="status"
						>
							<ImageOff class="h-4 w-4 opacity-70" />
							<span>{brokenThumbs[item.id]}</span>
						</div>
					{:else}
						<div
							class="flex aspect-video w-full items-center justify-center bg-[var(--color-surface-strong)] text-xs text-[var(--color-text-muted)]"
							data-testid="media-thumb-placeholder"
						>
							{item.media_type || 'media'}
						</div>
					{/if}
					<div
						class="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full
							{pinned
							? 'bg-[var(--color-accent)] text-[var(--color-on-primary)]'
							: 'bg-black/50 text-white opacity-0 group-hover:opacity-100'}"
					>
						{#if pinned}<Check class="h-3.5 w-3.5" />{:else}<Plus class="h-3.5 w-3.5" />{/if}
					</div>
					<div class="p-2">
						<p class="truncate text-xs font-medium text-[var(--color-text)]">
							{item.title || 'Untitled'}
						</p>
						<p class="truncate text-[10px] text-[var(--color-text-muted)]">{item.source}</p>
					</div>
				</button>
			{/each}
		</div>
	{:else if searched}
		<p class="text-xs text-[var(--color-text-muted)]">No media found. Try a different search.</p>
	{/if}
</div>

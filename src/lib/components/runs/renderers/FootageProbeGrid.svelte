<script lang="ts">
	// action_reel `footage_probe` (FootageProbeOutput{sources[]{id, filename, bytes,
	// content_type, preview_status, duration_s, fps, codec, width, height,
	// original_url, preview_url}, total_duration_s, notes}) → the FIRST review gate
	// of an action_reel run.
	//
	// It was the only action_reel gate with no renderer, so each of ~10 sources
	// reached the reviewer as a one-line JSON string. The job here is the sibling
	// gates' job: state what was measured, and state LOUDLY what was not.
	//
	// Honesty rules this renderer exists to keep:
	//  * A source whose derivative is still rendering (`pending`) or errored
	//    (`failed`) has no playable proxy. That must read as "no preview — here is
	//    why", never as a broken <video> element, and the row must NEVER be
	//    omitted: a reviewer approving footage has to see which clips could not be
	//    previewed.
	//  * Every numeric field is pydantic-DEFAULTED to 0 upstream, so 0 means "not
	//    probed". `0x0` / `0 fps` / `0.0s` printed as facts would be an affirmative
	//    false measurement, so a zero renders as "not probed" instead.
	//  * An unrecognised `preview_status` reads as NOT-recorded, never as healthy.
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { AlertTriangle, Film, Play, VideoOff } from '@lucide/svelte';
	import { formatFileSize } from '$lib/utils/format';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { isPresignExpired } from '$lib/utils/presign';
	import type { RendererProps } from './registry';
	import type { FootageProbeOutput, ProbedSource } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as FootageProbeOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;
	/** A probed measurement: defaulted-to-0 upstream, so only > 0 is a measurement. */
	const measured = (v: unknown): number | undefined => {
		const n = num(v);
		return n != null && n > 0 ? n : undefined;
	};

	// A stage output is JSONB from the wire: an array element may be null or a
	// scalar. The registry matcher only inspects sources[0], so a payload whose
	// SECOND element is null passes the matcher and then TypeErrors here — and
	// StageOutputView has no error boundary, so the whole panel would vanish.
	const isRec = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	const sources = $derived<ProbedSource[]>(
		Array.isArray(data.sources) ? (data.sources.filter(isRec) as ProbedSource[]) : []
	);
	// Soft-degradation channel: footage_probe writes an unreadable probe blob and
	// every `preview_status=failed` here. Rendered visibly, never behind a <details>.
	const notes = $derived<string[]>(
		Array.isArray(data.notes) ? data.notes.filter((n): n is string => str(n) != null) : []
	);

	// total_duration_s is authoritative when present; summing is the fallback for a
	// half-written payload so the header never reads "0s" on real footage.
	const totalSeconds = $derived(
		measured(data.total_duration_s) ??
			sources.reduce((acc, s) => acc + (measured(s.duration_s) ?? 0), 0)
	);
	const unpreviewable = $derived(
		sources.filter((s) => str(s.preview_status) !== 'ready' || !str(s.preview_url)).length
	);

	type StatusView = { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };
	// UNKNOWN must never read as HEALTHY: only the literal 'ready' earns the
	// success tone, everything else (including an absent field) is called out.
	//
	// ⚠️ `pending` DOES NOT MEAN "rendering".
	//
	// HISTORY, corrected 2026-08-23. This block used to assert that `preview_status`
	// was `pending` fleet-wide with NO producer — measured 2026-08-21 as 137 pending
	// rows and not one row ever reaching `ready` or `failed`. THAT IS NO LONGER TRUE.
	// The producer shipped: `w2v_orchestrator/src/lifecycle/preview_proxy.py` (PR #896,
	// 2026-08-23) transcodes each upload to an h264/≤720p/aac proxy, writes
	// `preview_key` and flips the row `pending -> ready | failed`. Measured in the
	// production DB on 2026-08-23: 144 ready / 1 failed / 0 pending, and a live run
	// renders ten playable tiles. So the `ready` branch below is the COMMON path, not
	// dead code — do not delete it, and do not delete `pending` or `failed` either:
	// `pending` is a source being transcoded right now, and `failed` is the durable
	// state after the worker exhausts its attempt cap.
	//
	// The `pending` LABEL still stays "no preview generated" rather than any word
	// implying work in progress. That was the original point and it survives the
	// producer existing: a label must describe what the reviewer HAS in front of
	// them, not what some component intends to do later.
	const statusOf = (s: ProbedSource): StatusView => {
		const raw = str(s.preview_status);
		if (raw === 'ready') return { label: 'preview ready', tone: 'success' };
		if (raw === 'pending') return { label: 'no preview generated', tone: 'warning' };
		if (raw === 'failed') return { label: 'preview failed', tone: 'danger' };
		return { label: raw ? `preview ${raw}` : 'preview status not recorded', tone: 'neutral' };
	};

	// scopedMediaUrl appends `?active_tenant=` by string concat, so it must run on
	// the bare url. "" (the "worker has not rendered it yet" sentinel) yields
	// undefined and the tile says why instead of requesting a 404.
	const previewSrc = (s: ProbedSource): string | undefined =>
		scopedMediaUrl(str(s.preview_url)) ?? undefined;

	// Presigned urls carry a ~1h TTL: a gate paused overnight has dead links, and a
	// black <video> reads as "bad footage" rather than "expired link".
	// Keyed by SOURCE id (stable across re-renders); index only as the fallback.
	const failKey = (s: ProbedSource, i: number): string => str(s.id) ?? `#${i}`;
	let failed = $state<Record<string, boolean>>({});
	const markExpired = (key: string) => {
		failed = { ...failed, [key]: true };
	};
	// `isPresignExpired` fails OPEN (unsigned/unparseable ⇒ false), so a parsing
	// miss can never hide a working preview — the <video> onerror still catches it.
	const isExpired = (s: ProbedSource, i: number, src: string): boolean =>
		failed[failKey(s, i)] === true || isPresignExpired(src);

	// Click-to-open, exactly as CutPlanTimeline does it: full playback bytes move
	// only when a reviewer clicks that specific tile.
	//
	// ⚠️ It used to be `preload="none"` with no poster, which measured badly in the
	// live browser proof on 2026-08-23: nine of ten tiles were IDENTICAL featureless
	// grey rectangles, so "review the footage" meant clicking ten boxes one at a
	// time to find out what each clip is. A review grid that shows nothing is not a
	// review grid.
	//
	// There is no poster/thumbnail object in storage (generating one is orchestrator
	// work), so the unopened tile paints its own: `preload="metadata"` plus a media
	// fragment `#t=<offset>`, which makes the browser seek to that timestamp and
	// paint the frame there. NOT `preload="auto"` — ten proxies at ~0.5-1.3 MB each
	// would be a multi-MB mount. metadata + a seek fetches the moov atom and the
	// range around the offset over HTTP range requests, not the whole file.
	//
	// A real `poster` object is the better end state (one decode server-side instead
	// of ten client seeks) and remains the thing to build; this needs no backend.
	let opened = $state<Record<string, boolean>>({});
	const openSource = (key: string) => {
		opened = { ...opened, [key]: true };
	};

	// 0.5s is the obvious offset and is the WRONG default: plenty of footage opens
	// on a fade-in or a black leader frame, which would paint the same grey box the
	// fragment exists to remove. 1s is far enough in to be picture on ordinary
	// footage. A short clip cannot be seeked to 1s, so it takes its own midpoint
	// (floored at 0.1s), and an unprobed duration (0 upstream ⇒ undefined here)
	// falls back to 0.5s because seeking past the end paints nothing at all.
	const posterOffset = (s: ProbedSource): number => {
		const d = measured(s.duration_s);
		if (d == null) return 0.5;
		return d >= 2 ? 1 : Math.max(0.1, Math.round((d / 2) * 100) / 100);
	};
	// The fragment goes on the UNOPENED tile only: the opened element plays from the
	// start, and `isExpired`/`isPresignExpired` keep parsing the bare url.
	const posterSrc = (s: ProbedSource, src: string): string => `${src}#t=${posterOffset(s)}`;

	const resolution = (s: ProbedSource): string | undefined => {
		const w = measured(s.width);
		const h = measured(s.height);
		return w != null && h != null ? `${w}×${h}` : undefined;
	};
</script>

<div class="space-y-3" data-testid="footage-probe-grid">
	<!-- Verdict strip — always before any source. -->
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
		data-testid="footage-probe-verdict"
	>
		<span class="inline-flex items-center gap-1.5 text-[var(--color-text)]">
			<Film class="h-3.5 w-3.5" />
			<span class="font-medium tabular-nums" data-testid="footage-probe-count"
				>{sources.length} sources</span
			>
		</span>
		<span class="inline-flex items-center gap-1" data-testid="footage-probe-total">
			<Duration seconds={totalSeconds} class="text-xs text-[var(--color-text)]" />
			<span>of footage</span>
		</span>
		{#if unpreviewable > 0}
			<span class="tabular-nums" data-testid="footage-probe-unpreviewable"
				>{unpreviewable} without a preview</span
			>
		{/if}
	</div>

	<!-- Index key: two identical note strings are a legal payload (they are appended
	     per source inside one loop) and a duplicate key is a Svelte 5 runtime error,
	     which on this boundary-less page blanks the whole output panel. -->
	{#each notes as note, i (i)}
		<p
			class="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
			data-testid="footage-probe-note"
		>
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
			<span>{note}</span>
		</p>
	{/each}

	<!-- One row per uploaded clip, in upload order. Keyed on `id` (the video_sources
	     row id) — NEVER on filename: two uploads may legally share a name, and a
	     duplicate key is a runtime error that would blank the panel. -->
	<ul class="space-y-2">
		{#each sources as source, i (str(source.id) ?? `#${i}`)}
			{@const st = statusOf(source)}
			{@const src = previewSrc(source)}
			{@const key = failKey(source, i)}
			{@const dur = measured(source.duration_s)}
			{@const res = resolution(source)}
			{@const fps = measured(source.fps)}
			{@const size = measured(source.bytes)}
			<li
				class="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
				data-testid="footage-probe-source"
				data-source-id={str(source.id) ?? undefined}
			>
				<div
					class="relative flex h-[72px] w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-strong)]"
				>
					{#if !src}
						<!-- No proxy to play. Say WHICH reason, never an empty/broken element. -->
						<span
							class="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-[var(--color-text-muted)]"
							data-testid="footage-probe-no-preview"
						>
							<VideoOff class="h-4 w-4" />
							no preview — {st.label}
						</span>
					{:else if isExpired(source, i, src)}
						<span
							class="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-[var(--color-danger-text)]"
							data-testid="footage-probe-preview-expired"
						>
							<VideoOff class="h-4 w-4" />
							preview link expired — re-run footage_probe
						</span>
					{:else if opened[key]}
						<video
							{src}
							preload="metadata"
							autoplay
							muted
							playsinline
							controls
							class="h-full w-full object-cover"
							data-testid="footage-probe-preview-video"
							data-loaded="true"
							onerror={() => markExpired(key)}
						>
							<track kind="captions" />
						</video>
					{:else}
						<button
							type="button"
							onclick={() => openSource(key)}
							class="group relative block h-full w-full"
							aria-label={`Load preview for ${str(source.filename) ?? `source ${i + 1}`}`}
							data-testid="footage-probe-preview-load"
						>
							<video
								src={posterSrc(source, src)}
								preload="metadata"
								muted
								playsinline
								class="h-full w-full object-cover"
								data-testid="footage-probe-preview-video"
								onerror={() => markExpired(key)}
							>
								<track kind="captions" />
							</video>
							<span
								class="absolute inset-0 flex items-center justify-center bg-black/15 group-hover:bg-black/25"
							>
								<span class="rounded-full bg-black/55 p-1.5 text-white"
									><Play class="h-4 w-4" /></span
								>
							</span>
						</button>
					{/if}
				</div>
				<div class="min-w-0 flex-1 space-y-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span
							class="truncate text-xs font-medium text-[var(--color-text)]"
							data-testid="footage-probe-filename"
							title={str(source.filename) ?? undefined}
							>{str(source.filename) ?? `Source ${i + 1}`}</span
						>
						<Pill tone={st.tone}><span data-testid="footage-probe-status">{st.label}</span></Pill>
					</div>
					<p
						class="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-muted)]"
						data-testid="footage-probe-meta"
					>
						<!-- Every measurement below is ffprobe on the UPLOADED MASTER, while the
					     tile beside it plays a transcoded proxy (h264 / ≤720p / aac). Unlabelled,
					     a reviewer reads "3840×2160 · hevc" next to a 720p h264 player and
					     concludes the numbers are wrong. They are not wrong, they describe a
					     different file — so say which file. -->
						<span
							class="text-[10px] uppercase tracking-wide"
							data-testid="footage-probe-meta-label"
							title="Measured from the uploaded source file; the tile plays a smaller preview proxy."
							>source file</span
						>
						{#if dur != null}
							<span class="inline-flex items-center gap-1"
								>· <Duration seconds={dur} class="text-xs" /></span
							>
						{:else}
							<span data-testid="footage-probe-no-duration">· duration not probed</span>
						{/if}
						<span
							>· {#if res}{res}{:else}<span data-testid="footage-probe-no-resolution"
									>resolution not probed</span
								>{/if}</span
						>
						{#if fps != null}<span class="tabular-nums"
								>· {fps.toFixed(2).replace(/\.?0+$/, '')} fps</span
							>{/if}
						{#if str(source.codec)}<span class="font-mono">· {source.codec}</span>{/if}
						{#if size != null}<span data-testid="footage-probe-size">· {formatFileSize(size)}</span
							>{/if}
					</p>
					{#if st.tone === 'danger'}
						<p
							class="flex items-start gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger-bg)] px-2 py-1 text-xs text-[var(--color-danger-text)]"
							data-testid="footage-probe-source-failed"
						>
							<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span
								><strong>Preview render failed</strong> — this clip cannot be reviewed here; the original
								upload is still usable by the reel.</span
							>
						</p>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</div>

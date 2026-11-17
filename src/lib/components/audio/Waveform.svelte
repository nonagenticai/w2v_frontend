<script lang="ts">
	// A wavesurfer-backed audio scrubber: the waveform doubles as the seek bar, so
	// the user can SEE the audio (silences, beats, where the take starts) rather
	// than guessing at a bare native scrub handle.
	//
	// wavesurfer streams through a media element, and the orchestrator's artifact
	// proxy honours HTTP Range (206 / Accept-Ranges), so seeking does not pull the
	// whole file down.
	import { browser } from '$app/environment';
	import WaveSurfer from 'wavesurfer.js';
	import { Play, Pause } from '@lucide/svelte';

	let {
		src,
		height = 56,
		title = ''
	}: { src?: string | null; height?: number; title?: string } = $props();

	let containerEl = $state<HTMLDivElement | null>(null);
	// The live instance. Deliberately NOT $state: nothing renders from it, and the
	// play/pause handler reads it imperatively.
	let ws: WaveSurfer | null = null;

	let playing = $state(false);
	let ready = $state(false);
	let failed = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);

	function fmt(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	// One effect owns the whole instance lifecycle. It READS `src` (and `height`,
	// and the container node), so Svelte re-runs it whenever any of them change —
	// and the cleanup below runs FIRST, destroying the old instance. That is what
	// makes selecting clip B safe: clip A's wavesurfer (and its media element, and
	// its audio) is torn down before B's is built, so B can never be heard playing
	// A's take, and switching clips repeatedly cannot stack instances.
	//
	// SSR: `$effect` only ever runs in the browser, but wavesurfer touches
	// `window`/`AudioContext` at construction, so the `browser` guard is kept
	// explicit (and matches `stores/auth.svelte.ts`).
	$effect(() => {
		const url = src;
		const el = containerEl;
		const h = height;
		if (!browser || !url || !el) return;

		playing = false;
		ready = false;
		failed = false;
		currentTime = 0;
		duration = 0;

		const instance = WaveSurfer.create({
			container: el,
			url,
			height: h,
			// Literal colors: these are painted into a canvas, where a `var(--…)`
			// token would not resolve. Chosen to read in both themes.
			waveColor: '#b8c2d6',
			progressColor: '#f7661f',
			cursorColor: '#7f8aa3',
			barWidth: 2,
			barGap: 1,
			barRadius: 2,
			normalize: true
		});
		ws = instance;

		instance.on('ready', (d: number) => {
			ready = true;
			duration = d;
		});
		instance.on('timeupdate', (t: number) => (currentTime = t));
		instance.on('play', () => (playing = true));
		instance.on('pause', () => (playing = false));
		instance.on('finish', () => (playing = false));
		instance.on('error', () => {
			failed = true;
			ready = false;
		});

		return () => {
			try {
				instance.destroy();
			} catch {
				// destroy() can throw if the media fetch is still in flight; the
				// instance is gone either way.
			}
			if (ws === instance) ws = null;
		};
	});

	function togglePlay() {
		ws?.playPause();
	}
</script>

<div class="w-full" data-testid="waveform">
	{#if title}
		<p class="mb-1.5 text-sm font-medium text-[var(--color-text)]">{title}</p>
	{/if}

	{#if src}
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={togglePlay}
				disabled={!ready}
				aria-label={playing ? 'Pause' : 'Play'}
				data-testid="waveform-play"
				class="shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-1.5 text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-50"
			>
				{#if playing}
					<Pause class="h-4 w-4" />
				{:else}
					<Play class="h-4 w-4" />
				{/if}
			</button>
			<div
				bind:this={containerEl}
				class="min-w-0 flex-1 overflow-hidden rounded-[var(--radius-md)]"
				data-testid="waveform-canvas"
			></div>
			<span
				class="shrink-0 font-mono text-xs text-[var(--color-text-muted)]"
				data-testid="waveform-time"
			>
				{fmt(currentTime)} / {fmt(duration)}
			</span>
		</div>
		{#if failed}
			<p class="mt-1 text-xs text-[var(--color-danger)]" data-testid="waveform-error">
				Could not load that audio.
			</p>
		{/if}
	{:else}
		<p class="text-xs text-[var(--color-text-muted)]" data-testid="waveform-empty">
			No audio to play.
		</p>
	{/if}
</div>

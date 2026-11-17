<script lang="ts">
	import { formatTimestamp } from '$lib/utils/format.js';
	import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, LoaderCircle } from '@lucide/svelte';

	let {
		src,
		poster,
		title,
		onTimeUpdate,
		onLoadedMetadata
	}: {
		src: string;
		poster?: string;
		title?: string;
		onTimeUpdate?: (time: number) => void;
		onLoadedMetadata?: (duration: number) => void;
	} = $props();

	let videoEl: HTMLVideoElement | undefined = $state();
	let playing = $state(false);
	let muted = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let isFullscreen = $state(false);
	let showControls = $state(true);
	let loadError: string | null = $state(null);
	// Loading / stalled feedback. The error path (onerror → loadError) only covers
	// sources that actively fail; a slow or hung fetch (e.g. a large file behind
	// the artifact proxy, or expired media that never returns) left the element a
	// silent black box. `loading` shows a spinner while metadata is in flight;
	// `stalled` converts an indefinite wait into an explanation after a timeout.
	let loading = $state(true);
	let stalled = $state(false);
	let stallTimeout: ReturnType<typeof setTimeout> | undefined;
	const STALL_MS = 20000;

	// (Re)arm the stall watchdog whenever the source changes. The `if (!src)`
	// guard reads `src`, so the effect re-runs on a new source (not on playback
	// state). The timeout callback runs outside reactive tracking, so reading
	// `loading`/`duration` there is safe.
	$effect(() => {
		loading = true;
		stalled = false;
		loadError = null;
		if (stallTimeout) clearTimeout(stallTimeout);
		if (!src) return;
		stallTimeout = setTimeout(() => {
			if (loading && !loadError && duration === 0) stalled = true;
		}, STALL_MS);
		return () => {
			if (stallTimeout) clearTimeout(stallTimeout);
		};
	});

	function clearLoading() {
		loading = false;
		stalled = false;
		if (stallTimeout) clearTimeout(stallTimeout);
	}

	let hideTimeout: ReturnType<typeof setTimeout> | undefined;
	let containerEl: HTMLDivElement | undefined = $state();
	let progressBarEl: HTMLDivElement | undefined = $state();
	let isSeeking = $state(false);
	let hoverTime: number | null = $state(null);
	let hoverX = $state(0);

	let progress = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
	let buffered = $derived.by(() => {
		if (!videoEl || videoEl.buffered.length === 0) return 0;
		return (videoEl.buffered.end(videoEl.buffered.length - 1) / duration) * 100;
	});

	export function seekTo(time: number) {
		if (videoEl) videoEl.currentTime = time;
	}

	/**
	 * Capture the current video frame as a PNG blob, for the thumbnail picker.
	 * Returns null if the frame can't be drawn (no metadata yet) or the canvas
	 * is tainted (cross-origin source without CORS — the artifact proxy serves
	 * the video same-origin, so this normally succeeds; callers fall back to a
	 * file upload on null).
	 */
	export function captureFrame(): Promise<Blob | null> {
		return new Promise((resolve) => {
			if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
				resolve(null);
				return;
			}
			try {
				const canvas = document.createElement('canvas');
				canvas.width = videoEl.videoWidth;
				canvas.height = videoEl.videoHeight;
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					resolve(null);
					return;
				}
				ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
				canvas.toBlob((blob) => resolve(blob), 'image/png');
			} catch {
				resolve(null); // tainted canvas (cross-origin) → caller uploads instead
			}
		});
	}

	function togglePlay() {
		if (!videoEl) return;
		if (videoEl.paused) {
			videoEl.play();
		} else {
			videoEl.pause();
		}
	}

	function toggleMute() {
		if (!videoEl) return;
		videoEl.muted = !videoEl.muted;
		muted = videoEl.muted;
	}

	function handleVolumeChange(e: Event) {
		if (!videoEl) return;
		const val = parseFloat((e.target as HTMLInputElement).value);
		volume = val;
		videoEl.volume = val;
		if (val === 0) {
			videoEl.muted = true;
			muted = true;
		} else if (muted) {
			videoEl.muted = false;
			muted = false;
		}
	}

	function handleTimeUpdate() {
		if (!videoEl || isSeeking) return;
		currentTime = videoEl.currentTime;
		onTimeUpdate?.(currentTime);
	}

	function handleLoadedMetadata() {
		if (!videoEl) return;
		duration = videoEl.duration;
		loadError = null;
		clearLoading();
		onLoadedMetadata?.(duration);
	}

	function handleVideoError() {
		loadError = 'Video unavailable for this job. Re-run the pipeline to regenerate it.';
		clearLoading();
	}

	// Buffering signals. `waiting`/`stalled` while not yet loaded → keep the
	// spinner; `canplay`/`playing` → the media is usable, clear it.
	function handleWaiting() {
		if (duration === 0) loading = true;
	}

	function handleCanPlay() {
		clearLoading();
	}

	function seekFromClientX(clientX: number) {
		if (!videoEl || !progressBarEl) return;
		const rect = progressBarEl.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		const newTime = pct * duration;
		currentTime = newTime;
		videoEl.currentTime = newTime;
	}

	function handleSeekStart(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		isSeeking = true;
		seekFromClientX(e.clientX);
		window.addEventListener('mousemove', handleSeekMove);
		window.addEventListener('mouseup', handleSeekEnd);
	}

	function handleSeekMove(e: MouseEvent) {
		if (!isSeeking) return;
		seekFromClientX(e.clientX);
	}

	function handleSeekEnd() {
		isSeeking = false;
		window.removeEventListener('mousemove', handleSeekMove);
		window.removeEventListener('mouseup', handleSeekEnd);
	}

	function handleTouchStart(e: TouchEvent) {
		if (!e.touches[0]) return;
		e.stopPropagation();
		isSeeking = true;
		seekFromClientX(e.touches[0].clientX);
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isSeeking || !e.touches[0]) return;
		e.preventDefault();
		seekFromClientX(e.touches[0].clientX);
	}

	function handleTouchEnd() {
		isSeeking = false;
	}

	function handleProgressHover(e: MouseEvent) {
		if (!progressBarEl) return;
		const rect = progressBarEl.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		hoverTime = pct * duration;
		hoverX = e.clientX - rect.left;
	}

	function handleProgressLeave() {
		hoverTime = null;
	}

	function handleFullscreen() {
		if (!containerEl) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			containerEl.requestFullscreen();
		}
	}

	function handleFullscreenChange() {
		isFullscreen = !!document.fullscreenElement;
	}

	function handleMouseMove() {
		showControls = true;
		if (hideTimeout) clearTimeout(hideTimeout);
		if (playing) {
			hideTimeout = setTimeout(() => {
				showControls = false;
			}, 3000);
		}
	}

	function handleMouseLeave() {
		if (playing) {
			hideTimeout = setTimeout(() => {
				showControls = false;
			}, 1000);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		// Ignore if focus is on an interactive child (e.g. volume slider)
		const tag = (e.target as HTMLElement).tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		switch (e.key) {
			case ' ':
				e.preventDefault();
				togglePlay();
				break;
			case 'ArrowLeft':
				e.preventDefault();
				if (videoEl) videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
				break;
			case 'ArrowRight':
				e.preventDefault();
				if (videoEl) videoEl.currentTime = Math.min(duration, videoEl.currentTime + 5);
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (videoEl) {
					const newVol = Math.min(1, volume + 0.05);
					volume = newVol;
					videoEl.volume = newVol;
					if (muted && newVol > 0) {
						videoEl.muted = false;
						muted = false;
					}
				}
				break;
			case 'ArrowDown':
				e.preventDefault();
				if (videoEl) {
					const newVol = Math.max(0, volume - 0.05);
					volume = newVol;
					videoEl.volume = newVol;
					if (newVol === 0) {
						videoEl.muted = true;
						muted = true;
					}
				}
				break;
			case 'm':
			case 'M':
				e.preventDefault();
				toggleMute();
				break;
			case 'f':
			case 'F':
				e.preventDefault();
				handleFullscreen();
				break;
		}
	}
</script>

<svelte:document onfullscreenchange={handleFullscreenChange} />

<div class="w-full max-w-5xl mx-auto">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={containerEl}
		class="relative bg-black rounded-xl overflow-hidden group focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2"
		role="region"
		aria-label={title ? `Video player: ${title}` : 'Video player'}
		tabindex="0"
		onkeydown={handleKeydown}
		onmousemove={handleMouseMove}
		onmouseleave={handleMouseLeave}
	>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			{src}
			{poster}
			onplay={() => (playing = true)}
			onpause={() => {
				playing = false;
				showControls = true;
			}}
			ontimeupdate={handleTimeUpdate}
			onloadedmetadata={handleLoadedMetadata}
			onerror={handleVideoError}
			onwaiting={handleWaiting}
			onstalled={handleWaiting}
			oncanplay={handleCanPlay}
			onclick={togglePlay}
			class="w-full aspect-video cursor-pointer"
			preload="metadata"
		></video>

		{#if loadError}
			<div class="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
				<p class="text-sm text-text max-w-md">{loadError}</p>
			</div>
		{:else if stalled}
			<!-- Loaded for a while with no metadata and no error: the media is slow or
			     no longer available. Explain instead of showing an endless black box. -->
			<div class="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
				<p class="text-sm text-text max-w-md">
					This is taking longer than expected — the video may be slow to load or no longer
					available. Try re-running the pipeline to regenerate it.
				</p>
			</div>
		{:else if loading}
			<!-- Metadata still in flight: a spinner beats a blank black frame. -->
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/40"
				aria-live="polite"
				aria-busy="true"
			>
				<LoaderCircle class="h-10 w-10 animate-spin text-white/80" />
				<span class="sr-only">Loading video…</span>
			</div>
		{/if}

		<!-- Play overlay when paused -->
		{#if !playing && duration > 0}
			<button
				type="button"
				onclick={togglePlay}
				class="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity"
				aria-label="Play video"
			>
				<div
					class="h-16 w-16 rounded-full bg-surface/90 flex items-center justify-center shadow-lg"
				>
					<Play class="h-7 w-7 text-primary-400 ml-1" />
				</div>
			</button>
		{/if}

		<!-- Controls overlay -->
		<div
			class="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-10 transition-opacity duration-300
        {showControls || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
		>
			<!-- Progress bar -->
			<div
				bind:this={progressBarEl}
				role="slider"
				aria-label="Seek video position"
				aria-valuemin={0}
				aria-valuemax={Math.round(duration)}
				aria-valuenow={Math.round(currentTime)}
				aria-valuetext={formatTimestamp(currentTime)}
				tabindex="0"
				class="w-full cursor-pointer relative group/seek select-none touch-none py-2 mb-1"
				onmousedown={handleSeekStart}
				ontouchstart={handleTouchStart}
				ontouchmove={handleTouchMove}
				ontouchend={handleTouchEnd}
				onmousemove={handleProgressHover}
				onmouseleave={handleProgressLeave}
			>
				<!-- Visual track -->
				<div class="h-1.5 rounded-full bg-surface-raised/50 relative">
					<!-- Buffered -->
					<div
						class="absolute inset-y-0 left-0 bg-surface/30 rounded-full pointer-events-none"
						style="width: {buffered}%"
					></div>
					<!-- Progress -->
					<div
						class="absolute inset-y-0 left-0 bg-primary-400 rounded-full pointer-events-none"
						class:transition-[width]={!isSeeking}
						class:duration-100={!isSeeking}
						style="width: {progress}%"
					></div>
					<!-- Scrubber dot -->
					<div
						class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md pointer-events-none transition-opacity
              {isSeeking ? 'opacity-100' : 'opacity-0 group-hover/seek:opacity-100'}"
						style="left: {progress}%"
					></div>
				</div>
				<!-- Hover time tooltip -->
				{#if hoverTime !== null && !isSeeking}
					<div
						class="absolute bottom-full mb-2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-white text-xs font-mono tabular-nums whitespace-nowrap pointer-events-none"
						style="left: {hoverX}px"
					>
						{formatTimestamp(hoverTime)}
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-3">
				<button
					type="button"
					onclick={togglePlay}
					class="text-text hover:text-primary-300 transition-colors"
					aria-label={playing ? 'Pause' : 'Play'}
				>
					{#if playing}
						<Pause class="h-5 w-5" />
					{:else}
						<Play class="h-5 w-5" />
					{/if}
				</button>

				<!-- Volume -->
				<div class="flex items-center gap-1.5 group/vol">
					<button
						type="button"
						onclick={toggleMute}
						class="text-text hover:text-primary-300 transition-colors"
						aria-label={muted ? 'Unmute' : 'Mute'}
					>
						{#if muted || volume === 0}
							<VolumeX class="h-5 w-5" />
						{:else}
							<Volume2 class="h-5 w-5" />
						{/if}
					</button>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={muted ? 0 : volume}
						oninput={handleVolumeChange}
						class="w-0 group-hover/vol:w-20 transition-all duration-200 accent-primary-400 h-1 cursor-pointer opacity-0 group-hover/vol:opacity-100"
						aria-label="Volume"
					/>
				</div>

				<span class="text-xs text-text-secondary font-mono tabular-nums">
					{formatTimestamp(currentTime)} / {formatTimestamp(duration)}
				</span>

				<div class="flex-1"></div>

				<button
					type="button"
					onclick={handleFullscreen}
					class="text-text hover:text-primary-300 transition-colors"
					aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
				>
					{#if isFullscreen}
						<Minimize class="h-5 w-5" />
					{:else}
						<Maximize class="h-5 w-5" />
					{/if}
				</button>
			</div>
		</div>
	</div>

	<!-- Title below video -->
	{#if title}
		<div class="mt-3">
			<p class="text-sm font-medium text-text truncate">{title}</p>
		</div>
	{/if}
</div>

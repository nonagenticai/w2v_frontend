<script lang="ts">
	let {
		src,
		title = '',
		preload = 'metadata'
	}: { src: string; title?: string; preload?: 'none' | 'metadata' | 'auto' } = $props();
</script>

<div class="w-full">
	{#if title}
		<p class="mb-1.5 text-sm font-medium text-text">{title}</p>
	{/if}
	{#if src}
		<!-- Native controls: reliable cross-browser seek/volume/speed for audio. -->
		<audio class="w-full" controls {preload} {src} data-testid="audio-player">
			<track kind="captions" />
			Your browser does not support the audio element.
		</audio>
	{:else}
		<p class="text-sm text-text-muted">No audio source available.</p>
	{/if}
</div>

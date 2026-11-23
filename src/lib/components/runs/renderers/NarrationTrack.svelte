<script lang="ts">
	// Narration clips (*NarrateOutput.clips → {line_id, artifact_url, seconds};
	// audiobook adds voice_id/speaker/speed) → a stacked list of playable audio
	// rows, each tied to its line so a marketer can hear the voiceover per line.
	import AudioPlayer from '$lib/components/audio/AudioPlayer.svelte';
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { Volume2 } from '@lucide/svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { RendererProps } from './registry';
	import type { NarrationOutput, NarrationClip } from './stage-outputs';

	let { output }: RendererProps = $props();

	type Clip = NarrationClip;
	const data = $derived(output as unknown as NarrationOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const clips = $derived<Clip[]>(Array.isArray(data.clips) ? data.clips : []);
	const totalSeconds = $derived(clips.reduce((acc, c) => acc + (num(c.seconds) ?? 0), 0));
	// scopedMediaUrl: the clip is streamed back by our own /api/runs/.../artifact/...
	// and <audio> is fetched by the browser, which can't carry X-Active-Tenant-Id —
	// so a super-admin browsing another tenant needs it in the query string instead.
	const clipSrc = (c: Clip): string | null | undefined => scopedMediaUrl(str(c.artifact_url));
	const label = (c: Clip, i: number): string => {
		const lid = str(c.line_id) ?? str(c.chunk_id);
		return lid ? `Line ${lid.slice(0, 6)}` : `Clip ${i + 1}`;
	};
</script>

<div class="space-y-2" data-testid="narration-track">
	{#if totalSeconds > 0}
		<div class="flex items-center gap-1.5 text-[var(--color-text-muted)] text-xs">
			<Volume2 class="h-3.5 w-3.5" />
			<span>{clips.length} clips · <Duration seconds={totalSeconds} /> total</span>
		</div>
	{/if}
	<ul class="space-y-2">
		{#each clips as clip, i (str(clip.id) ?? i)}
			{@const src = clipSrc(clip)}
			<li
				class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
				data-testid="narration-clip"
				data-line-id={str(clip.line_id) ?? undefined}
			>
				<div class="flex items-center justify-between gap-2 mb-1">
					<span class="text-xs font-medium text-[var(--color-text)] tabular-nums">
						{label(clip, i)}
					</span>
					<span class="flex items-center gap-1.5">
						{#if str(clip.voice_id)}<Pill tone="neutral">{clip.voice_id}</Pill>{/if}
						{#if str(clip.speaker)}<span class="text-xs text-[var(--color-text-muted)]">
								{clip.speaker}
							</span>{/if}
						{#if num(clip.speed)}<span class="text-xs text-[var(--color-text-muted)]">
								{clip.speed}×
							</span>{/if}
						{#if num(clip.seconds)}<Duration seconds={num(clip.seconds)} class="text-xs" />{/if}
					</span>
				</div>
				{#if src}
					<AudioPlayer {src} preload="none" />
				{:else}
					<p class="text-xs text-[var(--color-text-muted)]">No audio rendered.</p>
				{/if}
			</li>
		{/each}
	</ul>
</div>

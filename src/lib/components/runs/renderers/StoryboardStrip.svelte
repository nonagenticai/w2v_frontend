<script lang="ts">
	// Storyboard (PromoStoryboardOutput.shots[]{line_id, description, seconds,
	// visual_style, visual_type}) → a horizontal film-strip of shot cards, each
	// badged with what it'll be made of (footage / slide / html / ai_image).
	import Duration from './_shared/Duration.svelte';
	import LineChip from './_shared/LineChip.svelte';
	import { Pill } from '$lib/components/ui';
	import { Film, LayoutTemplate, Code2, Sparkles, Image as ImageIcon } from '@lucide/svelte';
	import type { RendererProps } from './registry';
	import type { StoryboardOutput, StoryboardShot } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as StoryboardOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const shots = $derived<StoryboardShot[]>(Array.isArray(data.shots) ? data.shots : []);
	const icon = (t?: string) =>
		t === 'footage'
			? Film
			: t === 'slide'
				? LayoutTemplate
				: t === 'html'
					? Code2
					: t === 'ai_image'
						? Sparkles
						: ImageIcon;
</script>

<div class="flex gap-3 overflow-x-auto pb-2 snap-x" data-testid="storyboard-strip">
	{#each shots as shot, i (str(shot.id) ?? i)}
		{@const Icon = icon(str(shot.visual_type))}
		<div
			class="w-56 shrink-0 snap-start rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2"
			data-line-id={str(shot.line_id) ?? undefined}
		>
			<div class="flex items-center justify-between gap-2">
				<span class="inline-flex items-center gap-1.5 text-[var(--color-accent)]">
					<Icon class="h-4 w-4" />
					<span class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
						{str(shot.visual_type) ?? 'shot'}
					</span>
				</span>
				<span class="text-[10px] tabular-nums text-[var(--color-text-muted)]">#{i + 1}</span>
			</div>
			{#if str(shot.description)}
				<p class="text-sm text-[var(--color-text)] line-clamp-3">{shot.description}</p>
			{/if}
			<div class="flex flex-wrap items-center gap-1.5">
				{#if str(shot.line_id)}<LineChip lineId={str(shot.line_id)} />{/if}
				{#if str(shot.visual_style)}<Pill tone="neutral">{shot.visual_style}</Pill>{/if}
				{#if num(shot.seconds)}<Duration seconds={num(shot.seconds)} class="text-xs" />{/if}
			</div>
		</div>
	{/each}
</div>

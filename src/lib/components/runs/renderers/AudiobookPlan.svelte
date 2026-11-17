<script lang="ts">
	// Audiobook production plan (ingest chapters[], plan chunks[], cast
	// {casting[], performances[]}) → a chapter list, a chunk summary and a
	// character→voice casting table.
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import { BookOpen, Mic } from '@lucide/svelte';
	import type { RendererProps } from './registry';
	import type { AudiobookPlanOutput } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as AudiobookPlanOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;
	const arr = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

	const chapters = $derived(arr(data.chapters));
	const chunks = $derived(arr(data.chunks));
	const casting = $derived(arr(data.casting));
	const totalSeconds = $derived(chunks.reduce((a, c) => a + (num(c.seconds) ?? 0), 0));
</script>

<div class="space-y-4" data-testid="audiobook-plan">
	{#if chapters.length}
		<div class="space-y-1.5">
			<p class="inline-flex items-center gap-1.5 text-kicker text-[var(--color-text-muted)]">
				<BookOpen class="h-3.5 w-3.5" /> Chapters ({chapters.length})
			</p>
			<ol class="space-y-1">
				{#each chapters as ch, i (str(ch.id) ?? i)}
					<li
						class="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
					>
						<span class="text-[var(--color-text)]"
							><span class="text-[var(--color-text-muted)] tabular-nums mr-1.5">{i + 1}.</span>{str(
								ch.title
							) ?? 'Chapter'}</span
						>
						{#if str(ch.page_range)}<span class="text-xs text-[var(--color-text-muted)]"
								>{ch.page_range}</span
							>{/if}
					</li>
				{/each}
			</ol>
		</div>
	{/if}

	{#if chunks.length}
		<p class="text-sm text-[var(--color-text-muted)]">
			{chunks.length} narration chunks{#if totalSeconds > 0}
				· <Duration seconds={totalSeconds} /> planned{/if}
		</p>
	{/if}

	{#if casting.length}
		<div class="space-y-1.5">
			<p class="inline-flex items-center gap-1.5 text-kicker text-[var(--color-text-muted)]">
				<Mic class="h-3.5 w-3.5" /> Casting
			</p>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">
				{#each casting as c, i (i)}
					<div
						class="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
					>
						<span class="text-[var(--color-text)]">{str(c.speaker) ?? 'Narrator'}</span>
						{#if str(c.voice_id)}<Pill tone="accent">{c.voice_id}</Pill>{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

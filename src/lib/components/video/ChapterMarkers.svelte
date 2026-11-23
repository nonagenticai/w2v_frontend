<script lang="ts">
	import type { StorylineChapter } from '$lib/types';
	import { formatTimestamp } from '$lib/utils/format.js';
	import { withUniqueKeys } from '$lib/utils/unique-keys.js';
	import { ListVideo } from '@lucide/svelte';

	let {
		chapters,
		currentTime = 0,
		onSeek
	}: {
		chapters: StorylineChapter[];
		currentTime?: number;
		onSeek?: (time: number) => void;
	} = $props();

	// Compute cumulative start times -- use actual timestamps when available
	const chapterStarts = $derived.by(() => {
		// If actual timestamps are available (from compilation), use them
		if (chapters.length > 0 && chapters[0].start_seconds !== undefined) {
			return chapters.map((ch) => ch.start_seconds!);
		}
		// Fallback to cumulative estimates
		const starts: number[] = [];
		let cumulative = 0;
		for (const ch of chapters) {
			starts.push(cumulative);
			cumulative += ch.estimated_duration_seconds ?? 0;
		}
		return starts;
	});

	// `number` is the chapter's identity when it has one, but not every producer
	// numbers its chapters (demo_video's `final_critique` emits `{start, title}`
	// only, so every row keyed as `undefined` and the duplicate key blanked the
	// whole run page). Dedupe so a numberless — or repeat-numbered — list still
	// renders, keyed.
	const rows = $derived(withUniqueKeys(chapters, (ch) => ch.number));

	// Active chapter index
	const activeIndex = $derived.by(() => {
		for (let i = chapterStarts.length - 1; i >= 0; i--) {
			if (currentTime >= chapterStarts[i]) return i;
		}
		return 0;
	});
</script>

<div class="space-y-1.5">
	{#each rows as { item: chapter, index: i, key } (key)}
		{@const startTime = chapterStarts[i]}
		{@const isActive = i === activeIndex}
		{@const isSub = (chapter.level ?? 0) === 1}
		<button
			type="button"
			onclick={() => onSeek?.(startTime)}
			class="w-full flex items-center gap-3 py-2.5 rounded-lg text-left transition-all border
        {isSub ? 'pl-8 pr-3' : 'px-3'}
        {isActive
				? 'bg-primary-500/10 border-primary-500/30 shadow-sm'
				: 'bg-surface border-border hover:border-border-hover hover:bg-surface-raised'}"
		>
			<!-- Chapter number badge (sub-chapters get a smaller, muted glyph badge) -->
			{#if isSub}
				<span
					class="flex items-center justify-center h-5 w-5 text-xs shrink-0 {isActive
						? 'text-primary-400'
						: 'text-text-muted'}"
					aria-hidden="true"
				>
					↳
				</span>
			{:else}
				<span
					class="flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold shrink-0
        {isActive ? 'bg-primary-500 text-text-on-primary' : 'bg-surface-raised text-text-muted'}"
				>
					{chapter.number ?? i + 1}
				</span>
			{/if}

			<div class="flex-1 min-w-0">
				<p class="text-sm font-medium truncate {isActive ? 'text-primary-400' : 'text-text'}">
					{chapter.title}
				</p>
				{#if chapter.subtitle}
					<p class="text-xs truncate {isActive ? 'text-primary-400/70' : 'text-text-muted'}">
						{chapter.subtitle}
					</p>
				{/if}
			</div>

			<!-- Timestamp -->
			<span
				class="text-xs font-mono shrink-0 tabular-nums {isActive
					? 'text-primary-400'
					: 'text-text-muted'}"
			>
				{formatTimestamp(startTime)}
			</span>
		</button>
	{/each}

	{#if chapters.length === 0}
		<div class="flex flex-col items-center gap-2 py-6 text-text-muted">
			<ListVideo class="h-8 w-8" />
			<p class="text-sm">No chapters available</p>
		</div>
	{/if}
</div>

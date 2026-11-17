<script lang="ts">
	// Script / narration backbone (PromoScriptOutput.lines, LessonScriptOutput
	// .paragraphs, demo gen lines) → a two-speaker chat transcript. Speaker "a"
	// reads left (accent bubble), "b" right; single-speaker scripts stack left.
	// Each bubble is line-addressable for cross-stage hover-sync.
	import Duration from './_shared/Duration.svelte';
	import { Pill } from '$lib/components/ui';
	import type { RendererProps } from './registry';
	import type { ScriptOutput, ScriptLine } from './stage-outputs';

	let { output, dense = false }: RendererProps = $props();

	const data = $derived(output as unknown as ScriptOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const num = (v: unknown): number | undefined =>
		typeof v === 'number' && Number.isFinite(v) ? v : undefined;

	const lines = $derived<ScriptLine[]>(
		Array.isArray(data.lines) ? data.lines : Array.isArray(data.paragraphs) ? data.paragraphs : []
	);
	const objective = $derived(str(data.learning_objective));
	const totalSeconds = $derived(
		num(data.total_seconds) ?? lines.reduce((acc, l) => acc + (num(l.seconds) ?? 0), 0)
	);
	const hasTwoSpeakers = $derived(lines.some((l) => str(l.speaker)));
</script>

<div class="space-y-3" data-testid="script-dialogue">
	{#if objective || totalSeconds > 0}
		<div class="flex flex-wrap items-center gap-2">
			{#if totalSeconds > 0}
				<Pill tone="accent"><Duration seconds={totalSeconds} /> runtime</Pill>
			{/if}
			{#if objective}
				<span class="text-kicker text-[var(--color-secondary)]">{objective}</span>
			{/if}
		</div>
	{/if}

	<ol class="space-y-2">
		{#each lines as line, i (str(line.id) ?? i)}
			{@const speaker = str(line.speaker)}
			{@const text = str(line.text) ?? ''}
			{@const seconds = num(line.seconds)}
			{@const right = speaker === 'b'}
			<li
				class="flex {right ? 'justify-end' : 'justify-start'}"
				data-testid="script-bubble"
				data-line-id={str(line.id) ?? str(line.line_id) ?? undefined}
			>
				<div
					class="max-w-[85%] rounded-[var(--radius-lg)] border px-3 py-2 {right
						? 'bg-[var(--color-surface)] border-[var(--color-border)]'
						: 'bg-[var(--color-accent-bg)] border-[var(--color-accent-border)]'}"
				>
					<div class="flex items-center gap-2 mb-0.5 text-[var(--color-text-muted)]">
						<span class="text-[10px] uppercase tracking-wide tabular-nums">
							{#if hasTwoSpeakers && speaker}Speaker {speaker.toUpperCase()}{:else}Line {i + 1}{/if}
						</span>
						{#if seconds != null}<Duration {seconds} class="text-[10px]" />{/if}
					</div>
					<p class="text-sm leading-relaxed text-[var(--color-text)] {dense ? 'line-clamp-3' : ''}">
						{text}
					</p>
				</div>
			</li>
		{/each}
	</ol>
</div>

<script lang="ts">
	// Structured LLM text that would otherwise become a <dl>: analysis
	// (pain_points, hooks, tonal_guidance) and image prompts
	// (prompts[]{line_id, prompt_text}). Renders labelled sections + chip lists.
	import LineChip from './_shared/LineChip.svelte';
	import Markdown from './_shared/Markdown.svelte';
	import type { RendererProps } from './registry';
	import type { TextInsightOutput, TextInsightPrompt } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as TextInsightOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const strList = (v: unknown): string[] =>
		Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

	const painPoints = $derived(strList(data.pain_points));
	const hooks = $derived(strList(data.hooks));
	const tonal = $derived(str(data.tonal_guidance));
	const prompts = $derived<TextInsightPrompt[]>(Array.isArray(data.prompts) ? data.prompts : []);
</script>

<div class="space-y-4" data-testid="text-insight">
	{#if painPoints.length}
		<div class="space-y-1">
			<p class="text-kicker text-[var(--color-text-muted)]">Pain points</p>
			<ul class="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-text)]">
				{#each painPoints as p, i (i)}<li>{p}</li>{/each}
			</ul>
		</div>
	{/if}
	{#if hooks.length}
		<div class="space-y-1">
			<p class="text-kicker text-[var(--color-text-muted)]">Hooks</p>
			<ul class="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-text)]">
				{#each hooks as h, i (i)}<li>{h}</li>{/each}
			</ul>
		</div>
	{/if}
	{#if tonal}
		<div class="space-y-1">
			<p class="text-kicker text-[var(--color-text-muted)]">Tone</p>
			<Markdown text={tonal} />
		</div>
	{/if}
	{#if prompts.length}
		<div class="space-y-1.5">
			<p class="text-kicker text-[var(--color-text-muted)]">Image prompts</p>
			<ul class="space-y-1.5">
				{#each prompts as p, i (i)}
					<li
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
					>
						{#if str(p.line_id)}<LineChip lineId={str(p.line_id)} class="mr-2" />{/if}
						<span class="text-[var(--color-text)]">{str(p.prompt_text) ?? str(p.text) ?? ''}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

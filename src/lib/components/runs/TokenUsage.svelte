<script lang="ts">
	// Token figures (input / output / total) for a run or one stage, shown next
	// to cost. Renders nothing when no usage was recorded.
	import type { RunUsageTotal } from '$lib/types/runs';
	import {
		formatTokenCount,
		formatTokenCountFull,
		noChargeNote,
		summarizeUsage
	} from '$lib/utils/usage';

	let {
		usage,
		stage = undefined,
		testid = 'run-tokens',
		class: className = ''
	}: {
		usage: RunUsageTotal | null | undefined;
		/** Restrict to one stage's `by_stage` rows. */
		stage?: string;
		/** Prefix for the testids: `<testid>`, `-input`, `-output`, `-total`, `-note`. */
		testid?: string;
		class?: string;
	} = $props();

	const summary = $derived(summarizeUsage(usage, stage));
	const note = $derived(noChargeNote(summary));
</script>

{#if summary}
	<div data-testid={testid} class="text-xs text-[var(--color-text-muted)] {className}">
		<p
			title={`${formatTokenCountFull(summary.input)} input + ${formatTokenCountFull(summary.output)} output = ${formatTokenCountFull(summary.total)} tokens`}
		>
			<span data-testid="{testid}-total" class="font-medium text-[var(--color-text)]">
				{formatTokenCount(summary.total)} tokens
			</span>
			<span aria-hidden="true"> · </span>
			<span data-testid="{testid}-input">{formatTokenCount(summary.input)} in</span>
			<span aria-hidden="true"> / </span>
			<span data-testid="{testid}-output">{formatTokenCount(summary.output)} out</span>
		</p>
		{#if note}
			<p data-testid="{testid}-note" class="mt-0.5">{note}</p>
		{/if}
	</div>
{/if}

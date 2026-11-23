<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- stageHref returns a caller-resolved internal route. */
	import { AlertTriangle, Info } from '@lucide/svelte';
	import { safeHref } from '$lib/utils/safe-url';
	import {
		degradationCodeTitle,
		extractRunAdvisories,
		extractRunWarnings,
		type WarningSourceStage
	} from '$lib/utils/run-warnings';

	// The "Completed with warnings" badge used to be the ONLY trace of a degraded
	// run: every stage response carries `degraded` / `degradation_codes` /
	// `output.degradations[]` / `output.notes`, and nothing rendered them. This
	// panel lists them per stage. Self-gates: renders nothing when there are none.
	//
	// It is NOT completed-only. A stage degrades the moment it completes, so a run
	// paused at a review gate (or one that later failed) already carries warnings
	// the reviewer needs BEFORE approving paid downstream work. `runStatus` only
	// changes the heading. `output.advisories` — the non-degrading tier — renders
	// as a separate, lower-severity "Notes" list.
	let {
		stages,
		runDegraded = false,
		runStatus = 'completed',
		onselect,
		stageHref
	}: {
		stages: readonly WarningSourceStage[];
		/** `run.degraded` — shows a fallback line if the run is flagged but no
		 *  stage response explains why (e.g. outputs not loaded yet). */
		runDegraded?: boolean;
		/** Live run status; drives the heading ("Completed with" vs "so far"). */
		runStatus?: string;
		/** Jump to a stage card in Production details. */
		onselect?: (stageName: string) => void;
		/** The step's own page (inspect it, fix the input, "Regenerate this stage").
		 *  When given, every WARNING stage offers it: a degraded step should say
		 *  where it is fixed, not only that it degraded. Advisories never do. */
		stageHref?: (stageName: string) => string;
	} = $props();

	const warnings = $derived(extractRunWarnings(stages));
	const advisories = $derived(extractRunAdvisories(stages));
	const total = $derived(warnings.reduce((n, w) => n + w.items.length, 0));
	const showWarnings = $derived(warnings.length > 0 || runDegraded);
	const noun = $derived(total === 1 ? 'warning' : 'warnings');
</script>

{#snippet stageList(
	list: typeof warnings,
	itemTestId: string,
	tone: string,
	fixHref?: (stageName: string) => string
)}
	<ul class="mt-2 space-y-2">
		{#each list as w (w.stageName)}
			<li data-testid="{itemTestId}-stage" data-stage={w.stageName}>
				<div class="flex flex-wrap items-baseline gap-x-3">
					{#if onselect}
						<button
							type="button"
							class="text-xs font-semibold {tone} hover:underline"
							onclick={() => onselect?.(w.stageName)}
						>
							{w.label}
						</button>
					{:else}
						<p class="text-xs font-semibold {tone}">{w.label}</p>
					{/if}
					{#if fixHref}
						<a
							href={safeHref(fixHref(w.stageName))}
							class="text-xs {tone} underline"
							data-testid="{itemTestId}-fix-link"
						>
							Fix and rerun this step
						</a>
					{/if}
				</div>
				<ul class="mt-0.5 space-y-0.5">
					{#each w.items as item, i (i)}
						<li class="text-sm text-[var(--color-text)] break-words" data-testid={itemTestId}>
							{#if item.code}
								<span class="font-medium">{degradationCodeTitle(item.code)}:</span>
								<span class="font-mono text-[11px] text-[var(--color-text-muted)]">
									({item.code})
								</span>
							{/if}
							{item.detail}
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
{/snippet}

{#if showWarnings}
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4"
		data-testid="run-warnings"
		aria-labelledby="run-warnings-title"
	>
		<h3
			id="run-warnings-title"
			class="flex items-center gap-2 text-sm font-semibold text-[var(--color-warning-text)]"
		>
			<AlertTriangle class="h-4 w-4 shrink-0" />
			{#if runStatus === 'completed'}
				{#if total > 0}Completed with {total} {noun}{:else}Completed with warnings{/if}
			{:else if total > 0}
				{total}
				{noun} so far
			{:else}
				Warnings so far
			{/if}
		</h3>
		{#if warnings.length === 0}
			<p class="mt-1 text-sm text-[var(--color-warning-text)]">
				A step reported a warning, but its details are not loaded. Open Production details below to
				inspect each stage.
			</p>
		{:else}
			{@render stageList(warnings, 'run-warning', 'text-[var(--color-warning-text)]', stageHref)}
		{/if}
	</section>
{/if}

{#if advisories.length > 0}
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
		data-testid="run-advisories"
		aria-labelledby="run-advisories-title"
	>
		<h3
			id="run-advisories-title"
			class="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-muted)]"
		>
			<Info class="h-4 w-4 shrink-0" />
			Notes
		</h3>
		{@render stageList(advisories, 'run-advisory', 'text-[var(--color-text-muted)]')}
	</section>
{/if}

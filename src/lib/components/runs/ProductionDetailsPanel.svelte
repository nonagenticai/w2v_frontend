<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { StageIOInspector } from '$lib/components/runs';
	import type { StageExecutionResponse, PipelineStatus } from '$lib/types';
	import type { RunStatus, StageOutputResponse, RunUsageTotal } from '$lib/types/runs';

	let {
		stages,
		outputs,
		config,
		usage,
		dependsOn,
		lineageUnavailable = false,
		outputError,
		expandedStage,
		pipelineStatus,
		ontoggle,
		onrerun,
		oneditor
	}: {
		stages: StageExecutionResponse[];
		outputs: StageOutputResponse[];
		config: Record<string, unknown>;
		usage: RunUsageTotal | null | undefined;
		dependsOn: Map<string, string[]>;
		/** True when `dependsOn` is empty because the blueprint fetch FAILED, not
		 *  because the stages have no upstreams. */
		lineageUnavailable?: boolean;
		/** Why a stage's lazily-fetched output could NOT be loaded (non-404), or
		 *  null. Lets a card say "could not be loaded" instead of asserting the
		 *  stage recorded no output. */
		outputError?: (stageName: string) => string | null;
		expandedStage: string | null;
		pipelineStatus: RunStatus | PipelineStatus;
		ontoggle: (name: string) => void;
		onrerun: (stageName: string) => void;
		oneditor: (stageName: string) => void;
	} = $props();
</script>

<!-- "Under the hood": the technical per-stage inspector, demoted behind a
     collapsed disclosure for the marketing audience but kept for debugging.
     IMPORTANT: a <details> keeps its children ATTACHED in the DOM when
     collapsed (only display is suppressed), so the e2e stage-card /
     data-stage / data-status contract — asserted via toHaveCount /
     toHaveAttribute on attached elements, not toBeVisible — stays green. Do
     NOT swap this for an {#if}/Sheet that unmounts the inspector. -->
<details
	class="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6"
>
	<summary class="flex cursor-pointer select-none items-start gap-2">
		<ChevronDown
			class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-open:rotate-180"
		/>
		<div>
			<p class="text-kicker text-[var(--color-text-muted)]">Under the hood</p>
			<h2 class="text-lg font-semibold text-[var(--color-text)]">Production details</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">
				Every step this creation's blueprint runs, in order — expand a step to trace the inputs it
				built on and inspect its output. For a deeper look and debugging.
			</p>
		</div>
	</summary>

	<!-- The per-stage I/O inspector: live status + inputs (depends_on lineage)
	     → output. Keeps the e2e stage-card / data-stage / data-status contract
	     on each panel wrapper (inside the component). -->
	<div class="mt-4">
		<StageIOInspector
			{stages}
			{outputs}
			{config}
			{usage}
			{dependsOn}
			{lineageUnavailable}
			{outputError}
			{expandedStage}
			{pipelineStatus}
			{ontoggle}
			{onrerun}
			{oneditor}
		/>
	</div>
</details>

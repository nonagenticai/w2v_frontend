<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	// Banner shown on the run-monitor page when the orchestrator has paused
	// for review at a checkpoint stage. One-click jump to the stage editor.
	//
	// Designed to be unobtrusive when no pause is active: the parent gates
	// visibility via `visible`. The component itself owns no lifecycle state.

	import { Button } from '$lib/components/ui';
	import { stageLabel } from '$lib/utils/stage-labels';
	import { NEEDS_REVIEW } from '$lib/utils/review-wait';
	import { PauseCircle, ChevronRight } from '@lucide/svelte';

	interface Props {
		visible: boolean;
		/** The stage that paused. Used in the body copy. */
		stageName: string | null;
		/** Where the [Open editor] button navigates. */
		editorHref: string;
		/** Optional subtitle override (e.g. "Editing scenes"). */
		subtitle?: string;
		/** "Needs review since ..." — from the run's `paused_at`. A paused run never
		 *  times out, so without this a reviewer returning a day later cannot tell a
		 *  fresh gate from one that has been holding the run for hours. */
		waitingSince?: string | null;
	}

	let { visible, stageName, editorHref, subtitle, waitingSince = null }: Props = $props();
	// One name for this state on every surface (src/lib/utils/review-wait.ts).

	// The shared label map — NOT a local underscore-strip. The old `display()`
	// duplicated `stageLabel` badly: it turned `ai_image_gen` into "ai image gen"
	// and leaned on a CSS `capitalize` to fake a title, so the banner named a stage
	// differently from every other surface that shows the same one.
</script>

{#if visible && stageName}
	<div
		class="rounded-xl border border-status-pending/40 bg-status-pending/10 p-4 flex items-start gap-3 shadow-soft"
	>
		<div class="shrink-0 mt-0.5">
			<PauseCircle class="h-5 w-5 text-status-pending" />
		</div>
		<div class="min-w-0 flex-1">
			<!-- Only the state is a live region. The "since … (5m ago)" line below
			     ticks every 30s; inside a live region a screen reader would re-read
			     it every tick. -->
			<p class="text-sm font-semibold text-text" role="status" aria-live="polite">
				{NEEDS_REVIEW}: {stageLabel(stageName)}
			</p>
			<p class="text-xs text-text-secondary mt-0.5">
				<!-- Describe the verbs the DESTINATION actually has. This promised
				     "Edit the draft, accept a prior version, or regenerate" while the
				     gate page offered none of the three — a banner that sends the
				     reviewer somewhere it has mis-described is worse than no banner. -->
				{subtitle ??
					`Review this stage's output, then approve to continue — or regenerate it from here.`}
			</p>
			{#if waitingSince}
				<p class="text-xs text-text-secondary mt-1" data-testid="pause-waiting-since">
					{waitingSince}
				</p>
			{/if}
		</div>
		<Button variant="primary" size="sm" href={safeHref(editorHref)}>
			Open editor
			<ChevronRight class="h-4 w-4" />
		</Button>
	</div>
{/if}

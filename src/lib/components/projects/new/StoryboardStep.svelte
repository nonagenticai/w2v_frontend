<script lang="ts">
	import StoryboardBoard from '$lib/components/studio/storyboard/StoryboardBoard.svelte';
	import StoryboardSection from '$lib/components/workspace/sections/StoryboardSection.svelte';
	import { Skeleton } from '$lib/components/ui';
	import { onMount } from 'svelte';
	import { createWizard as cw } from './create-wizard.svelte.js';

	// On entering the storyboard step (generic only), pre-create a `drafting`
	// project so the step can render the real project-scoped storyboard UI
	// (scenes + assets + AI draft) against a persisted project instead of an
	// in-memory array — and PATCH the brief typed in the (earlier) Brief step onto
	// it, so "Draft from brief" has a server-side brief to draft from. Runs on
	// every entry, so an edit made after going Back reaches the draft too.
	onMount(() => {
		void cw.prepareStoryboardDraft();
	});
</script>

{#if cw.draftPending}
	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	>
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Storyboard</h2>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">Preparing your storyboard…</p>
		</div>
		<Skeleton variant="box" height="8rem" />
	</section>
{:else if cw.draftProject}
	<StoryboardSection project={cw.draftProject} />
{:else if cw.submitError}
	<!-- Draft pre-create failed — fall back to the in-memory board so the wizard
	     still works. On this path cw.panels folds into brief.storyboard at submit
	     (the original create-at-submit behaviour). -->
	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	>
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Storyboard</h2>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				Plan the video shot by shot. Add panels with action, dialogue/voice-over, camera framing and
				timing; drag to reorder. Each panel maps to one clip on the pipeline spine. Leave it empty
				to let the pipeline auto-direct from the brief.
			</p>
		</div>
		<StoryboardBoard bind:panels={cw.panels} />
	</section>
{:else}
	<!-- Draft is being created — show a brief loading state before the live board. -->
	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	>
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Storyboard</h2>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">Preparing your storyboard…</p>
		</div>
		<Skeleton variant="box" height="8rem" />
	</section>
{/if}

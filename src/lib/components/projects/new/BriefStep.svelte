<script lang="ts">
	import { Input } from '$lib/components/ui';
	import { BriefForm, DeliverableConfig } from '$lib/components/studio';
	import { PROJECT_TYPE_LABELS, type ProjectType } from '$lib/types';
	import { Plus, Trash2, Sparkles, BookOpen } from '@lucide/svelte';
	import { createWizard as cw } from './create-wizard.svelte.js';

	let {
		cloneables,
		cloneablesTotal = 0,
		cloneablesTruncated = false,
		cloneablesFailed = false
	}: {
		cloneables: { id: string; title: string; type: ProjectType }[];
		/** Total projects the tenant has (the picker shows a filtered page of them). */
		cloneablesTotal?: number;
		/** The tenant has more projects than the picker fetched. */
		cloneablesTruncated?: boolean;
		/** The list request FAILED. Must not look like "you have no projects". */
		cloneablesFailed?: boolean;
	} = $props();

	// A generic script with no text source has only the brief to draw facts from;
	// the orchestrator now forbids it from stating specifics the brief lacks, so a
	// factual topic needs a source to say anything concrete. Pinned `media` items
	// are pictures, not facts — only url/document sources ground the script.
	const sourcesIndex = $derived(cw.steps.indexOf('sources'));
	const showGroundingHint = $derived(
		cw.projectType === 'generic' &&
			sourcesIndex >= 0 &&
			!cw.sources.some((s) => s.kind !== 'media' && s.ref.trim().length > 0)
	);
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div class="flex items-center justify-between gap-4">
		<h2 class="text-base font-semibold text-[var(--color-text)]">Basics</h2>
		<span class="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
			<Sparkles class="h-3.5 w-3.5" />
			{PROJECT_TYPE_LABELS[cw.projectType]}
		</span>
	</div>
	<Input
		name="title"
		label="Title"
		placeholder={cw.titleHint ||
			(cw.isCourse ? 'e.g. Postgres for engineers' : 'e.g. Launch promo')}
		bind:value={cw.title}
		required
	/>
	{#if cloneablesFailed}
		<!-- A load failure must be VISIBLY different from an empty list: hiding the
		     control entirely made "the API is down" indistinguishable from "you have
		     no projects to clone". -->
		<p
			class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
			data-testid="cloneables-error"
			role="status"
		>
			Couldn't load your existing projects, so "Clone settings from" is unavailable. Reload the page
			to try again — you can still create this project from scratch.
		</p>
	{:else if cloneables.length > 0}
		<label class="block space-y-1">
			<span class="text-xs font-medium text-[var(--color-text-muted)]"
				>Clone settings from (optional)</span
			>
			<select
				data-testid="clone-from"
				class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
				bind:value={cw.cloneFrom}
			>
				<option value="">— Start blank —</option>
				{#each cloneables as opt (opt.id)}
					<option value={opt.id}>{opt.title} ({PROJECT_TYPE_LABELS[opt.type]})</option>
				{/each}
			</select>
			<span class="block text-xs text-[var(--color-text-muted)]">
				Copies brand / voice / theme configs and brief defaults from the source project.
				{#if cloneablesTruncated}
					<span data-testid="cloneables-truncated">
						Showing {cloneables.length} of {cloneablesTotal} projects (most recent first).
					</span>
				{/if}
			</span>
		</label>
	{/if}
</section>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<h2 class="text-base font-semibold text-[var(--color-text)]">Brief</h2>
	<p class="text-xs text-[var(--color-text-muted)] -mt-2">
		These fields feed the {PROJECT_TYPE_LABELS[cw.projectType]} pipeline directly — fill them for a real
		result.
	</p>
	{#if showGroundingHint}
		<p
			class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
			data-testid="grounding-hint"
			role="note"
		>
			<BookOpen class="h-3.5 w-3.5 shrink-0" />
			<span class="min-w-0">Factual topic? Add a source so the script can cite real facts.</span>
			<button
				type="button"
				data-testid="grounding-hint-add-source"
				onclick={() => cw.goToStep(sourcesIndex)}
				class="font-medium text-[var(--color-accent)] underline underline-offset-2 hover:no-underline"
			>
				Add a source
			</button>
		</p>
	{/if}
	<BriefForm type={cw.pickType} bind:brief={cw.brief} redesignEnabled={cw.producesRedesign} />
</section>

{#if cw.projectType === 'website_review' && cw.producesVideo}
	<!-- Review checkpoints. Default ON: the orchestrator pauses after the redesign
	     and after the script so the operator can approve before paid narration.
	     Writes brief.pause_for_review (explicit boolean, see buildBrief).
	     Gated on producesVideo, NOT producesRedesign: the orchestrator seeds NO
	     gates when `generate_video` is false (run_engine.py
	     `default_pause_after_stages` returns [] for a critique/redesign-only
	     website_review), so on those runs this checkbox promised a pause that could
	     never happen. -->
	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-2"
	>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Review checkpoints</h2>
		<label class="flex items-start gap-2 text-sm text-[var(--color-text)]">
			<input
				type="checkbox"
				class="mt-0.5"
				data-testid="pause-for-review"
				checked={cw.brief.pause_for_review !== false}
				onchange={(e) => (cw.brief = { ...cw.brief, pause_for_review: e.currentTarget.checked })}
			/>
			<span>
				Pause for my review after the redesign and after the script
				<span class="block text-xs text-[var(--color-text-muted)]">
					Turn off to run the whole review straight through without stopping.
				</span>
			</span>
		</label>
	</section>
{/if}

{#if cw.needsDeliverables}
	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold text-[var(--color-text)]">Deliverables</h2>
			<button
				type="button"
				onclick={() => cw.addDeliverable()}
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
			>
				<Plus class="h-3.5 w-3.5" /> Add deliverable
			</button>
		</div>
		<p class="text-xs text-[var(--color-text-muted)] -mt-2">
			Each deliverable runs the blueprint independently. Add variants for cross-format releases
			(e.g. 16:9 + 9:16).{#if cw.controls.deliverableDuration}
				The duration here also sets the target script length.{/if}
		</p>
		<div class="space-y-4">
			{#each cw.deliverables as _deliverable, i (i)}
				<div
					class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
				>
					<div class="flex items-center justify-between">
						<p class="text-xs font-semibold text-[var(--color-text-muted)]">
							Deliverable {i + 1}
						</p>
						{#if cw.deliverables.length > 1}
							<button
								type="button"
								onclick={() => cw.removeDeliverable(i)}
								aria-label="Remove deliverable"
								class="p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						{/if}
					</div>
					<DeliverableConfig
						bind:deliverable={cw.deliverables[i]}
						minDurationSeconds={cw.minDurationSeconds}
						showDuration={cw.controls.deliverableDuration}
						inheritCaptions
						inheritedCaptionsMode={cw.defaultCaptionsMode}
					/>
				</div>
			{/each}
		</div>
	</section>
{/if}

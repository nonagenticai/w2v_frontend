<script lang="ts">
	// The per-panel AI image control and its status surface.
	//
	// Everything about a generation's LIFECYCLE lives in the storyboard store
	// (polling, SSE reconciliation, CAS/409, the board refetch on completion) —
	// this component only reads `panelImageState` and renders it. It deliberately
	// keeps NO local copy of the job: the card remounts on every reorder and on a
	// conflict re-seed, and a 20-minute generation has to survive that.
	//
	// ⚠️ The picture itself is rendered by StoryboardBoard from the PANEL's own
	// `media_ref.url`, which only the panel read path re-signs and which expires
	// after an hour. Nothing here may copy a url into state — that exact trap
	// already degraded every exported PDF frame to a placeholder.
	//
	// Seven distinct states, because each means something different to the person
	// waiting on it, and the neutral "Generate image" slot is a LIE in six of them:
	// it says "nothing has happened" when in fact a job is queued, or the
	// deployment cannot generate at all, or a render may still be running whose
	// receipt we lost.
	//
	// Copy note: the runner is text→image plus a seed. No reference image
	// conditions the result, so no copy here may suggest that it does.
	import { Loader2 } from '@lucide/svelte';
	import type { StoryboardPanelDraft } from '$lib/types';
	import {
		panelImageState,
		startPanelImage,
		dismissPanelImage,
		recheckPanelImage
	} from '$lib/stores/storyboard.svelte.js';
	import { formatTimestamp } from '$lib/utils/format';

	interface Props {
		panel: StoryboardPanelDraft;
		/** Read-only board (archived project / closed branch) ⇒ no generation. */
		disabled?: boolean;
	}

	let { panel, disabled = false }: Props = $props();

	// Generation is a server-side, project-scoped job, so it only exists for a
	// persisted row — the same "section-only" gate the approval cluster uses.
	const panelId = $derived(panel.id ?? null);
	const projectId = $derived(panel.project_id ?? null);
	const persisted = $derived(panelId != null && projectId != null);

	/** ALWAYS derived from the panel. Never assigned into `$state` — see the header. */
	const imageUrl = $derived.by(() => {
		const url = panel.media_ref?.url;
		return typeof url === 'string' && url !== '' ? url : null;
	});
	/** A non-empty `gen` record is the panel's own memory that it WAS generated. */
	const everGenerated = $derived(panel.gen != null && Object.keys(panel.gen).length > 0);

	const job = $derived(panelId != null ? panelImageState(panelId) : undefined);
	const inFlight = $derived(job?.status === 'queued' || job?.status === 'running');

	// Elapsed time only matters while we are waiting, so the ticker only runs then
	// (and is torn down with the card — a board of 40 shots must not hold 40 timers).
	let now = $state(Date.now());
	$effect(() => {
		if (!inFlight) return;
		now = Date.now();
		const id = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});
	const elapsed = $derived(
		job ? formatTimestamp(Math.max(0, (now - job.startedAt) / 1000)) : '0:00'
	);

	function handleGenerate(): void {
		if (panelId == null || projectId == null) return;
		void startPanelImage(projectId, panelId);
	}
	function handleRecheck(): void {
		if (panelId == null || projectId == null) return;
		void recheckPanelImage(projectId, panelId);
	}
	function handleDismiss(): void {
		if (panelId == null) return;
		dismissPanelImage(panelId);
	}

	const boxClass =
		'flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm';
	// Native buttons, not the `Button` primitive: `Button` declares explicit props
	// and forwards no rest attributes, so a `data-testid` on it never reaches the
	// DOM (same trap documented for `Card`), and the e2e lanes assert on these.
	const btnClass =
		'inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40';
</script>

{#if persisted}
	<div class="space-y-1.5" data-testid="panel-visual">
		<span class="text-sm font-medium text-[var(--color-text-muted)]">Panel image</span>

		{#if job?.status === 'queued'}
			<div class={boxClass} role="status" aria-live="polite" data-testid="panel-image-queued">
				<Loader2 class="h-4 w-4 animate-spin text-[var(--color-text-muted)]" aria-hidden="true" />
				<span class="text-[var(--color-text)]">
					Waiting for a free generator (the queue is cluster-wide and can take several minutes)
				</span>
				<span class="tabular-nums text-[var(--color-text-muted)]" data-testid="panel-image-elapsed">
					{elapsed}
				</span>
			</div>
		{:else if job?.status === 'running'}
			<div class={boxClass} role="status" aria-live="polite" data-testid="panel-image-running">
				<Loader2 class="h-4 w-4 animate-spin text-[var(--color-accent)]" aria-hidden="true" />
				<span class="text-[var(--color-text)]">Generating…</span>
				<span class="tabular-nums text-[var(--color-text-muted)]" data-testid="panel-image-elapsed">
					{elapsed}
				</span>
			</div>
		{:else if job?.status === 'failed'}
			<div
				class="{boxClass} border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10"
				role="alert"
				data-testid="panel-image-error"
			>
				<!-- The server's own words, verbatim — a paraphrase loses the one detail
				     that tells the user whether retrying can possibly help. -->
				<span class="text-[var(--color-text)]">
					Image generation failed{job?.error ? ` — ${job.error}` : '.'}
				</span>
				<button
					type="button"
					class={btnClass}
					{disabled}
					onclick={handleGenerate}
					data-testid="panel-image-retry"
				>
					Retry
				</button>
			</div>
		{:else if job?.status === 'unavailable'}
			<!-- 503: an infrastructure fact about this deployment, NOT "no image yet".
			     The control stays visible but disabled so the absence is explained. -->
			<div class={boxClass} role="status" data-testid="panel-image-unavailable">
				<span class="text-[var(--color-text-muted)]">
					Image generation is unavailable on this deployment
				</span>
				<button type="button" class={btnClass} disabled data-testid="panel-image-generate-disabled">
					Generate image
				</button>
			</div>
		{:else if job?.status === 'lost'}
			<!-- The job record aged out while we weren't looking. We do NOT know that it
			     failed, and we must not reset to idle — that would claim it never ran. -->
			<div class={boxClass} role="status" data-testid="panel-image-lost">
				<span class="text-[var(--color-text)]">
					Lost track of this generation — the image may still be rendering
				</span>
				<button
					type="button"
					class={btnClass}
					onclick={handleRecheck}
					data-testid="panel-image-recheck"
				>
					Check again
				</button>
			</div>
		{:else if job?.status === 'conflict'}
			<!-- A lost compare-and-swap. No retry here on purpose: retrying would send a
			     fresh token for a shot whose current text the user has not seen. -->
			<div
				class="{boxClass} border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10"
				role="status"
				data-testid="panel-image-conflict"
			>
				<span class="text-[var(--color-text)]">
					This shot changed elsewhere — reload before generating
				</span>
				<button
					type="button"
					class="shrink-0 text-xs font-medium text-[var(--color-text-muted)] underline"
					onclick={handleDismiss}
					data-testid="panel-image-dismiss"
				>
					Dismiss
				</button>
			</div>
		{:else if job?.status === 'completed' || imageUrl}
			<!-- The picture itself is the board's thumbnail; this is the receipt for it
			     (seed = the only thing that can reproduce the frame). -->
			<div class={boxClass} role="status" aria-live="polite" data-testid="panel-image-completed">
				<span class="text-[var(--color-text)]">
					Image ready{job?.seed != null ? ` · seed ${job.seed}` : ''}{job?.reused
						? ' · reused an identical earlier render'
						: ''}
				</span>
				<button
					type="button"
					class={btnClass}
					{disabled}
					onclick={handleGenerate}
					data-testid="panel-image-regenerate"
				>
					Regenerate
				</button>
			</div>
		{:else if everGenerated}
			<!-- Generated at some point, but the panel carries no fetchable url. Offering
			     "Generate image" here would state that nothing was ever made. -->
			<div class={boxClass} role="status" data-testid="panel-image-expired">
				<span class="text-[var(--color-text-muted)]">This shot's image is no longer available</span>
				<button
					type="button"
					class={btnClass}
					{disabled}
					onclick={handleGenerate}
					data-testid="panel-image-regenerate"
				>
					Regenerate
				</button>
			</div>
		{:else}
			<!-- The ONLY state that offers a plain generate affordance. -->
			<div class={boxClass} data-testid="panel-image-idle">
				<span class="text-[var(--color-text-muted)]">
					No image yet. Generation reads this shot's text and takes a few minutes.
				</span>
				<button
					type="button"
					class={btnClass}
					{disabled}
					onclick={handleGenerate}
					data-testid="panel-image-generate"
				>
					Generate image
				</button>
			</div>
		{/if}
	</div>
{/if}

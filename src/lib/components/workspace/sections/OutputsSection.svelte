<script lang="ts">
	import { resolve } from '$app/paths';
	import { runs as runsApi } from '$lib/api';
	import { EmptyState, ErrorState, Pill, Skeleton } from '$lib/components/ui';
	import { DELIVERABLE_FORMAT_LABELS, type ProjectDetailResponse } from '$lib/types';
	import type { RunSummary } from '$lib/types/runs';
	import { TYPE_BRIEF, type PickType } from '$lib/studio/project-request';
	import { Sparkles, ChevronRight } from '@lucide/svelte';

	let { project }: { project: ProjectDetailResponse } = $props();

	// Audits produce a scored scorecard, not a video — so the video-centric copy
	// (play the video / publish to YouTube / captions) and the format·captions card
	// meta are meaningless for them. Descriptor-driven (single source of truth) so a
	// new audit type is covered without editing this branch.
	const auditKind = $derived(TYPE_BRIEF[project.type as PickType]?.audit?.kind);
	const isAudit = $derived(auditKind !== undefined);
	const auditLabel = $derived(
		auditKind === 'cro'
			? 'CRO scorecard'
			: auditKind === 'marketing'
				? 'Marketing scorecard'
				: 'SEO scorecard'
	);

	// ProjectDetail carries no run list / output URLs and `deliverable.status` is a
	// dead field (project status derives from the latest RUN, not the deliverable),
	// so we resolve outputs from the run-history endpoint instead. Each card links
	// straight to the run-view, where the polymorphic RunOutputPanel renders the
	// player / publish / captions / chapters for whatever the run produced.
	let runList = $state<RunSummary[] | null>(null);
	let loading = $state(false);
	let error = $state<unknown>(null);
	let loadedFor = $state<string | null>(null);

	const deliverablesById = $derived(new Map(project.deliverables.map((d) => [d.id, d])));

	// One card per deliverable that has at least one completed run, pointing at its
	// NEWEST completed run. listForProject returns newest-first, so the first
	// completed run seen per deliverable_id is the latest.
	const outputs = $derived.by(() => {
		const seen: Record<string, true> = {};
		const rows: { run: RunSummary; deliverable: (typeof project.deliverables)[number] }[] = [];
		for (const run of runList ?? []) {
			if (run.status !== 'completed' || seen[run.deliverable_id]) continue;
			const deliverable = deliverablesById.get(run.deliverable_id);
			if (!deliverable) continue;
			seen[run.deliverable_id] = true;
			rows.push({ run, deliverable });
		}
		return rows;
	});

	async function load() {
		loading = true;
		error = null;
		try {
			// Max page: the newest completed run per deliverable must not fall off
			// the default 50-run page on a busy project.
			runList = await runsApi.listForProject(project.id, { limit: 200 });
		} catch (err) {
			error = err;
		} finally {
			loading = false;
		}
	}

	// The workspace loader doesn't seed runs — fetch when this section first renders
	// for a project (and again if the project id changes), guarded so it fires once.
	$effect(() => {
		if (loadedFor !== project.id) {
			loadedFor = project.id;
			void load();
		}
	});
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	data-testid="outputs-section"
>
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Outputs</h2>
		<p class="text-sm text-[var(--color-text-muted)] mt-1">
			{isAudit
				? 'Finished audits. Open one to view the scored scorecard and download the report.'
				: 'Finished deliverables. Open one to play the video, publish to YouTube or download captions.'}
		</p>
	</div>

	{#if loading}
		<Skeleton variant="box" height="8rem" />
	{:else if error}
		<ErrorState {error} title="Couldn't load outputs" onRetry={load} />
	{:else if outputs.length === 0}
		<EmptyState
			title="No outputs yet"
			description="Finished runs show up here. Start a run from the Deliverables section, then come back when it completes."
		>
			{#snippet icon()}
				<Sparkles class="h-12 w-12" />
			{/snippet}
		</EmptyState>
	{:else}
		<div class="space-y-2">
			{#each outputs as { run, deliverable } (deliverable.id)}
				<a
					href={resolve(`/projects/${project.id}/runs/${run.id}`)}
					class="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors"
					data-testid="output-row"
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-sm font-semibold text-[var(--color-text)] truncate"
								>{deliverable.name}</span
							>
							<Pill tone="success">completed</Pill>
						</div>
						<p class="text-xs text-[var(--color-text-muted)] mt-1">
							{#if isAudit}
								{auditLabel}
							{:else}
								{DELIVERABLE_FORMAT_LABELS[deliverable.format]} · {deliverable.captions_mode} captions
							{/if}
						</p>
					</div>
					<ChevronRight class="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
				</a>
			{/each}
		</div>
	{/if}
</section>

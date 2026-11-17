<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import { ChevronRight, History } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { runs as runsApi } from '$lib/api';
	import { RunLauncher } from '$lib/components/runs';
	import RunStatusBadge from '$lib/components/runs/RunStatusBadge.svelte';
	import TokenUsage from '$lib/components/runs/TokenUsage.svelte';
	import { EmptyState, ErrorState, Skeleton } from '$lib/components/ui';
	import { formatDateTime, formatRelativeTime } from '$lib/utils/format';
	import { usageFromTokens } from '$lib/utils/usage';
	import type { RunSummary } from '$lib/types/runs';

	let { data } = $props();

	// The deliverable loader carries no runs — fetch the project's run history and
	// filter to THIS deliverable so a finished run (and its output) is reachable
	// from here instead of dead-ending on the launch button.
	let runList = $state<RunSummary[] | null>(null);
	let loading = $state(false);
	let error = $state<unknown>(null);
	let loadedFor = $state<string | null>(null);

	const deliverableRuns = $derived(
		(runList ?? []).filter((r) => r.deliverable_id === data.deliverable.id)
	);

	async function load() {
		loading = true;
		error = null;
		try {
			runList = await runsApi.listForProject(data.project.id);
		} catch (err) {
			error = err;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (loadedFor !== data.deliverable.id) {
			loadedFor = data.deliverable.id;
			void load();
		}
	});
</script>

<svelte:head>
	<title>{data.deliverable.name} - {data.project.title}</title>
</svelte:head>

<Page width="narrow" testid="deliverable-home">
	<PageHeader title={data.deliverable.name}>
		{#snippet crumbs()}
			<span class="flex items-center gap-1.5">
				<a href={resolve('/projects')} class="hover:text-text-secondary">Projects</a>
				<ChevronRight class="h-3 w-3" />
				<a href={resolve(`/projects/${data.project.id}`)} class="hover:text-text-secondary"
					>{data.project.title}</a
				>
				<ChevronRight class="h-3 w-3" />
				<span>{data.deliverable.name}</span>
			</span>
		{/snippet}
	</PageHeader>

	<RunLauncher deliverableId={data.deliverable.id} deliverableStatus={data.deliverable.status} />

	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
		data-testid="deliverable-runs"
	>
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Runs</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">
				Every run of this deliverable, newest first. Open one to play the output, publish or
				download captions.
			</p>
		</div>

		{#if loading}
			<Skeleton variant="box" height="6rem" />
		{:else if error}
			<ErrorState {error} title="Couldn't load runs" onRetry={load} />
		{:else if deliverableRuns.length === 0}
			<EmptyState
				title="No runs yet"
				description="Start a run above; it will appear here when it begins — including failed attempts and regenerations."
			>
				{#snippet icon()}
					<History class="h-12 w-12" />
				{/snippet}
			</EmptyState>
		{:else}
			<div class="space-y-2">
				{#each deliverableRuns as run (run.id)}
					<a
						href={resolve(`/projects/${data.project.id}/runs/${run.id}`)}
						class="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors"
						data-testid="deliverable-run-row"
					>
						<div class="min-w-0">
							<RunStatusBadge
								status={run.status}
								degraded={run.degraded ?? false}
								pauseReason={run.pause_reason}
							/>
							<p class="text-xs text-[var(--color-text-muted)] mt-1">
								{run.blueprint_id} · created {formatDateTime(run.created_at)} ({formatRelativeTime(
									run.created_at
								)})
							</p>
							<TokenUsage
								usage={usageFromTokens(run.input_tokens, run.output_tokens)}
								testid="deliverable-run-tokens"
								class="mt-0.5"
							/>
						</div>
						<ChevronRight class="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
					</a>
				{/each}
			</div>
		{/if}
	</section>
</Page>

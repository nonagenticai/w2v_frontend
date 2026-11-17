<script lang="ts">
	import { resolve } from '$app/paths';
	import { runs as runsApi } from '$lib/api';
	import RunStatusBadge from '$lib/components/runs/RunStatusBadge.svelte';
	import { Button, EmptyState, ErrorState, Skeleton } from '$lib/components/ui';
	import { formatDateTime, formatRelativeTime } from '$lib/utils/format';
	import type { ProjectDetailResponse } from '$lib/types';
	import type { RunSummary } from '$lib/types/runs';
	import { ChevronRight, History } from '@lucide/svelte';

	let { project }: { project: ProjectDetailResponse } = $props();

	let runList = $state<RunSummary[] | null>(null);
	let loading = $state(false);
	let error = $state<unknown>(null);
	let loadedFor = $state<string | null>(null);
	// The backend pages run lists (newest first). A full page means there may
	// be more; say so and offer to load them instead of silently stopping.
	const PAGE_SIZE = 50;
	let hasMore = $state(false);
	// The project's TOTAL run count from `X-Total-Count`; null when the backend did
	// not send it, in which case "a full page" is the only more-exists signal.
	let total = $state<number | null>(null);
	let loadingMore = $state(false);
	let moreError = $state<string | null>(null);

	// deliverable_id → name, so each run row can show which deliverable it ran.
	const deliverableNames = $derived(new Map(project.deliverables.map((d) => [d.id, d.name])));

	// Wall-clock duration for a terminal run (start → completion). Cheap and
	// derivable from RunSummary alone — no per-run detail fetch. Returns '' for
	// in-flight runs (no completion timestamp yet).
	const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
	function runDuration(run: RunSummary): string {
		const start = run.started_at ?? run.created_at;
		if (!TERMINAL.has(run.status) || !start || !run.completed_at) return '';
		const ms = new Date(run.completed_at).getTime() - new Date(start).getTime();
		if (!isFinite(ms) || ms <= 0) return '';
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return m < 60 ? `${m}m ${rem}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
	}

	// With a server total, "more" is exact; without one, a full page is a guess.
	function moreExists(loaded: number, pageLen: number, serverTotal: number | null): boolean {
		return serverTotal !== null ? loaded < serverTotal && pageLen > 0 : pageLen === PAGE_SIZE;
	}

	async function load() {
		loading = true;
		error = null;
		moreError = null;
		try {
			let pageTotal: number | null = null;
			const page = await runsApi.listForProject(project.id, {
				limit: PAGE_SIZE,
				offset: 0,
				onTotal: (n) => (pageTotal = n)
			});
			runList = page;
			total = pageTotal;
			hasMore = moreExists(page.length, page.length, pageTotal);
		} catch (err) {
			error = err;
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!runList || loadingMore) return;
		loadingMore = true;
		moreError = null;
		try {
			let pageTotal: number | null = null;
			const page = await runsApi.listForProject(project.id, {
				limit: PAGE_SIZE,
				offset: runList.length,
				onTotal: (n) => (pageTotal = n)
			});
			const seen = new Set(runList.map((r) => r.id));
			runList = [...runList, ...page.filter((r) => !seen.has(r.id))];
			if (pageTotal !== null) total = pageTotal;
			hasMore = moreExists(runList.length, page.length, pageTotal);
		} catch {
			moreError = "Couldn't load more runs.";
		} finally {
			loadingMore = false;
		}
	}

	// The workspace loader doesn't seed runs — fetch when this section first
	// renders for a project (and again if the project id changes). Guarded on
	// loadedFor so it fires exactly once per project, not on every re-render.
	$effect(() => {
		if (loadedFor !== project.id) {
			loadedFor = project.id;
			void load();
		}
	});
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	data-testid="run-history"
>
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Run history</h2>
		<p class="text-sm text-[var(--color-text-muted)] mt-1">
			Every run started for this project, across all deliverables, newest first. Open a run to
			inspect its stages and output.
		</p>
	</div>

	{#if loading}
		<Skeleton variant="box" height="8rem" />
	{:else if error}
		<ErrorState {error} title="Couldn't load run history" onRetry={load} />
	{:else if !runList || runList.length === 0}
		<EmptyState
			title="No runs yet"
			description="Once you start a run from the Deliverables section it shows up here — including failed attempts and regenerations."
		>
			{#snippet icon()}
				<History class="h-12 w-12" />
			{/snippet}
		</EmptyState>
	{:else}
		<div class="space-y-2">
			{#each runList as run (run.id)}
				<a
					href={resolve(`/projects/${project.id}/runs/${run.id}`)}
					class="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors"
					data-testid="run-history-row"
				>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<RunStatusBadge
								status={run.status}
								degraded={run.degraded ?? false}
								pauseReason={run.pause_reason}
							/>
							<span class="text-sm font-semibold text-[var(--color-text)] truncate">
								{deliverableNames.get(run.deliverable_id) ?? 'Deliverable'}
							</span>
						</div>
						<p class="text-xs text-[var(--color-text-muted)] mt-1">
							{run.blueprint_id} · created {formatDateTime(run.created_at)} ({formatRelativeTime(
								run.created_at
							)}){#if runDuration(run)}
								· ran {runDuration(run)}{/if}
						</p>
					</div>
					<ChevronRight class="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
				</a>
			{/each}
		</div>
		<div class="flex items-center justify-between gap-3" data-testid="run-history-footer">
			<p class="text-xs text-[var(--color-text-muted)]">
				{#if total !== null}
					Showing {runList.length} of {total} run{total === 1 ? '' : 's'}.
				{:else}
					Showing {runList.length}{hasMore ? '+' : ''} run{runList.length === 1 ? '' : 's'}{hasMore
						? ' — older runs not loaded yet'
						: ''}.
				{/if}
			</p>
			{#if hasMore}
				<Button
					variant="secondary"
					size="sm"
					loading={loadingMore}
					disabled={loadingMore}
					onclick={loadMore}
				>
					Load more
				</Button>
			{/if}
		</div>
		{#if moreError}
			<p class="text-xs text-[var(--color-danger)]">{moreError}</p>
		{/if}
	{/if}
</section>

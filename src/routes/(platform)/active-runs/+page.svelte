<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	// Platform operator run pane (super_admin only). The "what is running right
	// now, across all tenants" view that was missing: GET /api/admin/runs lists
	// every in-flight (pending/running/paused) run across ALL tenants, each enriched
	// with leasePresent (a running row with no lease is an orphan no pod is executing).
	// A PAUSED row is not executing at all. It reads "Needs review" when it waits at a
	// review checkpoint and "Paused" when someone pressed Pause (`pause_reason`), and
	// is aged from `paused_at`, never from `started_at` — run 01a1770d sat here 29h at
	// a storyboard gate looking like a 29h-old running run.
	// `recent` lists the most-recently-updated terminal runs. Gated by the
	// (platform) group layout. The running view auto-refreshes so it stays live.
	import { resolve } from '$app/paths';
	import { admin, type AdminRunListItem } from '$lib/api';
	import { Card, Skeleton, ErrorState, EmptyState, Pill, Button } from '$lib/components/ui';
	import { formatRelativeTime } from '$lib/utils/format';
	import { reviewWaitShort, runStatusLabel } from '$lib/utils/review-wait';
	import { useNow } from '$lib/stores/now.svelte';

	// `running` is the API's name for the in-flight view (pending/running/paused).
	type View = 'running' | 'recent';

	let view = $state<View>('running');
	let runs = $state<AdminRunListItem[]>([]);
	let total = $state(0);
	let error = $state<unknown>(null);
	// A FAILED SILENT REFRESH IS NOT A PAGE ERROR. The 5s poll shares nothing with
	// `error` any more: one transient 502 used to replace a working, live run table
	// with the full-page ErrorState, destroying the operator's view. A silent
	// failure now keeps the last good rows on screen and surfaces itself
	// non-destructively as a header badge.
	let refreshError = $state<unknown>(null);
	let loading = $state(true);
	let refreshing = $state(false);
	const REFRESH_MS = 5000;

	async function load({ silent = false } = {}): Promise<void> {
		if (silent) refreshing = true;
		else loading = true;
		if (!silent) error = null;
		try {
			const res = await admin.runs({ status: view });
			runs = res.items;
			total = res.total;
			refreshError = null;
		} catch (e) {
			// Only a foreground load may take over the page. A silent refresh keeps
			// `runs`/`total` untouched — stale-but-real beats an error page.
			if (silent) refreshError = e;
			else error = e;
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	function refreshErrorMessage(err: unknown): string {
		if (err instanceof Error && err.message) return err.message;
		return String(err);
	}

	function setView(next: View): void {
		if (next === view) return;
		view = next;
		runs = [];
		refreshError = null;
		void load();
	}

	// Initial load + live auto-refresh of the running view (silent, no spinner
	// flash). Re-runs whenever `view` changes; the interval is cleaned up on teardown.
	$effect(() => {
		void view; // track
		void load();
		if (view !== 'running') return;
		const id = setInterval(() => void load({ silent: true }), REFRESH_MS);
		return () => clearInterval(id);
	});

	const statusTone = (s: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' => {
		if (s === 'running') return 'accent';
		if (s === 'paused') return 'warning'; // waiting on a person, not on a pod
		if (s === 'completed') return 'success';
		if (s === 'failed' || s === 'cancelled') return 'danger';
		return 'neutral'; // pending
	};
	const statusText = (r: AdminRunListItem): string => runStatusLabel(r.status, r.pause_reason);
	// Ages tick while the pane is open (the 5s refresh only runs on the in-flight view).
	const now = useNow();

	// A running row that no pod is executing (lease gone) — operator-actionable.
	const isOrphan = (r: AdminRunListItem): boolean =>
		r.status === 'running' && r.lease_present === false;

	const orphanCount = $derived(runs.filter(isOrphan).length);
	// A paused row's age is how long it has waited for review; everything else is
	// aged from when it started.
	const ageOf = (r: AdminRunListItem, at: number): string =>
		reviewWaitShort(r, at) ?? formatRelativeTime(r.started_at || r.created_at, at);
</script>

<Page width="narrow" testid="active-runs">
	<PageHeader
		kicker="Platform"
		title="All runs"
		subtitle="In-flight work across all tenants — pending, running, needing review, or paused."
	>
		{#snippet actions()}
			<div class="flex items-center gap-2">
				{#if !loading && !error}
					<Pill tone="neutral">{total} {total === 1 ? 'run' : 'runs'}</Pill>
					{#if view === 'running' && orphanCount > 0}
						<span data-testid="orphan-summary">
							<Pill tone="danger">{orphanCount} orphaned</Pill>
						</span>
					{/if}
					{#if refreshing}
						<span class="text-xs text-[var(--color-text-muted)]" data-testid="refreshing">↻</span>
					{/if}
					{#if refreshError}
						<span data-testid="refresh-error" title={refreshErrorMessage(refreshError)}>
							<Pill tone="danger">refresh failed — showing last known</Pill>
						</span>
					{/if}
				{/if}
			</div>
		{/snippet}
	</PageHeader>

	<div class="mb-4 flex gap-2" data-testid="view-toggle">
		<Button
			variant={view === 'running' ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => setView('running')}
		>
			In flight
		</Button>
		<Button
			variant={view === 'recent' ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => setView('recent')}
		>
			Recent
		</Button>
	</div>

	{#if loading}
		<div data-testid="runs-loading">
			<Card class="p-2"><Skeleton variant="text" count={5} height="2.25rem" /></Card>
		</div>
	{:else if error}
		<ErrorState title="Couldn't load runs" {error} onRetry={() => load()} />
	{:else if runs.length === 0}
		<EmptyState
			title={view === 'running' ? 'Nothing in flight' : 'No recent runs'}
			description={view === 'running'
				? 'No tenant has an in-flight run right now.'
				: 'No runs have finished recently.'}
		/>
	{:else}
		<Card>
			<ul class="divide-y divide-[var(--color-border)]" data-testid="runs-list">
				{#each runs as run (run.run_id)}
					<li class="flex items-center justify-between gap-4 p-4" data-testid="run-row">
						<div class="min-w-0">
							<p
								class="flex items-center gap-2 truncate text-sm font-medium text-[var(--color-text)]"
							>
								<a class="truncate hover:underline" href={resolve(`/runs/${run.run_id}`)}>
									{run.project_title}
								</a>
								<span data-testid="run-status">
									<Pill tone={statusTone(run.status)}>{statusText(run)}</Pill>
								</span>
								{#if isOrphan(run)}
									<span data-testid="orphan-badge"><Pill tone="danger">orphan</Pill></span>
								{:else if run.status === 'running' && run.lease_present === true}
									<span data-testid="live-badge"><Pill tone="success">live</Pill></span>
								{/if}
							</p>
							<p class="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
								{#if run.current_stage}stage: {run.current_stage} ·
								{/if}tenant:
								<span class="font-mono">{run.tenant_id}</span>
							</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="text-xs text-[var(--color-text-muted)]" data-testid="run-age">
								{ageOf(run, now.current)}
							</p>
							<p class="font-mono text-xs text-[var(--color-text-muted)]">{run.blueprint_id}</p>
						</div>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</Page>

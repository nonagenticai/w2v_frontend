<script lang="ts">
	import { resolve } from '$app/paths';
	import { runs as runsApi } from '$lib/api';
	import RunStatusBadge from '$lib/components/runs/RunStatusBadge.svelte';
	import { Button, Skeleton } from '$lib/components/ui';
	import { PROJECT_TYPE_LABELS, type ProjectDetailResponse } from '$lib/types';
	import type { RunSummary } from '$lib/types/runs';
	import { formatRelativeTime } from '$lib/utils/format';
	import LatestOutput from './LatestOutput.svelte';

	// Always-visible summary strip under the project header. Surfaces the facts an
	// operator wants at a glance — type, counts, last run, latest output — and
	// links straight into the run-view Stage I/O Inspector. Pure addition: it does
	// not change the default section or any e2e-pinned testid.
	let { project }: { project: ProjectDetailResponse } = $props();

	// FOUR states, not two. This strip previously kept only `runList`, coerced a
	// failed fetch to `[]`, and rendered `—` for null — so "still loading", "the
	// request died" and "this project has never been run" were squashed into two
	// renderings, one of which ("0 runs / no last run") is an outright lie about
	// a 500. Loading and error are now first-class, and a FAILED load leaves
	// `runList` null so nothing downstream can read a count out of it.
	// Same loading/error/loaded shape as OutputsSection.svelte:54-64.
	let runList = $state<RunSummary[] | null>(null);
	// Starts TRUE: the $effect below fires after mount, so a `false` initial value
	// renders one frame of the loaded branch against a null runList — i.e. the
	// blank/zero flash this component is being fixed for.
	let loading = $state(true);
	let error = $state<unknown>(null);
	let loadedFor = $state<string | null>(null);

	const isCourse = $derived(project.type === 'course');
	const primaryCount = $derived(isCourse ? project.children.length : project.deliverables.length);
	const primaryLabel = $derived(isCourse ? 'Lessons' : 'Deliverables');

	// The run list is paged by the backend; a full page means "at least this
	// many", never an exact total — unless the backend sent `X-Total-Count`.
	const RUNS_PAGE = 50;
	let serverTotal = $state<number | null>(null);
	const totalRuns = $derived(runList === null ? null : (serverTotal ?? runList.length));
	const totalRunsLabel = $derived(
		serverTotal === null && totalRuns !== null && totalRuns >= RUNS_PAGE
			? `${RUNS_PAGE}+`
			: String(totalRuns)
	);
	const lastRun = $derived(runList?.[0] ?? null);
	const latestCompleted = $derived(runList?.find((r) => r.status === 'completed') ?? null);

	async function load() {
		loading = true;
		error = null;
		try {
			let total: number | null = null;
			runList = await runsApi.listForProject(project.id, {
				limit: RUNS_PAGE,
				onTotal: (n) => (total = n)
			});
			serverTotal = total;
		} catch (err) {
			// Deliberately NOT `runList = []`: an unreachable run history is not an
			// empty run history, and the tiles must say so.
			runList = null;
			serverTotal = null;
			error = err;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (loadedFor !== project.id) {
			loadedFor = project.id;
			void load();
		}
	});
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 md:p-5"
	data-testid="project-overview"
>
	<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
		<div
			class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
		>
			<p class="text-xs text-[var(--color-text-muted)]">Type</p>
			<p class="text-sm font-semibold text-[var(--color-text)] mt-1 truncate">
				{PROJECT_TYPE_LABELS[project.type] ?? project.type}
			</p>
		</div>
		<div
			class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
		>
			<p class="text-xs text-[var(--color-text-muted)]">{primaryLabel}</p>
			<p class="text-sm font-semibold text-[var(--color-text)] mt-1">{primaryCount}</p>
		</div>
		<div
			class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
		>
			<p class="text-xs text-[var(--color-text-muted)]">Total runs</p>
			{#if loading}
				<div class="mt-1" data-testid="overview-runs-loading">
					<Skeleton variant="text" width="2rem" height="1.25rem" />
				</div>
			{:else if error}
				<p
					class="text-sm font-semibold text-[var(--color-danger)] mt-1"
					data-testid="overview-runs-error"
				>
					Unavailable
				</p>
				<!-- Button forwards no rest props, so the testid lives on a wrapper —
				     the same shape as `edit-deliverable-btn` in DeliverablesSection. -->
				<span class="inline-block -ml-3" data-testid="overview-runs-retry-btn">
					<Button variant="ghost" size="sm" onclick={load}>Retry</Button>
				</span>
			{:else if totalRuns === 0}
				<p
					class="text-sm font-semibold text-[var(--color-text)] mt-1"
					data-testid="overview-no-runs"
				>
					0
				</p>
			{:else}
				<p class="text-sm font-semibold text-[var(--color-text)] mt-1">{totalRunsLabel}</p>
			{/if}
		</div>
		<div
			class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
		>
			<p class="text-xs text-[var(--color-text-muted)]">Last run</p>
			{#if loading}
				<div class="mt-1" data-testid="overview-last-run-loading">
					<Skeleton variant="text" width="5rem" height="1.25rem" />
				</div>
			{:else if error}
				<p
					class="text-sm font-semibold text-[var(--color-danger)] mt-1"
					data-testid="overview-last-run-error"
				>
					Unavailable
				</p>
			{:else if lastRun}
				<a
					href={resolve(`/projects/${project.id}/runs/${lastRun.id}`)}
					class="mt-1 flex items-center gap-1.5 group"
					data-testid="overview-last-run"
				>
					<RunStatusBadge
						status={lastRun.status}
						degraded={lastRun.degraded ?? false}
						pauseReason={lastRun.pause_reason}
					/>
					<span class="text-xs text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">
						{formatRelativeTime(lastRun.created_at)}
					</span>
				</a>
			{:else}
				<p class="text-sm font-semibold text-[var(--color-text)] mt-1">No runs yet</p>
			{/if}
		</div>
	</div>

	{#if latestCompleted}
		<LatestOutput
			projectId={project.id}
			projectTitle={project.title}
			projectType={project.type}
			run={latestCompleted}
		/>
	{/if}
</section>

<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import ReviewInboxBanner from '$lib/components/ReviewInboxBanner.svelte';
	import {
		Button,
		EmptyState,
		Pagination,
		Tabs,
		Pill,
		Select,
		Dialog,
		BrandMark
	} from '$lib/components/ui';
	import { PROJECT_TYPE_LABELS, type ProjectType, type ProjectResponse } from '$lib/types';
	import { CREATABLE_PROJECT_TYPES } from '$lib/studio/project-request';
	import {
		Briefcase,
		Plus,
		Sparkles,
		LayoutGrid,
		List,
		ArrowUp,
		ArrowDown,
		Trash2,
		Film,
		Clock,
		CheckCircle2,
		Link as LinkIcon
	} from '@lucide/svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		getSettings,
		updateProjectsView,
		type ProjectsLayout
	} from '$lib/stores/settings.svelte.js';
	import { removeProject } from '$lib/stores/projects.svelte.js';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import { formatRelativeTime, formatDateTime, extractHostname } from '$lib/utils/format.js';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { cancelRuns, listActiveRuns } from '$lib/utils/run-actions';
	import { runStatusLabel } from '$lib/utils/review-wait';
	import {
		PROJECT_STATUS_LABELS,
		projectStatusLabel,
		projectStatusTone as statusTone,
		type PillTone
	} from '$lib/utils/project-status';

	let { data } = $props();

	// The URL is the single source of truth. Each control derives its active
	// value from the loader output and navigates imperatively on change. A prior
	// local-$state mirror (synced from `data` by an unconditional $effect) fought
	// the type pills' plain onclick writes — the pill write was silently lost so
	// clicking a type filter did nothing — while the bound Tabs survived via
	// two-way binding. Deriving from the URL removes that tug-of-war entirely.
	let activeTab = $derived(data.currentStatus ?? '');
	let activeType = $derived((data.currentType as '' | ProjectType) ?? '');
	let activeSort = $derived(data.currentSort ?? 'created_at');
	let activeOrder = $derived((data.currentOrder as 'asc' | 'desc') ?? 'desc');
	let currentPage = $derived(data.currentPage ?? 1);

	// Layout is a persisted UI preference (localStorage), not a URL param.
	let layout = $state<ProjectsLayout>(getSettings().projectsView.layout);

	function setLayout(next: ProjectsLayout) {
		layout = next;
		updateProjectsView({ layout: next });
	}

	type NavPatch = {
		status?: string;
		type?: '' | ProjectType;
		sort?: string;
		order?: 'asc' | 'desc';
		page?: number;
	};

	// Merge a change over the current URL-derived state and navigate. `??` keeps
	// an explicit empty string (e.g. "All types" → type='') as a real value.
	function navigate(patch: NavPatch) {
		const next = {
			status: patch.status ?? activeTab,
			type: patch.type ?? activeType,
			sort: patch.sort ?? activeSort,
			order: patch.order ?? activeOrder,
			page: patch.page ?? currentPage
		};
		const params = new SvelteURLSearchParams();
		if (next.status) params.set('status', next.status);
		if (next.type) params.set('type', next.type);
		if (next.sort && next.sort !== 'created_at') params.set('sort', next.sort);
		if (next.order && next.order !== 'desc') params.set('order', next.order);
		if (next.page > 1) params.set('page', String(next.page));
		const qs = params.toString();
		goto(qs ? resolve(`/projects?${qs}`) : resolve('/projects'), {
			replaceState: true,
			noScroll: true
		});
	}

	function selectSort(value: string) {
		// Persist the chosen sort alongside the layout preference.
		updateProjectsView({ sortBy: value, order: activeOrder });
		navigate({ sort: value, page: 1 });
	}

	function toggleOrder() {
		const next = activeOrder === 'asc' ? 'desc' : 'asc';
		updateProjectsView({ sortBy: activeSort, order: next });
		navigate({ order: next, page: 1 });
	}

	const statusTabs = [
		{ value: '', label: 'All' },
		{ value: 'drafting', label: PROJECT_STATUS_LABELS.drafting },
		{ value: 'producing', label: PROJECT_STATUS_LABELS.producing },
		{ value: 'completed', label: PROJECT_STATUS_LABELS.completed },
		{ value: 'failed', label: PROJECT_STATUS_LABELS.failed },
		{ value: 'archived', label: PROJECT_STATUS_LABELS.archived }
	];

	// Derived from the shared CREATABLE_PROJECT_TYPES so the filter set + order
	// always match the New Project wizard (no more drift: the filter used to offer
	// the dormant `app_review` and omit the createable `web_design`). `app_review`
	// (dormant) and `lesson` (child-only, surfaced only when drilling into a
	// course) are intentionally excluded from that list.
	const typeChips: ReadonlyArray<{ value: '' | ProjectType; label: string }> = [
		{ value: '', label: 'All types' },
		...CREATABLE_PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_LABELS[t] }))
	];

	const sortOptions = [
		{ value: 'created_at', label: 'Created' },
		{ value: 'finished_at', label: 'Finished' },
		{ value: 'updated_at', label: 'Updated' },
		{ value: 'title', label: 'Title' },
		{ value: 'status', label: 'Status' },
		{ value: 'type', label: 'Type' }
	];

	function runStatusTone(status: string | null | undefined): PillTone {
		switch (status) {
			case 'completed':
				return 'success';
			case 'failed':
			case 'cancelled':
				return 'danger';
			case 'running':
			case 'pending':
				return 'accent';
			case 'paused':
				return 'warning';
			default:
				return 'neutral';
		}
	}

	function fmtRel(iso: string | null | undefined): string {
		return iso ? formatRelativeTime(iso) : '—';
	}

	// ─── Delete ──────────────────────────────────────────────────────────────
	// Deleting archives the project, and archiving does not stop its runs: a
	// producing project would keep executing (and spending) invisibly. So the
	// dialog first checks for active runs, says how many will be cancelled, and
	// cancels them before archiving.
	let deleteTarget = $state<ProjectResponse | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state(false);
	let activeRunIds = $state<string[] | null>(null);
	let activeRunsCheckFailed = $state(false);
	let deleteSeq = 0;

	function askDelete(project: ProjectResponse) {
		deleteTarget = project;
		deleteOpen = true;
		activeRunIds = null;
		activeRunsCheckFailed = false;
		const seq = ++deleteSeq;
		listActiveRuns(project.id)
			.then((active) => {
				if (seq === deleteSeq) activeRunIds = active.map((r) => r.id);
			})
			.catch(() => {
				if (seq === deleteSeq) activeRunsCheckFailed = true;
			});
	}

	async function confirmDelete() {
		if (!deleteTarget) return;
		const target = deleteTarget;
		deleting = true;
		try {
			// Re-read at confirm time: a run may have started since the dialog opened.
			const active = (await listActiveRuns(target.id)).map((r) => r.id);
			const notCancelled = await cancelRuns(active);
			if (notCancelled.length > 0) {
				toastError(
					'Delete stopped',
					`${notCancelled.length} active run${notCancelled.length === 1 ? '' : 's'} could not be cancelled, so the project was not deleted. Cancel ${notCancelled.length === 1 ? 'it' : 'them'} from the run page, then try again.`
				);
				return;
			}
			await removeProject(target.id);
			toastSuccess(
				'Project deleted',
				active.length > 0
					? `${target.title} (${active.length} active run${active.length === 1 ? '' : 's'} cancelled)`
					: target.title
			);
			deleteOpen = false;
			await invalidateAll();
		} catch (e) {
			toastError('Delete failed', e instanceof Error ? e.message : String(e));
		} finally {
			deleting = false;
		}
	}

	const emptyDescription = $derived.by(() => {
		if (activeTab && activeType)
			return `No ${activeTab} ${PROJECT_TYPE_LABELS[activeType].toLowerCase()} projects.`;
		if (activeTab) return `No ${activeTab} projects.`;
		if (activeType) return `No ${PROJECT_TYPE_LABELS[activeType].toLowerCase()} projects.`;
		return 'Create your first project to get started.';
	});
</script>

<svelte:head>
	<title>Projects - Studio</title>
</svelte:head>

<Page testid="projects-home">
	<PageHeader
		kicker="Create"
		title="Projects"
		subtitle="One creative brief per project; one or more deliverables per project."
	>
		{#snippet actions()}
			<Button variant="primary" href="/projects/new">
				<Plus class="h-4 w-4" />
				New project
			</Button>
		{/snippet}
	</PageHeader>

	<ReviewInboxBanner />

	<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by project type">
		{#each typeChips as chip (chip.value)}
			<button
				type="button"
				class="rounded-full px-3 py-1 text-xs font-medium transition border
        {activeType === chip.value
					? 'bg-[var(--color-accent)] text-[var(--color-on-primary)] border-[var(--color-accent)]'
					: 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] hover:border-[var(--color-border-strong)]'}"
				onclick={() => navigate({ type: chip.value, page: 1 })}
			>
				{chip.label}
			</button>
		{/each}
	</div>

	<Tabs
		items={statusTabs}
		value={activeTab}
		onValueChange={(v) => navigate({ status: v, page: 1 })}
	/>

	<!-- Sort + view-mode controls -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-end gap-2">
			<Select
				label="Sort by"
				name="sort"
				placeholder=""
				value={activeSort}
				onchange={(e) => selectSort((e.target as HTMLSelectElement).value)}
				options={sortOptions}
				class="w-40"
			/>
			<button
				type="button"
				onclick={toggleOrder}
				aria-label={activeOrder === 'asc' ? 'Ascending' : 'Descending'}
				title={activeOrder === 'asc' ? 'Ascending' : 'Descending'}
				class="mb-0.5 inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-strong)] transition"
			>
				{#if activeOrder === 'asc'}
					<ArrowUp class="h-4 w-4" />
				{:else}
					<ArrowDown class="h-4 w-4" />
				{/if}
			</button>
		</div>

		<div
			class="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden"
			role="group"
			aria-label="View mode"
		>
			<button
				type="button"
				onclick={() => setLayout('gallery')}
				aria-pressed={layout === 'gallery'}
				title="Gallery view"
				class="inline-flex items-center gap-1.5 px-3 py-2 text-sm transition {layout === 'gallery'
					? 'bg-[var(--color-accent)] text-[var(--color-on-primary)]'
					: 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)]'}"
			>
				<LayoutGrid class="h-4 w-4" />
				<span class="hidden sm:inline">Gallery</span>
			</button>
			<button
				type="button"
				onclick={() => setLayout('list')}
				aria-pressed={layout === 'list'}
				title="List view"
				class="inline-flex items-center gap-1.5 px-3 py-2 text-sm transition border-l border-[var(--color-border)] {layout ===
				'list'
					? 'bg-[var(--color-accent)] text-[var(--color-on-primary)]'
					: 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)]'}"
			>
				<List class="h-4 w-4" />
				<span class="hidden sm:inline">List</span>
			</button>
		</div>
	</div>

	{#if data.projectList.items.length === 0}
		<div data-testid="projects-empty-state">
			<EmptyState title="No projects found" description={emptyDescription}>
				{#snippet icon()}
					<Briefcase class="h-12 w-12" />
				{/snippet}
				{#snippet action()}
					{#if !activeTab}
						<Button variant="primary" href="/projects/new">
							<Plus class="h-4 w-4" />
							Create project
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		</div>
	{:else if layout === 'gallery'}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="project-grid">
			{#each data.projectList.items as project (project.id)}
				<div
					data-testid="project-card"
					data-project-id={project.id}
					data-project-type={project.type}
					data-project-status={project.status}
					class="group relative rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-accent)] hover:shadow-soft transition-all"
				>
					<a href={resolve(`/projects/${project.id}`)} class="block">
						<!-- scopedMediaUrl (here and in the table below): the browser fetches
						     these itself and can't send the X-Active-Tenant-Id header a
						     super-admin's tenant switch relies on. -->
						{#if project.thumbnail_url}
							<img
								src={scopedMediaUrl(project.thumbnail_url)}
								alt={`${project.title} preview`}
								loading="lazy"
								class="aspect-video w-full rounded-t-[var(--radius-lg)] border-b border-[var(--color-border)] object-cover bg-[var(--color-surface)]"
							/>
						{:else}
							<div
								class="aspect-video w-full rounded-t-[var(--radius-lg)] border-b border-[var(--color-border)] flex items-center justify-center bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_16%,var(--color-surface)),var(--color-surface))]"
								aria-hidden="true"
							>
								<BrandMark size={40} />
							</div>
						{/if}
						<div class="p-5">
							<div class="flex items-start justify-between gap-3 mb-2 pr-7">
								<h2 class="text-base font-semibold text-[var(--color-text)] truncate flex-1">
									{project.title}
								</h2>
								<div class="flex items-center gap-1.5 shrink-0">
									<Pill
										tone={statusTone(
											project.status,
											project.last_run_status,
											project.last_run_pause_reason
										)}
									>
										{projectStatusLabel(
											project.status,
											project.last_run_status,
											project.last_run_pause_reason
										)}
									</Pill>
								</div>
							</div>
							<p class="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
								<Sparkles class="h-3.5 w-3.5" />
								{PROJECT_TYPE_LABELS[project.type] ?? project.type}
							</p>
							{#if project.source_url}
								<p
									class="mt-1 text-xs text-[var(--color-text-muted)] flex items-center gap-1.5 truncate"
									title={project.source_url}
								>
									<LinkIcon class="h-3.5 w-3.5 shrink-0" />
									<span class="truncate">{extractHostname(project.source_url)}</span>
								</p>
							{/if}

							<div
								class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--color-text-muted)]"
							>
								<span class="inline-flex items-center gap-1" title="Deliverables">
									<Film class="h-3.5 w-3.5" />
									{project.deliverable_count ?? 0}
									{(project.deliverable_count ?? 0) === 1 ? 'deliverable' : 'deliverables'}
								</span>
								{#if project.last_run_status}
									<span class="inline-flex items-center gap-1">
										<Pill tone={runStatusTone(project.last_run_status)}>
											{runStatusLabel(project.last_run_status, project.last_run_pause_reason)}
										</Pill>
									</span>
								{/if}
							</div>

							<div
								class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-3"
							>
								<span
									class="inline-flex items-center gap-1"
									title={formatDateTime(project.created_at)}
								>
									<Clock class="h-3 w-3" /> Created {fmtRel(project.created_at)}
								</span>
								<span
									class="inline-flex items-center gap-1"
									title={formatDateTime(project.finished_at)}
								>
									<CheckCircle2 class="h-3 w-3" /> Finished {fmtRel(project.finished_at)}
								</span>
								<span title={formatDateTime(project.updated_at)}>
									Updated {fmtRel(project.updated_at)}
								</span>
								<span class="truncate text-right" title={`Owner ${project.owner_subject_id}`}>
									Owner {project.owner_subject_id.slice(0, 8)}
								</span>
							</div>
						</div>
					</a>
					<button
						type="button"
						onclick={() => askDelete(project)}
						aria-label="Delete project"
						title="Delete project"
						class="absolute top-3 right-3 rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-strong)] transition"
					>
						<Trash2 class="h-4 w-4" />
					</button>
				</div>
			{/each}
		</div>

		<Pagination
			page={currentPage}
			pageSize={20}
			total={data.projectList.total}
			onPageChange={(p) => navigate({ page: p })}
		/>
	{:else}
		<!-- List view -->
		<div class="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
			<table class="w-full text-sm" data-testid="project-table">
				<thead class="text-left text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)]">
					<tr class="border-b border-[var(--color-border)]">
						<th class="px-4 py-2.5 font-medium">Title</th>
						<th class="px-4 py-2.5 font-medium">Type</th>
						<th class="px-4 py-2.5 font-medium">Status</th>
						<th class="px-4 py-2.5 font-medium">Last run</th>
						<th class="px-4 py-2.5 font-medium text-right">Deliv.</th>
						<th class="px-4 py-2.5 font-medium">Created</th>
						<th class="px-4 py-2.5 font-medium">Finished</th>
						<th class="px-4 py-2.5 font-medium">Updated</th>
						<th class="px-4 py-2.5 font-medium"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.projectList.items as project (project.id)}
						<tr
							data-testid="project-row"
							data-project-id={project.id}
							data-project-type={project.type}
							data-project-status={project.status}
							class="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface)] transition"
						>
							<td class="px-4 py-2.5 max-w-[18rem]">
								<div class="flex items-center gap-2.5">
									{#if project.thumbnail_url}
										<img
											src={scopedMediaUrl(project.thumbnail_url)}
											alt=""
											loading="lazy"
											class="h-8 w-14 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] object-cover bg-[var(--color-surface)]"
										/>
									{:else}
										<div
											class="h-8 w-14 shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--color-surface))]"
											aria-hidden="true"
										></div>
									{/if}
									<div class="min-w-0">
										<a
											href={resolve(`/projects/${project.id}`)}
											class="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)] truncate block"
											title={project.title}
										>
											{project.title}
										</a>
										{#if project.source_url}
											<span
												class="block text-xs text-[var(--color-text-muted)] truncate"
												title={project.source_url}
											>
												{extractHostname(project.source_url)}
											</span>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap">
								{PROJECT_TYPE_LABELS[project.type] ?? project.type}
							</td>
							<td class="px-4 py-2.5">
								<Pill
									tone={statusTone(
										project.status,
										project.last_run_status,
										project.last_run_pause_reason
									)}
								>
									{projectStatusLabel(
										project.status,
										project.last_run_status,
										project.last_run_pause_reason
									)}
								</Pill>
							</td>
							<td class="px-4 py-2.5">
								{#if project.last_run_status}
									<Pill tone={runStatusTone(project.last_run_status)}>
										{runStatusLabel(project.last_run_status, project.last_run_pause_reason)}
									</Pill>
								{:else}
									<span class="text-[var(--color-text-muted)]">—</span>
								{/if}
							</td>
							<td class="px-4 py-2.5 text-right text-[var(--color-text-muted)]">
								{project.deliverable_count ?? 0}
							</td>
							<td
								class="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap"
								title={formatDateTime(project.created_at)}
							>
								{fmtRel(project.created_at)}
							</td>
							<td
								class="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap"
								title={formatDateTime(project.finished_at)}
							>
								{fmtRel(project.finished_at)}
							</td>
							<td
								class="px-4 py-2.5 text-[var(--color-text-muted)] whitespace-nowrap"
								title={formatDateTime(project.updated_at)}
							>
								{fmtRel(project.updated_at)}
							</td>
							<td class="px-4 py-2.5 text-right">
								<button
									type="button"
									onclick={() => askDelete(project)}
									aria-label="Delete project"
									title="Delete project"
									class="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-strong)] transition"
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<Pagination
			page={currentPage}
			pageSize={20}
			total={data.projectList.total}
			onPageChange={(p) => navigate({ page: p })}
		/>
	{/if}
</Page>

<Dialog bind:open={deleteOpen} title="Delete project?">
	<p class="text-sm text-[var(--color-text-muted)]">
		This archives <span class="font-medium text-[var(--color-text)]">{deleteTarget?.title}</span> and
		hides it from your active projects (it stays under the Archived tab). This cannot be undone from here.
	</p>
	{#if activeRunIds && activeRunIds.length > 0}
		<p
			class="text-sm font-medium text-[var(--color-danger-text)]"
			data-testid="delete-active-runs-warning"
		>
			{activeRunIds.length} run{activeRunIds.length === 1 ? ' is' : 's are'} still in progress or waiting
			for review. Deleting will cancel {activeRunIds.length === 1 ? 'it' : 'them'} first.
		</p>
	{:else if activeRunsCheckFailed}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="delete-active-runs-unknown">
			Couldn't check this project for active runs. Any that are running will be cancelled before the
			project is deleted.
		</p>
	{/if}
	<div class="flex justify-end gap-2">
		<Button variant="ghost" onclick={() => (deleteOpen = false)}>Cancel</Button>
		<Button variant="danger" loading={deleting} onclick={confirmDelete}>
			{activeRunIds && activeRunIds.length > 0 ? 'Cancel runs and delete' : 'Delete'}
		</Button>
	</div>
</Dialog>

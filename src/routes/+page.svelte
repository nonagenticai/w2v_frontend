<script lang="ts">
	import type { DashboardStats } from '$lib/types';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { StatsGrid } from '$lib/components/dashboard';
	import { EmptyState, ErrorState, Button, Card, BrandMark, Pill } from '$lib/components/ui';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import ReviewInboxBanner from '$lib/components/ReviewInboxBanner.svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import { Briefcase, Plus } from '@lucide/svelte';
	import { PROJECT_TYPE_LABELS } from '$lib/types';
	import { projectStatusLabel, projectStatusTone } from '$lib/utils/project-status';

	let { data } = $props();

	// Counts are fetched in +page.ts under the auth-ready gate. The loader returns
	// `projectsError` / `statusCountsError` so a failed load is NEVER rendered as
	// "you have no projects" or as real zeros: branch on them first.
	const stats: DashboardStats = $derived.by(() => {
		const countsKnown = data.statusCountsError === null;
		return {
			total: data.projectsError === null ? data.projectList.total : null,
			completed: countsKnown ? data.statusCounts.completed : null,
			producing: countsKnown ? data.statusCounts.running : null,
			failed: countsKnown ? data.statusCounts.failed : null
		};
	});

	const retry = () => invalidateAll();
</script>

<svelte:head>
	<title>Dashboard - Studio</title>
</svelte:head>

<Page testid="dashboard">
	<PageHeader
		kicker="Overview"
		title="Dashboard"
		subtitle="Track project progress, inspect runs, and relaunch from one place."
	>
		{#snippet actions()}
			<Button variant="primary" href="/projects/new">
				<Plus class="h-4 w-4" />
				New project
			</Button>
		{/snippet}
	</PageHeader>

	<ReviewInboxBanner />

	{#if data.statusCountsError && !data.projectsError}
		<p class="text-sm text-[var(--color-warning-text)]" data-testid="dashboard-counts-error">
			Some project counts could not be loaded ({data.statusCountsError.detail}). They show as “—”
			until a reload succeeds.
		</p>
	{/if}
	<StatsGrid
		{stats}
		hrefs={{
			total: '/projects',
			completed: '/projects?status=completed',
			producing: '/projects?status=producing',
			failed: '/projects?status=failed'
		}}
	/>

	<section>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-lg font-semibold text-text">Recent projects</h2>
			<Button variant="secondary" size="sm" href="/projects">View all</Button>
		</div>
		{#if data.projectsError}
			<!-- A load that did not answer is not "no projects". -->
			<div data-testid="dashboard-projects-error">
				<ErrorState
					title="Couldn't load your projects"
					error={data.projectsError.status
						? `${data.projectsError.status}: ${data.projectsError.detail}`
						: data.projectsError.detail}
					onRetry={retry}
				/>
			</div>
		{:else if data.projectList.items.length === 0}
			<Card>
				<div data-testid="dashboard-empty">
					<EmptyState
						title="No projects yet"
						description="A project turns a website, app or brief into a narrated video."
					>
						{#snippet icon()}
							<Briefcase class="h-12 w-12" />
						{/snippet}
						{#snippet action()}
							<ol
								class="mx-auto mb-5 max-w-md space-y-2 text-left text-sm text-[var(--color-text)]"
								data-testid="first-run-checklist"
							>
								<li>
									<span class="font-semibold">1.</span> Pick a project type — demo, promo, course or review.
								</li>
								<li>
									<span class="font-semibold">2.</span>
									{#if isTenantAdmin()}
										If your workspace brings its own AI providers, connect them in
										<a class="underline hover:opacity-80" href={resolve('/providers')}>
											Providers
										</a>.
									{:else}
										If your workspace brings its own AI providers, ask a workspace admin to connect
										them.
									{/if}
								</li>
								<li>
									<span class="font-semibold">3.</span> Add a source and a brief, then start the
									run. Voice and caption defaults live in
									<a class="underline hover:opacity-80" href={resolve('/settings')}>Settings</a>.
								</li>
							</ol>
							<Button variant="primary" href="/projects/new">
								<Plus class="h-4 w-4" />
								Create your first project
							</Button>
						{/snippet}
					</EmptyState>
				</div>
			</Card>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each data.projectList.items as project (project.id)}
					<a href={resolve(`/projects/${project.id}`)} class="block">
						<Card hover class="overflow-hidden">
							<!-- scopedMediaUrl: the <img> is fetched by the browser, which can't
							     send the X-Active-Tenant-Id header a tenant switch relies on. -->
							{#if project.thumbnail_url}
								<img
									src={scopedMediaUrl(project.thumbnail_url)}
									alt={`${project.title} preview`}
									loading="lazy"
									class="aspect-video w-full border-b border-border object-cover bg-surface"
								/>
							{:else}
								<div
									class="aspect-video w-full flex items-center justify-center border-b border-border bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_16%,var(--color-surface)),var(--color-surface))]"
									aria-hidden="true"
								>
									<BrandMark size={40} />
								</div>
							{/if}
							<div class="p-4 md:p-5 space-y-2">
								<div class="flex items-center justify-between gap-2">
									<p class="text-xs uppercase tracking-wide text-text-muted">
										{PROJECT_TYPE_LABELS[project.type] ?? project.type}
									</p>
									<Pill
										tone={projectStatusTone(
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
								<h3 class="text-base font-semibold text-text truncate">
									{project.title}
								</h3>
								<p class="text-xs text-text-muted">
									{project.deliverable_count ?? 0}
									{(project.deliverable_count ?? 0) === 1 ? 'deliverable' : 'deliverables'}
								</p>
							</div>
						</Card>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</Page>

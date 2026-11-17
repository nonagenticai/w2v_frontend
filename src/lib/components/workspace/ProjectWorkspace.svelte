<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Pill } from '$lib/components/ui';
	import { ChevronRight, Sparkles } from '@lucide/svelte';
	import { PROJECT_TYPE_LABELS, type ProjectDetailResponse } from '$lib/types';
	import WorkspaceNav from './WorkspaceNav.svelte';
	import BranchBanner from './BranchBanner.svelte';
	import {
		blueprintStagesFor,
		demoVideoLacksRecording,
		homeTestId,
		resolveSection,
		sectionsFor,
		type SectionId
	} from './workspace-sections';
	import ProjectOverview from './sections/ProjectOverview.svelte';
	import DeliverablesSection from './sections/DeliverablesSection.svelte';
	import LessonsSection from './sections/LessonsSection.svelte';
	import BriefSection from './sections/BriefSection.svelte';
	import VerbatimSection from './sections/VerbatimSection.svelte';
	import StoryboardSection from './sections/StoryboardSection.svelte';
	import OutputsSection from './sections/OutputsSection.svelte';
	import RunHistorySection from './sections/RunHistorySection.svelte';

	let {
		project,
		blueprintStages = []
	}: { project: ProjectDetailResponse; blueprintStages?: string[] } = $props();

	const sections = $derived(sectionsFor(project));
	const active = $derived(resolveSection(page.url.searchParams.get('section'), sections));
	const stages = $derived(blueprintStagesFor(project, blueprintStages));
	const testId = $derived(homeTestId(project.type));

	type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
	function statusTone(status: string): PillTone {
		switch (status) {
			case 'producing':
				return 'accent';
			case 'completed':
				return 'success';
			case 'failed':
				return 'danger';
			case 'archived':
				return 'warning';
			default:
				return 'neutral';
		}
	}

	const subtitle = $derived.by(() => {
		if (project.type === 'course') {
			return `${project.children.length} lesson${project.children.length === 1 ? '' : 's'}`;
		}
		const n = project.deliverables.length;
		return `${n} deliverable${n === 1 ? '' : 's'}`;
	});

	// Section is held in the URL so it's linkable + back/forward works. The
	// default section drops the query; others push `?section=` as a real history
	// entry (so Back returns to the previous section).
	function selectSection(id: SectionId) {
		const url =
			id === sections[0].id
				? resolve(`/projects/${project.id}`)
				: resolve(`/projects/${project.id}?section=${id}`);
		goto(url, { noScroll: true, keepFocus: true });
	}
</script>

<div class="space-y-6" data-testid={testId}>
	<!-- You-are-here for branch projects. Absent (not empty) on ordinary projects. -->
	{#if project.branch}
		<BranchBanner branch={project.branch} />
	{/if}

	<!-- Header -->
	<div class="space-y-1">
		<p class="text-kicker text-[var(--color-text-muted)] flex items-center gap-1.5">
			<a href={resolve('/projects')} class="hover:text-[var(--color-text)]">Projects</a>
			<ChevronRight class="h-3 w-3" />
			<span class="truncate">{project.title}</span>
		</p>
		<div class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<h1 class="font-display text-2xl font-bold text-[var(--color-text)] truncate">
					{project.title}
				</h1>
				<p class="text-xs text-[var(--color-text-muted)] mt-1 flex items-center gap-1.5">
					<Sparkles class="h-3.5 w-3.5" />
					{PROJECT_TYPE_LABELS[project.type] ?? project.type} · {subtitle}
				</p>
			</div>
			<Pill tone={statusTone(project.status)}>{project.status}</Pill>
		</div>
	</div>

	<!-- Always-visible summary strip: type / counts / last run / latest output -->
	<ProjectOverview {project} />

	<!-- Master-detail: section nav + active pane -->
	<div class="grid gap-6 md:grid-cols-[200px_1fr]">
		<WorkspaceNav {sections} {active} onSelect={selectSection} />

		<div class="min-w-0">
			{#if active === 'deliverables'}
				<DeliverablesSection {project} {stages} />
			{:else if active === 'lessons'}
				<LessonsSection {project} {stages} />
			{:else if active === 'brief'}
				<BriefSection {project} />
			{:else if active === 'verbatim'}
				<VerbatimSection {project} />
			{:else if active === 'storyboard'}
				{#if demoVideoLacksRecording(project)}
					<div
						class="mb-4 rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-text)]"
						role="note"
						data-testid="demo-storyboard-warning"
					>
						<p class="font-semibold">A storyboard replaces the screen recording</p>
						<p class="mt-1 text-[var(--color-text-muted)]">
							Once this demo video has storyboard panels, the run narrates the panels instead of
							recording the target site. This project has no recording package, so the result would
							be a text-card video with no screen recording, and starting a run is blocked while
							panels exist. Leave the storyboard empty to record the site.
						</p>
					</div>
				{/if}
				<StoryboardSection {project} />
			{:else if active === 'outputs'}
				<OutputsSection {project} />
			{:else if active === 'history'}
				<RunHistorySection {project} />
			{/if}
		</div>
	</div>
</div>

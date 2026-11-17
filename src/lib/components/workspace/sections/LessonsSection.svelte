<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Button, ErrorState } from '$lib/components/ui';
	import { ListOrdered, Plus } from '@lucide/svelte';
	import { ApiError } from '$lib/api';
	import {
		addChild as addChildProject,
		reorderChildren as reorderChildProjects
	} from '$lib/stores/projects.svelte.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import type { ProjectDetailResponse } from '$lib/types';
	import ChildProjectList from '$lib/components/studio/ChildProjectList.svelte';
	import { RunLauncher } from '$lib/components/runs';

	let { project, stages = [] }: { project: ProjectDetailResponse; stages?: string[] } = $props();

	let addingLesson = $state(false);

	// The course's OWN deliverable: a course-level run executes the course
	// blueprint (lesson sub-DAGs inside course_compile_lessons). The wizard
	// starts it on deliverables[0]; this is the same launch for a course saved
	// as a draft, or whose run failed / was cancelled. run_engine skips a
	// course with no lesson children, so the launcher needs at least one.
	const courseDeliverable = $derived(project.deliverables[0] ?? null);
	const hasLessons = $derived(project.children.length > 0);

	// `stages` is `[]` for BOTH "no blueprint is published" and "GET /api/blueprints
	// failed", and the empty-state copy below asserts the first one out loud. The
	// route loader now publishes the distinction as a sibling key on `page.data`
	// (see projects/[pid]/+page.ts). It is read here rather than threaded through
	// ProjectWorkspace as a prop because no component between the loader and this
	// one has any use for it — ProjectWorkspace already reads `page` for the same
	// reason. `page.data` is optional-chained: a test that stubs `$app/state` with
	// only `url` must not crash this section.
	const blueprintsError = $derived(
		(page.data as { blueprintsError?: unknown } | undefined)?.blueprintsError ?? null
	);

	async function handleReorder(order: string[]) {
		try {
			await reorderChildProjects(project.id, { ordered_child_ids: order });
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Reorder failed';
			toastError('Reorder failed', detail);
		}
	}

	async function handleAddLesson() {
		addingLesson = true;
		try {
			const next = project.children.length + 1;
			await addChildProject(project.id, {
				type: 'lesson',
				title: `Lesson ${next}`,
				brief: {},
				deliverables: [{ name: `Lesson ${next}`, format: '16x9', captions_mode: 'none' }]
			});
			toastSuccess('Lesson added', `Lesson ${next}`);
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Add lesson failed';
			toastError('Add lesson failed', detail);
		} finally {
			addingLesson = false;
		}
	}
</script>

<div class="space-y-6">
	<!-- Unconditional section with an explicit `{:else}` — see the same change in
	     DeliverablesSection. A missing blueprint used to delete the whole preview
	     silently. The `{:else}` renders zero `stage-row` elements on purpose. -->
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-3"
		data-testid="course-stages"
	>
		<div class="flex items-center gap-2">
			<ListOrdered class="h-4 w-4 text-[var(--color-accent)]" />
			<h2 class="text-base font-semibold text-[var(--color-text)]">Course blueprint stages</h2>
		</div>
		{#if stages.length}
			<p class="text-xs text-[var(--color-text-muted)]">
				A course-level run executes these {stages.length} stages, with lesson sub-DAGs running in parallel
				inside <code class="font-mono">course_compile_lessons</code>. Lessons can also be run
				individually from their own pages.
			</p>
			<ol class="grid gap-1.5">
				{#each stages as stageName, idx (stageName)}
					<li
						data-testid="stage-row"
						data-stage={stageName}
						class="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
					>
						<span class="text-xs text-[var(--color-text-muted)] tabular-nums w-5">{idx + 1}.</span>
						<span class="font-mono">{stageName}</span>
					</li>
				{/each}
			</ol>
		{:else if blueprintsError}
			<!-- A failed /api/blueprints fetch. The `stages-empty-state` copy below is
			     a statement about the PRODUCT ("no blueprint is published") and must
			     never be shown for a transport failure. -->
			<div data-testid="stages-unavailable">
				<ErrorState
					error={blueprintsError}
					title="Course blueprint stages unavailable"
					onRetry={() => void invalidateAll()}
				/>
			</div>
		{:else}
			<p class="text-xs text-[var(--color-text-muted)]" data-testid="stages-empty-state">
				No course blueprint is published, so there are no stages to preview here. Runs still start
				normally — the pipeline resolves its stages when the run begins, and live status appears on
				the run detail page.
			</p>
		{/if}
	</section>

	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-3"
		data-testid="course-run"
	>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<h2 class="text-base font-semibold text-[var(--color-text)]">Course run</h2>
				<p class="text-xs text-[var(--color-text-muted)] mt-1">
					Produces every lesson and stitches them into the course.
				</p>
			</div>
			{#if !courseDeliverable}
				<p class="text-xs text-[var(--color-text-muted)]" data-testid="course-run-unavailable">
					This course has no deliverable to run.
				</p>
			{:else if !hasLessons}
				<p class="text-xs text-[var(--color-text-muted)]" data-testid="course-run-needs-lessons">
					Add at least one lesson before starting the course run.
				</p>
			{:else}
				<div data-testid="start-course-run">
					<RunLauncher
						deliverableId={courseDeliverable.id}
						deliverableStatus={courseDeliverable.status}
						label="Start course run"
					/>
				</div>
			{/if}
		</div>
	</section>

	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold text-[var(--color-text)]">Lessons</h2>
			<Button
				variant="primary"
				size="sm"
				loading={addingLesson}
				disabled={addingLesson}
				onclick={handleAddLesson}
			>
				<Plus class="h-3.5 w-3.5" /> Add lesson
			</Button>
		</div>

		<!-- No `onStart`: every row gets "Open". A lesson row's action only ever
		     navigated into the lesson; labelling it "Start" promised a run it
		     did not start. Lessons are run from their own page. -->
		<ChildProjectList children={project.children} onReorder={handleReorder} />
	</section>
</div>

<script lang="ts">
	import { ApiError, storyboard as storyboardApi } from '$lib/api';
	import { demoVideoLacksRecording } from '../workspace-sections';
	import { resolve } from '$app/paths';
	import { Button, Dialog, EmptyState, Pill } from '$lib/components/ui';
	import { NEEDS_REVIEW, PAUSED } from '$lib/utils/review-wait';
	import DeliverableConfig from '$lib/components/studio/DeliverableConfig.svelte';
	import { RunLauncher } from '$lib/components/runs';
	import {
		DELIVERABLE_FORMAT_LABELS,
		type DeliverableInput,
		type DeliverableResponse,
		type DeliverableUpdateRequest,
		type ProjectDetailResponse
	} from '$lib/types';
	import {
		add as addDeliverable,
		update as updateDeliverable,
		remove as removeDeliverable
	} from '$lib/stores/deliverables.svelte.js';
	import { getOne, loadOne } from '$lib/stores/projects.svelte.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { ChevronLeft, Film, ListOrdered, Pencil, Plus, Trash2 } from '@lucide/svelte';

	let { project, stages = [] }: { project: ProjectDetailResponse; stages?: string[] } = $props();

	type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
	// Same words as every other surface (src/lib/utils/review-wait.ts): a run parked
	// at a checkpoint "Needs review"; one someone paused is just "Paused".
	const DELIVERABLE_STATUS_LABELS: Record<string, string> = {
		idle: 'Idle',
		running: 'Running',
		awaiting_review: NEEDS_REVIEW,
		paused: PAUSED,
		completed: 'Completed',
		failed: 'Failed'
	};
	function deliverableTone(status: string): PillTone {
		switch (status) {
			case 'running':
				return 'accent';
			case 'awaiting_review':
			case 'paused':
				return 'warning';
			case 'completed':
				return 'success';
			case 'failed':
				return 'danger';
			default:
				return 'neutral';
		}
	}

	// Lesson-only: lazy-load the parent course to render the "Lesson N of M"
	// banner (lifted from LessonProjectHome).
	// The component is rendered unkeyed and same-route nav (lesson → its course,
	// lesson of A → lesson of B) swaps `project` on the LIVE instance, so every
	// path through this effect must WRITE `parent` — an early return that left
	// the previous value in place rendered a course's own breadcrumb linking to
	// itself, and filed B's lesson under A's course.
	let parent = $state<ProjectDetailResponse | undefined>(undefined);
	// Monotonic token so a slow response for the project we just left cannot
	// land after a faster one for the project we are now on.
	let parentSeq = 0;
	$effect(() => {
		const parentId = project.type === 'lesson' ? project.parent_project_id : undefined;
		const seq = ++parentSeq;
		if (!parentId) {
			parent = undefined;
			return;
		}
		const cached = getOne(parentId);
		if (cached) {
			parent = cached;
		} else {
			// Clear first: showing the OLD parent while the new one loads is the
			// same wrong banner, just briefer.
			parent = undefined;
			loadOne(parentId)
				.then((p) => {
					if (seq === parentSeq) parent = p;
				})
				.catch(() => {
					// Best-effort; absence of the banner is acceptable.
				});
		}
	});

	// demo_video: persisted storyboard panels switch the run to the AUTHORED
	// path, which skips test generation and records only from brief.package_url.
	// The demo_video wizard never collects a package, so panels + no package =
	// a narrated text-card video with no screen recording at all. Refuse that
	// launch with the reason instead of billing a run that cannot do the job.
	let storyboardPanelCount = $state<number | null>(null);
	let panelSeq = 0;
	$effect(() => {
		const seq = ++panelSeq;
		const projectId = project.id;
		if (!demoVideoLacksRecording(project)) {
			storyboardPanelCount = null;
			return;
		}
		storyboardApi
			.listPanels(projectId)
			.then((res) => {
				if (seq === panelSeq) storyboardPanelCount = res.total ?? res.items.length;
			})
			.catch(() => {
				// Unknown is not "none": leave the launcher unblocked rather than
				// invent a reason, the run page will show what happened.
				if (seq === panelSeq) storyboardPanelCount = null;
			});
	});
	const launchBlockedReason = $derived(
		storyboardPanelCount !== null && storyboardPanelCount > 0
			? 'This demo video has storyboard panels but no recording package, so the run would make a narrated text-card video with no screen recording. Remove the storyboard panels to record the target site instead.'
			: null
	);

	let showAddForm = $state(false);
	let pendingDeliverable = $state<DeliverableInput>({
		name: '',
		format: '16x9',
		target_duration_seconds: null,
		captions_mode: 'none'
	});
	let isAdding = $state(false);

	// Unique-name validation (deliverable-config.feature): a deliverable name
	// must be unique within the project, case-insensitively.
	const trimmedName = $derived(pendingDeliverable.name.trim());
	const duplicateName = $derived(
		trimmedName.length > 0 &&
			project.deliverables.some((d) => d.name.trim().toLowerCase() === trimmedName.toLowerCase())
	);

	// The server's TYPED rejection (e.g. a target duration below the orchestrator's
	// floor) arrives as `ApiError.detail`. It used to go ONLY to a toast, which
	// self-dismisses and leaves the still-open form saying nothing about why the
	// save failed — indistinguishable from a generic failure. Keep the toast and
	// ALSO pin the same detail inline, the way ReviewStep pins `cw.submitError`.
	let addError = $state<string | null>(null);

	async function handleAdd() {
		if (!trimmedName || duplicateName) return;
		isAdding = true;
		addError = null;
		try {
			await addDeliverable(project.id, pendingDeliverable);
			toastSuccess('Deliverable added', pendingDeliverable.name);
			pendingDeliverable = {
				name: '',
				format: '16x9',
				target_duration_seconds: null,
				captions_mode: 'none'
			};
			showAddForm = false;
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Failed to add deliverable';
			addError = detail;
			toastError('Could not add deliverable', detail);
		} finally {
			isAdding = false;
		}
	}

	// --- Edit (D1) -------------------------------------------------------------
	// The deliverable currently being edited (drives the edit Dialog's open state)
	// and a working draft seeded from its fields.
	let editing = $state<DeliverableResponse | null>(null);
	let editDraft = $state<DeliverableInput>({
		name: '',
		format: '16x9',
		target_duration_seconds: null,
		captions_mode: 'none'
	});
	let isSaving = $state(false);
	/** Same inline surfacing as `addError`, for the edit dialog. */
	let saveError = $state<string | null>(null);

	function openEdit(deliverable: DeliverableResponse) {
		editing = deliverable;
		saveError = null;
		editDraft = {
			name: deliverable.name,
			format: deliverable.format,
			target_duration_seconds: deliverable.target_duration_seconds ?? null,
			captions_mode: deliverable.captions_mode
		};
	}

	const editTrimmedName = $derived(editDraft.name.trim());
	// Same case-insensitive uniqueness rule as create, but the row being edited
	// is allowed to keep its own name.
	const editDuplicateName = $derived(
		editTrimmedName.length > 0 &&
			project.deliverables.some(
				(d) => d.id !== editing?.id && d.name.trim().toLowerCase() === editTrimmedName.toLowerCase()
			)
	);

	function draftToUpdate(d: DeliverableInput): DeliverableUpdateRequest {
		return {
			name: d.name.trim(),
			format: d.format,
			target_duration_seconds: d.target_duration_seconds ?? null,
			captions_mode: d.captions_mode
		};
	}

	async function handleSave() {
		if (!editing || !editTrimmedName || editDuplicateName) return;
		const target = editing;
		isSaving = true;
		saveError = null;
		try {
			await updateDeliverable(project.id, target.id, draftToUpdate(editDraft));
			toastSuccess('Deliverable updated', editTrimmedName);
			editing = null;
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Failed to update deliverable';
			saveError = detail;
			toastError('Could not update deliverable', detail);
		} finally {
			isSaving = false;
		}
	}

	// --- Remove (D1) -----------------------------------------------------------
	let removing = $state<DeliverableResponse | null>(null);
	let isRemoving = $state(false);

	async function handleRemove() {
		if (!removing) return;
		const target = removing;
		isRemoving = true;
		try {
			await removeDeliverable(project.id, target.id);
			toastSuccess('Deliverable removed', target.name);
			removing = null;
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Failed to remove deliverable';
			toastError('Could not remove deliverable', detail);
		} finally {
			isRemoving = false;
		}
	}
</script>

<div class="space-y-6">
	{#if parent}
		<a
			href={resolve(`/projects/${parent.id}`)}
			class="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)]"
		>
			<ChevronLeft class="h-3.5 w-3.5" />
			{parent.title} · Lesson {project.position ?? '?'} of {parent.children.length}
		</a>
	{/if}

	<!-- The section itself is unconditional now. It used to be wrapped in
	     `{#if stages.length}` with no `{:else}`, so a project type with no
	     published blueprint made the whole preview vanish and a tester could not
	     tell "no blueprint" from "the stage preview is broken". The `{:else}`
	     renders ZERO `stage-row` elements, so a stage-row count stays exact. -->
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-3"
		data-testid={`${project.type === 'lesson' ? 'lesson' : project.type === 'app_review' ? 'app-review' : 'promo'}-stages`}
	>
		<div class="flex items-center gap-2">
			<ListOrdered class="h-4 w-4 text-[var(--color-accent)]" />
			<h2 class="text-base font-semibold text-[var(--color-text)]">Blueprint stages</h2>
		</div>
		{#if stages.length}
			<p class="text-xs text-[var(--color-text-muted)]">
				Each run executes these {stages.length} stages in order. Live status appears on the run detail
				page.
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
		{:else}
			<p class="text-xs text-[var(--color-text-muted)]" data-testid="stages-empty-state">
				No blueprint is published for this project type, so there are no stages to preview here.
				Runs still start normally — the pipeline resolves its stages when the run begins, and live
				status appears on the run detail page.
			</p>
		{/if}
	</section>

	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold text-[var(--color-text)]">Deliverables</h2>
			<Button variant="secondary" size="sm" onclick={() => (showAddForm = !showAddForm)}>
				<Plus class="h-3.5 w-3.5" />
				{showAddForm ? 'Cancel' : 'Add deliverable'}
			</Button>
		</div>

		{#if showAddForm}
			<!-- `add-deliverable-form` because the edit Dialog stays mounted while
			     closed, so its DeliverableConfig renders a SECOND
			     input[name="deliverable-name"] / select[name="deliverable-format"].
			     Unscoped field queries are a strict-mode violation. -->
			<div
				data-testid="add-deliverable-form"
				class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
			>
				<DeliverableConfig bind:deliverable={pendingDeliverable} />
				{#if duplicateName}
					<p class="text-xs text-[var(--color-danger)]" data-testid="deliverable-name-error">
						A deliverable named “{trimmedName}” already exists in this project.
					</p>
				{/if}
				{#if addError}
					<p class="text-xs text-[var(--color-danger)]" data-testid="add-deliverable-error">
						{addError}
					</p>
				{/if}
				<div class="flex justify-end">
					<Button
						variant="primary"
						disabled={!trimmedName || duplicateName || isAdding}
						loading={isAdding}
						onclick={handleAdd}
					>
						Add deliverable
					</Button>
				</div>
			</div>
		{/if}

		{#if project.deliverables.length === 0}
			<!-- "Add one above" pointed at the header toggle, which is COLLAPSED by
			     default — the instruction referred to something not on screen. The
			     CTA opens that same form instead of describing it. Its label is
			     deliberately NOT "Add deliverable": the e2e helper clicks
			     `getByRole('button', { name: 'Add deliverable' }).first()` and
			     Playwright matches accessible names by substring. -->
			<div data-testid="deliverables-empty-state">
				<EmptyState
					title="No deliverables yet"
					description="A deliverable is one finished output this project produces — a single video in one aspect ratio, with its own captions setting and target duration. A project needs at least one before a run can be started."
				>
					{#snippet icon()}
						<Film class="h-12 w-12" />
					{/snippet}
					{#snippet action()}
						<span data-testid="add-first-deliverable-btn">
							<Button variant="primary" onclick={() => (showAddForm = true)}>
								<Plus class="h-4 w-4" />
								Add your first deliverable
							</Button>
						</span>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			<div class="space-y-2">
				{#each project.deliverables as deliverable (deliverable.id)}
					<!-- `deliverable-row` mirrors the gallery's `project-card` hook: the
					     per-row controls already carry testids, but nothing identified the
					     ROW, so "Hero Reel shows captions burned_in" had no element to
					     scope to. -->
					<div
						data-testid="deliverable-row"
						data-deliverable-id={deliverable.id}
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<a
									href={resolve(`/projects/${project.id}/deliverables/${deliverable.id}`)}
									class="text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] truncate"
								>
									{deliverable.name}
								</a>
								<Pill tone={deliverableTone(deliverable.status)}
									>{DELIVERABLE_STATUS_LABELS[deliverable.status] ?? deliverable.status}</Pill
								>
							</div>
							<p class="text-xs text-[var(--color-text-muted)] mt-1">
								{DELIVERABLE_FORMAT_LABELS[deliverable.format]}
								{#if deliverable.target_duration_seconds !== null && deliverable.target_duration_seconds !== undefined}
									· {deliverable.target_duration_seconds}s
								{/if}
								· {deliverable.captions_mode} captions
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<span data-testid="edit-deliverable-btn" data-deliverable-id={deliverable.id}>
								<Button variant="ghost" size="sm" onclick={() => openEdit(deliverable)}>
									<Pencil class="h-3.5 w-3.5" />
									<span class="sr-only">Edit {deliverable.name}</span>
								</Button>
							</span>
							<span data-testid="remove-deliverable-btn" data-deliverable-id={deliverable.id}>
								<Button variant="ghost" size="sm" onclick={() => (removing = deliverable)}>
									<Trash2 class="h-3.5 w-3.5 text-[var(--color-danger)]" />
									<span class="sr-only">Remove {deliverable.name}</span>
								</Button>
							</span>
							<div data-testid="start-run-btn" data-deliverable-id={deliverable.id}>
								<RunLauncher
									deliverableId={deliverable.id}
									deliverableStatus={deliverable.status}
									blockedReason={launchBlockedReason}
								/>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<!-- Edit deliverable -->
<Dialog open={editing !== null} title="Edit deliverable">
	<div class="space-y-3" data-testid="edit-deliverable-dialog">
		<DeliverableConfig bind:deliverable={editDraft} />
		{#if editDuplicateName}
			<p class="text-xs text-[var(--color-danger)]" data-testid="edit-deliverable-name-error">
				A deliverable named “{editTrimmedName}” already exists in this project.
			</p>
		{/if}
		{#if saveError}
			<p class="text-xs text-[var(--color-danger)]" data-testid="edit-deliverable-error">
				{saveError}
			</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button variant="secondary" disabled={isSaving} onclick={() => (editing = null)}>
				Cancel
			</Button>
			<Button
				variant="primary"
				disabled={!editTrimmedName || editDuplicateName || isSaving}
				loading={isSaving}
				onclick={handleSave}
			>
				Save changes
			</Button>
		</div>
	</div>
</Dialog>

<!-- Remove deliverable -->
<Dialog open={removing !== null} title="Remove deliverable">
	<div class="space-y-4" data-testid="remove-deliverable-dialog">
		<p class="text-sm text-[var(--color-text-muted)]">
			Remove <span class="font-semibold text-[var(--color-text)]">{removing?.name}</span>? This
			deletes the deliverable and its run history. This cannot be undone.
		</p>
		<div class="flex justify-end gap-2">
			<Button variant="secondary" disabled={isRemoving} onclick={() => (removing = null)}>
				Cancel
			</Button>
			<Button variant="danger" disabled={isRemoving} loading={isRemoving} onclick={handleRemove}>
				Remove
			</Button>
		</div>
	</div>
</Dialog>

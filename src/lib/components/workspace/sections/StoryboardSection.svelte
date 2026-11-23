<script lang="ts">
	import SceneBoard from '$lib/components/studio/storyboard/SceneBoard.svelte';
	import AssetLibrary from '$lib/components/studio/storyboard/AssetLibrary.svelte';
	import StoryboardVersions from '$lib/components/studio/storyboard/StoryboardVersions.svelte';
	import StoryboardBranches from '$lib/components/studio/storyboard/StoryboardBranches.svelte';
	import {
		createPanel,
		updatePanel,
		deletePanel,
		reorderPanels,
		getProjectList,
		getProject,
		loadProject,
		isProjectLoading,
		loadScenes,
		draftFromBrief,
		rewritePanel,
		isPanelBusy,
		backfillFromBrief,
		getPanelConflict,
		dismissPanelConflict,
		getBoardReloadSeq
	} from '$lib/stores/storyboard.svelte.js';
	import { ApiError } from '$lib/api';
	import { briefHasDraftableText } from '$lib/studio/project-request';
	import { downloads } from '$lib/api/downloads.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { Skeleton } from '$lib/components/ui';
	import { Download, Plus } from '@lucide/svelte';
	import type {
		ProjectDetailResponse,
		StoryboardPanelDraft,
		StoryboardDraftRequest,
		StoryboardPanelCreate,
		StoryboardPanelListResponse
	} from '$lib/types';

	let { project }: { project: ProjectDetailResponse } = $props();

	// Fields on StoryboardPanelCreate we mirror from an inline brief panel during
	// backfill. shot_key is handled separately (always set / re-derived).
	const BACKFILL_KEYS = [
		'action_description',
		'dialogue',
		'vo_text',
		'shot_size',
		'angle',
		'movement',
		'transition_out',
		'duration_seconds',
		'shot_number',
		'status'
	] as const;

	// Guard so the one-shot brief→table backfill can't re-fire when the cache
	// refresh it triggers re-runs the mount effect. Keyed by project id, because
	// SvelteKit reuses this component instance across [pid] navigations — a bare
	// boolean would skip backfill for every project after the first.
	let backfillDoneFor: string | null = null;

	function mapBriefPanels(raw: Record<string, unknown>[]): StoryboardPanelCreate[] {
		return raw.map((p, i) => {
			const shotKey = typeof p.shot_key === 'string' && p.shot_key ? p.shot_key : `clip-${i + 1}`;
			const out: Record<string, unknown> = { shot_key: shotKey };
			for (const k of BACKFILL_KEYS) {
				const v = p[k];
				if (v != null && v !== '') out[k] = v;
			}
			return out as StoryboardPanelCreate;
		});
	}

	async function maybeBackfill(pid: string, res: StoryboardPanelListResponse): Promise<void> {
		if (backfillDoneFor === pid) return;
		backfillDoneFor = pid; // one attempt per project — never loop on the cache refresh
		const briefPanels = project.brief?.storyboard;
		if (res.items.length > 0 || !Array.isArray(briefPanels) || briefPanels.length === 0) return;
		try {
			await backfillFromBrief(pid, mapBriefPanels(briefPanels));
			toastSuccess('Storyboard imported', 'Seeded the board from the wizard brief.');
		} catch (e) {
			report('backfill', e);
		}
	}

	// The workspace loader doesn't seed the storyboard, so fetch on mount if the
	// store has no snapshot for this project yet. Re-renders flow via getProjectList.
	// After the load, seed the table from any inline wizard panels on the brief.
	// One load attempt per project id. Without this a FAILED load is an unbounded
	// retry: the catch leaves the cache empty and `isProjectLoading` back to
	// false, which are exactly the two conditions the guard below tests, so the
	// effect re-fires the moment it settles — hammering the API for as long as
	// the section stays open. Keyed by project id for the same reason
	// `backfillDoneFor` is: the component instance is reused across [pid] navs.
	let loadAttemptedFor: string | null = null;
	// A FAILED load is NOT an empty board. The store write is pessimistic, so on a
	// 5xx/dropped fetch the cache stays empty, `panels` derives [] and `loading`
	// derives false — exactly the shape of a genuinely empty storyboard. Without
	// this flag the section then asserts "no shots yet" and offers Draft from
	// brief; that click 409s, the UI asks "A storyboard already exists — replace
	// it?", and confirming DESTROYS a full board the user never saw. Mirrors the
	// sibling AssetLibrary's `loadFailed` (same reason, same shape). Left set on
	// failure alongside `loadAttemptedFor` so the effect cannot become an
	// unbounded retry — the user retries by reopening the section.
	let loadFailed = $state(false);
	$effect(() => {
		const pid = project.id;
		if (loadAttemptedFor !== pid && getProject(pid) === undefined && !isProjectLoading(pid)) {
			loadAttemptedFor = pid;
			loadFailed = false;
			loadProject(pid)
				.then((res) => maybeBackfill(pid, res))
				.catch((e) => {
					loadFailed = true;
					report('load', e);
				});
		}
		// Scenes are a separate cache; load them alongside panels so SceneBoard can
		// group. loadScenes is idempotent-safe (replaces the keyed cache).
		loadScenes(pid).catch((e) => report('scene load', e));
	});

	const panels = $derived(getProjectList(project.id));
	const loading = $derived(getProject(project.id) === undefined && isProjectLoading(project.id));
	// Read-only storyboard: an archived project, or a branch child that has already
	// been merged/abandoned (an OPEN branch is still editable — that is the point of
	// branching). The backend independently 409s these mutations
	// (`ProjectArchivedError`); this gate is the UX half, so the controls never invite
	// an edit that would only bounce.
	const readonly = $derived(
		project.status === 'archived' || (project.branch != null && project.branch.status !== 'open')
	);
	// Raised when a write lost its optimistic-concurrency CAS: the store has already
	// reloaded the board, so this explains why the shots just changed.
	const conflictNotice = $derived(getPanelConflict(project.id));
	const boardReloadSeq = $derived(getBoardReloadSeq(project.id));

	// Next free `clip-<n>` ordinal — max existing ordinal + 1, NOT panels.length+1
	// (which would collide after a delete: [clip-1,clip-3] len 2 → clip-3 again).
	function nextShotKey(): string {
		const maxN = panels.reduce((m, p) => {
			const match = /^clip-(\d+)$/.exec(p.shot_key ?? '');
			return match ? Math.max(m, Number(match[1])) : m;
		}, 0);
		return `clip-${maxN + 1}`;
	}

	function errMessage(e: unknown, fallback = 'Something went wrong'): string {
		return e instanceof ApiError ? e.detail : fallback;
	}

	// A rejected mutation leaves the pessimistic store/board unchanged (no phantom
	// row, no data loss); surface it as a toast so it isn't invisible.
	function report(op: string, e: unknown): void {
		toastError(`Storyboard ${op} failed`, errMessage(e));
	}
	// `sceneId` is bound by the scene group that raised the add, so the new shot
	// lands in that scene. Omit the field entirely when there's no scene (the
	// unassigned group / the empty-state button) — the panel is then unassigned.
	function handleAdd(sceneId?: string | null): void {
		const body: StoryboardPanelCreate = { shot_key: nextShotKey(), status: 'draft' };
		if (sceneId != null) body.scene_id = sceneId;
		createPanel(project.id, body).catch((e) => report('create', e));
	}
	function handleUpdate(id: string, patch: Partial<StoryboardPanelDraft>): Promise<unknown> {
		// Return the store write's promise so the board can revert its optimistic edit
		// on failure. Toast here (existing UX) but RE-THROW so the rejection reaches the
		// board's revert; a swallowed rejection would leave the phantom "saved" value.
		return updatePanel(project.id, id, patch).catch((e) => {
			report('update', e);
			throw e;
		});
	}
	function handleDelete(id: string): void {
		deletePanel(project.id, id).catch((e) => report('delete', e));
	}
	function handleReorder(orderedIds: string[]): void {
		reorderPanels(project.id, orderedIds).catch((e) => report('reorder', e));
	}
	function handleRewrite(id: string, instruction: string, fields?: string[]): void {
		rewritePanel(project.id, id, instruction, fields)
			.then(() => toastSuccess('Panel rewritten'))
			.catch((e) => toastError('Rewrite failed', errMessage(e)));
	}
	async function handleMovePanelToScene(panelId: string, sceneId: string | null): Promise<void> {
		try {
			await updatePanel(project.id, panelId, { scene_id: sceneId });
		} catch (e) {
			report('move', e);
		}
	}

	// Draft-from-brief. 409 ⇒ ask to replace via an inline confirm (window.confirm
	// is blocked); 422 ⇒ the brief has no script/idea to draft from.
	let drafting = $state(false);

	// The draft needs real text to work from (see `briefHasDraftableText`).
	// Offering the button on an empty brief guaranteed a 422 or a junk draft
	// (ui-review X1), so it is disabled with the reason instead.
	const briefHasText = $derived(briefHasDraftableText(project.brief));
	let confirmReplace = $state(false);

	async function runDraft(replace: boolean): Promise<void> {
		drafting = true;
		try {
			const body: StoryboardDraftRequest = {
				script_or_idea: null,
				instructions: null,
				replace
			};
			await draftFromBrief(project.id, body);
			confirmReplace = false;
			toastSuccess('Storyboard drafted', 'Generated the board from the project brief.');
		} catch (e) {
			if (e instanceof ApiError && e.status === 409) {
				confirmReplace = true;
				return;
			}
			if (e instanceof ApiError && e.status === 422) {
				toastError('Add a script or brief first', e.detail);
				return;
			}
			report('draft', e);
		} finally {
			drafting = false;
		}
	}

	// Versions (snapshot/restore) is collapsed by default — it's a recovery tool,
	// not part of the editing loop, and staying unmounted means it doesn't fetch
	// the snapshot list on every workspace visit.
	let showVersions = $state(false);

	function toggleVersions(): void {
		showVersions = !showVersions;
	}

	// Branches (fork the whole board into a hidden child project, rework it, merge
	// back) is collapsed by default for the same reason as Versions: it is not part
	// of the editing loop, and staying unmounted means no branch fetch on every
	// workspace visit.
	let showBranches = $state(false);

	function toggleBranches(): void {
		showBranches = !showBranches;
	}

	// Shot-list / timeline export — mints the board as a downloadable file via the
	// orchestrator, one entry per format. Disabled while empty (nothing to export)
	// or in flight. A single `downloading` flag gates the whole set so two exports
	// can't race the same hidden-anchor save.
	let downloading = $state(false);

	type ExportSpec = {
		label: string;
		testid: string;
		run: (projectId: string) => Promise<void>;
	};

	const EXPORTS: ExportSpec[] = [
		{ label: 'CSV', testid: 'download-csv', run: (id) => downloads.storyboardCsv(id) },
		{ label: 'EDL', testid: 'download-edl', run: (id) => downloads.storyboardEdl(id) },
		{ label: 'FCPXML', testid: 'download-fcpxml', run: (id) => downloads.storyboardFcpxml(id) },
		{ label: 'PDF', testid: 'download-pdf', run: (id) => downloads.storyboardPdf(id) }
	];

	async function handleDownload(spec: ExportSpec): Promise<void> {
		downloading = true;
		try {
			await spec.run(project.id);
		} catch (e) {
			report(`${spec.label} export`, e);
		} finally {
			downloading = false;
		}
	}

	function handleDraft(): void {
		void runDraft(false);
	}
	function handleConfirmReplace(): void {
		void runDraft(true);
	}
	function handleCancelReplace(): void {
		confirmReplace = false;
	}
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
>
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Storyboard</h2>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">
				The shot-by-shot visual blueprint for this project. Panels seed the render pipeline via the
				<code>clip-&lt;n&gt;</code> spine, so the output follows what you plan here.
			</p>
		</div>

		<div class="flex flex-col items-end gap-2">
			<div class="flex flex-wrap items-center justify-end gap-2">
				{#each EXPORTS as spec (spec.testid)}
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
						disabled={downloading || panels.length === 0}
						onclick={() => handleDownload(spec)}
						data-testid={spec.testid}
					>
						<Download class="h-4 w-4" />
						{downloading ? 'Downloading…' : `Download ${spec.label}`}
					</button>
				{/each}
			</div>
			{#if confirmReplace}
				<div class="flex items-center gap-2" data-testid="draft-confirm">
					<span class="text-sm text-[var(--color-text-muted)]">
						A storyboard already exists — replace it?
					</span>
					<button
						type="button"
						class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-colors disabled:opacity-40"
						disabled={drafting || readonly}
						onclick={handleConfirmReplace}
						data-testid="draft-confirm-replace"
					>
						{drafting ? 'Replacing…' : 'Replace'}
					</button>
					<button
						type="button"
						class="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
						disabled={drafting}
						onclick={handleCancelReplace}
						data-testid="draft-confirm-cancel"
					>
						Cancel
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
					disabled={drafting || readonly || loadFailed || !briefHasText}
					title={briefHasText
						? undefined
						: 'Fill in the brief first — there is nothing to draft from yet.'}
					onclick={handleDraft}
					data-testid="draft-from-brief"
				>
					{drafting ? 'Drafting…' : 'Draft from brief'}
				</button>
			{/if}

			<!-- Empty board ⇒ surface a manual entry point right next to the AI draft,
			     so the first shot doesn't require scrolling into a scene group. Adds
			     an unassigned panel; per-scene adds live on the group headers. -->
			{#if panels.length === 0 && !loadFailed}
				<button
					type="button"
					class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
					disabled={readonly}
					onclick={() => handleAdd()}
					data-testid="add-shot-empty"
				>
					<Plus class="h-4 w-4" />
					Add shot
				</button>
			{/if}
		</div>
	</div>

	{#if loadFailed}
		<div
			class="rounded-[var(--radius-md)] border border-[var(--color-danger-border,var(--color-border))] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)]"
			role="status"
			data-testid="storyboard-unavailable"
		>
			The storyboard could not be loaded, so this is not showing what this project has. Drafting is
			disabled until it loads — reopen the section to try again.
		</div>
	{/if}

	{#if readonly}
		<div
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)]"
			role="status"
			data-testid="storyboard-readonly-notice"
		>
			{project.status === 'archived'
				? 'This project is archived — the storyboard is read-only.'
				: 'This branch has been merged or abandoned — its storyboard is read-only.'}
		</div>
	{/if}

	<div class="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
		<button
			type="button"
			class="flex w-full items-center justify-between gap-2 text-sm font-semibold text-[var(--color-text)]"
			onclick={toggleVersions}
			aria-expanded={showVersions}
			data-testid="versions-toggle"
		>
			<span>Versions</span>
			<span class="text-xs font-normal text-[var(--color-text-muted)]">
				{showVersions ? 'Hide' : 'Snapshot / restore'}
			</span>
		</button>
		{#if showVersions}
			<StoryboardVersions projectId={project.id} />
		{/if}
	</div>

	<div class="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
		<button
			type="button"
			class="flex w-full items-center justify-between gap-2 text-sm font-semibold text-[var(--color-text)]"
			onclick={toggleBranches}
			aria-expanded={showBranches}
			data-testid="branches-toggle"
		>
			<span>Branches</span>
			<span class="text-xs font-normal text-[var(--color-text-muted)]">
				{showBranches ? 'Hide' : 'Try an alternative cut'}
			</span>
		</button>
		{#if showBranches}
			<StoryboardBranches projectId={project.id} />
		{/if}
	</div>

	{#if conflictNotice}
		<div
			class="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2"
			role="status"
			data-testid="panel-conflict-notice"
		>
			<p class="text-sm text-[var(--color-text)]">{conflictNotice}</p>
			<button
				type="button"
				class="shrink-0 text-xs font-medium text-[var(--color-text-muted)] underline"
				onclick={() => dismissPanelConflict(project.id)}
			>
				Dismiss
			</button>
		</div>
	{/if}

	{#if loading}
		<Skeleton variant="box" height="8rem" />
	{:else}
		<!-- Keyed on the force-reload counter so a conflict refetch re-seeds the board's
		     local working copy. StoryboardBoard only re-seeds on a membership change,
		     which a same-shots-different-values reload is not. -->
		{#key boardReloadSeq}
			<SceneBoard
				projectId={project.id}
				onAddPanel={handleAdd}
				onUpdatePanel={handleUpdate}
				onDeletePanel={handleDelete}
				onReorderPanels={handleReorder}
				onRewritePanel={handleRewrite}
				{isPanelBusy}
				onMovePanelToScene={handleMovePanelToScene}
				disabled={readonly}
			/>
		{/key}
	{/if}

	<div class="space-y-3 border-t border-[var(--color-border)] pt-4">
		<h3 class="text-sm font-semibold text-[var(--color-text)]">Asset library</h3>
		<AssetLibrary projectId={project.id} disabled={readonly} />
	</div>
</section>

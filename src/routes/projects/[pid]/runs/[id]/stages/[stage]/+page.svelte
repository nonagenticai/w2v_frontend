<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import { Badge, Button, Card, ErrorState, Input } from '$lib/components/ui';
	import { AnnotationsPanel } from '$lib/components/studio';
	import {
		RegenerateRunModal,
		RestartRunModal,
		StageElementEditor,
		StageOutputView
	} from '$lib/components/runs';
	import TokenUsage from '$lib/components/runs/TokenUsage.svelte';
	import {
		ArrowLeft,
		Check,
		ChevronRight,
		FileJson,
		GitBranch,
		Pencil,
		RefreshCw
	} from '@lucide/svelte';
	import type { StageDraftListResponse } from '$lib/api/drafts';
	import type { AnnotationListResponse, ProjectDetailResponse } from '$lib/types';
	import type { RunDetail } from '$lib/types/runs';
	import { restamp } from '$lib/stores/elements.svelte.js';
	import { runs, ApiError } from '$lib/api';
	import { performRestart } from '$lib/utils/run-restart';
	import { byoProviderRequiredFromError, type ByoProviderRequired } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';
	import { runNotResumable } from '$lib/utils/run-actions';
	import { stageLabel } from '$lib/utils/stage-labels';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';

	// The REVIEW GATE. A run pauses here and waits for a human, so this page must
	// be able to end the pause — approve to continue, or regenerate this stage.
	// Until 2026-08 it could do neither: the only control was a raw-JSON "Restamp
	// element" textarea and `runs.resume` lived exclusively on the run page, so a
	// reviewer who followed the pause banner in hit a dead end and had to navigate
	// back to find the verb. Restamp is still here, demoted to an Advanced
	// disclosure below the output.

	type Data = {
		project: ProjectDetailResponse;
		run: RunDetail;
		stage: string;
		draftList: StageDraftListResponse;
		draftListError: unknown;
		annotations: AnnotationListResponse;
		annotationsError: unknown;
	};

	let { data }: { data: Data } = $props();

	const stageOutput = $derived(
		(data.run.stage_outputs ?? []).find((s) => s.stage_name === data.stage)
	);

	const stageStatus = $derived(stageOutput?.status ?? 'pending');

	// The gate-review page is where a reviewer approves a paused stage, so it must
	// show the SAME rich renderer the run page shows (cut plan timeline, shot
	// analysis summary, …) — a raw JSON wall is not a review. StageOutputView
	// resolves the shape registry, falls back to its generic view when no renderer
	// matches, and always carries a "Raw JSON" disclosure, so nothing is lost.
	const stageOutputPayload = $derived(
		(stageOutput?.output ?? null) as Record<string, unknown> | null
	);

	const ancestors = $derived(data.draftList.drafts);

	const label = $derived(stageLabel(data.stage));
	const runHref = $derived(resolve(`/projects/${data.project.id}/runs/${data.run.id}`));

	// --- Which gate is the run actually waiting at? ---
	// A run only ever pauses at a DECLARED checkpoint: `pause_after_stages` is the
	// user's chosen (or blueprint-seeded) gate set, and the backend pauses after a
	// stage in `set(run.pause_after_stages)` and nowhere else. So membership in that
	// set is a hard precondition for every answer below — a stage that is not a
	// declared gate can NEVER be the pause point, no matter what it completed.
	//
	// `current_stage` alone is not sufficient and not even necessary:
	//  * a blueprint wave runs its independent stages CONCURRENTLY, so the last
	//    stage to enter `running` can be a no-dep leaf that finished (or SKIPPED)
	//    while the checkpoint that actually tripped the pause was a sibling. Trusting
	//    a completed `current_stage` unconditionally enabled Approve on that leaf —
	//    a NON-gate page — and `resume` carries no stage argument, so the click
	//    continued the run past the real gate the reviewer never read.
	//  * runs paused before the orchestrator learned to re-point `current_stage`
	//    still carry the skipped stage, hence the fallback.
	//
	// The fallback is ordered by EXECUTION EVIDENCE (`completed_at`), never by
	// position in `pause_after_stages`. That array is user-ordered — CheckpointPicker
	// appends in CLICK order and the backend consumes it as a `set` — so `.at(-1)`
	// on it named whichever gate the user happened to tick last, which for
	// `['cut_plan', 'segment_select']` is `segment_select` while the run is really
	// waiting at `cut_plan`: Approve live on the already-read gate and dead on the
	// open one. Order is not a contract; timestamps are.
	//
	// When the evidence does not single one out (missing or tied `completed_at` on
	// two consumed gates) we return null and DISABLE Approve rather than guess. A
	// disabled button costs a click; a wrong-gate approval continues a paid run past
	// a checkpoint nobody reviewed.
	//
	// This page reads the loader snapshot rather than a live poll: approving is a
	// deliberate act on the state the reviewer is looking at, and the loader is
	// re-run by `invalidateAll()` after every write here.
	const consumedGates = $derived.by(() => {
		if (data.run.status !== 'paused') return [];
		const gates = new Set(data.run.pause_after_stages ?? []);
		return (data.run.stage_outputs ?? []).filter(
			(s) => gates.has(s.stage_name) && s.status === 'completed'
		);
	});

	const pausedStage = $derived.by(() => {
		if (data.run.status !== 'paused') return null;
		const current = data.run.current_stage;
		// Trust `current_stage` only when it is BOTH a declared gate AND completed.
		if (current && consumedGates.some((s) => s.stage_name === current)) return current;
		if (consumedGates.length === 0) return null;
		if (consumedGates.length === 1) return consumedGates[0].stage_name;
		// >1 consumed gate: the open one is the one that finished LAST. Sort on the
		// ISO timestamp (lexicographic order == chronological order for ISO-8601 UTC).
		const timed = consumedGates.filter((s) => typeof s.completed_at === 'string' && s.completed_at);
		if (timed.length !== consumedGates.length) return null; // no evidence — don't guess
		const sorted = [...timed].sort((a, b) =>
			(a.completed_at ?? '').localeCompare(b.completed_at ?? '')
		);
		const last = sorted[sorted.length - 1];
		// A tie is genuinely ambiguous (two gates stamped the same instant).
		if (sorted[sorted.length - 2].completed_at === last.completed_at) return null;
		return last.stage_name;
	});

	// Paused, but which gate is open cannot be established from this snapshot. Not
	// the same state as "not paused" — saying "Run is paused — nothing to approve"
	// there would be a claim, and the reviewer needs to be sent to the run monitor.
	//
	// That includes ZERO consumed gates (the run's `pause_after_stages` holds no
	// completed checkpoint — e.g. the approval ledger was already drained, or the
	// gate that tripped is not in the snapshot yet). That case used to fall through
	// to "Run is paused — nothing to approve here" over a disabled Approve: a
	// contradiction with no way forward. It gets the same explain-and-link.
	const pausePointUnresolved = $derived(data.run.status === 'paused' && pausedStage === null);

	// THE safety property of this page: Approve resumes the RUN, and the backend
	// resumes from its own pause point — it does not take a stage argument. So an
	// enabled Approve button on a stage the run is NOT paused at would silently
	// approve a DIFFERENT gate than the one on screen (and 409 outright when the
	// run is not paused at all). Never widen this condition.
	const isPausedHere = $derived(pausedStage === data.stage);
	const pausedElsewhere = $derived(pausedStage !== null && pausedStage !== data.stage);

	// --- Approve & continue ---
	let approving = $state(false);

	async function handleApprove() {
		// Defence in depth: the button is disabled, but a keyboard/DOM path must not
		// be able to approve a gate the reviewer is not looking at.
		if (!isPausedHere) return;
		approving = true;
		try {
			await performRestart({ runId: data.run.id, status: data.run.status });
			toastSuccess('Approved', `${label} accepted — the pipeline is continuing.`);
			// Refresh the snapshot BEFORE leaving, so the run page paints the resumed
			// state instead of the paused one it was last loaded with.
			await invalidateAll();
			// Send the reviewer where the pipeline is visibly moving; staying here
			// would show a stage that is now behind the run.
			goto(runHref);
		} catch (err) {
			if (handleByoRefusal(err)) return;
			const refused = runNotResumable(err);
			if (refused) {
				// The run already left `paused` (approved elsewhere, cancelled, …):
				// say so and reload the real state instead of offering a retry.
				toastError('Nothing to approve', refused.message);
				await invalidateAll();
				return;
			}
			toastError('Failed to approve', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			approving = false;
		}
	}

	// --- Regenerate this stage ---
	// Both confirmable actions on this page (regenerate-from-here, and the
	// restamp checkbox that re-runs the WHOLE pipeline) go through ONE modal —
	// the same `RegenerateRunModal` the run page uses for its own `from_stage`
	// rerun. `confirmKind` says which one the reviewer is answering, because the
	// two spend very different amounts of money.
	let regenerating = $state(false);
	let showRegenerateModal = $state(false);
	let confirmKind = $state<'stage' | 'restamp-full-run'>('stage');

	// Regenerating spawns a SIBLING run. Doing that while the parent is still
	// executing means paying for two pipelines at once over the same
	// deliverable, and the reviewer is then looking at a run that is no longer
	// the live one. `paused` is explicitly allowed: rejecting the gate instead of
	// approving it is the whole point of this page. `pending`/`running` are not.
	// (Reachable stage statuses are pending | running | completed | failed |
	// skipped | cancelled — only `completed` has an output worth re-running from,
	// which is what the pre-existing status half of this gate encodes.)
	const runIsActive = $derived(data.run.status === 'running' || data.run.status === 'pending');
	const canRegenerateStage = $derived(stageStatus === 'completed' && !runIsActive);

	// --- Edit this step's content ---
	// A finished step's text (script lines, shots, paragraphs) is editable on any
	// run the pipeline is not executing — including a CANCELLED one: cancelling to
	// fix something and restarting is the point. The edit is kept on Restart and
	// only the steps that build on it run again.
	const elementPaths = $derived(stageOutput?.element_paths ?? []);
	const canEditContent = $derived(stageStatus === 'completed' && elementPaths.length > 0);
	const editBlockedReason = $derived(
		runIsActive ? `This run is still ${data.run.status}. You can edit it once it stops.` : null
	);
	const wasEdited = $derived(Boolean(stageOutput?.edited_at));
	const restartHint = $derived(
		data.run.status === 'cancelled' || data.run.status === 'failed'
			? 'After editing, go back to the run and press Restart: this step keeps your edit and only the steps that build on it run again.'
			: data.run.status === 'completed'
				? 'After editing, go back to the run and press Rerun: this step keeps your edit and only the steps that build on it run again.'
				: null
	);

	function requestRegenerateStage() {
		// Defence in depth: the button is disabled, but a keyboard/DOM path must
		// not be able to open a confirmation for an action we would refuse.
		if (!canRegenerateStage) return;
		confirmKind = 'stage';
		showRegenerateModal = true;
	}

	function handleConfirm() {
		if (confirmKind === 'restamp-full-run') {
			void submitRestamp();
			return;
		}
		void handleRegenerateStage();
	}

	// The run-start preflight's 402 `byo_provider_required` (#1150) on approve /
	// regenerate: nothing was started and the fix is on /providers, so it is a
	// persistent notice with the link instead of a toast.
	let startRefusal = $state<ByoProviderRequired | null>(null);
	function handleByoRefusal(err: unknown): boolean {
		const byo = byoProviderRequiredFromError(err);
		if (!byo) return false;
		startRefusal = byo;
		showRegenerateModal = false;
		return true;
	}

	async function handleRegenerateStage() {
		if (!canRegenerateStage) return;
		regenerating = true;
		try {
			// `from_stage`: the BE preserves every completed stage BEFORE this one and
			// re-runs from here onward — into a NEW sibling run. Navigating to the old
			// id would park the reviewer on a run that will never move again.
			const result = await runs.regenerate(data.run.id, { from_stage: data.stage });
			showRegenerateModal = false;
			toastSuccess('Regenerating', `Re-running from ${label} as a new version.`);
			goto(resolve(`/projects/${data.project.id}/runs/${result.id}`));
		} catch (err) {
			if (handleByoRefusal(err)) return;
			toastError('Failed to regenerate', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			regenerating = false;
		}
	}

	// --- Advanced: restamp one element (raw JSON) ---
	// `bind:open` so a successful submit can collapse the disclosure again.
	let restampOpen = $state(false);
	let restampElementId = $state('');
	let restampValueJson = $state('');
	let restampBusy = $state(false);
	// DEFAULT OFF. This checkbox does not re-run "the stage you are looking at" —
	// `runs.regenerate(id, {})` carries NO `from_stage`, so it re-runs the ENTIRE
	// pipeline as a new paid run. It shipped ON, under the label "Auto-trigger run
	// regenerate", which named neither the scope nor the cost: clicking "Restamp"
	// on a one-word JSON fix launched a full re-render. Off by default, and when
	// it IS on the Restamp button routes through the confirmation below.
	let restampAutoRegenerate = $state(false);

	// Validation runs BEFORE the confirmation opens: asking a reviewer to confirm a
	// paid run and then telling them their JSON was malformed is a confirmation
	// that meant nothing. `submitRestamp` re-checks — this is a UX ordering, not
	// the guard.
	function parseRestampInput(): Record<string, unknown> | null {
		if (!restampElementId.trim()) {
			toastError('Element id required');
			return null;
		}
		try {
			return JSON.parse(restampValueJson) as Record<string, unknown>;
		} catch (e) {
			toastError('Invalid JSON', (e as Error).message);
			return null;
		}
	}

	function requestRestamp() {
		if (parseRestampInput() === null) return;
		if (restampAutoRegenerate) {
			// Confirm BEFORE anything is written: the restamp itself is cheap, but
			// the run it would launch is not, and a reviewer who cancels here should
			// not discover the element was already rewritten.
			confirmKind = 'restamp-full-run';
			showRegenerateModal = true;
			return;
		}
		void submitRestamp();
	}

	async function submitRestamp() {
		const parsed = parseRestampInput();
		if (parsed === null) {
			showRegenerateModal = false;
			return;
		}
		restampBusy = true;
		try {
			await restamp(data.run.id, data.stage, restampElementId.trim(), parsed);
			if (restampAutoRegenerate) {
				// No `from_stage` — this is the WHOLE pipeline, which is why it is
				// only reachable through the confirmation.
				await runs.regenerate(data.run.id, {});
				showRegenerateModal = false;
				toastSuccess('Element restamped + whole-run regenerate started');
			} else {
				toastSuccess(
					'Element restamped',
					'Downstream stages marked pending — POST /runs/{id}/regenerate to re-execute'
				);
			}
			restampOpen = false;
			restampElementId = '';
			restampValueJson = '';
			await invalidateAll();
		} catch (e) {
			showRegenerateModal = false;
			if (handleByoRefusal(e)) return;
			toastError('Restamp failed', (e as Error).message);
		} finally {
			restampBusy = false;
		}
	}
</script>

<svelte:head>
	<!-- The human label, not the raw slug: `segment_select` in a tab title reads as
	     a database key, not as the decision the reviewer is being asked to make.
	     `data.stage` stays the URL/testid identity everywhere. -->
	<title>{label} · {data.project.title} · Studio</title>
</svelte:head>

<Page testid="stage-inspector">
	<nav aria-label="Breadcrumb" class="flex items-center gap-1 text-xs text-text-muted">
		<a href={resolve('/projects')} class="hover:text-text-secondary">Projects</a>
		<ChevronRight size={12} />
		<a href={resolve(`/projects/${data.project.id}`)} class="hover:text-text-secondary uppercase">
			{data.project.title}
		</a>
		<ChevronRight size={12} />
		<a
			href={resolve(`/projects/${data.project.id}/runs/${data.run.id}`)}
			class="hover:text-text-secondary"
		>
			Run {data.run.id.slice(0, 8)}
		</a>
		<ChevronRight size={12} />
		<span class="text-text">{label}</span>
	</nav>

	<!-- Stacks below sm: side by side, two action buttons + the badge left the
	     title/description ~60px wide at 390px and pushed Regenerate off-screen. -->
	<header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
		<div class="min-w-0">
			<h1 class="text-xl font-semibold text-text">{label}</h1>
			<p class="text-xs text-text-muted mt-0.5">
				Review what this stage produced. Approve to let the pipeline continue, or regenerate the
				stage to try again from here.
			</p>
			<TokenUsage
				usage={data.run.usage_total}
				stage={data.stage}
				testid="stage-tokens"
				class="mt-1"
			/>
		</div>
		<div class="flex flex-col items-start gap-2 sm:items-end sm:shrink-0">
			<div class="flex flex-wrap items-center gap-2">
				<Badge>{stageStatus}</Badge>
				<!-- Approve is enabled ONLY when the run is paused at THIS stage — see
				     `isPausedHere`. Resume carries no stage argument, so an enabled
				     button anywhere else approves someone else's gate. -->
				<Button
					variant="primary"
					size="sm"
					disabled={!isPausedHere || approving}
					onclick={handleApprove}
				>
					<Check size={14} class="mr-1" />
					{approving ? 'Approving…' : 'Approve & continue'}
				</Button>
				<!-- Confirmed, never one-click: this spends money (a fresh sibling run from
				     this stage onward) and navigates the reviewer off the page.
				     `canRegenerateStage` also withholds it while the parent run is
				     still executing — see the derived value. -->
				<Button
					variant="secondary"
					size="sm"
					disabled={!canRegenerateStage || regenerating}
					onclick={requestRegenerateStage}
				>
					<RefreshCw size={14} class="mr-1" />
					{regenerating ? 'Starting…' : 'Rerun from here'}
				</Button>
			</div>
			{#if runIsActive && stageStatus === 'completed'}
				<!-- The commonest confusing state: this stage is done, the run is not.
				     A disabled button with no reason reads as a bug. -->
				<p class="text-xs text-text-muted" data-testid="regenerate-stage-unavailable">
					Run is still {data.run.status} — rerun from here once it stops.
				</p>
			{/if}
			{#if pausedElsewhere}
				<!-- A disabled button with no explanation reads as a broken page. Say
				     which gate is actually open and offer the one click that gets there. -->
				<p class="text-xs text-text-muted" data-testid="paused-elsewhere">
					Run is paused at
					<a
						href={resolve(`/projects/${data.project.id}/runs/${data.run.id}/stages/${pausedStage}`)}
						class="text-primary-500 hover:text-primary-400"
					>
						{stageLabel(pausedStage ?? '')}
					</a>
				</p>
			{:else if pausePointUnresolved}
				<!-- Ambiguous evidence: more than one checkpoint completed and the
				     snapshot cannot say which one the run stopped after. Approve stays
				     DISABLED — resume takes no stage argument, so guessing here would
				     continue a paid run past a gate nobody read. Say so, and point at
				     the monitor, which polls live status. -->
				<p class="text-xs text-text-muted max-w-sm text-right" data-testid="pause-point-unknown">
					{#if consumedGates.length === 0}
						Run is paused, but none of its review checkpoints has a completed output, so this page
						can't tell which gate it is waiting at and Approve stays off —
					{:else}
						Run is paused, but this snapshot does not say which checkpoint is open —
					{/if}
					<a href={runHref} class="text-primary-500 hover:text-primary-400">open the run monitor</a>
					to review and resume it.
				</p>
			{:else if !isPausedHere}
				<p class="text-xs text-text-muted" data-testid="not-paused">
					Run is {data.run.status} — nothing to approve here.
					<a href={runHref} class="text-primary-500 hover:text-primary-400">Back to run</a>
				</p>
			{/if}
		</div>
	</header>

	{#if startRefusal}
		<ByoProviderRequiredNotice required={startRefusal} />
	{/if}

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
		<div class="space-y-4">
			<Card>
				<div
					class="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-xs uppercase text-text-secondary"
				>
					<FileJson size={14} />
					<span>Output</span>
				</div>
				<div class="px-4 py-3" data-testid="stage-output">
					<StageOutputView
						output={stageOutputPayload}
						runId={data.run.id}
						emptyLabel="(no output yet)"
					/>
				</div>
			</Card>

			{#if canEditContent}
				<Card>
					<div
						class="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-xs uppercase text-text-secondary"
					>
						<Pencil size={14} />
						<span>Edit this step</span>
						{#if wasEdited}
							<span data-testid="stage-edited-badge"><Badge>Edited</Badge></span>
						{/if}
					</div>
					<div class="space-y-3 px-4 py-3">
						{#if restartHint}
							<p class="text-xs text-text-muted" data-testid="stage-edit-hint">
								{restartHint}
								<a href={runHref} class="text-primary-500 hover:text-primary-400">Back to run</a>
							</p>
						{/if}
						<StageElementEditor
							runId={data.run.id}
							stageName={data.stage}
							output={stageOutputPayload}
							{elementPaths}
							blockedReason={editBlockedReason}
							onsaved={() => invalidateAll()}
						/>
					</div>
				</Card>
			{/if}

			<!-- Restamp is a power-user escape hatch (replace ONE element by raw JSON
			     and mark everything downstream pending). It used to be the ONLY control
			     on this page, which made a review gate look like a debugging console.
			     Demoted to a disclosure so the two review verbs above are the page's
			     answer, and this stays available for the case they don't cover. -->
			<details
				bind:open={restampOpen}
				class="rounded-[var(--radius-md)] border border-border/40"
				data-testid="advanced-restamp"
			>
				<summary class="cursor-pointer px-4 py-2 text-xs uppercase text-text-secondary">
					Advanced — restamp element
				</summary>
				<div class="space-y-3 border-t border-border/40 px-4 py-3">
					<div>
						<Input
							name="restamp-eid"
							label="Element id (find in Raw JSON above)"
							bind:value={restampElementId}
							placeholder="e.g. shot_1"
						/>
					</div>
					<div>
						<label class="mb-1 block text-xs text-text-muted" for="restamp-val">
							New value (JSON object — the element's `id` is preserved regardless)
						</label>
						<textarea
							id="restamp-val"
							bind:value={restampValueJson}
							rows="6"
							class="w-full rounded border border-border/60 bg-background px-2 py-1 font-mono text-xs"
							placeholder={'{\n  "text": "..."\n}'}
						></textarea>
					</div>
					<label class="flex items-start gap-2 text-xs text-text-muted">
						<input
							type="checkbox"
							data-testid="restamp-auto-regenerate"
							bind:checked={restampAutoRegenerate}
						/>
						<span>
							Also re-run the <strong>whole run</strong> afterwards — every stage from the start, as a
							new paid version. Leave this off to only mark downstream stages pending.
						</span>
					</label>
					<div class="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onclick={() => (restampOpen = false)}>
							Cancel
						</Button>
						<Button variant="primary" size="sm" disabled={restampBusy} onclick={requestRestamp}>
							{restampBusy ? 'Restamping…' : 'Restamp'}
						</Button>
					</div>
				</div>
			</details>

			<!-- The error branch MUST be tested before `ancestors.length > 0`. `settle`
			     hands back a `drafts: []` fallback on a failed fetch, so a
			     length-first gate drops the ENTIRE card on exactly the failure it
			     should report — indistinguishable from a deliverable that genuinely
			     has no prior runs, which is how a reviewer concludes "first run" and
			     re-runs a deliverable that already exists. -->
			{#if data.draftListError}
				<Card>
					<div
						class="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-xs uppercase text-text-secondary"
					>
						<GitBranch size={14} />
						<span>Prior runs of this deliverable</span>
					</div>
					<div data-testid="prior-runs-unavailable">
						<ErrorState
							error={data.draftListError}
							title="Prior runs could not be loaded"
							onRetry={() => void invalidateAll()}
						/>
					</div>
				</Card>
			{:else if ancestors.length > 0}
				<Card>
					<div
						class="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-xs uppercase text-text-secondary"
					>
						<GitBranch size={14} />
						<span>Prior runs of this deliverable</span>
					</div>
					<ul class="divide-y divide-border/40">
						{#each ancestors as ancestor (ancestor.id)}
							<li class="flex items-center justify-between px-4 py-2 text-sm">
								<span class="font-mono text-xs text-text-muted">
									{ancestor.id.slice(0, 8)}
								</span>
								<Badge>{ancestor.status}</Badge>
								<a
									href={resolve(`/projects/${data.project.id}/runs/${ancestor.id}`)}
									class="text-xs text-primary-500 hover:text-primary-400"
								>
									View →
								</a>
							</li>
						{/each}
					</ul>
				</Card>
			{/if}
		</div>

		<aside class="space-y-4">
			<Card>
				<div class="border-b border-border/40 px-4 py-2 text-xs uppercase text-text-secondary">
					Annotations
				</div>
				<div class="px-4 py-3">
					<!-- The error branch MUST be tested before the empty one. `settle`
					     hands back the `{annotations: [], total: 0}` fallback on a failed
					     fetch, so an `total === 0`-first gate keeps the panel unmounted on
					     exactly the failure it is supposed to report — the rail renders
					     "No annotations yet." verbatim and every affordance inside
					     AnnotationsPanel is unreachable dead code. -->
					{#if data.annotationsError}
						<AnnotationsPanel items={data.annotations.annotations} selectedIds={new Set()} />
					{:else if data.annotations.total === 0}
						<p class="text-xs text-text-muted">No annotations yet.</p>
					{:else}
						<AnnotationsPanel items={data.annotations.annotations} selectedIds={new Set()} />
					{/if}
				</div>
			</Card>

			<Button href={`/projects/${data.project.id}/runs/${data.run.id}`} variant="secondary">
				<ArrowLeft size={14} class="mr-1" />
				Back to run
			</Button>
		</aside>
	</div>
</Page>

<!-- ONE confirmation for both paid actions on this page. It is the same component
     the run page uses for its own `from_stage` rerun, deliberately — a second
     confirmation style would be a second thing to get wrong. The copy says which of
     the two the reviewer is answering: they spend very different amounts. -->
{#if confirmKind === 'stage'}
	<!-- "Rerun from here" previews its own plan: this step and everything built on
	     it run again, every other finished step is kept. -->
	<RestartRunModal
		bind:open={showRegenerateModal}
		runId={data.run.id}
		fromStage={data.stage}
		loading={regenerating}
		onconfirm={handleConfirm}
		title={`Rerun from “${label}”?`}
		intro="Starts a new version of this run. This step and every step that builds on it run again; every other finished step is kept."
		confirmLabel="Start rerun"
	/>
{:else}
	<RegenerateRunModal
		bind:open={showRegenerateModal}
		loading={restampBusy}
		onconfirm={handleConfirm}
		title="Save this element and start a new run?"
		description="Saves this element, then starts a new paid run. Steps the change affects run again; finished steps it does not affect are kept."
		confirmLabel="Save and run"
	/>
{/if}

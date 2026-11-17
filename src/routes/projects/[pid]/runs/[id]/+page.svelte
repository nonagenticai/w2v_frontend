<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	/* eslint-disable svelte/no-navigation-without-resolve -- sourceUrl in template is an external URL from project.brief; internal links elsewhere use resolve(). */
	import { onDestroy, untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { runs, youtube, ApiError } from '$lib/api';
	import type {
		StageExecutionResponse,
		YouTubeConnectionState,
		YouTubePrivacyStatus
	} from '$lib/types';
	import type { RunWsMessage } from '$lib/stores/job-progress';
	import { JobProgressState } from '$lib/stores/job-progress';
	import { blueprintStageRank, sortByStageRank } from '$lib/utils/stage-order';
	import { LiveStageOutputs } from '$lib/stores/live-stage-outputs.svelte';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import { reviewInboxStore } from '$lib/stores/review-inbox.svelte.js';
	import {
		patch as patchCheckpoints,
		getList as getCheckpointList,
		setFromSnapshot as seedCheckpoints
	} from '$lib/stores/checkpoints.svelte.js';
	import {
		setProjectSnapshot as seedVerbatimProject,
		getProjectList as getVerbatimProjectList,
		loadProject as loadVerbatimProject,
		createForProject as createProjectVerbatim,
		deleteForProject as deleteProjectVerbatim
	} from '$lib/stores/verbatim.svelte.js';
	import { PauseBanner } from '$lib/components/studio';
	import { NEEDS_REVIEW, PAUSED, reviewWaitSentence } from '$lib/utils/review-wait';
	import { useNow } from '$lib/stores/now.svelte';
	import { VERBATIM_CARRIER_STAGES, type VerbatimItemCreateRequest } from '$lib/types';
	import {
		RunOutputPanel,
		DecisionsPanel,
		StageStoryline,
		CancelRunModal,
		RestartRunModal,
		PublishYouTubeModal,
		CheckpointsPanel,
		VerbatimPanel,
		ProductionDetailsPanel,
		RunWarningsPanel,
		StageOutputView
	} from '$lib/components/runs';
	import { stageLabel } from '$lib/utils/stage-labels';
	import { canPublishToYouTube, youtubeConnectionState } from '$lib/utils/youtube-status';
	import { formatRelativeTime, extractHostname, plural } from '$lib/utils/format.js';
	import { runPageTitle } from '$lib/utils/page-title';
	import { performRestart, restartLabel } from '$lib/utils/run-restart';
	import {
		canCancelRun,
		canEditCheckpoints,
		canRestartRun,
		canResumeRun,
		failureMessage,
		redactRunError,
		resolveFailedStage,
		runEndLabel,
		runNotResumable,
		siteLoginFailureFromRun,
		upstreamAuthFailureFromRun
	} from '$lib/utils/run-actions';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import { runHasResult, isVideoStage } from '$lib/utils/stage-output.js';
	import { PanelBoundary } from '$lib/components/errors';
	import {
		byoProviderRequiredFromError,
		byoProviderRequiredFromRun,
		type ByoProviderRequired
	} from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';
	import { LogStream, JobStatusBadge } from '$lib/components/jobs';
	import { Button } from '$lib/components/ui';
	import { formatCost } from '$lib/utils/cost';
	import { downloadBaseName, videoTitleFor } from '$lib/utils/output-labels';
	import TokenUsage from '$lib/components/runs/TokenUsage.svelte';
	import {
		ArrowLeft,
		ChevronRight,
		ExternalLink,
		Wifi,
		WifiOff,
		Loader,
		XCircle,
		RotateCcw,
		Play,
		ChevronDown,
		MonitorPlay,
		Check
	} from '@lucide/svelte';

	let { data } = $props();

	// Source/target URL lives on Project.brief in the v3 model; the run itself no
	// longer carries it. app_review/website_review store it as `target_url`,
	// promo/generic (when ingestion lands) as `source_url`; `url` is the legacy
	// key still seen on older payloads.
	const sourceUrl = $derived.by(() => {
		const brief = (data.project.brief as Record<string, unknown> | null) ?? {};
		const candidate = brief.target_url ?? brief.source_url ?? brief.url;
		return typeof candidate === 'string' ? candidate : '';
	});

	const projectId = $derived(data.project.id);

	// A run the orchestrator refused because this `byo_required` tenant has no
	// provider of its own (w2v_orchestrator#1106). Read from the loader snapshot:
	// a run that fails while open gets it on the one terminal `invalidateAll()`.
	// When set, it REPLACES the generic "Pipeline Error" text — the raw error is
	// a stack-flavoured sentence; this one says what to do and links to it.
	// The same refusal on a run START from this page (restart / rerun / resume): the
	// run-start preflight answers 402 naming every missing slot (#1150) and no new
	// run exists, so it is shown here instead of a toast that cannot carry the link.
	let startRefusal = $state<ByoProviderRequired | null>(null);
	const byoRequired = $derived(
		startRefusal ?? (data.run.status === 'failed' ? byoProviderRequiredFromRun(data.run) : null)
	);
	/** True (and the notice shown) when `err` is the run-start BYO 402. */
	function handleByoRefusal(err: unknown): boolean {
		const byo = byoProviderRequiredFromError(err);
		if (!byo) return false;
		startRefusal = byo;
		showRestartModal = false;
		showRerunModal = false;
		return true;
	}
	const projectTitle = $derived(data.project.title);
	const runId = $derived(data.run.id);
	const jobIdShort = $derived(runId.slice(0, 8));

	// Run-level LLM spend, surfaced as a stat card. Per-stage breakdown drives
	// the inspector panel meta.
	// cost_status 'unavailable' ⇒ cost_usd is null (billing unreadable): render
	// "Cost unavailable" with the reason as a tooltip, never $0.
	const totalCost = $derived(
		formatCost(
			data.run.usage_total?.cost_usd,
			data.run.usage_total?.cost_status,
			data.run.usage_total?.cost_unavailable_reason
		)
	);
	// A run's cost is priced by billing and mirrored onto the run only once it is
	// finished, and even then billing's async cost events can still be flushing.
	// The orchestrator says when the figure is FINAL (`usage_total.cost_settled`).
	// Until then a figure is at best partial, so it is never shown as the run's
	// price: `$0.0000` on a live or just-finished run read as "this run is free"
	// (run 01a17e6f). An older orchestrator that does not send the flag is
	// treated as settled for a finished run (its figure was final by its rules).
	const costSettled = $derived(data.run.usage_total?.cost_settled ?? true);
	const costRecorded = $derived((data.run.usage_total?.by_stage?.length ?? 0) > 0);
	const costDisplay = $derived.by(() => {
		if (totalCost.unavailable) return totalCost;
		const soFar = (title: string) => ({ ...totalCost, text: `${totalCost.text} so far`, title });
		const calculating = (title: string) => ({ text: 'Calculating…', unavailable: false, title });
		// Terminal, but the figure is not final: plain words, never a number that
		// reads like the run's price and never an endless spinner. A cancelled run
		// normally stays provisional for the video compiler's whole render ceiling
		// (up to ~1h), so this is a resting state, not a transient one — the
		// re-read below keeps checking until billing settles it.
		const confirming = () => ({
			text: 'Still being confirmed',
			unavailable: false,
			title:
				'Billing has not confirmed the final cost yet. This page keeps checking; a cancelled run can take up to an hour.'
		});
		if (jobProgress.jobStatus === 'paused') {
			// Waiting for a human, possibly for days: say what is known, not a spinner.
			return costRecorded
				? soFar('Billed steps are priced when the run finishes.')
				: {
						text: 'Not priced yet',
						unavailable: false,
						title: 'The cost is priced when the run finishes.'
					};
		}
		if (!jobProgress.isTerminal) {
			return costRecorded
				? soFar('The cost is final once the run finishes.')
				: calculating('The cost is final once the run finishes.');
		}
		// Finished live, but the loader has not re-read the run yet.
		if (data.run.status !== jobProgress.jobStatus) return confirming();
		if (costSettled) return totalCost;
		return confirming();
	});
	const totalTokens = $derived(
		(data.run.usage_total?.input_tokens ?? 0) + (data.run.usage_total?.output_tokens ?? 0)
	);

	// --- Job progress (intentional one-time initialization) ---
	// The v3 BE emits run + stage LIFECYCLE events only — no payloads. Verbatim
	// placement is not pushed and never will be: it is derived server-side from
	// a stage's persisted output when the list is read with `?run_id=`. So the
	// live channel's job here is only to say WHEN it is worth re-reading; see
	// `refetchVerbatimForCarrierStage` below.
	//
	// `$state`, not `const`: SvelteKit REUSES this component across
	// /runs/A → /runs/B (restart and regenerate both `goto` a sibling run from
	// this very page), so a store captured once in `untrack` stays bound to run
	// A forever. `JobProgressState.runId` is readonly, so re-scoping means
	// building a new one — see the run-scope effect below.
	function buildJobProgress(): JobProgressState {
		const jp = new JobProgressState(data.run.id);
		jp.hydrateFromDetail(data.run);
		jp.onExtraEvent = handleLiveEvent;
		if (data.run.status === 'running' || data.run.status === 'pending') {
			jp.connect();
		}
		return jp;
	}
	let jobProgress = $state<JobProgressState>(untrack(buildJobProgress));
	// Set on unmount so any in-flight bounded poll stops on its next tick.
	// `onDestroy` used to disconnect the SSE only; `pollPublishJob` runs up to
	// 200 x 3s = ~10 MINUTES and read no such flag, so navigating away
	// mid-publish left it firing GET /youtube/upload/jobs/{id} at the
	// orchestrator for ten minutes, writing into dead component state.
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		jobProgress.disconnect();
	});

	// The status badge reads LIVE jobProgress, but stage OUTPUTS, usage, error
	// text and the RunOutputPanel are bound to the loader snapshot `data.run`,
	// which is frozen at page load. Without this, a run that finishes while the
	// page is open shows green "Completed" badges over empty Output panels and a
	// blank RunOutputPanel until a manual reload. When the live run first reaches
	// a terminal state, refetch the loader once so the final outputs/artifact
	// appear. Guarded to fire at most once, and skipped when the run was already
	// terminal at load (data is fresh then). invalidateAll() updates `data`
	// without remounting, so the one-time jobProgress/checkpoint seeds above are
	// untouched.
	// untrack: capture the load-time status once (a one-shot guard, not reactive).
	// Re-evaluated on every run-id change (see the run-scope effect): a FAILED
	// run A leaves this `true`, and carrying that onto a freshly-spawned run B
	// would suppress B's own one-shot reveal for B's whole lifetime.
	const loadedTerminal = () => ['completed', 'failed', 'cancelled'].includes(data.run.status);
	let refreshedOnTerminal = untrack(loadedTerminal);
	$effect(() => {
		if (jobProgress.isTerminal && !refreshedOnTerminal) {
			refreshedOnTerminal = true;
			// A failed re-read must not end the follow-up: schedule the next one either way.
			void invalidateAll().then(scheduleLateCostRefresh, scheduleLateCostRefresh);
		}
	});

	// Until the orchestrator reports the cost settled, re-read the run: the read
	// is what mirrors billing. Every read of an unsettled terminal run replaces
	// the mirrored rows with billing's current view, and the read that finds the
	// run past its settle window marks it settled — the window is PER STATUS:
	// 30s once a run is completed/failed, but a cancelled run settles only after
	// the video compiler's whole render ceiling (`job_work_timeout_seconds` 3600
	// + 300s), because a render the cancel did not reach keeps billing until
	// then. A read that collides with another caller's per-run reconciliation
	// lock comes back still unsettled — not an error — so the next tick simply
	// asks again.
	//
	// So the re-read runs UNTIL THE COST IS SETTLED (or the page is left, or the
	// run stops being terminal) — never a fixed attempt count that gives up while
	// billing is still converging. What is bounded is the interval: 35s doubling
	// to a 2-minute ceiling, which keeps an hour-long wait to ~35 reads.
	const LATE_COST_REFRESH_MS = 35_000;
	const LATE_COST_MAX_INTERVAL_MS = 120_000;
	let lateCostRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let lateCostAttempts = 0;
	function scheduleLateCostRefresh() {
		if (destroyed || lateCostRefreshTimer !== null) return;
		if (!['completed', 'failed', 'cancelled'].includes(data.run.status)) return;
		if (data.run.usage_total?.cost_status === 'unavailable') return;
		if (data.run.usage_total?.cost_settled ?? true) return;
		const delay = Math.min(LATE_COST_REFRESH_MS * 2 ** lateCostAttempts, LATE_COST_MAX_INTERVAL_MS);
		lateCostAttempts += 1;
		lateCostRefreshTimer = setTimeout(() => {
			lateCostRefreshTimer = null;
			if (!destroyed) void invalidateAll().then(scheduleLateCostRefresh, scheduleLateCostRefresh);
		}, delay);
	}
	// A page opened on a run that has just finished needs the same follow-up.
	untrack(() => {
		if (refreshedOnTerminal) scheduleLateCostRefresh();
	});
	// Stop the pending read the moment there is nothing left to wait for — the
	// cost settled on a read, or the run stopped being terminal. (Unmount is the
	// onDestroy below.) A settled run must not keep touching the run detail.
	$effect(() => {
		const terminal = ['completed', 'failed', 'cancelled'].includes(data.run.status);
		const settled = data.run.usage_total?.cost_settled ?? true;
		if (terminal && !settled) return;
		if (lateCostRefreshTimer !== null) clearTimeout(lateCostRefreshTimer);
		lateCostRefreshTimer = null;
		lateCostAttempts = 0;
	});
	onDestroy(() => {
		if (lateCostRefreshTimer !== null) clearTimeout(lateCostRefreshTimer);
	});

	// Server truth beats the live view. Whenever the loader re-reads the run
	// (terminal refetch, pause refetch, late-cost refetch) and the SERVER says it
	// is finished while the live store still says otherwise, adopt the server's
	// state. This is the backstop that makes "a reload shows the truth" also
	// hold for an open page whose live state went wrong for any reason.
	$effect(() => {
		const loaded = data.run;
		untrack(() => {
			if (loaded.id !== jobProgress.runId) return;
			if (!['completed', 'failed', 'cancelled'].includes(loaded.status)) return;
			if (jobProgress.jobStatus === loaded.status) return;
			jobProgress.disconnect();
			jobProgress.hydrateFromDetail(loaded);
			refreshedOnTerminal = true;
			scheduleLateCostRefresh();
		});
	});

	// A background tab throttles timers and a sleeping laptop drops the stream,
	// so the moment the person LOOKS at the page again is the moment it is most
	// likely to be stale. Ask the server immediately instead of waiting for the
	// next 30s safety-net tick. (No-op on a finished run.)
	$effect(() => {
		const recheck = () => {
			if (document.visibilityState === 'visible') jobProgress.resync();
		};
		document.addEventListener('visibilitychange', recheck);
		window.addEventListener('online', recheck);
		return () => {
			document.removeEventListener('visibilitychange', recheck);
			window.removeEventListener('online', recheck);
		};
	});

	// NOTE: an earlier "live reveal" refetched the loader (invalidateAll) on every
	// stage completion so the storyboard's media filled in as the run built. On a
	// multi-stage run (promo/website) that re-fetched the large run detail +
	// re-rendered the whole storyboard/inspector every few seconds, which froze
	// the resource-constrained CI browser mid-run (the page went unresponsive ~60s
	// in, hanging the post-promote E2E). Removed for stability: stage STATUS still
	// updates live via jobProgress polling, and the produced media fills in on the
	// one-shot terminal refresh above. A churn-free live reveal would need the BE
	// to push lightweight output previews on the SSE stream (tracked separately).

	// --- Checkpoints (BE phase 3) ---
	// Seed the store from the page snapshot so the picker is in sync immediately.
	untrack(() => seedCheckpoints(data.checkpoints));
	// Captured from the snapshot, then updated through the PATCH path only.
	//
	// It is NOT initial-only: this file used to claim "SvelteKit re-running
	// load() on navigation rebuilds this state via remount of the page
	// component", which is false for a SAME-ROUTE navigation — /runs/A →
	// /runs/B reuses the component. Stale, this meant saving checkpoints on
	// run B submitted run A's `pause_after_stages`. Re-seeded in the run-scope
	// effect below.
	let pauseAfter = $state<string[]>(untrack(() => [...data.checkpoints.pause_after_stages]));
	let checkpointsBusy = $state(false);
	let checkpointsErr = $state<string | null>(null);
	// The last list the SERVER confirmed. A failed PATCH rolls back to this, not
	// to the load-time snapshot (which is stale after one successful edit).
	let checkpointsConfirmed = $state<string[]>(
		untrack(() => [...data.checkpoints.pause_after_stages])
	);
	// The GET failed, so `pauseAfter` above is the empty FALLBACK, not the run's
	// real gates. `$derived` and not a one-time read: a same-route /runs/A →
	// /runs/B navigation reuses this component, exactly like `pauseAfter`'s
	// re-seed below.
	const checkpointsReadFailed = $derived(data.checkpointsError != null);

	async function applyCheckpoints(next: string[]) {
		// The picker is already disabled in this state; this is the write-side
		// backstop. PATCH replaces the WHOLE list, so submitting one built from an
		// unknown baseline deletes gates we never managed to read.
		if (checkpointsReadFailed) return;
		// The backend 409s checkpoint edits on a finished run; the panel is
		// read-only then, and this is the write-side backstop.
		if (!checkpointsEditable) return;
		pauseAfter = next; // optimistic
		checkpointsBusy = true;
		checkpointsErr = null;
		try {
			const result = await patchCheckpoints(runId, next.length === 0 ? null : next);
			pauseAfter = [...result.pause_after_stages];
			checkpointsConfirmed = [...result.pause_after_stages];
		} catch (err) {
			checkpointsErr =
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to update checkpoints';
			// Roll back to the last list the server confirmed.
			pauseAfter = [...checkpointsConfirmed];
			toastError('Failed to update checkpoints', checkpointsErr);
		} finally {
			checkpointsBusy = false;
		}
	}

	// --- Verbatim items (project-scoped only in v3) ---
	// v3 dropped per-job verbatim — items live solely on the project and
	// cascade to every Deliverable / Run from it. The run-monitor view
	// surfaces the project list inline so the operator can add / dismiss
	// verbatim without leaving the page.
	// Seed the SHARED project-keyed store only when the fetch actually
	// succeeded. On failure `data.verbatimProject` is `settle`'s empty fallback,
	// and writing that into the store would not just blank this panel — it would
	// overwrite the workspace's cached list for the same project, turning one
	// failed run-view read into "this project has no verbatim" everywhere until
	// a reload. The panel renders its own error state from `verbatimError`.
	function seedVerbatimFromSnapshot() {
		if (!data.verbatimError) seedVerbatimProject(data.project.id, data.verbatimProject);
	}
	untrack(seedVerbatimFromSnapshot);
	const projectVerbatim = $derived(getVerbatimProjectList(data.project.id));

	// --- Live placement: refetch the verbatim list when a CARRIER stage lands ---
	//
	// Placement is derived server-side from a stage's persisted output, so the
	// only way to learn it is to re-read `…/verbatim-items?run_id=`. The SSE
	// stream carries no payload; it only tells us when re-reading is worthwhile.
	//
	// WHY THIS IS NOT `invalidateAll()` (see CLAUDE.md § "Run viewer / live
	// progress"): invalidateAll re-runs the whole loader — the multi-MB run
	// detail with every stage output — and re-renders the storyboard. Doing that
	// per stage completion froze the CPU-constrained CI browser mid-run. This
	// calls ONE endpoint that returns a handful of short strings, and writes it
	// into the verbatim store, so nothing outside the verbatim panel re-renders.
	//
	// Three further guards keep the cost flat regardless of stream behaviour:
	//   - only CARRIER stages trigger it; a `narrate` or `compile` completion
	//     cannot change placement, so it must not cost a request;
	//   - each stage name fires at most once. An SSE reconnect REPLAYS the full
	//     event history (job-progress-state.svelte.ts), so without this a flaky
	//     connection would re-request once per replayed event, forever;
	//   - an in-flight fetch suppresses the next, so a burst coalesces.
	//
	// The hook is `jobProgress.onExtraEvent` rather than a second
	// `subscribeRunEvents()` call: the page already holds an open stream for
	// this run, and opening a parallel EventSource would double the server's
	// connection count per viewer to observe events it is already receiving.
	//
	// Known limitation, deliberate: `onExtraEvent` sees SSE messages only. If
	// the stream dies and JobProgressState falls back to status POLLING, live
	// placement stops updating and the operator sees it on the terminal refresh
	// instead. That is a degraded-but-correct display, not a wrong one.
	// A plain array, not a Set: `svelte/prefer-svelte-reactivity` (correctly)
	// flags a mutable built-in Set in a component, and this is deliberately NOT
	// reactive — nothing renders it, it only de-duplicates requests. At most one
	// entry per carrier stage, so membership cost is irrelevant.
	const refetchedCarrierStages: string[] = [];
	// Carrier stages that completed while a read was already open. They are NOT
	// marked refetched — the open read was ISSUED before their output existed, so
	// it cannot carry their placement — and are drained once it settles. Same
	// plain-array reasoning as above: deliberately non-reactive, one entry max per
	// carrier stage, so the queue is bounded and the drain terminates.
	const pendingCarrierStages: string[] = [];
	let verbatimRefetchInFlight = false;

	async function refetchVerbatimForCarrierStage(stageName: string) {
		if (!VERBATIM_CARRIER_STAGES.has(stageName)) return;
		if (refetchedCarrierStages.includes(stageName)) return;
		// Coalesce, but do not FORGET. Marking the stage refetched here (as this
		// used to, before the bail) recorded a read that never happened: the
		// de-dup guard above then blocked it forever and the panel showed this
		// stage as "pending" for the rest of the run.
		if (verbatimRefetchInFlight) {
			if (!pendingCarrierStages.includes(stageName)) pendingCarrierStages.push(stageName);
			return;
		}
		refetchedCarrierStages.push(stageName);
		verbatimRefetchInFlight = true;
		try {
			await loadVerbatimProject(data.project.id, data.run.id);
		} catch {
			// A failed refetch leaves the previously rendered rows in place. That
			// is the honest outcome: the last known placement stays on screen and
			// nothing is silently downgraded to "pending". The next carrier stage
			// (or the terminal reload) tries again.
			refetchedCarrierStages.splice(refetchedCarrierStages.indexOf(stageName), 1);
		} finally {
			verbatimRefetchInFlight = false;
		}
		// Trailing edge: drain one queued stage per settled read. Each drained call
		// issues a real read and marks only itself, so a replayed event storm still
		// costs at most one request per carrier stage.
		const next = pendingCarrierStages.shift();
		if (next !== undefined) await refetchVerbatimForCarrierStage(next);
	}

	// Named (not an inline assignment to `jobProgress`) because every re-scoped
	// store needs the same hook re-attached — `buildJobProgress` wires it.
	function handleLiveEvent(msg: RunWsMessage) {
		if (msg.event === 'stage_completed' && msg.stage_name) {
			void refetchVerbatimForCarrierStage(msg.stage_name);
		}
	}

	async function handleAddVerbatim(body: VerbatimItemCreateRequest) {
		try {
			await createProjectVerbatim(data.project.id, body);
			toastSuccess('Verbatim item added', 'Will apply on the next stage execution.');
		} catch (err) {
			throw new Error(
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to add verbatim item',
				{ cause: err }
			);
		}
	}

	async function handleDeleteVerbatim(itemId: string) {
		try {
			await deleteProjectVerbatim(data.project.id, itemId);
		} catch (err) {
			throw new Error(
				err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to delete verbatim item',
				{ cause: err }
			);
		}
	}

	// --- What the run is doing RIGHT NOW ---
	// A percentage alone does not tell a waiting human anything: these runs take
	// 8-50 minutes, and `currentStage` was hydrated from the API and updated over
	// the live transport but rendered NOWHERE while a run was running -- its only
	// two consumers were both gated on `jobStatus === 'paused'`. The per-stage
	// list does exist, but only inside the Production-details inspector far below
	// the fold. Surfaced here beside the percentage, where the waiting happens.
	const runningStageLabel = $derived.by(() => {
		if (jobProgress.jobStatus !== 'running') return null;
		const current = jobProgress.currentStage;
		if (!current) return null;
		return current.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	});

	// --- The stage the reviewer is actually being asked to approve ---
	// NOT simply `jobProgress.currentStage`. That field tracks "the stage that
	// entered `running` most recently", and a blueprint wave runs its
	// independent stages CONCURRENTLY — so the last writer can be a no-dep leaf
	// that then SKIPPED (e.g. demo_video's `source_ingest`) while the checkpoint
	// that actually tripped the pause was a sibling. The orchestrator now
	// re-points current_stage at the pause-triggering checkpoint when it pauses,
	// but runs that paused BEFORE that fix still carry the skipped stage, so
	// trust the field only when it names a stage that really completed and
	// repair from the checkpoint list otherwise. Never offer a skipped stage:
	// it has no draft, and its editor is empty.
	const pausedStage = $derived.by(() => {
		if (jobProgress.jobStatus !== 'paused') return null;
		const statusByName = new Map(jobProgress.stages.map((s) => [s.name, s.status]));
		const current = jobProgress.currentStage;
		if (current && statusByName.get(current) === 'completed') return current;
		const consumedGates = getCheckpointList(runId).filter(
			(name) => statusByName.get(name) === 'completed'
		);
		return consumedGates.at(-1) ?? null;
	});

	// --- Refresh the loader when the run PAUSES for review ---
	// Stage OUTPUTS are bound to the frozen loader snapshot (see the terminal
	// reveal above). A run that pauses while this page is open therefore showed
	// the pause banner over Outputs / Storyboard panels frozen at page-load time —
	// at website_review's redesign and script gates the reviewer could not see
	// the very thing they were asked to approve. Refetch ONCE per entry into
	// `paused`. This is not the per-stage-completion refetch CLAUDE.md forbids: a
	// run pauses at most once per declared checkpoint (two for website_review),
	// and the CPU cost is paid while the pipeline is idle waiting for a human.
	// Skipped when the run was already paused at load (the snapshot is fresh).
	const loadedPaused = () => data.run.status === 'paused';
	let refreshedOnPause = untrack(loadedPaused);
	$effect(() => {
		if (jobProgress.jobStatus !== 'paused') {
			refreshedOnPause = false;
			return;
		}
		if (refreshedOnPause) return;
		refreshedOnPause = true;
		void invalidateAll();
	});

	// The output under review, rendered beside the pause banner. Read from the
	// (refreshed) loader snapshot; null until that refetch lands.
	const pausedStageOutput = $derived(
		pausedStage
			? ((data.run.stage_outputs ?? []).find(
					(s) => s.stage_name === pausedStage && s.status === 'completed'
				) ?? null)
			: null
	);

	// Approve from the monitor: resume carries no stage argument, so this is only
	// offered while the LIVE status is paused AND the reviewable stage resolved —
	// the same stage the panel is showing.
	let approvingPause = $state(false);
	async function handleApprovePause() {
		if (jobProgress.jobStatus !== 'paused' || !pausedStage) return;
		const approved = pausedStage;
		approvingPause = true;
		try {
			await performRestart({ runId, status: 'paused' });
			toastSuccess('Approved', `${stageLabel(approved)} accepted — the pipeline is continuing.`);
			resumeLiveStream();
		} catch (err) {
			if (handleNotResumable(err)) return;
			toastError('Failed to approve', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			approvingPause = false;
		}
	}

	// A run loaded while paused never opened a live stream (`buildJobProgress`
	// connects only running/pending runs), so after a resume from THIS page
	// nothing would ever update it again. Flip the status optimistically and
	// connect; the catch-up snapshot + poll correct anything we got wrong.
	function resumeLiveStream() {
		jobProgress.jobStatus = 'running';
		// A run that paused while this page was open still holds its stream.
		if (jobProgress.connectionStatus !== 'connected') jobProgress.connect();
		// The run left its checkpoint: drop it from the bell / banners now, not on the next poll.
		void reviewInboxStore.refresh();
	}

	// --- WHY it is paused ---
	// Only a review CHECKPOINT (`pause_reason: 'checkpoint'`) is "Needs review": approve
	// the stage output. A run someone paused (`manual`) or one paused before the reason
	// was recorded (`unknown`) is just "Paused" — there is nothing to review and the
	// page must not say there is. The reason arrives on the run snapshot, refetched
	// once on entry into `paused` (above); until it lands the page keeps the review
	// view it already had.
	const manualPause = $derived(
		jobProgress.jobStatus === 'paused' &&
			data.run.status === 'paused' &&
			data.run.pause_reason !== 'checkpoint'
	);
	const reviewPause = $derived(jobProgress.jobStatus === 'paused' && !manualPause);
	// One ticking clock for "(5m ago)" so the wait line stays true while the tab is open.
	const now = useNow();
	const pauseSentence = $derived(reviewWaitSentence(data.run, now.current));

	// --- Toast on transition into a review pause ---
	// Waits for the refreshed snapshot (status `paused`) so a MANUAL pause never
	// announces itself as a review.
	let lastNotifiedPauseStage = $state<string | null>(null);
	$effect(() => {
		if (jobProgress.jobStatus !== 'paused') {
			lastNotifiedPauseStage = null;
			return;
		}
		if (data.run.status !== 'paused' || manualPause) return;
		const stage = pausedStage;
		if (!stage || stage === lastNotifiedPauseStage) return;
		lastNotifiedPauseStage = stage;
		toastSuccess(
			NEEDS_REVIEW,
			`${stageLabel(stage)} is ready. Approve it to continue, or open the full review to regenerate it.`
		);
	});

	// --- Expandable stages ---
	let expandedStage = $state<string | null>(null);

	// Outputs the loader snapshot cannot supply. The live poll (RunStatusLite)
	// carries stage STATUS but explicitly omits every output blob, so mid-run a
	// stage that just went green renders "No output recorded." and its dependents
	// render "not produced yet" — until the one-shot terminal refetch or a manual
	// reload. See the store's docstring for why this is a pull (on expand) and not
	// a push (on every stage event): the push version froze the CI browser.
	const liveOutputs = untrack(() => new LiveStageOutputs(data.run.id));

	// --- Re-scope EVERY run-scoped store when the run id changes ---
	//
	// SvelteKit reuses this component across /runs/A → /runs/B, and this page
	// performs that navigation ITSELF: `handleRestart` (failed/cancelled →
	// regenerate) and `handleRerunConfirm` both `goto` a sibling run. No remount
	// happens, so anything captured in a top-level `untrack` stays bound to run A.
	//
	// Only `liveOutputs` used to be re-scoped here. The rest went stale, and the
	// worst case was silent: open a FAILED run A → Regenerate → land on run B and
	// (a) `jobProgress` still holds A's stage set and A's terminal status, so it
	// renders B as A's failed pipeline; (b) because A was terminal, `connect()`
	// was never called and B gets NO live stream, forever; (c) `refreshedOnTerminal`
	// is already `true` from A, so B's one-shot terminal `invalidateAll()` — the
	// only thing that ever fills B's outputs — is skipped too; (d) saving
	// checkpoints on B PATCHes A's `pause_after_stages`.
	//
	// `$effect.pre` runs BEFORE the DOM update, so no stale frame is rendered.
	// Everything after the id guard runs inside `untrack`, so this effect's only
	// dependency is `data.run.id` — it reads none of the state it writes
	// (`jobProgress`, `pauseAfter`, the stores), so it cannot re-trigger itself.
	let scopedRunId = untrack(() => data.run.id);
	$effect.pre(() => {
		const nextRunId = data.run.id;
		liveOutputs.reset(nextRunId); // no-op when the id is unchanged
		if (nextRunId === scopedRunId) return;
		scopedRunId = nextRunId;
		untrack(() => {
			// Tear the old run's stream down first, or its transports keep
			// polling/streaming run A into a store nothing renders.
			jobProgress.onExtraEvent = null;
			jobProgress.disconnect();
			jobProgress = buildJobProgress();
			refreshedOnTerminal = loadedTerminal();
			refreshedOnPause = loadedPaused();
			// Per-run de-dup bookkeeping for the verbatim placement refetch. Left
			// populated, run B's carrier stages would be treated as already read.
			refetchedCarrierStages.length = 0;
			pendingCarrierStages.length = 0;
			verbatimRefetchInFlight = false;
			seedCheckpoints(data.checkpoints);
			pauseAfter = [...data.checkpoints.pause_after_stages];
			seedVerbatimFromSnapshot();
			// Run-scoped view state: an expanded card names a stage of run A.
			expandedStage = null;
			lastNotifiedPauseStage = null;
			if (lateCostRefreshTimer !== null) {
				clearTimeout(lateCostRefreshTimer);
				lateCostRefreshTimer = null;
			}
			lateCostAttempts = 0;
			if (refreshedOnTerminal) scheduleLateCostRefresh();
		});
	});

	/** True when the loader snapshot already carries this stage's output. */
	function snapshotHasOutput(name: string): boolean {
		const stage = detailMap.get(name);
		return (
			stage?.output != null &&
			['completed', 'failed', 'skipped', 'cancelled'].includes(stage.status)
		);
	}

	/** A stage's CURRENT status: live poll first, loader snapshot as fallback. */
	function stageStatus(name: string): string {
		return liveStatusByStage.get(name) ?? detailMap.get(name)?.status ?? 'pending';
	}

	// Warnings panel → expand + scroll to that stage's card in Production details.
	function openWarningStage(name: string) {
		expandedStage = name;
		requestAnimationFrame(() => {
			document
				.getElementById(`stage-${name}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}

	function toggleStage(name: string) {
		expandedStage = expandedStage === name ? null : name;
		// The fetch is driven by the effect below, which covers both "just opened"
		// and "the open card's stage finished while it was open".
	}

	// Fetch outputs for the OPEN card only — the one stage whose output is
	// rendered plus its declared upstream deps, whose input summaries it renders.
	// Scoped strictly to `expandedStage`: this must never widen into a poll for
	// stages nobody opened (that push design froze the CI browser; see the note
	// above and the store docstring).
	//
	// It re-runs when one of those stages' STATUS changes, which is the fix for
	// the card that was expanded while its stage was still `running`: that attempt
	// 404s, and without this nothing ever re-asked, so the card read "No output
	// recorded." for the rest of the run. `ensure` is keyed per (stage, status),
	// so the re-run costs one request per stage per status transition, and none at
	// all once a payload has resolved.
	$effect(() => {
		const name = expandedStage;
		if (!name) return;
		const names = [name, ...(data.dependsOn.get(name) ?? [])];
		// Explicit reads so this effect depends on exactly these stages' statuses.
		for (const n of names) stageStatus(n);
		void liveOutputs.ensure(names, snapshotHasOutput, stageStatus);
	});

	// Only fetch completed storyboard carriers, in small batches after a burst of
	// status events. Reuse the per-stage cache; never invalidate the full loader.
	$effect(() => {
		const requestRunId = runId;
		const wanted = jobProgress.stages
			.filter(
				(s) =>
					s.status === 'completed' &&
					/(?:script|script_draft|narrate|slides|storyboard|visual_director|record|redesign|image_gen|video_gen|motion_graphics_gen|site_capture)$/.test(
						s.name
					)
			)
			.map((s) => s.name);
		const timer = setTimeout(async () => {
			for (let i = 0; i < wanted.length; i += 2) {
				if (liveOutputs.runId !== requestRunId) return;
				await liveOutputs.ensure(wanted.slice(i, i + 2), snapshotHasOutput, stageStatus);
			}
		}, 500);
		return () => clearTimeout(timer);
	});
	// --- Log panel collapse ---
	let logsPanelOpen = $state(true);

	// Convert LogEntry[] to string[] for the LogStream component. A live run
	// re-runs this derivation on every stage event; memoising formatLogTime by
	// timestamp keeps it from re-running Intl date formatting across the whole
	// (capped-500) log list each time.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain non-reactive memo cache is intended; a reactive SvelteMap would defeat the purpose.
	const _timeFmtCache = new Map<string, string>();

	function formatLogTime(timestamp: string): string {
		const cached = _timeFmtCache.get(timestamp);
		if (cached !== undefined) return cached;
		let out: string;
		try {
			out = new Date(timestamp).toLocaleTimeString('en-US', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
		} catch (e) {
			if (import.meta.env.DEV) console.warn('Failed to format log timestamp:', e);
			out = '--:--:--';
		}
		_timeFmtCache.set(timestamp, out);
		return out;
	}

	const logStrings = $derived(
		jobProgress.logs.map(
			(entry) =>
				`[${formatLogTime(entry.timestamp)}] ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`
		)
	);

	function clearLogs() {
		jobProgress.logs = [];
	}

	// Frozen map of the run's loaded stage outputs. `data.run` is the load-time
	// snapshot (refreshed only once at terminal), so this is hoisted out of
	// detailStages below — otherwise it was rebuilt on every live stage event.
	const detailMap = $derived(new Map((data.run.stage_outputs ?? []).map((s) => [s.stage_name, s])));

	// LIVE stage statuses (the loader snapshot's are frozen at page load). Read by
	// `stageStatus`, which keys the lazy-output attempt guard — a stage that was
	// `running` when the reviewer opened its card must be re-asked once it
	// completes.
	const liveStatusByStage = $derived(new Map(jobProgress.stages.map((s) => [s.name, s.status])));

	// The snapshot's outputs with anything lazily fetched overlaid. Returns the
	// snapshot array UNCHANGED until a fetch actually resolves, so the inspector's
	// per-stage memoisation (and the render budget it protects) is untouched for
	// every run nobody clicks into.
	const mergedOutputs = $derived(liveOutputs.merge(data.run.stage_outputs ?? []));
	const storylineRun = $derived({
		...data.run,
		stage_outputs: mergedOutputs.map((s) =>
			s.output && stageStatus(s.stage_name) === 'completed'
				? { ...s, status: 'completed' as const }
				: s
		)
	});

	// Live stage list for the inspector + checkpoint picker. The v3 RunDetail has
	// stage_outputs (no service_name / service_job_id / retry_count); we
	// synthesize blank values for those legacy fields so the components can stay
	// unchanged. Memoised per stage: a live event only changes one stage's
	// status, so returning the SAME object reference for unchanged stages lets
	// the keyed {#each} in StageIOInspector (and the checkpoint picker) re-render
	// only the changed card instead of all ~15 every event — the dominant
	// per-event re-render cost that saturated the constrained CI browser and
	// stalled the run page on long multi-stage runs (promo / website_review).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain non-reactive memo cache is intended; a reactive SvelteMap would defeat the purpose.
	const stageObjCache = new Map<string, StageExecutionResponse>();
	// Pipeline order from the blueprint's depends_on edges. The API lists a run's
	// stages alphabetically (they are all seeded at once, ordered by
	// created_at, stage_name), so without this the inspector and the checkpoint
	// picker opened on "Claim Finish" and buried "Source Ingest" near the end.
	// Ties between ready stages (demo_video has two roots) break by when the run
	// actually STARTED each one — the run's own record, not the blueprint — and
	// stages the current blueprint does not know still get ranked (by start
	// time, unstarted last) instead of keeping the API's alphabetical order.
	const stageRank = $derived(
		blueprintStageRank(
			data.dependsOn,
			new Map((data.run.stage_outputs ?? []).map((s) => [s.stage_name, s.started_at])),
			(data.run.stage_outputs ?? []).map((s) => s.stage_name)
		)
	);
	const detailStages = $derived.by((): StageExecutionResponse[] => {
		const map = detailMap;
		const ordered = sortByStageRank(jobProgress.stages, stageRank, (s) => s.name);
		return ordered.map((s) => {
			const status = s.status as StageExecutionResponse['status'];
			const duration_seconds = s.durationMs !== null ? s.durationMs / 1000 : null;
			const error = map.get(s.name)?.error ?? null;
			const prev = stageObjCache.get(s.name);
			if (
				prev &&
				prev.status === status &&
				prev.duration_seconds === duration_seconds &&
				prev.error === error
			) {
				return prev;
			}
			const next: StageExecutionResponse = {
				stage_name: s.name,
				status,
				service_name: '',
				service_job_id: null,
				duration_seconds,
				retry_count: 0,
				error
			};
			stageObjCache.set(s.name, next);
			return next;
		});
	});

	// --- Cancel flow ---
	let showCancelModal = $state(false);
	let cancelling = $state(false);

	async function handleCancel() {
		cancelling = true;
		try {
			await runs.cancel(runId);
			jobProgress.jobStatus = 'cancelled';
			showCancelModal = false;
			toastSuccess('Pipeline cancelled');
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				showCancelModal = false;
				toastSuccess('Pipeline already finished');
			} else {
				toastError('Failed to cancel', err instanceof ApiError ? err.detail : 'Unknown error');
			}
		} finally {
			cancelling = false;
		}
	}

	// --- Resume / Restart flow ---
	// Two different actions with two different buttons:
	//   * Resume  — only for a PAUSED run; continues it in place, nothing re-billed.
	//   * Restart — only for a FAILED/CANCELLED run; spawns a NEW paid run, so it
	//               is always confirmed first.
	// Both re-read the run's status from the server before acting. The loader
	// snapshot and even the live stream can lag (a run that failed while the
	// page was open), and acting on a stale status either resumes a dead run
	// (a silent no-op) or regenerates a paused one (abandons paid work).
	let restarting = $state(false);
	let showRestartModal = $state(false);
	let confirmingRestart = $state(false);

	// A resume the server refused because the run already left `paused` (another
	// tab approved it, it was cancelled, …): say what it is NOW and adopt that
	// status, instead of a generic failure the person would retry.
	function handleNotResumable(err: unknown): boolean {
		const refused = runNotResumable(err);
		if (!refused) return false;
		toastError('Nothing to resume', refused.message);
		if (refused.status) jobProgress.jobStatus = refused.status;
		return true;
	}

	async function freshStatus(): Promise<string> {
		const lite = await runs.getStatus(runId);
		jobProgress.jobStatus = lite.status;
		return lite.status;
	}

	async function handleResume() {
		restarting = true;
		try {
			const status = await freshStatus();
			if (!canResumeRun(status)) {
				toastError('Nothing to resume', `This run is now ${status}.`);
				return;
			}
			await performRestart({ runId, status });
			toastSuccess('Pipeline resumed — continuing from the next stage');
			// Stay on the same page. A run loaded paused has no open stream, so
			// open one — otherwise nothing "picks up new events".
			resumeLiveStream();
		} catch (err) {
			if (handleNotResumable(err)) return;
			if (handleByoRefusal(err)) return;
			toastError('Failed to resume', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			restarting = false;
		}
	}

	async function handleRestartRequest() {
		restarting = true;
		try {
			const status = await freshStatus();
			if (!canRestartRun(status)) {
				toastError('Restart not available', `This run is now ${status}.`);
				return;
			}
			showRestartModal = true;
		} catch (err) {
			toastError(
				'Could not check the run status',
				err instanceof ApiError ? err.detail : 'Unknown error'
			);
		} finally {
			restarting = false;
		}
	}

	async function handleRestartConfirm() {
		confirmingRestart = true;
		try {
			const result = await runs.regenerate(runId, {});
			showRestartModal = false;
			toastSuccess('Pipeline restart requested');
			// The new run id differs from the old, so navigate to what the BE returned.
			goto(resolve(`/projects/${projectId}/runs/${result.id}`));
		} catch (err) {
			if (handleByoRefusal(err)) return;
			toastError('Failed to restart', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			confirmingRestart = false;
		}
	}

	// --- Open stage editor ---
	function handleOpenEditor(stageName: string) {
		goto(resolve(`/projects/${projectId}/runs/${runId}/stages/${stageName}`));
	}

	// --- Regenerate run flow (full regenerate; per-stage rerun is TODO b2) ---
	let showRerunModal = $state(false);
	let rerunStage = $state<string | null>(null);
	let rerunning = $state(false);

	function handleRerunRequest(stageName: string) {
		rerunStage = stageName;
		showRerunModal = true;
	}

	async function handleRerunConfirm() {
		if (!rerunStage) return;
		rerunning = true;
		try {
			// Rerun from the chosen stage: the BE preserves every completed stage
			// before it and re-runs from it onward (RegenerateRequest.from_stage).
			const result = await runs.regenerate(runId, { from_stage: rerunStage });
			showRerunModal = false;
			toastSuccess('Regenerating run as a new version');
			// The regenerate endpoint returns a new sibling run; navigate to it.
			goto(resolve(`/projects/${projectId}/runs/${result.id}`));
		} catch (err) {
			if (handleByoRefusal(err)) return;
			toastError('Failed to rerun', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			rerunning = false;
		}
	}

	// --- Derived state ---
	// Cancel is allowed on a PAUSED run too: rejecting a gate must not leave a
	// zombie run holding the deliverable in "awaiting review".
	const canCancel = $derived(canCancelRun(jobProgress.jobStatus));
	const canResume = $derived(canResumeRun(jobProgress.jobStatus));
	const canRestart = $derived(canRestartRun(jobProgress.jobStatus));
	const checkpointsEditable = $derived(canEditCheckpoints(jobProgress.jobStatus));

	// Failure explanation: keyed on the orchestrator's structural failure_class,
	// never on the raw error (an exception dump with internal service URLs).
	// The server names the failed stage (`RunDetail.failed_stage`); the first stage
	// the live view saw fail is only the fallback for a server that does not.
	const failedStage = $derived(
		resolveFailedStage(
			data.run,
			jobProgress.stages.find((st) => st.status === 'failed')?.name ?? null
		)
	);
	// `failure_detail.code="upstream_auth"`: whose credential was rejected decides
	// who can fix it (the tenant's own provider key vs our service config).
	const upstreamAuth = $derived(
		data.run.status === 'failed' ? upstreamAuthFailureFromRun(data.run) : null
	);
	// `failure_detail.code="site_login_failed"`: the saved source-site sign-in did not
	// work. The fix is on the Brief page, then a rerun of the failed step.
	const siteLogin = $derived(
		data.run.status === 'failed' ? siteLoginFailureFromRun(data.run) : null
	);
	const runFailure = $derived(
		upstreamAuth ??
			siteLogin ??
			failureMessage(
				data.run.status === 'failed' ? (data.run.failure_class ?? null) : null,
				failedStage,
				stageLabel
			)
	);
	const runErrorDetails = $derived(redactRunError(jobProgress.error));
	const isCompleted = $derived(jobProgress.jobStatus === 'completed');
	// The deliverable leads the page once the run is done AND the loader holds
	// its outputs (the terminal refetch has landed) — not a frame earlier, or the
	// layout would jump twice.
	const outputsFirst = $derived(isCompleted && data.run.status === 'completed');
	// The canonical address of this run page — what "Copy link" hands a teammate.
	const shareUrl = $derived(
		typeof window === 'undefined'
			? undefined
			: `${window.location.origin}${resolve(`/projects/${projectId}/runs/${runId}`)}`
	);
	const isStreaming = $derived(
		jobProgress.connectionStatus === 'connected' &&
			(jobProgress.jobStatus === 'running' || jobProgress.jobStatus === 'pending')
	);

	const siteName = $derived(extractHostname(sourceUrl) || projectTitle);
	// Tab title names the project + workflow type (was the source hostname +
	// a constant "Pipeline Detail", identical for every run of a site).
	const pageTitle = $derived(runPageTitle(projectTitle, data.project.type));

	// The Studio (preview + clip timeline + feedback/regeneration) opens on any
	// run that produced a compiled video, resolved by output shape.
	const hasVideo = $derived(runHasResult(data.run, isVideoStage));

	// The run's actual stages, in execution order — drives the stage inspector
	// and the checkpoint picker. The per-type blueprint defines these; we read
	// them off the run rather than a hard-coded grouping. The stage *set* is
	// fixed once the run starts (only statuses change live), so we return a
	// stable array reference while the names are unchanged — otherwise every
	// live event handed CheckpointPicker a new array and re-rendered its rows.
	let stageNamesCache: string[] = [];
	const runStageNames = $derived.by(() => {
		const next = detailStages.map((s) => s.stage_name);
		if (next.length === stageNamesCache.length && next.every((n, i) => n === stageNamesCache[i])) {
			return stageNamesCache;
		}
		stageNamesCache = next;
		return next;
	});

	// Hoisted out of the template so the preset arrays aren't re-created (and the
	// picker re-rendered) on every live event; recomputes only when the stable
	// runStageNames reference changes.
	const checkpointPresets = $derived([
		{ label: 'None', stages: [] },
		{ label: 'Every stage', stages: [...runStageNames] }
	]);

	// ── Publish to YouTube ────────────────────────────────────────────────
	// The run's final video is uploaded via the orchestrator /api/youtube/upload
	// translation route. OAuth connect/disconnect lives on the Providers page; here
	// we check connection state, collect title/description/privacy, start the job,
	// and poll it to completion. The RunOutputPanel surfaces the trigger on the
	// video result via the onPublish callback.
	let showPublishModal = $state(false);
	let publishConnected = $state<boolean | null>(null);
	let publishConnectionState = $state<YouTubeConnectionState | null>(null);
	let publishTitle = $state('');
	let publishDescription = $state('');
	let publishPrivacy = $state<YouTubePrivacyStatus>('unlisted');
	let publishing = $state(false);
	let publishError = $state<string | null>(null);
	let publishJobStatus = $state<string | null>(null);
	let publishedUrl = $state<string | null>(null);
	// The orchestrator echoes the minted soft-CC .srt URL on the initial publish
	// response (not the poll), so capture it at submit time for a download link.
	let publishedCaptionUrl = $state<string | null>(null);

	async function openPublish() {
		publishError = null;
		publishJobStatus = null;
		publishedUrl = null;
		publishedCaptionUrl = null;
		publishTitle = projectTitle;
		publishDescription = '';
		publishPrivacy = 'unlisted';
		publishConnected = null;
		publishConnectionState = null;
		showPublishModal = true;
		try {
			const status = await youtube.authStatus();
			// Gate on can_publish (falls back to `connected` on an older backend):
			// `connected` is now true only for the tenant's own grant.
			publishConnectionState = youtubeConnectionState(status);
			publishConnected = canPublishToYouTube(status);
		} catch (e) {
			publishConnected = false;
			publishError = e instanceof ApiError ? e.detail : 'Could not check YouTube connection';
		}
	}

	async function submitPublish() {
		if (!publishTitle.trim()) {
			publishError = 'A title is required';
			return;
		}
		publishing = true;
		publishError = null;
		publishedUrl = null;
		publishedCaptionUrl = null;
		try {
			const job = await youtube.startUpload({
				pipeline_job_id: data.run.id,
				title: publishTitle.trim(),
				description: publishDescription.trim() || undefined,
				privacy_status: publishPrivacy
			});
			publishJobStatus = job.status;
			// caption_source is only on the start_upload response, not the poll job.
			publishedCaptionUrl = job.caption_source ?? null;
			await pollPublishJob(job.job_id);
		} catch (e) {
			publishError = e instanceof ApiError ? e.detail : 'Upload failed to start';
		} finally {
			publishing = false;
		}
	}

	async function pollPublishJob(jobId: string) {
		// Bounded poll — uploads of a long course can take minutes; cap at ~10min.
		for (let i = 0; i < 200; i++) {
			// Stop the moment the component is gone. The upload itself is
			// server-side and unaffected; this only stops us asking about it.
			if (destroyed) return;
			let job;
			try {
				job = await youtube.getJob(jobId);
			} catch (e) {
				publishError = e instanceof ApiError ? e.detail : 'Lost track of the upload job';
				return;
			}
			publishJobStatus = job.status;
			if (job.status === 'completed') {
				publishedUrl = job.youtube_url ?? null;
				toastSuccess('Published to YouTube');
				return;
			}
			if (job.status === 'failed') {
				publishError = job.error_message ?? 'Upload failed';
				return;
			}
			await new Promise((r) => setTimeout(r, 3000));
		}
		publishError = 'Upload is still processing — check YouTube Studio in a few minutes';
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
</svelte:head>

<Page testid="run-viewer">
	{#if jobProgress.unavailable}
		<div
			role="alert"
			data-testid="run-unavailable-banner"
			class="rounded-[var(--radius-lg)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger-text)]"
		>
			This run isn't available under your current workspace
			{jobProgress.accessError === 404
				? '— it may belong to a different workspace.'
				: '— your session may have expired.'}
			Live updates have stopped; anything shown below may be out of date. Try reloading or switching workspace.
		</div>
	{/if}
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 shadow-soft"
	>
		<div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
			<div class="min-w-0 space-y-3">
				<p class="text-kicker text-[var(--color-text-muted)] flex items-center gap-1.5">
					<a href={resolve('/projects')} class="hover:text-[var(--color-text)]">Projects</a>
					<ChevronRight class="h-3 w-3" />
					<a href={resolve(`/projects/${projectId}`)} class="hover:text-[var(--color-text)]"
						>{projectTitle}</a
					>
					<ChevronRight class="h-3 w-3" />
					<span>Run {jobIdShort}</span>
				</p>
				<div class="flex items-center gap-2 flex-wrap">
					<h1 class="text-xl md:text-2xl font-bold text-[var(--color-text)] truncate">
						{siteName}
					</h1>
					<!-- e2e: data-testid + data-status mirror the badge state so
					     w2v_frontend/e2e/tests/*.spec.ts can poll for completion
					     without coupling to JobStatusBadge's visual implementation.
					     Bind to the LIVE jobProgress.jobStatus (SSE/poll-updated),
					     NOT data.run.status — the loader snapshot is frozen at page
					     load (no invalidate()), so a run that finishes while the page
					     is open would otherwise leave data-status stuck at its
					     load-time value and the e2e poll would hang the full budget. -->
					<span data-testid="run-status-badge" data-status={jobProgress.jobStatus}>
						<JobStatusBadge
							status={jobProgress.jobStatus}
							degraded={data.run.degraded ?? false}
							pauseReason={data.run.status === 'paused' ? data.run.pause_reason : null}
						/>
					</span>
				</div>
				{#if sourceUrl}
					<a
						href={sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline font-mono break-all"
					>
						{sourceUrl}
						<ExternalLink class="h-3.5 w-3.5 shrink-0" />
					</a>
				{/if}
			</div>

			<div class="space-y-3">
				<div class="flex items-center justify-end gap-2 text-xs">
					{#if jobProgress.connectionStatus === 'connected'}
						<span
							class="inline-flex items-center gap-1.5 text-[var(--color-success-text)] rounded-full border border-[var(--color-success-border)] px-2.5 py-1 bg-[var(--color-success-bg)]"
						>
							<Wifi class="h-3.5 w-3.5" />
							Live updates
						</span>
					{:else if jobProgress.connectionStatus === 'connecting'}
						<span
							class="inline-flex items-center gap-1.5 text-[var(--color-warning-text)] rounded-full border border-[var(--color-warning-border)] px-2.5 py-1 bg-[var(--color-warning-bg)]"
						>
							<Loader class="h-3.5 w-3.5 animate-spin" />
							Connecting
						</span>
					{:else if jobProgress.unavailable}
						<span
							data-testid="run-updates-unavailable"
							title="This run isn't available under your current workspace — it may belong to a different workspace."
							class="inline-flex items-center gap-1.5 text-[var(--color-danger-text)] rounded-full border border-[var(--color-danger-border)] px-2.5 py-1 bg-[var(--color-danger-bg)]"
						>
							<WifiOff class="h-3.5 w-3.5" />
							Updates unavailable
						</span>
					{:else if jobProgress.connectionStatus === 'failed'}
						<button
							onclick={() => jobProgress.connect()}
							class="inline-flex items-center gap-1.5 text-[var(--color-danger-text)] rounded-full border border-[var(--color-danger-border)] px-2.5 py-1 bg-[var(--color-danger-bg)] hover:opacity-80"
						>
							<WifiOff class="h-3.5 w-3.5" />
							Reconnect stream
						</button>
					{/if}
				</div>

				<div class="flex flex-wrap justify-end gap-2">
					{#if hasVideo}
						<Button
							variant="primary"
							size="sm"
							href={`/projects/${projectId}/runs/${runId}/studio`}
						>
							<MonitorPlay class="h-4 w-4" />
							Open in Studio
						</Button>
					{/if}
					{#if canCancel}
						<Button variant="danger" size="sm" onclick={() => (showCancelModal = true)}>
							<XCircle class="h-4 w-4" />
							Cancel
						</Button>
					{/if}
					{#if canResume}
						<Button variant="primary" size="sm" loading={restarting} onclick={handleResume}>
							<Play class="h-4 w-4" />
							Resume
						</Button>
					{:else if canRestart}
						<Button variant="primary" size="sm" loading={restarting} onclick={handleRestartRequest}>
							<RotateCcw class="h-4 w-4" />
							{restartLabel(jobProgress.jobStatus)}
						</Button>
					{/if}
					{#if isCompleted}
						<Button variant="secondary" size="sm" href={`/projects/${projectId}`}>
							<ArrowLeft class="h-4 w-4" />
							Back to project
						</Button>
					{/if}
				</div>
			</div>
		</div>

		{#if canRestart}
			<!-- People cancel a run to fix something and run it again. Say how, before
			     they look for it: edits made now are kept by Restart, and only the
			     steps they affect run again. -->
			<p class="mt-3 text-sm text-[var(--color-text-muted)]" data-testid="restart-edit-hint">
				Want to change something first? Open a step below to edit what it produced or rerun it from
				there, or edit the
				<a
					href={resolve(`/projects/${projectId}`)}
					class="text-[var(--color-accent)] hover:underline">project settings</a
				>. When you {restartLabel(jobProgress.jobStatus).toLowerCase()}, finished steps your changes
				don't affect are kept.
			</p>
		{/if}

		<div class="mt-5 grid grid-cols-2 lg:grid-cols-6 gap-3">
			<div
				class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
			>
				<p class="text-xs text-[var(--color-text-muted)]">Created</p>
				<p class="text-sm font-semibold text-[var(--color-text)] mt-1">
					{data.run.created_at ? formatRelativeTime(data.run.created_at) : '--'}
				</p>
			</div>
			<div
				class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
			>
				<p class="text-xs text-[var(--color-text-muted)]">
					{runEndLabel(data.run.status, data.run.completed_at)}
				</p>
				<p class="text-sm font-semibold text-[var(--color-text)] mt-1">
					{data.run.completed_at
						? formatRelativeTime(data.run.completed_at)
						: data.run.started_at
							? formatRelativeTime(data.run.started_at)
							: '--'}
				</p>
			</div>
			<div
				class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
			>
				<p class="text-xs text-[var(--color-text-muted)]">Progress</p>
				<p class="text-sm font-semibold text-[var(--color-text)] mt-1">
					{jobProgress.progressPercent}%
				</p>
				{#if runningStageLabel}
					<p
						data-testid="running-stage"
						class="text-xs text-[var(--color-text-muted)] mt-0.5 truncate"
						title={runningStageLabel}
					>
						{runningStageLabel}
					</p>
				{/if}
			</div>
			<div
				class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5"
			>
				<p class="text-xs text-[var(--color-text-muted)]">Cost</p>
				<p
					data-testid="run-cost"
					class="text-sm font-semibold text-[var(--color-text)] mt-1"
					title={costDisplay.title ?? `${totalTokens.toLocaleString()} tokens`}
				>
					{costDisplay.text}
				</p>
				<TokenUsage usage={data.run.usage_total} class="mt-0.5" />
			</div>
			<div
				class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 lg:col-span-2"
			>
				<p class="text-xs text-[var(--color-text-muted)]">Run ID</p>
				<p class="text-sm font-mono text-[var(--color-text)] mt-1 truncate" title={runId}>
					{runId}
				</p>
			</div>
		</div>

		<div class="mt-4">
			<div
				class="h-2 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden"
			>
				<div
					class="h-full bg-[var(--color-accent)] transition-all duration-300"
					style="width: {Math.max(2, jobProgress.progressPercent)}%"
				></div>
			</div>
		</div>
	</section>

	<!-- A COMPLETED run leads with its deliverable (the output panel); the
	     in-flight order is the `!outputsFirst` branch below. -->
	{#if outputsFirst}
		<PanelBoundary name="Outputs">
			{@render outputPanel()}
		</PanelBoundary>
	{/if}

	{#if manualPause}
		<div
			class="rounded-xl border border-status-pending/40 bg-status-pending/10 p-4 shadow-soft"
			data-testid="manual-pause-banner"
		>
			<!-- Live region holds the state only; the ticking age below is not re-announced. -->
			<p class="text-sm font-semibold text-text" role="status" aria-live="polite">{PAUSED}</p>
			<p class="text-xs text-text-secondary mt-0.5">
				{pauseSentence ?? 'Someone paused this run. Resume it to continue.'}
			</p>
		</div>
	{/if}

	<PauseBanner
		visible={reviewPause}
		stageName={pausedStage}
		waitingSince={pauseSentence}
		editorHref={pausedStage
			? `/projects/${projectId}/runs/${runId}/stages/${pausedStage}`
			: `/projects/${projectId}/runs/${runId}`}
	/>

	{#if reviewPause && pausedStage}
		<!-- What the reviewer is being asked to approve, on THIS page. The banner
		     alone pointed at a gate while every output panel below was the frozen
		     page-load snapshot. -->
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 md:p-5 space-y-3"
			data-testid="pause-review"
			data-stage={pausedStage}
		>
			<div class="flex items-start justify-between gap-3 flex-wrap">
				<div>
					<h2 class="text-sm font-semibold text-[var(--color-text)]">
						{stageLabel(pausedStage)}: the draft to approve
					</h2>
					<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
						Approve to let the pipeline continue, or open the full review to regenerate it.
					</p>
				</div>
				<Button
					variant="primary"
					size="sm"
					loading={approvingPause}
					disabled={approvingPause}
					onclick={handleApprovePause}
				>
					<Check class="h-4 w-4" />
					Approve &amp; continue
				</Button>
			</div>
			{#if pausedStageOutput}
				<div data-testid="pause-review-output">
					<StageOutputView
						output={pausedStageOutput.output as Record<string, unknown> | null}
						{runId}
						dense
					/>
				</div>
			{:else}
				<p class="text-xs text-[var(--color-text-muted)]" data-testid="pause-review-loading">
					<Loader class="inline h-3.5 w-3.5 animate-spin" /> Loading the output under review…
				</p>
			{/if}
		</section>
	{/if}

	<!-- Warnings show as soon as ANY stage degraded — not only once the run is
	     completed. A stage's `degraded` flips when THAT stage completes, so a run
	     paused at a review gate (or one that later failed) already carries warnings
	     the reviewer must see before approving paid downstream work. The panel
	     self-gates to nothing when there are none. -->
	<RunWarningsPanel
		stages={mergedOutputs}
		runDegraded={data.run.degraded ?? false}
		runStatus={jobProgress.jobStatus}
		onselect={openWarningStage}
		stageHref={(stage) => resolve(`/projects/${projectId}/runs/${data.run.id}/stages/${stage}`)}
	/>

	{#if byoRequired}
		<ByoProviderRequiredNotice required={byoRequired} />
	{:else if jobProgress.error}
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4"
			data-testid="run-failure"
		>
			<h3 class="text-sm font-semibold text-[var(--color-danger-text)] mb-1">
				{runFailure.title}
			</h3>
			<p class="text-sm text-[var(--color-danger-text)]">{runFailure.body}</p>
			{#if upstreamAuth?.scope === 'tenant'}
				<p class="mt-1 text-sm text-[var(--color-danger-text)]" data-testid="upstream-auth-fix">
					{#if isTenantAdmin()}
						<a
							href={resolve('/providers')}
							class="font-semibold underline"
							data-testid="upstream-auth-providers-link">Open provider settings</a
						>
					{:else}
						Ask a workspace admin to fix the key on the Providers page.
					{/if}
				</p>
			{/if}
			{#if siteLogin}
				<p class="mt-1 flex flex-wrap gap-x-4 text-sm text-[var(--color-danger-text)]">
					<a
						href={resolve(`/projects/${projectId}?section=brief`)}
						class="font-semibold underline"
						data-testid="site-login-brief-link">Check the sign-in on the Brief page</a
					>
					{#if failedStage}
						<a
							href={resolve(`/projects/${projectId}/runs/${data.run.id}/stages/${failedStage}`)}
							class="font-semibold underline"
							data-testid="site-login-rerun-link">Rerun this step</a
						>
					{/if}
				</p>
			{/if}
			{#if runErrorDetails}
				<details class="mt-2">
					<summary class="cursor-pointer text-xs text-[var(--color-danger-text)] opacity-80">
						Technical details (for support)
					</summary>
					<p
						class="mt-1 break-words font-mono text-xs text-[var(--color-danger-text)] opacity-80"
						data-testid="run-failure-details"
					>
						{runErrorDetails}
					</p>
				</details>
			{/if}
		</section>
	{/if}

	<!-- While the run is in flight (or paused for review) the controls that shape
	     it come first. Once it has COMPLETED, the deliverable is the point of the
	     page: it is rendered at the top (above) and these move below the
	     production details, where they are read-only history. -->
	{#if !outputsFirst}
		{@render setupPanels()}

		<PanelBoundary name="Outputs">
			{@render outputPanel()}
		</PanelBoundary>
	{/if}

	<!-- Decisions: the great-video AI's editorial choices (pacing / hooks / cold
	     open / render-manifest override ledger), surfaced by output shape via the
	     registry so they're front-and-centre instead of buried in the inspector.
	     Self-gates to nothing for runs without decision-bearing stages. -->
	<PanelBoundary name="Decisions">
		<DecisionsPanel run={data.run} />
	</PanelBoundary>

	<!-- Storyboard: the cross-stage line_id assembly (script + voiceover + visual
	     per line). Self-gates to nothing for runs without line-keyed stages. Lives
	     between the finished-deliverable hero and the technical inspector. -->
	<PanelBoundary name="Storyboard">
		<StageStoryline run={storylineRun} />
	</PanelBoundary>

	<PanelBoundary name="Production details">
		<ProductionDetailsPanel
			stages={detailStages}
			outputs={mergedOutputs}
			config={data.run.config_snapshot ?? {}}
			usage={data.run.usage_total}
			dependsOn={data.dependsOn}
			lineageUnavailable={Boolean(data.lineageError)}
			outputError={(name) => liveOutputs.errorFor(name)}
			{expandedStage}
			pipelineStatus={data.run.status}
			ontoggle={toggleStage}
			onrerun={handleRerunRequest}
			oneditor={handleOpenEditor}
		/>
	</PanelBoundary>

	{#if outputsFirst}
		{@render setupPanels()}
	{/if}

	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 md:p-5"
	>
		<button
			type="button"
			onclick={() => (logsPanelOpen = !logsPanelOpen)}
			aria-expanded={logsPanelOpen}
			class="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)] mb-3 hover:text-[var(--color-text-muted)] transition-colors"
		>
			<ChevronDown
				aria-hidden="true"
				class="h-4 w-4 transition-transform {logsPanelOpen ? '' : '-rotate-90'}"
			/>
			Activity Log
			<span class="text-xs text-[var(--color-text-muted)] font-normal"
				>({plural(logStrings.length, 'entry', 'entries')})</span
			>
		</button>
		{#if logsPanelOpen}
			<LogStream
				logs={logStrings}
				{isStreaming}
				connectionStatus={jobProgress.connectionStatus}
				maxHeight="420px"
				onclear={clearLogs}
			/>
		{/if}
	</section>
</Page>

<!-- Polymorphic output panel — renders whichever result kinds this run
     produced (video / audiobook / redesign / report / review), resolved by
     output shape. Self-gates: renders nothing until a matching completed
     stage exists. Rendered once, either at the top (completed) or after the
     setup panels (in flight). -->
{#snippet outputPanel()}
	<RunOutputPanel
		run={data.run}
		onPublish={openPublish}
		videoTitle={videoTitleFor(data.project.type)}
		downloadBaseName={downloadBaseName(projectTitle)}
		{shareUrl}
	/>
{/snippet}

{#snippet setupPanels()}
	<CheckpointsPanel
		value={pauseAfter}
		availableStages={runStageNames}
		onChange={applyCheckpoints}
		busy={checkpointsBusy}
		presets={checkpointPresets}
		error={checkpointsErr}
		readFailed={checkpointsReadFailed}
		readOnly={!checkpointsEditable}
	/>

	<VerbatimPanel
		{projectId}
		items={projectVerbatim}
		loadError={data.verbatimError}
		onCreate={handleAddVerbatim}
		onDelete={handleDeleteVerbatim}
	/>
{/snippet}

<!-- ===================== CANCEL MODAL ===================== -->
<CancelRunModal bind:open={showCancelModal} loading={cancelling} onconfirm={handleCancel} />

<!-- ===================== RESTART (REGENERATE) MODAL ===================== -->
<RestartRunModal
	bind:open={showRestartModal}
	{runId}
	loading={confirmingRestart}
	onconfirm={handleRestartConfirm}
	title={jobProgress.jobStatus === 'completed' ? 'Rerun this project?' : 'Restart this run?'}
	confirmLabel={jobProgress.jobStatus === 'completed' ? 'Rerun' : 'Restart run'}
/>

<!-- ===================== RERUN MODAL ===================== -->
<!-- "Rerun from here": the same plan preview, scoped to the chosen step — it and
     every step built on it run again, every other finished step is kept. -->
<RestartRunModal
	bind:open={showRerunModal}
	{runId}
	fromStage={rerunStage}
	loading={rerunning}
	onconfirm={handleRerunConfirm}
	title={rerunStage ? `Rerun from “${stageLabel(rerunStage)}”?` : 'Rerun from this step?'}
	intro="Starts a new version of this run. This step and every step that builds on it run again; every other finished step is kept."
	confirmLabel="Start rerun"
/>

<!-- ===================== PUBLISH-TO-YOUTUBE MODAL ===================== -->
<PublishYouTubeModal
	bind:open={showPublishModal}
	connected={publishConnected}
	connectionState={publishConnectionState}
	bind:title={publishTitle}
	bind:description={publishDescription}
	bind:privacy={publishPrivacy}
	{publishing}
	error={publishError}
	jobStatus={publishJobStatus}
	{publishedUrl}
	{publishedCaptionUrl}
	captionsFileName={`${downloadBaseName(projectTitle)}-captions.srt`}
	onsubmit={submitPublish}
/>

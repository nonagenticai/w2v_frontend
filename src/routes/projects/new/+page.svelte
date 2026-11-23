<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { wizardBackTarget } from '$lib/layout/back-target';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { ApiError, runs, projects } from '$lib/api';
	import {
		byoProviderRequiredFromError,
		byoRequiredQueryValue,
		BYO_REQUIRED_QUERY
	} from '$lib/api/byo-provider.js';
	import {
		create as createProject,
		update as projectsUpdate
	} from '$lib/stores/projects.svelte.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { wizard } from '$lib/stores/wizard.svelte.js';
	import { tenantDefaults, wizardPrefill } from '$lib/api/tenant-defaults.js';
	import { Button } from '$lib/components/ui';
	import {
		buildProjectRequest,
		buildFinalizePatch,
		buildLessonChildren,
		cloneSourceNotFoundMessage,
		CREATABLE_PROJECT_TYPES
	} from '$lib/studio/project-request';
	import { randomId } from '$lib/utils/random-id';
	import { createWizard as cw } from '$lib/components/projects/new/create-wizard.svelte.js';
	import WizardNav from '$lib/components/projects/new/WizardNav.svelte';
	import TypeStep from '$lib/components/projects/new/TypeStep.svelte';
	import SourcesStep from '$lib/components/projects/new/SourcesStep.svelte';
	import FindMediaStep from '$lib/components/projects/new/FindMediaStep.svelte';
	import SourceStep from '$lib/components/projects/new/SourceStep.svelte';
	import ShotlistStep from '$lib/components/projects/new/ShotlistStep.svelte';
	import BeatsStep from '$lib/components/projects/new/BeatsStep.svelte';
	import StoryboardStep from '$lib/components/projects/new/StoryboardStep.svelte';
	import BriefStep from '$lib/components/projects/new/BriefStep.svelte';
	import LessonsStep from '$lib/components/projects/new/LessonsStep.svelte';
	import ReviewStep from '$lib/components/projects/new/ReviewStep.svelte';

	let { data } = $props();

	// "Back to X": Projects when the user came from the project list, else the dashboard.
	let back = $state(wizardBackTarget(null));
	afterNavigate(({ from, to, type }) => {
		const fromPath = (from?.url as URL | null | undefined)?.pathname;
		// A link/goto to /projects/new FROM /projects/new (the sidebar "New project"
		// CTA mid-wizard) reuses this component, so onMount never re-runs and the
		// previous wizard's step + answers stayed on screen. That click asks for a
		// NEW project: start clean. Keep `back` pointing where the wizard was
		// entered from. Back/forward ('popstate') is history, not a new request.
		if (
			fromPath === '/projects/new' &&
			to?.url.pathname === '/projects/new' &&
			(type === 'link' || type === 'goto')
		) {
			cw.clearPersisted();
			startWizard(null);
			return;
		}
		// `from` is non-null with a null `url` on a direct load (navigation type 'enter').
		back = wizardBackTarget(fromPath);
	});

	onMount(() => {
		// Consume the reload-recovery snapshot BEFORE resetting: `reset()` wipes the
		// in-memory state this would otherwise be measured against. Returns null on a
		// client-side navigation into the wizard (= "new project", start clean).
		startWizard(cw.takePersisted());
	});

	/** Reset to first-visit state, apply defaults + deep-link params, then resume `recovered` (or arm a clean wizard). */
	function startWizard(recovered: ReturnType<typeof cw.takePersisted>) {
		// The wizard state is a module singleton (shared across step subcomponents),
		// so reset it — and the `wizard` settings store — to first-visit state.
		cw.reset();
		wizard.resetWizard();
		// The VIDEO theme starts at its own factory default. It is deliberately NOT
		// seeded from the interface theme (the app's light/dark colour scheme): a
		// dark-mode browser must not silently get a "dark" video.
		// Workspace defaults (server-backed, P6 FE-1) — voice, speed, brand color and
		// the captions mode a deliverable inherits when the user picks none. Async and
		// best-effort: `applyTenantDefaults` only fills fields still at their factory
		// value, so an early user choice (or a resumed draft) wins; a failed read (e.g.
		// an orchestrator without the route) leaves the factory values.
		void tenantDefaults
			.get()
			.then((view) => {
				const prefill = wizardPrefill(view);
				wizard.applyTenantDefaults(prefill);
				cw.defaultCaptionsMode = prefill.captionsMode;
			})
			.catch(() => {});

		// Preselect from query params. `?type=` picks the project type; the legacy
		// `?mode=critique_only` link (from /critique) maps onto app_review.
		const typeParam = page.url.searchParams.get('type');
		const modeParam = page.url.searchParams.get('mode');
		const requested = modeParam === 'critique_only' ? 'app_review' : typeParam;
		// Only a type the picker offers can be deep-linked. Anything else — the
		// dormant 'app_review' (incl. `?mode=critique_only`), child-only 'lesson',
		// and 'growth_bundle', which has no wizard wiring and crashed the page on
		// `?type=growth_bundle` — falls through to the picker's default.
		const creatable: readonly string[] = CREATABLE_PROJECT_TYPES;
		if (requested && creatable.includes(requested)) {
			cw.setProjectType(requested as (typeof CREATABLE_PROJECT_TYPES)[number]);
		}
		const urlParam = page.url.searchParams.get('url');
		if (urlParam) wizard.url = urlParam;

		// Last: a draft that survived a reload wins over the defaults + deep-link
		// params above (they are the same params the reloaded URL carried). Verifies
		// the draft still exists server-side; a dead id falls back to this clean
		// wizard. Also arms persistence — hence it runs on the no-snapshot path too.
		void cw.resume(recovered);
	}

	// Mirror the wizard into sessionStorage on every change, so a refresh resumes
	// the draft (and its already-uploaded footage) instead of orphaning it. No-op
	// until `resume()` arms it, and until a draft project actually exists.
	$effect(() => {
		cw.persist();
	});

	// One Idempotency-Key per logical create attempt, STABLE across retries so a
	// lost-response retry (the POST committed server-side but the response never
	// arrived) replays the original create instead of duplicating the project,
	// its lesson children, and the run. Reset only after a fully successful
	// submit, so starting a brand-new project later gets a fresh key.
	let pendingSubmitKey: string | null = null;

	/**
	 * Start the new project's first run. On the start-run preflight's 402
	 * `byo_provider_required` (a `byo_required` tenant with no provider of its own,
	 * w2v_orchestrator#1108) the project ALREADY EXISTS — staying on this form would
	 * make "retry" create a duplicate. So finalize the draft and land on the created
	 * project, which renders the what-to-do notice from `?byo_required=<slots>`.
	 * Resolves null when it handled that refusal; any other failure rethrows.
	 */
	async function startRunOrLandOnByo(
		projectId: string,
		title: string,
		deliverableId: string,
		idem: { idempotencyKey: string }
	): Promise<{ id: string } | null> {
		try {
			return await runs.start(deliverableId, {}, idem);
		} catch (err) {
			const byo = byoProviderRequiredFromError(err);
			if (!byo) throw err;
			toastSuccess('Project created', `Created "${title}" — the run was not started`);
			pendingSubmitKey = null;
			cw.clearPersisted();
			const slots = encodeURIComponent(byoRequiredQueryValue(byo));
			await goto(resolve(`/projects/${projectId}?${BYO_REQUIRED_QUERY}=${slots}`));
			return null;
		}
	}

	async function submit(startRun: boolean) {
		cw.isSubmitting = true;
		cw.submitError = '';
		const idempotencyKey = (pendingSubmitKey ??= randomId());
		const idem = { idempotencyKey };
		try {
			// Storyboard path (generic only): the project already exists as a draft,
			// pre-created when the user reached the storyboard step. Finalize it —
			// PATCH the authored brief/config, add the deliverables, then optionally
			// start the run — instead of creating from scratch. Panels were persisted
			// live against the draft, so cw.panels is empty and is NOT folded here.
			if (cw.projectId) {
				const req = buildProjectRequest(cw.buildInput());
				// Carries `clone_from_project_id` too: the draft flow never POSTs
				// /projects, so this PATCH is where "Clone settings from" lands.
				await projectsUpdate(cw.projectId, buildFinalizePatch(req));
				// Resume from any deliverables already created by a prior failed
				// finalize attempt so a retry never re-adds duplicates (addDeliverable
				// is not idempotency-keyed; the loop is the guard).
				for (let i = cw.createdDeliverableIds.length; i < req.deliverables.length; i++) {
					const created = await projects.addDeliverable(cw.projectId, req.deliverables[i]);
					cw.createdDeliverableIds.push(created.id);
				}
				const firstDeliverableId = cw.createdDeliverableIds[0];
				if (startRun) {
					if (!firstDeliverableId) throw new Error('Project has no deliverable to run');
					const run = await startRunOrLandOnByo(cw.projectId, req.title, firstDeliverableId, idem);
					if (!run) return;
					toastSuccess('Project created', `Run started for ${req.title}`);
					pendingSubmitKey = null;
					// The draft is finalized — there is nothing left to recover.
					cw.clearPersisted();
					await goto(resolve(`/projects/${cw.projectId}/runs/${run.id}`));
				} else {
					toastSuccess('Draft created', `Created "${req.title}"`);
					pendingSubmitKey = null;
					// The draft is finalized — there is nothing left to recover.
					cw.clearPersisted();
					// Land on Brief, not the workspace default (Deliverables, whose
					// primary action is "Start run") — the user just declined to run.
					// Brief is where configuration continues: the wizard collected only
					// the type's REQUIRED brief keys, while Brief additionally exposes
					// audience/angle/CTA, AI visuals, site capture and brand/voice/theme.
					await goto(resolve(`/projects/${cw.projectId}?section=brief`));
				}
				return;
			}

			const request = buildProjectRequest(cw.buildInput());
			const project = await createProject(request, idem);

			// A course is only runnable once it has lesson children — each child
			// carries its own deliverable (run_engine skips childless / deliverable-less
			// courses). Create them before starting the run.
			if (cw.isCourse) {
				// Propagate the course's grounding onto each lesson child: the
				// orchestrator does NOT inherit course→lesson config, so the lesson's
				// own source_ingest stage grounds its script only if its brief carries
				// the sources (and media_discovery flag).
				const children = buildLessonChildren(cw.lessons, {
					dialogue: cw.brief.dialogue,
					sources: cw.sources,
					mediaDiscovery: cw.mediaDiscovery,
					aiVideoGen: cw.brief.ai_video_gen,
					// The Look picker's tier lands on the built brief, not cw.brief.
					resolution: request.brief?.resolution ?? cw.brief.resolution,
					kenBurns: cw.brief.ken_burns
				});
				for (const child of children) {
					await projects.addChild(project.id, child, idem);
				}
			}

			if (startRun) {
				const deliverableId = project.deliverables[0]?.id;
				if (!deliverableId) throw new Error('Project created but has no deliverable to run');
				// Empty overrides: the run inherits brief/voice/theme/deliverable from
				// the persisted project (run_engine builds config_snapshot from it).
				const run = await startRunOrLandOnByo(project.id, project.title, deliverableId, idem);
				if (!run) return;
				toastSuccess('Project created', `Run started for ${project.title}`);
				pendingSubmitKey = null;
				// The draft is finalized — there is nothing left to recover.
				cw.clearPersisted();
				await goto(resolve(`/projects/${project.id}/runs/${run.id}`));
			} else {
				toastSuccess('Draft created', `Created "${project.title}"`);
				pendingSubmitKey = null;
				// The draft is finalized — there is nothing left to recover.
				cw.clearPersisted();
				// Same intent-matching landing as the storyboard draft exit above: the
				// user declined to start a run, so land where configuration continues
				// (Brief) rather than on the Deliverables "Start run" default.
				await goto(resolve(`/projects/${project.id}?section=brief`));
			}
		} catch (err) {
			cw.submitError =
				cloneSourceNotFoundMessage(err) ??
				(err instanceof ApiError
					? err.detail
					: err instanceof Error
						? err.message
						: 'Failed to create project');
			toastError('Project creation failed', cw.submitError);
			cw.isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>New Project - Studio</title>
</svelte:head>

<Page testid="new-project">
	<PageHeader
		kicker="Create"
		title="New project"
		{back}
		subtitle="The project type picks the blueprint and what gets produced. Each step only asks for what that type's pipeline actually uses."
	/>

	<!-- grid-cols-1 (minmax(0,1fr)), not the implicit `auto` track: an auto
	     track grows to its widest child, which let the step strip run past the
	     screen edge at 390px instead of scrolling inside it. -->
	<div class="grid grid-cols-1 gap-6 md:grid-cols-[210px_minmax(0,1fr)] md:items-start">
		<WizardNav />

		<!-- Content column -->
		<div class="space-y-6">
			{#if cw.currentStep === 'type'}
				<TypeStep />
			{:else if cw.currentStep === 'sources'}
				<SourcesStep />
				<FindMediaStep />
			{:else if cw.currentStep === 'source'}
				<SourceStep />
			{:else if cw.currentStep === 'shotlist'}
				<ShotlistStep />
			{:else if cw.currentStep === 'beats'}
				<BeatsStep />
			{:else if cw.currentStep === 'storyboard'}
				<StoryboardStep />
			{:else if cw.currentStep === 'brief'}
				<BriefStep
					cloneables={data.cloneables}
					cloneablesTotal={data.cloneablesTotal}
					cloneablesTruncated={data.cloneablesTruncated}
					cloneablesFailed={data.cloneablesFailed}
				/>
			{:else if cw.currentStep === 'lessons'}
				<LessonsStep />
			{:else if cw.currentStep === 'review'}
				<ReviewStep />
			{/if}

			<!-- Navigation -->
			<div
				class="sticky bottom-0 -mx-1 mt-2 flex justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 px-1 py-3 backdrop-blur"
			>
				{#if cw.stepIndex === 0}
					<Button variant="secondary" href="/projects">Cancel</Button>
				{:else}
					<Button variant="secondary" onclick={() => cw.back()}>Back</Button>
				{/if}

				{#if cw.currentStep !== 'review'}
					<Button variant="primary" disabled={!cw.canProceed} onclick={() => cw.next()}>
						Next
					</Button>
				{:else}
					<div class="flex items-center gap-2">
						<Button
							variant="secondary"
							disabled={cw.isSubmitting}
							loading={cw.isSubmitting}
							onclick={() => submit(false)}
						>
							Save draft
						</Button>
						<Button
							variant="primary"
							disabled={cw.isSubmitting}
							loading={cw.isSubmitting}
							onclick={() => submit(true)}
						>
							Create &amp; start run
						</Button>
					</div>
				{/if}
			</div>
		</div>
	</div>
</Page>

// Stage editor.
// F2: read-only viewer + draft history.
// F3: PATCH /output, accept/revert.
// F4: structured editors per stage (storyline / shotlist / slide_deck / narrate).
// F5: regenerate-with-feedback.
// F6: verbatim overlay on slide_deck + narrate (kind-filtered).

import { annotations as annotationsApi, drafts as draftsApi, runs, verbatim } from '$lib/api';
import type { StageDraftListResponse } from '$lib/api/drafts';
import { loadOne as loadProjectOne, getOne as getProjectOne } from '$lib/stores/projects.svelte.js';
import { setProjectSnapshot as seedVerbatimProject } from '$lib/stores/verbatim.svelte.js';
import { notFoundOr503, settle } from '$lib/utils/load-errors';
import { error, redirect } from '@sveltejs/kit';
import type { RunDetail } from '$lib/types/runs';
import type {
	AnnotationListResponse,
	ProjectDetailResponse,
	VerbatimItemListResponse
} from '$lib/types';

const VERBATIM_CONSUMER_STAGES = new Set(['slide_deck', 'narrate']);

export async function load({ params }): Promise<{
	project: ProjectDetailResponse;
	run: RunDetail;
	stage: string;
	draftList: StageDraftListResponse;
	draftListError: unknown;
	verbatimProject: VerbatimItemListResponse;
	verbatimError: unknown;
	annotations: AnnotationListResponse;
	annotationsError: unknown;
}> {
	const { pid, id, stage } = params;

	const cachedProject = getProjectOne(pid);
	const projectPromise = cachedProject ? Promise.resolve(cachedProject) : loadProjectOne(pid);

	const [project, detail] = await Promise.all([
		projectPromise.catch((e) => notFoundOr503(e, 'Project')),
		runs.get(id).catch((e) => notFoundOr503(e, 'Run'))
	]);

	// Cross-check that the run actually belongs to this project. v3 has no
	// project_id on the run; we resolve via the project's deliverables.
	const projectDeliverableIds = new Set((project.deliverables ?? []).map((d) => d.id));
	if (projectDeliverableIds.size > 0 && !projectDeliverableIds.has(detail.deliverable_id)) {
		throw redirect(303, `/projects`);
	}

	// Verify the requested stage actually exists on this run. The
	// orchestrator returns 404 for unknown stage_name; we surface the same
	// to the user rather than rendering an empty editor.
	const stageNames = new Set((detail.stage_outputs ?? []).map((s) => s.stage_name));
	if (!stageNames.has(stage)) {
		throw error(404, `Stage "${stage}" not found on this run`);
	}

	// "Drafts" in v3 are the run's ancestor chain — list of prior runs of
	// the same deliverable. A failed fetch must still render the editor (this is
	// a side card, not the page), but it is NOT an empty ancestor chain: the
	// panel is gated on `ancestors.length > 0`, so degrading to `drafts: []`
	// erases the whole "Prior runs of this deliverable" card with no error, no
	// empty state and no retry. On a re-run that DOES have prior runs, that reads
	// as "this is the first run" and the reviewer re-runs the deliverable from
	// scratch — a paid mistake caused by a transport blip. `draftListError`
	// carries the distinction, exactly as `verbatimError`/`annotationsError` do
	// below.
	const emptyDraftList: StageDraftListResponse = { job_id: id, stage_name: stage, drafts: [] };
	const { data: draftList, error: draftListError } = await settle(
		draftsApi.list(id, stage),
		emptyDraftList
	);

	// Verbatim overlay — only meaningful for consumer stages. v3 dropped
	// per-job verbatim; we read the project-scoped list and let the
	// component render it inline.
	//
	// A failed fetch is NOT an empty overlay: `{ items: [], total: 0 }` renders as
	// "this project has no verbatim items", which is a claim about the project
	// rather than about the request. `verbatimError` carries the distinction.
	const empty: VerbatimItemListResponse = { items: [], total: 0 };
	const isConsumer = VERBATIM_CONSUMER_STAGES.has(stage);
	const { data: verbatimProject, error: verbatimError } = isConsumer
		? await settle(verbatim.listProject(pid), empty)
		: { data: empty, error: null };

	// Seed ONLY on success. `setProjectSnapshot` writes into the shared
	// project-scoped verbatim store, and VerbatimSection's fetch-on-mount is
	// gated on `getProject(id) === undefined`. Seeding the empty FALLBACK after a
	// failed fetch therefore poisons that store: the workspace's Verbatim section
	// sees a defined snapshot, never fetches, never reaches its own error state,
	// and renders "this project has no verbatim items" — a failure on THIS page
	// silently lying on a DIFFERENT one. Leaving the store untouched lets
	// VerbatimSection fetch for itself and surface its own retryable error.
	if (isConsumer && !verbatimError) {
		seedVerbatimProject(pid, verbatimProject);
	}

	// Annotations (Studio v2 BE-2). The rail surfaces them; an empty list is a
	// normal state, so a transport error must not 500 the page — but it must not
	// be RENDERED as "no notes" either. That is a tester reloading the editor and
	// concluding their note was never saved. The rail reads `annotationsError` and
	// says the notes could not be loaded instead.
	const { data: annotations, error: annotationsError } = await settle(
		annotationsApi.list(id, stage),
		{ annotations: [], total: 0 } as AnnotationListResponse
	);

	return {
		project,
		run: detail,
		stage,
		draftList,
		draftListError,
		verbatimProject,
		verbatimError,
		annotations,
		annotationsError
	};
}

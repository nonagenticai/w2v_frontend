// Video Studio — preview + clip timeline + per-clip feedback / regeneration.
// Loads the run detail (compiled video + clip spine) plus the spine stage's
// annotations. `resolveClipSpine` answers two questions: which stage to DISPLAY
// (works for every video blueprint) and whether the server will accept a
// REORDER of it — both are returned, because the page gates different
// affordances on each. A run with no timeline still loads (the page shows an
// empty state and links back to the run monitor).

import { runs, annotations } from '$lib/api';
import { loadOne as loadProjectOne, getOne as getProjectOne } from '$lib/stores/projects.svelte.js';
import { notFoundOr503, settle } from '$lib/utils/load-errors';
import { redirect } from '@sveltejs/kit';
import { resolveClipSpine } from '$lib/utils/timeline';
import type { RunDetail } from '$lib/types/runs';
import type { AnnotationResponse, ProjectDetailResponse } from '$lib/types';

export async function load({ params }): Promise<{
	project: ProjectDetailResponse;
	run: RunDetail;
	spineStageName: string | null;
	/** True only when the orchestrator itself named the spine stage, i.e. the
	 *  reorder route will accept it. A displayed-but-guessed spine is `false` —
	 *  the page must render it and withhold the reorder affordance. */
	spineReorderable: boolean;
	annotations: AnnotationResponse[];
	annotationsError: unknown;
}> {
	const { pid, id } = params;

	const cachedProject = getProjectOne(pid);
	const projectPromise = cachedProject ? Promise.resolve(cachedProject) : loadProjectOne(pid);

	const [project, run] = await Promise.all([
		projectPromise.catch((e) => notFoundOr503(e, 'Project')),
		runs.get(id).catch((e) => notFoundOr503(e, 'Run'))
	]);

	const projectDeliverableIds = new Set((project.deliverables ?? []).map((d) => d.id));
	if (projectDeliverableIds.size > 0 && !projectDeliverableIds.has(run.deliverable_id)) {
		throw redirect(303, `/projects`);
	}

	// The spine stage drives the timeline AND scopes the clip feedback. Fetch its
	// annotations only when a spine exists; failures degrade to an empty list.
	const spine = resolveClipSpine(run);
	const spineStageName = spine?.stageName ?? null;
	// Threaded alongside `spineStageName`: the stage name drives display +
	// annotation scoping, this flag alone drives the reorder affordance.
	const spineReorderable = spine?.reorderable ?? false;
	//
	// The `.catch(() => [])` this replaces made the clip inspector lose every
	// feedback marker silently — a reviewer's notes were simply not there, and the
	// regenerate hint told them to "add a note above" for notes that already
	// existed. `annotationsError` lets the inspector say so instead.
	const anns = spineStageName
		? await settle(
				annotations
					.list(id, spineStageName)
					// Audit narrated-videos yield clips with no visual annotations; that
					// stage's response omits `annotations` (null), so coerce to [] to keep
					// the declared `AnnotationResponse[]` contract (else the timeline spread
					// `[...data.annotations]` throws). Promo/course return an array already.
					.then((r) => r.annotations ?? []),
				[] as AnnotationResponse[]
			)
		: { data: [] as AnnotationResponse[], error: null };

	return {
		project,
		run,
		spineStageName,
		spineReorderable,
		annotations: anns.data,
		annotationsError: anns.error
	};
}

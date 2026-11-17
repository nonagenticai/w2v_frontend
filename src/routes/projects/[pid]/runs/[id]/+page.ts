// Studio v3 run-monitor. Replaces /pipelines/[id]; we re-fetch both the
// project (for breadcrumbs + linkage check) and the run detail (for live
// monitor hydration), and bounce back to /projects/[pid] if the run
// belongs to a different project.
//
// Also pre-loads the checkpoints snapshot so the picker on the page doesn't
// flash empty before its own GET completes. We seed the checkpoints store
// from the snapshot in the +page.svelte component.

import { runs, verbatim, blueprints } from '$lib/api';
import { loadOne as loadProjectOne, getOne as getProjectOne } from '$lib/stores/projects.svelte.js';
import { notFoundOr503, settle } from '$lib/utils/load-errors';
import { redirect } from '@sveltejs/kit';
import type { CheckpointsResponse } from '$lib/api/runs';
import type { RunDetail } from '$lib/types/runs';
import type { ProjectDetailResponse, VerbatimItemListResponse } from '$lib/types';

export async function load({ params }): Promise<{
	project: ProjectDetailResponse;
	run: RunDetail;
	checkpoints: CheckpointsResponse;
	/** Non-null when the checkpoints fetch FAILED. `checkpoints` is then the empty
	 *  fallback: it must NOT be rendered as "this run has no checkpoints", and
	 *  editing must be blocked — a PATCH built from it would wipe the real gates. */
	checkpointsError: unknown;
	verbatimProject: VerbatimItemListResponse;
	/** Non-null when the verbatim fetch FAILED. The list above is then the empty
	 *  fallback and must not be rendered as "this project has no verbatim". */
	verbatimError: unknown;
	/** stage → upstream stages it depends on, for the Stage I/O Inspector lineage. */
	dependsOn: Map<string, string[]>;
	/** Non-null when the blueprint fetch FAILED, i.e. `dependsOn` is empty
	 *  because we do not know the edges — not because the stages have none. */
	lineageError: unknown;
}> {
	const { pid, id } = params;

	const cachedProject = getProjectOne(pid);
	const projectPromise = cachedProject ? Promise.resolve(cachedProject) : loadProjectOne(pid);

	// v3 dropped job-scoped verbatim — items live solely on the project
	// and cascade. The run-monitor view sources them from the project list.
	//
	// `run_id` is what makes the lifecycle badge mean anything here: without it
	// the BE cannot say whether a phrase was used, so every item comes back
	// `pending` and the green "Placed" badge is unreachable. This view IS scoped
	// to one run, so it is the surface entitled to ask.
	//
	// blueprints.list() supplies the per-stage depends_on edges that drive the
	// Stage I/O Inspector's input lineage (matched by project type below).
	const [project, detail, checkpointsSnapshot, verbatimRead, blueprintsRead] = await Promise.all([
		projectPromise.catch((e) => notFoundOr503(e, 'Project')),
		runs.get(id).catch((e) => notFoundOr503(e, 'Run')),
		// MUST be `settle`, not a bare `.catch(() => empty)`. The checkpoint panel
		// does not merely DISPLAY this list — it PATCHes a full replacement built
		// from it. A failed GET that degraded to `pause_after_stages: []` therefore
		// showed "Autopilot — no checkpoints" over a run that actually had gates,
		// and the first toggle sent `[thatOneStage]`, DELETING every real gate the
		// user could not see. A read failure must never become a write.
		settle(runs.checkpoints.get(id), <CheckpointsResponse>{
			run_id: id,
			pause_after_stages: []
		}),
		settle(verbatim.listProject(pid, id), { items: [], total: 0 }),
		settle(blueprints.list(), [])
	]);

	// Cross-check that the run actually belongs to this project. The v3
	// runs surface no longer carries project_id on the run itself — the
	// linkage flows project → deliverable → run. Resolve via the project's
	// deliverables; if the run's deliverable_id doesn't match any of the
	// project's deliverables and we know which project owns it, redirect.
	const projectDeliverableIds = new Set((project.deliverables ?? []).map((d) => d.id));
	if (projectDeliverableIds.size > 0 && !projectDeliverableIds.has(detail.deliverable_id)) {
		throw redirect(303, `/projects`);
	}

	// Lineage edges for this run's blueprint, keyed by project type (same match
	// idiom as the project loader). An empty map is AMBIGUOUS — it means either
	// "these stages genuinely have no upstreams" or "we never got the edges" —
	// so `lineageError` travels with it and the inspector says "unknown" instead
	// of the false claim "starts from the run configuration".
	// Prefer the run's OWN blueprint id: a project type can map to a different
	// blueprint than the one this run was created under.
	const matched =
		blueprintsRead.data.find((b) => b.id === detail.blueprint_id) ??
		blueprintsRead.data.find((b) => b.project_type === project.type);
	const dependsOn = new Map((matched?.stages ?? []).map((s) => [s.name, s.depends_on]));

	return {
		project,
		run: detail,
		checkpoints: checkpointsSnapshot.data,
		checkpointsError: checkpointsSnapshot.error,
		verbatimProject: verbatimRead.data,
		verbatimError: verbatimRead.error,
		dependsOn,
		lineageError: blueprintsRead.error
	};
}

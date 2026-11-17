// What "restart this run" means depends on WHY the run stopped, and the two
// meanings are not interchangeable:
//
//   * `paused`  → the run is alive at a review checkpoint. `POST /runs/{id}/resume`
//                 continues it IN PLACE: every completed stage is kept, nothing is
//                 re-billed, and the run id does not change.
//   * anything  → the run is dead (`failed` / `cancelled`). There is nothing to
//     else      resume, so `POST /runs/{id}/regenerate` spawns a FRESH SIBLING run
//                 on the same deliverable and hands back its new id.
//
// Getting the branch (or the LABEL on the branch) wrong is expensive in both
// directions. Calling regenerate on a paused run silently throws away the 15-25
// minutes of recording, narration and render the reviewer already paid for.
// Labelling resume as "Restart" tells the reviewer the same lie in words, so the
// rational move is to NOT click — which is the one action a checkpoint exists to
// collect.
//
// This lived inline in the run-monitor page. It is a module because the gate page
// (`runs/[id]/stages/[stage]`) now approves from the checkpoint too, and two
// copies of this decision is exactly how the two surfaces drift apart.

import { runs } from '$lib/api';

export type RestartKind = 'resume' | 'regenerate';

/** Which endpoint a run in `status` must be restarted through. */
export function restartKind(status: string): RestartKind {
	return status === 'paused' ? 'resume' : 'regenerate';
}

/**
 * The verb to put ON the button. Must track `restartKind` — a button that says
 * "Restart" while the handler resumes (or vice versa) is worse than no button.
 */
export function restartLabel(status: string): string {
	if (restartKind(status) === 'resume') return 'Resume';
	// A finished run is not "restarted" — it is run again as a new version.
	return status === 'completed' ? 'Rerun' : 'Restart';
}

/**
 * Perform the restart. Returns which branch ran, because the caller's navigation
 * differs: a resume stays on the SAME run id, a regenerate produced a new run and
 * the caller must navigate to `id` or the reviewer watches a run that will never
 * move again.
 *
 * Toasts and `goto` deliberately stay in the pages — the copy differs per surface
 * ("Pipeline resumed" on the monitor vs "Approved" at the gate).
 */
export async function performRestart(args: {
	runId: string;
	status: string;
}): Promise<{ kind: 'resumed' } | { kind: 'regenerated'; id: string }> {
	if (restartKind(args.status) === 'resume') {
		// No body: the backend resumes from ITS OWN recorded pause point. The caller
		// cannot (and must not) name a stage here.
		await runs.resume(args.runId);
		return { kind: 'resumed' };
	}
	const result = await runs.regenerate(args.runId, {});
	return { kind: 'regenerated', id: result.id };
}

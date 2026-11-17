// Which Studio SAVE affordances the server will actually accept.
//
// `resolveClipSpine` keeps its shape heuristic for DISPLAY (action_reel's
// `cut_plan.shots[]` and website_review's `<x>_script.lines[]` are real
// timelines to look at and annotate). But `POST /runs/{id}/apply-edits` has the
// SAME gate as reorder (orchestrator `api/routes/runs/lifecycle.py`
// `apply_clip_edits`): the stage must support element pinning AND have a compile
// cut downstream — exactly what `resolve_clip_spine_stage` checks before it
// names `clip_spine_stage`. So a guessed spine is not a save target: prod run
// 01a09f82 POSTed apply-edits against `website_review_script` and got 422.
//
// Rule: a clip-edit save targets ONLY the stage the backend named. When it named
// none, clip-edit saves are disabled with a visible reason — never a guess.
//
// The one exception is a MUSIC-only change on a pipeline whose cut is timed to
// the bed: the server rewinds to the stage that owns the beat grid instead of
// using the spine at all (`_music_rewind_for` → `music_rewind_stage`, keyed on
// the `music_select` stage — `_GRID_OWNER_STAGE` in `services/runs/elements.py`).
// Such a request must carry no clip edits. Detecting it by the presence of that
// stage row mirrors the backend's own predicate, it is not a shape guess.

import type { ClipSpine } from '$lib/utils/timeline';

/** Mirrors orchestrator `services/runs/elements.py` `_GRID_OWNER_STAGE`. */
export const MUSIC_GRID_OWNER_STAGE = 'music_select';

export interface StudioEditGates {
	/** Per-clip edits (trim / anchor / caption / …) can be saved. */
	canSaveClipEdits: boolean;
	/** A music-bed change can be saved (alone, or with clip edits when those are allowed). */
	canSaveMusic: boolean;
	/** The `stage_name` to send with apply-edits, or null when nothing is savable. */
	saveStageName: string | null;
	/** Why clip editing is unavailable on a finished run; null when it is available
	 *  or when the run simply has not finished yet (that has its own message). */
	clipEditsBlockedReason: string | null;
	/** Why the soundtrack cannot be changed on a finished run; null otherwise. */
	musicBlockedReason: string | null;
}

export function studioEditGates(input: {
	completed: boolean;
	spine: Pick<ClipSpine, 'stageName' | 'reorderable'> | null;
	stageNames: readonly string[];
}): StudioEditGates {
	const serverSpine = input.spine?.reorderable ? input.spine.stageName : null;
	const musicRewinds = !serverSpine && input.stageNames.includes(MUSIC_GRID_OWNER_STAGE);
	const canSaveClipEdits = input.completed && serverSpine !== null;
	const canSaveMusic = input.completed && (serverSpine !== null || musicRewinds);
	const saveStageName =
		serverSpine ?? (musicRewinds ? (input.spine?.stageName ?? MUSIC_GRID_OWNER_STAGE) : null);

	const notRegistered =
		"This deliverable type has no editable clip timeline on the server yet, so edits can't be re-rendered.";
	return {
		canSaveClipEdits,
		canSaveMusic,
		saveStageName: input.completed ? saveStageName : null,
		clipEditsBlockedReason: input.completed && !canSaveClipEdits ? notRegistered : null,
		musicBlockedReason: input.completed && !canSaveMusic ? notRegistered : null
	};
}

// The ONE `POST /runs/{id}/regenerate-clip` refusal a whole-run regenerate can
// answer: the pipeline has no per-clip stage to target surgically. Mirrors the
// two `RegenClipError` messages in orchestrator `services/runs/regenerate.py`
// (`_image_producer_stage` is None / `prompts_from_stage` unset). Every other 422
// from that route — no open feedback on the clip, run not completed, no line_id,
// stage is not a clip spine — is NOT fixed by re-running everything, so it must
// be shown, never converted into a paid full re-run.
const NO_PER_CLIP_STAGE =
	/has no downstream per-clip image stage|has no per-line prompts; cannot regenerate a single clip/;

/** True only for the regenerate-clip 422 that means "this pipeline cannot target one clip". */
export function isNoPerClipStageError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const e = err as { status?: unknown; detail?: unknown };
	return e.status === 422 && typeof e.detail === 'string' && NO_PER_CLIP_STAGE.test(e.detail);
}

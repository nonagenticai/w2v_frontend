import { describe, expect, it } from 'vitest';
import { studioEditGates, MUSIC_GRID_OWNER_STAGE } from './edit-gates';
import { resolveClipSpine } from '$lib/utils/timeline';
import type { RunDetail } from '$lib/types/runs';

const completed = (stage_name: string, output: Record<string, unknown>) => ({
	stage_name,
	status: 'completed',
	output
});

// Shape of prod run 01a09f82 (website_review_v1): a lines[] script the shape
// heuristic DISPLAYS, but the server named no clip spine.
function websiteReviewRun(clip_spine_stage: string | null | undefined): RunDetail {
	return {
		clip_spine_stage,
		stage_outputs: [
			completed('website_review_script', {
				lines: [
					{ id: 'clip-1', seconds: 5, text: 'intro' },
					{ id: 'clip-2', seconds: 5, text: 'outro' }
				]
			}),
			completed('website_review_compile', { artifact_url: 'http://x/v.mp4' })
		]
	} as unknown as RunDetail;
}

function gatesFor(run: RunDetail, completedRun = true) {
	return studioEditGates({
		completed: completedRun,
		spine: resolveClipSpine(run),
		stageNames: (run.stage_outputs ?? []).map((s) => s.stage_name)
	});
}

describe('studioEditGates — never save against a guessed spine', () => {
	it('clip_spine_stage null: timeline still displays, but NO save targets the guessed stage', () => {
		const run = websiteReviewRun(null);
		// Display is kept (the heuristic finds the script)…
		expect(resolveClipSpine(run)?.stageName).toBe('website_review_script');
		// …but nothing may be POSTed against it.
		const g = gatesFor(run);
		expect(g.canSaveClipEdits).toBe(false);
		expect(g.canSaveMusic).toBe(false);
		expect(g.saveStageName).toBeNull();
		expect(g.clipEditsBlockedReason).toMatch(/no editable clip timeline/);
		expect(g.musicBlockedReason).toMatch(/no editable clip timeline/);
	});

	it('clip_spine_stage absent (older orchestrator) is treated like null', () => {
		const g = gatesFor(websiteReviewRun(undefined));
		expect(g.canSaveClipEdits).toBe(false);
		expect(g.saveStageName).toBeNull();
	});

	it('server-named spine: edits + music save target exactly that stage', () => {
		const g = gatesFor(websiteReviewRun('website_review_script'));
		expect(g.canSaveClipEdits).toBe(true);
		expect(g.canSaveMusic).toBe(true);
		expect(g.saveStageName).toBe('website_review_script');
		expect(g.clipEditsBlockedReason).toBeNull();
	});

	it('a run that has not finished offers nothing and gives no "unsupported" reason', () => {
		const g = gatesFor(websiteReviewRun('website_review_script'), false);
		expect(g).toEqual({
			canSaveClipEdits: false,
			canSaveMusic: false,
			saveStageName: null,
			clipEditsBlockedReason: null,
			musicBlockedReason: null
		});
	});

	it('beat-grid pipeline (action_reel): music-only save stays available without a spine', () => {
		const g = studioEditGates({
			completed: true,
			spine: { stageName: 'cut_plan', reorderable: false },
			stageNames: [MUSIC_GRID_OWNER_STAGE, 'cut_plan', 'compile']
		});
		expect(g.canSaveClipEdits).toBe(false);
		expect(g.canSaveMusic).toBe(true);
		expect(g.saveStageName).toBe('cut_plan');
		expect(g.musicBlockedReason).toBeNull();
	});
});

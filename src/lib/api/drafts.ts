// Stage drafts API — v3 ancestors surface.
//
// v3 has no "drafts" array per stage: every regenerate produces a NEW Run
// with parent_run_id pointing at the previous one. The "drafts" UI for a
// stage is the chain of ancestor runs.
//
// Endpoint:
//   GET /api/runs/{run_id}/ancestors → RunSummary[]
//
// The v1 verbs that operated on draft IDs within a single stage
// (patchOutput, accept, delete, single-stage regenerate) have no v3
// equivalent — they are stubbed and reject with a clear "unsupported in
// v3" error so UI surfaces fail loudly rather than silently. Whole-run
// regenerate via parent_run lives on `runs.regenerate(runId)`.

import { runs } from './runs.js';
import type { RunSummary } from '$lib/types/runs';

export interface StageDraftListResponse {
	job_id: string;
	stage_name: string;
	drafts: RunSummary[];
}

function unsupported(verb: string): never {
	throw new Error(
		`drafts.${verb} is not supported in v3 — use runs.regenerate(runId) for whole-run rewrites`
	);
}

export const drafts = {
	/**
	 * "Drafts" for a (run, stage) in v3 are the run's ancestor chain — each
	 * previous run is a prior draft of the deliverable. stage_name is kept
	 * in the response envelope for parity with v1 callers but is not used
	 * server-side; ancestors are run-scoped, not stage-scoped.
	 */
	async list(runId: string, stageName: string): Promise<StageDraftListResponse> {
		const ancestors = await runs.ancestors(runId);
		return { job_id: runId, stage_name: stageName, drafts: ancestors };
	},

	get(): never {
		unsupported('get');
	},

	patchOutput(): never {
		unsupported('patchOutput');
	},

	accept(): never {
		unsupported('accept');
	},

	delete(): never {
		unsupported('delete');
	},

	regenerate(): never {
		unsupported('regenerate');
	}
};

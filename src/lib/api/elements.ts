// Element CRUD API — v3 PATCH + restamp surface.
//
// v3 does not expose a typed `elements[]` array on the stage output —
// `StageOutputResponse.output` is `Record<string, unknown> | null` and
// element addressing lives server-side via `_ELEMENT_PATHS[stage]`.
//
// Endpoints:
//   PATCH /api/runs/{run_id}/stages/{stage_name}/elements/{element_id}
//     body: { patch: { ...partial fields... } }  → shallow-merge only
//   POST  /api/runs/{run_id}/stages/{stage_name}/elements/{element_id}/restamp
//     body: { value: { ...full element... } }    → full replace + mark
//     every downstream stage_output pending. Caller then POSTs
//     /runs/{id}/regenerate to re-execute from the first dirty stage.
//
// list / insert / delete / reorder have no v3 equivalent and are stubbed
// to throw at the call site.

import { runs } from './runs.js';
import type { RunSummary, StageOutputResponse } from '$lib/types/runs';

function unsupported(verb: string): never {
	throw new Error(
		`elements.${verb} is not supported in v3 — only PATCH (PRs #50/#52) and restamp (A.3) are wired.`
	);
}

export const elements = {
	/**
	 * Shallow-merge a patch into one element inside StageOutput.output.
	 * `elementType` is preserved in the call signature for v1 parity but
	 * the BE looks up the element by id alone (path-based dispatch in
	 * `_ELEMENT_PATHS[stage]`), so it is unused.
	 */
	update(
		runId: string,
		stage: string,
		_elementType: string,
		elementId: string,
		body: { patch: Record<string, unknown> }
	): Promise<StageOutputResponse> {
		return runs.stages.patchElement(runId, stage, elementId, body);
	},

	/**
	 * Full-replace an element + reset every downstream stage to pending.
	 * `elementType` is unused (kept for v1 call-signature parity).
	 * The element's `id` field is preserved regardless of `body.value`.
	 */
	restamp(
		runId: string,
		stage: string,
		_elementType: string,
		elementId: string,
		body: { value: Record<string, unknown> }
	): Promise<StageOutputResponse> {
		return runs.stages.restampElement(runId, stage, elementId, body);
	},

	list(): never {
		unsupported('list');
	},

	get(): never {
		unsupported('get');
	},

	insert(): never {
		unsupported('insert');
	},

	delete(): never {
		unsupported('delete');
	},

	/**
	 * Rearrange a stage's clip timeline and re-stitch the video as a child run.
	 * `orderedIds` is the full set of the stage's clip ids in the new order.
	 */
	reorder(runId: string, stage: string, orderedIds: string[]): Promise<RunSummary> {
		return runs.reorderClips(runId, stage, orderedIds);
	}
};

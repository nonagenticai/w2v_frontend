// Verbatim items API — project-scoped only in v3.
//
// v3 dropped the per-job (pipeline) verbatim surface. Items now live
// solely on Projects and cascade to every Deliverable / Run from that
// project. The BE routes are:
//
//   POST   /api/projects/{project_id}/verbatim-items        → 201 VerbatimItemResponse
//   GET    /api/projects/{project_id}/verbatim-items        → VerbatimItemListResponse
//   PATCH  /api/verbatim-items/{id}                          → VerbatimItemResponse
//   DELETE /api/verbatim-items/{id}                          → 204
//
// Tenant scoping is inherited from the parent Project row server-side.
// listJob / createForJob / deleteForJob from v1 are stubbed — they
// reject loudly so a misrouted caller surfaces instead of silently
// hitting a 404.

import type {
	VerbatimItemCreateRequest,
	VerbatimItemListResponse,
	VerbatimItemResponse,
	VerbatimItemUpdateRequest
} from '$lib/types';
import { api } from './client.js';

function unsupported(verb: string): never {
	throw new Error(
		`verbatim.${verb} is not supported in v3 — verbatim items are project-scoped only.`
	);
}

export const verbatim = {
	/**
	 * List a project's verbatim items.
	 *
	 * `runId` is OPTIONAL and changes the MEANING of the response, not just its
	 * contents. Omitted, the BE answers exactly as it always has — every item
	 * `pending`, because placement is not a property of the project. Supplied,
	 * the orchestrator derives placement at read time against that run's
	 * persisted stage output, so `status` / `placed_in_stage` /
	 * `placed_in_element_id` describe THAT RUN. Unmatched items stay `pending`.
	 *
	 * Passing a run id from a surface that isn't scoped to one run would render
	 * one run's placement as if it were the project's, so the parameter stays
	 * opt-in per call site rather than being baked into the store key.
	 */
	listProject(projectId: string, runId?: string): Promise<VerbatimItemListResponse> {
		const query = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
		return api.get<VerbatimItemListResponse>(`/projects/${projectId}/verbatim-items${query}`);
	},

	createForProject(
		projectId: string,
		body: VerbatimItemCreateRequest
	): Promise<VerbatimItemResponse> {
		return api.post<VerbatimItemResponse>(`/projects/${projectId}/verbatim-items`, body);
	},

	updateForProject(
		_projectId: string,
		itemId: string,
		body: VerbatimItemUpdateRequest
	): Promise<VerbatimItemResponse> {
		// Like delete, the v3 BE keys the patch by item id alone; projectId stays
		// in the signature so call sites read symmetrically with create/delete.
		return api.patch<VerbatimItemResponse>(`/verbatim-items/${itemId}`, body);
	},

	deleteForProject(_projectId: string, itemId: string): Promise<void> {
		// v3 BE keys delete by item id alone (`/api/verbatim-items/{id}`);
		// projectId remains in the call signature for v1 parity.
		return api.delete<void>(`/verbatim-items/${itemId}`);
	},

	listJob(): never {
		unsupported('listJob');
	},

	createForJob(): never {
		unsupported('createForJob');
	},

	deleteForJob(): never {
		unsupported('deleteForJob');
	}
};

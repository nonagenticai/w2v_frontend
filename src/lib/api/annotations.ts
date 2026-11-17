// Annotations CRUD API (Studio v2 BE-2) — v3 routes.
//
// List/create are still nested under the (run, stage) so the BE can
// pre-scope by ownership:
//   GET  /api/runs/{run_id}/stages/{stage_name}/annotations
//   POST /api/runs/{run_id}/stages/{stage_name}/annotations
//
// Update/dismiss key off the annotation id alone (cross-stage move
// dropped in v3):
//   PATCH  /api/annotations/{annotation_id}
//   DELETE /api/annotations/{annotation_id}
//
// Body shapes are validated server-side. Only ``open`` annotations are
// mutable / dismissible; conflicts return 409.

import type {
	AnnotationListResponse,
	AnnotationResponse,
	AnnotationStatus,
	CreateAnnotationRequest,
	UpdateAnnotationRequest
} from '$lib/types';
import { api } from './client.js';
import type { components } from './types.gen';

// The list route returns `StageOutputAnnotations { stage_output_id, items }`
// (NOT `{ annotations, total }`); reading `.annotations` off it yielded
// undefined, leaving the Notes rail permanently empty and crashing
// AnnotationsPanel's `items.filter(...)` when a stage actually had
// annotations. That re-shaping is the only adaptation still needed here.
//
// The per-item adaptation that used to sit alongside it is gone: the internal
// `AnnotationResponse` is now an alias of the generated schema, so items pass
// through unchanged instead of being renamed to `job_id`/`stage_name`/
// `applied_in_draft_id`. The (run, stage) scope the caller supplied is already
// carried by the store key and by these functions' own arguments.
type ApiStageOutputAnnotations = components['schemas']['StageOutputAnnotations'];

function listPath(runId: string, stage: string): string {
	return `/runs/${runId}/stages/${stage}/annotations`;
}

export const annotations = {
	async list(
		runId: string,
		stage: string,
		status?: AnnotationStatus
	): Promise<AnnotationListResponse> {
		const qs = status ? `?status=${status}` : '';
		const res = await api.get<ApiStageOutputAnnotations>(`${listPath(runId, stage)}${qs}`);
		const items = res.items ?? [];
		return { annotations: items, total: items.length };
	},

	create(runId: string, stage: string, body: CreateAnnotationRequest): Promise<AnnotationResponse> {
		return api.post<AnnotationResponse>(listPath(runId, stage), body);
	},

	update(
		_runId: string,
		_stage: string,
		id: string,
		body: UpdateAnnotationRequest
	): Promise<AnnotationResponse> {
		return api.patch<AnnotationResponse>(`/annotations/${id}`, body);
	},

	dismiss(_runId: string, _stage: string, id: string): Promise<void> {
		return api.delete<void>(`/annotations/${id}`);
	}
};

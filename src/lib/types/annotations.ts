// Annotations (Studio v2 BE-2). Persistent operator notes pinned to a stage
// or to a single element within a stage's output.
//
// Lifecycle: open → applied (via regenerate) | open → dismissed (via DELETE).
//
// `AnnotationResponse` is an ALIAS of the generated schema, not a hand-written
// mirror of it. It used to be the latter, declaring `job_id` + `stage_name` +
// `applied_in_draft_id` against a backend that says `stage_output_id` +
// `applied_in_run_id` — the same shape of drift that shipped the dead
// `CheckpointsResponse`. `src/lib/api/annotations.ts` renamed the fields back
// at the boundary, so nothing was undefined at runtime, but the collision meant
// a backend field rename could not surface at any call site. Aliasing removes
// that blind spot. `job_id`/`stage_name` were caller-supplied echoes that no
// component ever read; the (job, stage) scope lives in the store key.

import type { components as gen } from '$lib/api/types.gen';

export type AnnotationStatus = 'open' | 'applied' | 'dismissed';

export type AnnotationResponse = gen['schemas']['AnnotationResponse'];

// Frontend-only wrapper: the wire list route returns
// `StageOutputAnnotations { stage_output_id, items }`. `src/lib/api/annotations.ts`
// re-shapes it into this so callers get a `total` alongside the rows.
export interface AnnotationListResponse {
	annotations: AnnotationResponse[];
	total: number;
}

export interface CreateAnnotationRequest {
	text: string;
	element_id: string | null;
}

export interface UpdateAnnotationRequest {
	text: string;
}

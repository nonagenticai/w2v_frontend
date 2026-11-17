// Annotations store (Studio v2 BE-2). Keyed by `${jobId}::${stageName}` so
// a single store handles every (job, stage) pair surfaced in the SPA.
//
// State is reconciled both by the FE-driven CRUD calls (create/update/dismiss)
// The cache was also fed by `annotation_*` lifecycle events on a job WS channel.
// The orchestrator has never emitted those events — a repo-wide grep for
// `annotation_created` / `annotation_applied` in the backend matches only a
// migration filename — and live progress is Server-Sent Events, not WS. The
// handler had no non-test caller, so it was an exported function whose only
// consumer was the test proving it worked. Removed rather than left as a
// standing invitation to wire up a contract that does not exist.

import { annotations as annApi } from '$lib/api';
import type {
	AnnotationResponse,
	AnnotationStatus,
	CreateAnnotationRequest,
	UpdateAnnotationRequest
} from '$lib/types';

let byKey = $state<Record<string, AnnotationResponse[]>>({});

const k = (j: string, s: string) => `${j}::${s}`;

export async function load(jobId: string, stage: string): Promise<void> {
	const r = await annApi.list(jobId, stage);
	byKey = { ...byKey, [k(jobId, stage)]: r.annotations };
}

/**
 * Seed the cache from a snapshot already loaded by a +page.ts loader.
 * Preserves the full AnnotationResponse shape (created_at, updated_at, etc.),
 * including the timestamps the AnnotationsPanel needs to sort the open bucket
 * by created_at.
 */
export function seedList(jobId: string, stage: string, list: AnnotationResponse[]): void {
	byKey = { ...byKey, [k(jobId, stage)]: list };
}

export function getList(jobId: string, stage: string): AnnotationResponse[] {
	return byKey[k(jobId, stage)] ?? [];
}

export function getOpen(jobId: string, stage: string): AnnotationResponse[] {
	return getList(jobId, stage).filter((a) => a.status === 'open');
}

export function getOpenForElement(
	jobId: string,
	stage: string,
	elementId: string
): AnnotationResponse[] {
	return getOpen(jobId, stage).filter((a) => a.element_id === elementId);
}

export function countOpenForElement(jobId: string, stage: string, elementId: string): number {
	return getOpenForElement(jobId, stage, elementId).length;
}

export async function create(
	jobId: string,
	stage: string,
	req: CreateAnnotationRequest
): Promise<AnnotationResponse> {
	const ann = await annApi.create(jobId, stage, req);
	upsert(jobId, stage, ann);
	return ann;
}

export async function update(
	jobId: string,
	stage: string,
	id: string,
	req: UpdateAnnotationRequest
): Promise<AnnotationResponse> {
	const ann = await annApi.update(jobId, stage, id, req);
	upsert(jobId, stage, ann);
	return ann;
}

export async function dismiss(jobId: string, stage: string, id: string): Promise<void> {
	await annApi.dismiss(jobId, stage, id);
	const list = byKey[k(jobId, stage)];
	if (list) {
		byKey = {
			...byKey,
			[k(jobId, stage)]: list.map((a) =>
				a.id === id ? { ...a, status: 'dismissed' as AnnotationStatus } : a
			)
		};
	}
}

function upsert(jobId: string, stage: string, ann: AnnotationResponse): void {
	const key = k(jobId, stage);
	const list = byKey[key] ?? [];
	const exists = list.some((a) => a.id === ann.id);
	byKey = {
		...byKey,
		[key]: exists ? list.map((a) => (a.id === ann.id ? ann : a)) : [...list, ann]
	};
}

export function invalidate(): void {
	byKey = {};
}

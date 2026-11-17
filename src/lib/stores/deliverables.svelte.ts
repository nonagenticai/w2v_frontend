// Deliverables store (Svelte 5 runes).
//
// Mutating operations on Deliverables (add to project, start) update the
// parent Project's cached detail tree in `projects.svelte.ts` so the UI
// reflects the new state without a re-fetch.

import { deliverables as deliverablesApi, projects as projectsApi } from '$lib/api';
import type {
	CreateDeliverableRequest,
	DeliverableResponse,
	DeliverableStartResponse,
	DeliverableUpdateRequest
} from '$lib/types';
import { loadOne as loadProject } from './projects.svelte.js';

export async function get(deliverableId: string): Promise<DeliverableResponse> {
	return deliverablesApi.get(deliverableId);
}

export async function add(
	projectId: string,
	req: CreateDeliverableRequest
): Promise<DeliverableResponse> {
	const result = await projectsApi.addDeliverable(projectId, req);
	// Refresh the parent project so the new deliverable appears in its tree.
	await loadProject(projectId);
	return result;
}

export async function start(
	projectId: string,
	deliverableId: string
): Promise<DeliverableStartResponse> {
	const result = await deliverablesApi.start(deliverableId);
	// Refresh the parent project so deliverable status + pipeline_job_id update.
	await loadProject(projectId);
	return result;
}

export async function update(
	projectId: string,
	deliverableId: string,
	req: DeliverableUpdateRequest
): Promise<DeliverableResponse> {
	const result = await deliverablesApi.update(deliverableId, req);
	// Refresh the parent project so the edited deliverable reflects in its tree.
	await loadProject(projectId);
	return result;
}

export async function remove(projectId: string, deliverableId: string): Promise<void> {
	await deliverablesApi.remove(deliverableId);
	// Refresh the parent project so the removed deliverable drops from its tree.
	await loadProject(projectId);
}

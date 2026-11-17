import type {
	DeliverableResponse,
	DeliverableStartResponse,
	DeliverableUpdateRequest
} from '$lib/types';
import { api } from './client.js';

export const deliverables = {
	get(deliverableId: string): Promise<DeliverableResponse> {
		return api.get<DeliverableResponse>(`/deliverables/${deliverableId}`);
	},

	start(deliverableId: string): Promise<DeliverableStartResponse> {
		return api.post<DeliverableStartResponse>(`/deliverables/${deliverableId}/start`);
	},

	update(deliverableId: string, req: DeliverableUpdateRequest): Promise<DeliverableResponse> {
		return api.patch<DeliverableResponse>(`/deliverables/${deliverableId}`, req);
	},

	remove(deliverableId: string): Promise<void> {
		return api.delete<void>(`/deliverables/${deliverableId}`);
	}
};

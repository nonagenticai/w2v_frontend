/**
 * "Needs your review" inbox — orchestrator `src/api/routes/review_inbox.py`.
 *
 *   GET  /api/review-inbox                   runs the caller OWNS that are paused at a
 *                                            review checkpoint, oldest wait first
 *   POST /api/review-inbox/{run_id}/dismiss  hide the notice (204); 404 when the run is
 *        [?reminder=true]                    foreign or no longer waiting at a checkpoint
 *
 * The server owns every rule: a dismissed notice comes back flagged `reminder` once the
 * run has waited 24h, and a resume clears the dismissal. The frontend only lists and
 * dismisses. Every type aliases the generated schema (type-drift-check).
 */

import { api } from './client.js';
import type { components } from './types.gen.js';

type Schemas = components['schemas'];

export type ReviewInboxItem = Schemas['ReviewInboxItem'];

export const reviewInbox = {
	async list(): Promise<ReviewInboxItem[]> {
		return (await api.get<Schemas['ReviewInbox']>('/review-inbox')).items;
	},
	/** `reminder` = the caller was shown this item flagged `reminder`: dismissing it is final
	 * for this pause. A plain dismiss keeps the server's first dismissal time, so a stale
	 * tab cannot dismiss a reminder nobody has seen. */
	dismiss(runId: string, reminder = false): Promise<void> {
		const query = reminder ? '?reminder=true' : '';
		return api.post<void>(`/review-inbox/${encodeURIComponent(runId)}/dismiss${query}`);
	}
};

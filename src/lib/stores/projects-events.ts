// Project-level child-lifecycle SSE subscription.
//
// Subscribes to GET /api/projects/{parentId}/events and routes the three
// child-lifecycle events (child_added, child_reordered, child_status_changed)
// into the projects store apply* helpers. The BE publishes child_added with
// metadata only (id/title/position/...), so this module fetches the new
// child's full ProjectResponse before applying — keeps the parent's children
// list authoritative without refetching the entire tree.
//
// Auth: cookie-based (oauth2-proxy / Keycloak). Reconnect + connection-status
// reporting come from $lib/stores/sse-subscription (shared with run-events).

import { projects as projectsApi } from '$lib/api';
import type { PanelImageJobResponse, ProjectResponse } from '$lib/types';
import {
	applyChildAdded,
	applyChildReordered,
	applyChildStatusChanged
} from './projects.svelte.js';
import { applyPanelImageEvent } from './storyboard.svelte.js';
import { subscribeSse, type SseConnectionStatus } from './sse-subscription.js';

export interface ProjectEventsHandle {
	close(): void;
}

interface ChildAddedPayload {
	child_id?: string;
}

interface ChildReorderedPayload {
	order?: string[];
}

interface ChildStatusChangedPayload {
	child_id?: string;
	status?: ProjectResponse['status'];
}

/**
 * Panel-image progress. Storyboard rows carry no `run_id`, so the PROJECT channel
 * is the only stream a panel-image job can ride — that is why this lives here and
 * not in `run-events.ts`.
 *
 * This is an ACCELERATOR, not the source of truth: the storyboard store polls the
 * job endpoint independently and both feed the same reducer, because the stream can
 * be disconnected for minutes and reconnects do not replay. A malformed or partial
 * payload is therefore dropped, not defaulted — the poll will pick the truth up.
 */
type PanelImageStatusPayload = Partial<PanelImageJobResponse>;

function parsePayload<T>(event: MessageEvent<string>): T | null {
	const data = event.data;
	if (typeof data !== 'string') return null;
	try {
		return JSON.parse(data) as T;
	} catch {
		return null;
	}
}

/**
 * Subscribe to child-lifecycle events for *parentId*. Returns a handle whose
 * `close()` detaches the EventSource. The handle is safe to close more than
 * once.
 *
 * Caller is expected to invoke the returned `close()` when the subscription
 * is no longer needed (e.g. component unmount, parent id change).
 */
export function subscribeProjectEvents(
	parentId: string,
	onStatusChange?: (status: SseConnectionStatus) => void
): ProjectEventsHandle {
	return subscribeSse({
		url: `/api/projects/${parentId}/events`,
		onStatusChange,
		listeners: {
			child_added: async (event) => {
				const payload = parsePayload<ChildAddedPayload>(event);
				if (!payload?.child_id) return;
				try {
					const child = await projectsApi.get(payload.child_id);
					applyChildAdded(parentId, child);
				} catch {
					// Child may have been deleted between the event and the fetch — ignore.
				}
			},
			child_reordered: (event) => {
				const payload = parsePayload<ChildReorderedPayload>(event);
				if (!Array.isArray(payload?.order)) return;
				applyChildReordered(parentId, payload.order);
			},
			child_status_changed: (event) => {
				const payload = parsePayload<ChildStatusChangedPayload>(event);
				if (!payload?.child_id || !payload.status) return;
				applyChildStatusChanged(parentId, payload.child_id, payload.status);
			},
			panel_image_status: (event) => {
				const payload = parsePayload<PanelImageStatusPayload>(event);
				if (!payload?.panel_id || !payload.job_id || !payload.status) return;
				applyPanelImageEvent(parentId, payload.panel_id, {
					...payload,
					job_id: payload.job_id,
					panel_id: payload.panel_id,
					project_id: payload.project_id ?? parentId,
					status: payload.status
				});
			}
		}
	});
}

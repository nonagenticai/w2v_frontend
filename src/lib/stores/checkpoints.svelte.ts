// Checkpoints store (Svelte 5 runes).
//
// Per-runId cache of ``pause_after_stages``. Pages call ``load(runId)`` from
// their +page.ts and read via ``getList(runId)``. ``patch(runId, stages)``
// writes to the BE (PATCH /api/runs/{runId}/checkpoints) and updates the
// cache in-place from the response.

import { runs as runsApi } from '$lib/api';
import type { CheckpointsResponse } from '$lib/api/runs';

let byRun = $state<Record<string, CheckpointsResponse>>({});
let loading = $state<Record<string, boolean>>({});

export async function load(runId: string): Promise<CheckpointsResponse> {
	loading = { ...loading, [runId]: true };
	try {
		const result = await runsApi.checkpoints.get(runId);
		byRun = { ...byRun, [runId]: result };
		return result;
	} finally {
		loading = { ...loading, [runId]: false };
	}
}

export async function patch(
	runId: string,
	pauseAfterStages: string[] | null
): Promise<CheckpointsResponse> {
	const result = await runsApi.checkpoints.patch(runId, pauseAfterStages);
	byRun = { ...byRun, [runId]: result };
	return result;
}

export function get(runId: string): CheckpointsResponse | undefined {
	return byRun[runId];
}

/** Direct list view; falls back to empty array if unloaded. */
export function getList(runId: string): string[] {
	return byRun[runId]?.pause_after_stages ?? [];
}

export function isLoading(runId: string): boolean {
	return loading[runId] === true;
}

export function invalidate(runId?: string): void {
	if (runId) {
		const next = { ...byRun };
		delete next[runId];
		byRun = next;
	} else {
		byRun = {};
	}
}

/**
 * In-place state setter for callers that already hold a fresh response (e.g.
 * a route +page.ts that fetched the data via the load function). Avoids a
 * second round-trip when the page is hydrating from a server-loaded snapshot.
 */
export function setFromSnapshot(snapshot: CheckpointsResponse): void {
	byRun = { ...byRun, [snapshot.run_id]: snapshot };
}

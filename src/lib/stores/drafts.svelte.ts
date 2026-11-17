// Stage "drafts" store (Svelte 5 runes) — v3 ancestors-based.
//
// v3 has no draft array per stage: each regenerate produces a new Run
// whose parent_run_id chains back to the previous draft of the same
// deliverable. This store now keeps an in-memory cache of the ancestor
// chain per (runId, stageName) so the right-rail "history" panel can
// render without re-fetching.
//
// v1 mutation verbs (patchOutput, accept, deleteDraft, regenerate) are
// gone — whole-run rewrites live on runs.regenerate(runId), element
// rewrites on the element store, and there is no per-stage accept/delete.

import { drafts as draftsApi, type StageDraftListResponse } from '$lib/api/drafts.js';

type Key = string; // `${runId}::${stageName}`

function key(runId: string, stageName: string): Key {
	return `${runId}::${stageName}`;
}

let byKey = $state<Record<Key, StageDraftListResponse>>({});
let loading = $state<Record<Key, boolean>>({});

export async function loadList(runId: string, stageName: string): Promise<StageDraftListResponse> {
	const k = key(runId, stageName);
	loading = { ...loading, [k]: true };
	try {
		const result = await draftsApi.list(runId, stageName);
		byKey = { ...byKey, [k]: result };
		return result;
	} finally {
		loading = { ...loading, [k]: false };
	}
}

export function getList(runId: string, stageName: string): StageDraftListResponse | undefined {
	return byKey[key(runId, stageName)];
}

export function isLoading(runId: string, stageName: string): boolean {
	return loading[key(runId, stageName)] === true;
}

export function invalidate(runId?: string, stageName?: string): void {
	if (runId && stageName) {
		const k = key(runId, stageName);
		const next = { ...byKey };
		delete next[k];
		byKey = next;
	} else if (runId) {
		const prefix = `${runId}::`;
		const next: Record<Key, StageDraftListResponse> = {};
		for (const [k, v] of Object.entries(byKey)) {
			if (!k.startsWith(prefix)) next[k] = v;
		}
		byKey = next;
	} else {
		byKey = {};
	}
}

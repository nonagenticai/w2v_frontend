// Verbatim items store (Svelte 5 runes) — project-scoped only (v3).
//
// v3 dropped per-job verbatim — items live solely on Projects and
// cascade to every Deliverable / Run under them. Run-level reads now
// pull the project's verbatim list via the project_id derived from the
// run's deliverable.
//
// Placement is NOT stored on the item and is NOT pushed over SSE. The
// orchestrator derives it at read time from a run's persisted stage output
// when the list is fetched with `?run_id=`; without that parameter every item
// reads back ``pending``. So a row's ``status`` is only as fresh as the last
// fetch, and "show placement live" means re-reading this list — see
// `loadProject`.

import { verbatim as verbatimApi } from '$lib/api';
import type {
	VerbatimItemCreateRequest,
	VerbatimItemListResponse,
	VerbatimItemResponse,
	VerbatimItemUpdateRequest
} from '$lib/types';
import { sortByPosition } from '$lib/verbatim/reorder.js';

type Key = string; // 'p:<projectId>'

function projectKey(projectId: string): Key {
	return `p:${projectId}`;
}

let byKey = $state<Record<Key, VerbatimItemListResponse>>({});
let loading = $state<Record<Key, boolean>>({});

/** Per-project tail of the reorder queue. Plain (non-reactive) — nothing
 *  renders it; it exists only to serialize `reorderProject`. */
const reorderChain: Record<Key, Promise<void>> = {};

/**
 * Load a project's verbatim items into the cache.
 *
 * `runId` is forwarded to the API but deliberately NOT part of the cache key.
 * Placement is a read-time projection of one run onto the project's items, and
 * every surface that renders this list renders the project's items — so a run
 * view and the workspace share one row set, with the run view's fetch being the
 * one that carries placement. Keying by run instead would make the run page
 * render a second, divergent copy of the same items.
 */
export async function loadProject(
	projectId: string,
	runId?: string
): Promise<VerbatimItemListResponse> {
	const k = projectKey(projectId);
	loading = { ...loading, [k]: true };
	try {
		const result = await verbatimApi.listProject(projectId, runId);
		byKey = { ...byKey, [k]: result };
		return result;
	} finally {
		loading = { ...loading, [k]: false };
	}
}

export function getProject(projectId: string): VerbatimItemListResponse | undefined {
	return byKey[projectKey(projectId)];
}

/**
 * The project's items in render order. Sorting here (not at each call site) is
 * load-bearing: nothing else orders this list — ``createForProject`` prepends
 * and the BE returns arrival order — so without it the position field, and
 * therefore every reorder, would be invisible in the UI.
 */
export function getProjectList(projectId: string): VerbatimItemResponse[] {
	const items = byKey[projectKey(projectId)]?.items ?? [];
	return sortByPosition(items);
}

export function isProjectLoading(projectId: string): boolean {
	return loading[projectKey(projectId)] === true;
}

export async function createForProject(
	projectId: string,
	body: VerbatimItemCreateRequest
): Promise<VerbatimItemResponse> {
	const created = await verbatimApi.createForProject(projectId, body);
	const k = projectKey(projectId);
	const existing = byKey[k];
	if (existing) {
		byKey = {
			...byKey,
			[k]: {
				items: [created, ...existing.items],
				total: existing.total + 1
			}
		};
	}
	return created;
}

/**
 * Patch one item. Pessimistic on purpose: we await the server and then adopt
 * ITS row, so a rejected edit (validation, 409, offline) can never leave the
 * list showing text the backend does not hold. The error propagates so the
 * editor can stay open with the user's draft intact.
 */
export async function updateForProject(
	projectId: string,
	itemId: string,
	body: VerbatimItemUpdateRequest
): Promise<VerbatimItemResponse> {
	const updated = await verbatimApi.updateForProject(projectId, itemId, body);
	const k = projectKey(projectId);
	const existing = byKey[k];
	if (existing) {
		byKey = {
			...byKey,
			[k]: {
				...existing,
				items: existing.items.map((i) => (i.id === itemId ? updated : i))
			}
		};
	}
	return updated;
}

/**
 * Apply a batch of position writes. Optimistic — a reorder must feel instant
 * or the user clicks the arrow twice — but the snapshot restore is what makes
 * that safe: the PATCHes go out one at a time and any failure rewinds the
 * whole batch, so a half-applied order never survives on screen.
 *
 * Note the writes are NOT transactional server-side (unlike storyboard's bulk
 * reorder endpoint); the rollback only restores the local view, so a partial
 * failure leaves the server mid-batch and the next GET is authoritative.
 */
export async function reorderProject(
	projectId: string,
	updates: { id: string; position: number }[]
): Promise<void> {
	if (updates.length === 0) return;
	const k = projectKey(projectId);
	// Serialize per project. The slide and TTS columns are two SEPARATE
	// VerbatimItemList instances, each with its own in-flight guard, so nothing
	// in the UI stops a move in one track starting while the other is mid-flight.
	// Interleaved, the second call would capture a snapshot that already contains
	// the first call's optimistic write — and if the first then failed, its
	// rollback would silently discard the second's already-committed reorder.
	// Chaining makes every snapshot a settled state.
	const prior = reorderChain[k] ?? Promise.resolve();
	const run = prior.then(
		() => applyReorder(projectId, k, updates),
		() => applyReorder(projectId, k, updates)
	);
	// The chain must never reject, or one failure poisons every later reorder.
	reorderChain[k] = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}

/** Serialized per project by `reorderProject` — never call directly. */
async function applyReorder(
	projectId: string,
	k: Key,
	updates: { id: string; position: number }[]
): Promise<void> {
	const existing = byKey[k];
	if (!existing) {
		for (const u of updates) {
			await verbatimApi.updateForProject(projectId, u.id, { position: u.position });
		}
		return;
	}

	const snapshot = existing.items;
	// Plain record, not a Map: this is a throwaway id→position lookup, never
	// reactive state, and `svelte/prefer-svelte-reactivity` errors on a bare Map.
	const wanted: Record<string, number> = {};
	for (const u of updates) wanted[u.id] = u.position;
	byKey = {
		...byKey,
		[k]: {
			...existing,
			items: snapshot.map((i) => (i.id in wanted ? { ...i, position: wanted[i.id] } : i))
		}
	};

	try {
		for (const u of updates) {
			const row = await verbatimApi.updateForProject(projectId, u.id, { position: u.position });
			const current = byKey[k];
			if (!current) continue;
			byKey = {
				...byKey,
				[k]: { ...current, items: current.items.map((i) => (i.id === row.id ? row : i)) }
			};
		}
	} catch (e) {
		const current = byKey[k];
		byKey = { ...byKey, [k]: { ...(current ?? existing), items: snapshot } };
		throw e;
	}
}

export async function deleteForProject(projectId: string, itemId: string): Promise<void> {
	await verbatimApi.deleteForProject(projectId, itemId);
	const k = projectKey(projectId);
	const existing = byKey[k];
	if (existing) {
		const remaining = existing.items.filter((i) => i.id !== itemId);
		byKey = {
			...byKey,
			[k]: { items: remaining, total: Math.max(0, existing.total - 1) }
		};
	}
}

// NOTE: `applyPlacedEvent` / `applyMissingEvent` used to live here — per-item
// patches for the v1 `verbatim_item_placed` / `_missing` SSE events. Both had
// ZERO callers for the whole life of v3, because v3 never emitted those events.
// They are gone rather than re-wired: placement is now DERIVED server-side per
// run (`GET …/verbatim-items?run_id=`), so the only correct way to learn it is
// to re-read the list, which `loadProject` already does wholesale. Feeding a
// refetch's rows back through a per-item patch would be a slower, lossier
// restatement of the assignment `loadProject` just made.

export function invalidateProject(projectId?: string): void {
	if (projectId) {
		const k = projectKey(projectId);
		const next = { ...byKey };
		delete next[k];
		byKey = next;
	} else {
		byKey = {};
	}
}

export function invalidateAll(): void {
	byKey = {};
}

/** Seed from a snapshot loaded by a route +page.ts to avoid a flash. */
export function setProjectSnapshot(projectId: string, snapshot: VerbatimItemListResponse): void {
	byKey = { ...byKey, [projectKey(projectId)]: snapshot };
}

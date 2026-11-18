// Storyboard panels store (Svelte 5 runes) — project-scoped (Phase 0).
//
// Mirrors the verbatim store's keyed cache + await-then-mutate semantics for
// create/update/delete. Reorder is the one optimistic path: the BE reorder
// endpoint returns 204 with no echo, so we apply the new order to the cache
// immediately (snappy drag UX) and revert to the snapshot if the call fails.

import { SvelteSet, SvelteMap } from 'svelte/reactivity';
import { storyboard as storyboardApi } from '$lib/api';
import { ApiError } from '$lib/api/client';
import { toastError } from '$lib/stores/toast.svelte.js';
import type {
	StoryboardPanelCreate,
	StoryboardPanelUpdate,
	StoryboardPanelListResponse,
	StoryboardPanelResponse,
	StoryboardAssetCreate,
	StoryboardAssetUpdate,
	StoryboardAssetListResponse,
	StoryboardAssetResponse,
	StoryboardSceneCreate,
	StoryboardSceneUpdate,
	StoryboardSceneListResponse,
	StoryboardSceneResponse,
	StoryboardDraftRequest,
	StoryboardDraftResponse,
	SnapshotListResponse,
	StoryboardSnapshot,
	RestoreResponse,
	BranchListResponse,
	StoryboardBranch,
	BranchDiffResponse,
	BranchMergeRequest,
	BranchMergeResponse,
	SiblingMergeRequest,
	SiblingMergeResponse,
	PanelImageRequest,
	PanelImageJobResponse
} from '$lib/types';

type Key = string; // 'p:<projectId>'

function projectKey(projectId: string): Key {
	return `p:${projectId}`;
}

let byKey = $state<Record<Key, StoryboardPanelListResponse>>({});
let loading = $state<Record<Key, boolean>>({});
let assetsByKey = $state<Record<Key, StoryboardAssetListResponse>>({});
let scenesByKey = $state<Record<Key, StoryboardSceneListResponse>>({});
// Version snapshots (restore points). Separate keyed cache + its own loading
// flag: the Versions panel loads lazily and must not flip the board's skeleton.
// `snapshotsOffsetByKey` remembers which page each project is on so a delete can
// refetch the SAME page (not silently jump back to page 1).
let snapshotsByKey = $state<Record<Key, SnapshotListResponse>>({});
let snapshotsLoading = $state<Record<Key, boolean>>({});
let snapshotsOffsetByKey = $state<Record<Key, number>>({});
// Branches (forks of the whole board into a hidden child project). Same
// keyed-cache + loading-flag + remembered-offset triple as snapshots, for the
// same reasons: the panel loads lazily, and an abandon must refetch the SAME page.
let branchesByKey = $state<Record<Key, BranchListResponse>>({});
let branchesLoading = $state<Record<Key, boolean>>({});
let branchesOffsetByKey = $state<Record<Key, number>>({});

// Per-project "somebody else edited this shot" notice, raised by a lost CAS.
// Deliberately NOT a toast: the board silently changes under the user when we
// refetch, so the explanation has to persist next to the board rather than fade.
let conflictByKey = $state<Record<Key, string>>({});
// Bumped only when the board was force-reloaded out from under the user. The
// section keys the board on it so the refetched rows are re-seeded — StoryboardBoard
// only re-seeds on a MEMBERSHIP change, and a conflict reload changes field values,
// not the id set, so without this the reloaded rows never reach the DOM.
let reloadSeqByKey = $state<Record<Key, number>>({});

/** Snapshot list page size — matches the orchestrator's default `limit`. */
export const PAGE_SIZE = 20;
// Panel ids with an in-flight AI rewrite; drives per-card spinners.
// SvelteSet is deeply reactive, so mutate in place (add/delete/clear) — no reassign.
const rewriting = new SvelteSet<string>();
// The in-flight rewrite promise per panel (error-swallowed), so the field-PATCH
// serialiser AND approve/unapprove can await a rewrite the same way they await a
// pending PATCH. A rewrite and a keystroke PATCH both bump `lock_version`, so a
// caller that reads the version while the other is mid-flight would send a token
// the other is about to invalidate — the user's own edit 409s against itself.
const rewriteDrains = new SvelteMap<string, Promise<void>>();

/** Wait for a panel's in-flight AI rewrite to settle (no-op if none). */
function drainPanelRewrite(panelId: string): Promise<void> {
	return rewriteDrains.get(panelId) ?? Promise.resolve();
}

export async function loadProject(projectId: string): Promise<StoryboardPanelListResponse> {
	const k = projectKey(projectId);
	loading = { ...loading, [k]: true };
	try {
		const result = await storyboardApi.listPanels(projectId);
		byKey = { ...byKey, [k]: result };
		return result;
	} finally {
		loading = { ...loading, [k]: false };
	}
}

export function getProject(projectId: string): StoryboardPanelListResponse | undefined {
	return byKey[projectKey(projectId)];
}

export function getProjectList(projectId: string): StoryboardPanelResponse[] {
	return byKey[projectKey(projectId)]?.items ?? [];
}

export function isProjectLoading(projectId: string): boolean {
	return loading[projectKey(projectId)] === true;
}

export async function createPanel(
	projectId: string,
	body: StoryboardPanelCreate
): Promise<StoryboardPanelResponse> {
	const created = await storyboardApi.createPanel(projectId, body);
	const k = projectKey(projectId);
	const existing = byKey[k];
	if (existing) {
		byKey = {
			...byKey,
			[k]: { items: [...existing.items, created], total: existing.total + 1 }
		};
	}
	return created;
}

// Backend's optimistic-concurrency conflict `detail`. A 409 is OVERLOADED — an
// archived-project write ALSO returns 409 (detail: "project is archived and
// read-only") — so every recovery branch matches on THIS suffix, never on the
// status code alone. The backend emits `<entity> was modified concurrently` for
// panel/scene/asset CAS losses (migration 0055/0056); the archived detail does
// not end with it, so the suffix match stays exact enough to disambiguate.
const CONCURRENT_CONFLICT_SUFFIX = ' was modified concurrently';

/**
 * `{ rowId: lock_version }` for a batch of cached rows — the multi-row
 * compare-and-swap token the reorder + restore routes take.
 *
 * Built from the CACHE, never from a refetch: reading the board back before
 * mutating it would open exactly the window the CAS exists to close (and cost a
 * round trip on every drag). A row the cache doesn't hold simply isn't in the map.
 */
function lockVersionMap(rows: Array<{ id: string; lock_version: number }>): Record<string, number> {
	return Object.fromEntries(rows.map((r) => [r.id, r.lock_version]));
}

/** True iff `e` is the compare-and-swap stale-token 409 (not the archived-409). */
function isConcurrentConflict(e: unknown): boolean {
	return e instanceof ApiError && e.status === 409 && e.detail.endsWith(CONCURRENT_CONFLICT_SUFFIX);
}

/**
 * Find a cached panel row by id across every project bucket. Panels are keyed by
 * project, but approve/unapprove only carry the panel id — this recovers the
 * current `lock_version` (and `project_id`) for the compare-and-swap token.
 */
function findCachedPanel(panelId: string): StoryboardPanelResponse | undefined {
	return Object.values(byKey)
		.flatMap((v) => v.items)
		.find((p) => p.id === panelId);
}

// ── Serialising the panel write path ────────────────────────────────────────
//
// Attaching the cached `lock_version` to a write is only safe if the token is
// FRESH. StoryboardPanelCard fires `onUpdate` from `oninput` — one
// fire-and-forget PATCH per KEYSTROKE — so two characters typed before the first
// response lands would both read the same cached version, and the second write
// would lose its compare-and-swap. The user 409s against their own typing and the
// board reloads mid-word. (`storyboard-write-queue.svelte.test.ts` pins this; it
// fails against a straight read-cache-then-send implementation.)
//
// So writes to a given panel run one at a time, and patches that pile up behind
// an in-flight request are COALESCED into a single follow-up write. Every
// dispatch reads the version AFTER the previous response landed, so the token is
// always fresh for our own edits and only goes stale when somebody ELSE wrote the
// row — which is the case worth catching. Collapsing the per-keystroke request
// storm is a welcome side effect.

/** Panels with a drain running, and the merged patch queued behind it. */
const draining = new SvelteMap<string, Promise<void>>();
type PanelWriteOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * The most recently INTENDED write per panel, and whether it landed.
 *
 * `runPanelWrites` routes a write error to that write's own waiters and then
 * RESOLVES — its drain promise never rejects — so a caller that merely awaits
 * `drainPanelWrites` cannot tell a flushed queue from a failed one.
 *
 * Keyed on INTENT (registered in `updatePanel`), not on queue membership: a write
 * deferred behind an in-flight rewrite is in neither `queued` nor `draining`, yet
 * it is still an unsaved edit an approve must wait for. Each entry deletes itself
 * once it settles — so an already-surfaced-and-reverted failure cannot veto a later
 * approve — and a newer write replaces the entry, making the verdict LAST-WRITE-WINS
 * rather than "did anything ever fail".
 */
const lastPanelWrite = new SvelteMap<string, Promise<PanelWriteOutcome>>();

/**
 * Register `write` as the panel's latest outstanding edit and report its outcome.
 *
 * A lost compare-and-swap counts as OK: `notePanelConflict` already reloaded the
 * board to server truth and posted its own notice, so that path owns the UX. Vetoing
 * an approve on top of it would give the user two contradictory toasts and refuse an
 * approve of a row the store has already reconciled.
 */
function trackPanelWrite(
	panelId: string,
	write: Promise<StoryboardPanelResponse>
): Promise<StoryboardPanelResponse> {
	const tracked: Promise<PanelWriteOutcome> = write.then(
		() => ({ ok: true }),
		(error: unknown) => (isConcurrentConflict(error) ? { ok: true } : { ok: false, error })
	);
	lastPanelWrite.set(panelId, tracked);
	void tracked.then(() => {
		if (lastPanelWrite.get(panelId) === tracked) lastPanelWrite.delete(panelId);
	});
	return write;
}
const queued = new SvelteMap<
	string,
	{
		projectId: string;
		patch: StoryboardPanelUpdate;
		waiters: Array<{
			resolve: (row: StoryboardPanelResponse) => void;
			reject: (e: unknown) => void;
		}>;
	}
>();

function cachePanelRow(projectId: string, updated: StoryboardPanelResponse): void {
	const k = projectKey(projectId);
	const existing = byKey[k];
	if (existing) {
		const items = existing.items.map((p) => (p.id === updated.id ? updated : p));
		byKey = { ...byKey, [k]: { ...existing, items } };
	}
}

/**
 * Wait for a panel's queued writes to flush. Re-entrant callers get the RUNNING
 * drain's promise, not a no-op, so an approval can be sure no PATCH is still in
 * flight for the panel before it reads the version.
 */
function drainPanelWrites(panelId: string): Promise<void> {
	const active = draining.get(panelId);
	if (active) return active;
	// Nothing queued and nothing running ⇒ nothing to wait for. Returning here is not
	// just an optimisation: a "wait for writes" caller (rewrite/approve/unapprove) that
	// hit an empty queue would otherwise spin up a `runPanelWrites` that deletes the
	// `draining` slot synchronously AFTER the `set` below re-creates it, leaving a
	// resolved promise that shadows — and silently orphans — every later write to the
	// panel. `runPanelWrites` always yields on its first dequeued item, so once we only
	// start it with a non-empty queue the slot only ever holds a still-running drain.
	if (!queued.has(panelId)) return Promise.resolve();
	const started = runPanelWrites(panelId);
	draining.set(panelId, started);
	return started;
}

/**
 * `drainPanelWrites`, but it THROWS if a write in the drain we waited on failed.
 *
 * Approve/unapprove/rewrite are not "report the failure and carry on" operations:
 * approving a panel whose last keystroke PATCH never landed stamps a server row
 * for text the user never saved, and rewriting one runs the LLM over stale text.
 * Both are wrong results, not just missing feedback — so they abort.
 *
 * Only the panel's latest write, and only while it is still OUTSTANDING, gets a
 * vote: a write that already settled has had its own error toasted and its optimistic
 * edit reverted by the board, so it must not veto a later approve.
 */
async function drainPanelWritesStrict(panelId: string): Promise<void> {
	// Read SYNCHRONOUSLY (an async function body runs to its first await eagerly), so
	// this is the latest write intended BEFORE we were called. That is also what makes
	// `rewritePanel` safe: a write deferred behind THIS rewrite is registered after
	// this read, so we never wait on a promise that only settles once we finish.
	const outstanding = lastPanelWrite.get(panelId);
	await drainPanelWrites(panelId);
	if (!outstanding) return;
	const outcome = await outstanding;
	if (!outcome.ok) throw outcome.error;
}

async function runPanelWrites(panelId: string): Promise<void> {
	for (;;) {
		const next = queued.get(panelId);
		if (!next) {
			// Cleared synchronously, before this function yields again: `updatePanel`
			// enqueues and calls `drainPanelWrites` in one synchronous step, so a
			// queued patch can never see a dying drain and be orphaned.
			draining.delete(panelId);
			return;
		}
		queued.delete(panelId);
		const { projectId, patch, waiters } = next;
		// Read the token HERE, not at enqueue time — that is the whole point.
		const cached = findCachedPanel(panelId);
		const body: StoryboardPanelUpdate =
			cached && patch.expected_lock_version === undefined
				? { ...patch, expected_lock_version: cached.lock_version }
				: patch;
		try {
			const updated = await storyboardApi.updatePanel(panelId, body);
			cachePanelRow(projectId, updated);
			for (const w of waiters) w.resolve(updated);
		} catch (e) {
			// Only the CAS-conflict 409 reloads; the archived-409 (and every other
			// error) propagates untouched so the caller sees the real cause.
			if (isConcurrentConflict(e)) await notePanelConflict(projectId, panelId);
			for (const w of waiters) w.reject(e);
		}
	}
}

export function updatePanel(
	projectId: string,
	panelId: string,
	body: StoryboardPanelUpdate
): Promise<StoryboardPanelResponse> {
	// Symmetric counterpart to the rewrite→`drainPanelWrites` wait (see `rewritePanel`):
	// if an AI rewrite is in flight for this panel, defer enqueuing until it lands so
	// the drain reads a POST-rewrite `lock_version` instead of racing a pre-rewrite
	// token into a self-409 that `notePanelConflict` would then drop. Gating at the
	// enqueue side (not inside `runPanelWrites`) is deliberate: a deferred write is not
	// yet queued, so the in-flight rewrite's own `drainPanelWrites(panelId)` never waits
	// on it — the two waits stay one-directional and cannot deadlock.
	// Registered as OUTSTANDING here, at the moment the write is intended — including
	// on the deferred branch, where it is in neither `queued` nor `draining` and so is
	// invisible to any queue-membership check.
	if (rewriting.has(panelId)) {
		return trackPanelWrite(
			panelId,
			drainPanelRewrite(panelId).then(() => enqueuePanelWrite(projectId, panelId, body))
		);
	}
	return trackPanelWrite(panelId, enqueuePanelWrite(projectId, panelId, body));
}

function enqueuePanelWrite(
	projectId: string,
	panelId: string,
	body: StoryboardPanelUpdate
): Promise<StoryboardPanelResponse> {
	return new Promise<StoryboardPanelResponse>((resolve, reject) => {
		const existing = queued.get(panelId);
		if (existing) {
			// Later fields win — queued and incoming are both "latest known value per
			// field", so a plain merge is the correct collapse.
			existing.patch = { ...existing.patch, ...body };
			existing.waiters.push({ resolve, reject });
		} else {
			queued.set(panelId, { projectId, patch: { ...body }, waiters: [{ resolve, reject }] });
		}
		void drainPanelWrites(panelId);
	});
}

/**
 * A write lost its compare-and-swap: reload the board so the user sees what the
 * other editor actually wrote, and leave a notice saying so. The rejected write is
 * NOT replayed — replaying re-applies the local edit over the other writer, which
 * is the very lost update the CAS exists to prevent.
 */
async function notePanelConflict(projectId: string, panelId: string): Promise<void> {
	const k = projectKey(projectId);
	const shot = findCachedPanel(panelId)?.shot_key;
	try {
		await loadProject(projectId);
	} catch {
		// A failed refetch must not swallow the notice — a stale board with an
		// explanation beats a silent one. The next load reconciles it.
	}
	reloadSeqByKey = { ...reloadSeqByKey, [k]: (reloadSeqByKey[k] ?? 0) + 1 };
	conflictByKey = {
		...conflictByKey,
		[k]: shot
			? `${shot} was changed by someone else — the board has been reloaded and your last edit was not applied.`
			: 'This shot was changed by someone else — the board has been reloaded and your last edit was not applied.'
	};
}

/**
 * A scene/asset write lost its compare-and-swap: reload the affected list so the
 * user sees what the other editor wrote, bump the reload seq, and leave a notice.
 * Mirrors `notePanelConflict` (and reuses the same project-keyed notice surface);
 * the rejected write is NOT replayed — replaying is the very lost update the CAS
 * exists to prevent.
 */
async function noteEntityConflict(
	projectId: string,
	kind: 'scene' | 'asset',
	reload: () => Promise<unknown>
): Promise<void> {
	const k = projectKey(projectId);
	try {
		await reload();
	} catch {
		// A failed refetch must not swallow the notice — a stale list with an
		// explanation beats a silent one. The next load reconciles it.
	}
	reloadSeqByKey = { ...reloadSeqByKey, [k]: (reloadSeqByKey[k] ?? 0) + 1 };
	conflictByKey = {
		...conflictByKey,
		[k]: `This ${kind} was changed by someone else — it has been reloaded and your last edit was not applied.`
	};
}

/** Text of the outstanding concurrent-edit notice for a project, if any. */
export function getPanelConflict(projectId: string): string | undefined {
	return conflictByKey[projectKey(projectId)];
}

/** Increments each time a lost CAS force-reloaded this project's board. */
export function getBoardReloadSeq(projectId: string): number {
	return reloadSeqByKey[projectKey(projectId)] ?? 0;
}

export function dismissPanelConflict(projectId: string): void {
	const next = { ...conflictByKey };
	delete next[projectKey(projectId)];
	conflictByKey = next;
}

/**
 * Replace a single cached panel row with the server's authoritative copy. Keyed
 * off the returned row's own `project_id`, so approve/unapprove only need the
 * panel id (not the project id) at the call site.
 */
function replacePanelRow(updated: StoryboardPanelResponse): void {
	const k = projectKey(updated.project_id);
	const existing = byKey[k];
	if (existing) {
		const items = existing.items.map((p) => (p.id === updated.id ? updated : p));
		byKey = { ...byKey, [k]: { ...existing, items } };
	}
}

/**
 * Approve a panel (pessimistic map-replace with the returned row). On failure
 * the cache is untouched and the error is surfaced as a toast; returns null so
 * the caller can skip its own success feedback.
 */
export async function approvePanel(
	panelId: string,
	note?: string
): Promise<StoryboardPanelResponse | null> {
	// Flush any queued keystroke PATCHes AND any in-flight AI rewrite first: reading
	// lock_version while either is still in flight would send a token that write is
	// about to invalidate (the user's own change 409ing against itself).
	try {
		await drainPanelWritesStrict(panelId);
	} catch (e) {
		// The panel does NOT hold the edit the user is approving — approving anyway
		// would stamp an approval on text the server never received.
		toastError(
			'Not approved — your last edit did not save',
			e instanceof Error ? e.message : undefined
		);
		return null;
	}
	await drainPanelRewrite(panelId);
	const cached = findCachedPanel(panelId);
	try {
		const updated = await storyboardApi.approvePanel(panelId, note, cached?.lock_version);
		replacePanelRow(updated);
		return updated;
	} catch (e) {
		if (isConcurrentConflict(e)) {
			if (cached) await notePanelConflict(cached.project_id, panelId);
			toastError('Panel changed', 'Reloaded latest — reapply your change');
			return null;
		}
		toastError('Could not approve panel', e instanceof Error ? e.message : undefined);
		return null;
	}
}

/** Unapprove a panel (back to `draft`); same map-replace + toast-on-failure. */
export async function unapprovePanel(
	panelId: string,
	note?: string
): Promise<StoryboardPanelResponse | null> {
	try {
		await drainPanelWritesStrict(panelId);
	} catch (e) {
		toastError(
			'Approval not removed — your last edit did not save',
			e instanceof Error ? e.message : undefined
		);
		return null;
	}
	await drainPanelRewrite(panelId);
	const cached = findCachedPanel(panelId);
	try {
		const updated = await storyboardApi.unapprovePanel(panelId, note, cached?.lock_version);
		replacePanelRow(updated);
		return updated;
	} catch (e) {
		if (isConcurrentConflict(e)) {
			if (cached) await notePanelConflict(cached.project_id, panelId);
			toastError('Panel changed', 'Reloaded latest — reapply your change');
			return null;
		}
		toastError('Could not unapprove panel', e instanceof Error ? e.message : undefined);
		return null;
	}
}

export async function deletePanel(projectId: string, panelId: string): Promise<void> {
	// Compare-and-swap on delete: send the CACHED token (no refetch-before-mutate —
	// a read round-trip would itself be a window for the concurrent write we are
	// guarding against). `undefined` when the row isn't cached ⇒ param omitted.
	const k = projectKey(projectId);
	await storyboardApi.deletePanel(
		panelId,
		byKey[k]?.items.find((p) => p.id === panelId)?.lock_version
	);
	const existing = byKey[k];
	if (existing) {
		const remaining = existing.items.filter((p) => p.id !== panelId);
		byKey = { ...byKey, [k]: { items: remaining, total: Math.max(0, existing.total - 1) } };
	}
}

/**
 * Optimistically reorder the cached panels to `orderedIds`, then persist.
 * The BE echoes the panels in their new order with FRESH `lock_version` tokens
 * (moved rows were bumped); we reconcile the cache with that authoritative
 * response so a subsequent edit to a moved panel doesn't 409 against a stale
 * token. On failure we restore the snapshot and rethrow for the caller.
 */
export async function reorderPanels(projectId: string, orderedIds: string[]): Promise<void> {
	const k = projectKey(projectId);
	const existing = byKey[k];
	if (!existing) {
		await storyboardApi.reorderPanels(projectId, orderedIds);
		return;
	}
	const snapshot = existing.items;
	const reordered = orderedIds
		.map((id) => snapshot.find((p) => p.id === id))
		.filter((p): p is StoryboardPanelResponse => p !== undefined);
	// Keep any panels the caller didn't mention (defensive) appended in place.
	const rest = snapshot.filter((p) => !orderedIds.includes(p.id));
	byKey = { ...byKey, [k]: { ...existing, items: [...reordered, ...rest] } };
	// One token per row being reordered, read off the PRE-mutation snapshot.
	const expectedLockVersions = lockVersionMap(reordered);
	try {
		const rows = await storyboardApi.reorderPanels(projectId, orderedIds, expectedLockVersions);
		// Reconcile with the server's authoritative order + fresh tokens.
		byKey = { ...byKey, [k]: { ...existing, items: rows } };
	} catch (e) {
		byKey = { ...byKey, [k]: { ...existing, items: snapshot } };
		throw e;
	}
}

export function invalidateProject(projectId?: string): void {
	if (projectId) {
		const k = projectKey(projectId);
		const next = { ...byKey };
		delete next[k];
		byKey = next;
		const nextAssets = { ...assetsByKey };
		delete nextAssets[k];
		assetsByKey = nextAssets;
		const nextScenes = { ...scenesByKey };
		delete nextScenes[k];
		scenesByKey = nextScenes;
		const nextSnapshots = { ...snapshotsByKey };
		delete nextSnapshots[k];
		snapshotsByKey = nextSnapshots;
		const nextOffsets = { ...snapshotsOffsetByKey };
		delete nextOffsets[k];
		snapshotsOffsetByKey = nextOffsets;
		// The notice explains a reload that is now itself discarded — keeping it
		// would caption a board the user has not seen yet.
		const nextConflicts = { ...conflictByKey };
		delete nextConflicts[k];
		conflictByKey = nextConflicts;
		const nextReloads = { ...reloadSeqByKey };
		delete nextReloads[k];
		reloadSeqByKey = nextReloads;
	} else {
		byKey = {};
		assetsByKey = {};
		scenesByKey = {};
		snapshotsByKey = {};
		snapshotsOffsetByKey = {};
		conflictByKey = {};
		reloadSeqByKey = {};
	}
}

export function invalidateAll(): void {
	byKey = {};
	assetsByKey = {};
	scenesByKey = {};
	snapshotsByKey = {};
	snapshotsLoading = {};
	snapshotsOffsetByKey = {};
	conflictByKey = {};
	reloadSeqByKey = {};
	rewriting.clear();
	rewriteDrains.clear();
	lastPanelWrite.clear();
	queued.clear();
	// Drop in-flight drain tracking too: the queue it drained is now cleared, so a
	// parked runPanelWrites self-terminates on its next loop. Leaving a stale entry
	// here would make a later drainPanelWrites return a promise that never resolves.
	draining.clear();
	// Panel-image jobs: cancel the timers BEFORE dropping the state, or an armed
	// poll fires against a panel the store no longer knows about.
	for (const timer of panelImageTimers.values()) clearTimeout(timer);
	panelImageTimers.clear();
	panelImageByPanel = {};
}

// NB `invalidateProject` deliberately does NOT drop panel-image state: it clears
// caches on an explicit reload, and a generation in flight for a panel of that
// project is still running server-side. Killing the tracking there would orphan a
// 20-minute job the user is watching. `invalidateAll` (test/teardown) does clear it.

/** Seed from a snapshot loaded by a route +page.ts to avoid a flash. */
export function setProjectSnapshot(projectId: string, snapshot: StoryboardPanelListResponse): void {
	byKey = { ...byKey, [projectKey(projectId)]: snapshot };
}

// ── Assets (character/location/prop bible) ─────────────────────────────────
// Same keyed-cache + await-then-mutate idiom as the panel cache above.

export async function loadAssets(projectId: string): Promise<StoryboardAssetResponse[]> {
	const result = await storyboardApi.listAssets(projectId);
	assetsByKey = { ...assetsByKey, [projectKey(projectId)]: result };
	return result.items;
}

export function getAssetList(projectId: string): StoryboardAssetResponse[] {
	return assetsByKey[projectKey(projectId)]?.items ?? [];
}

export async function createAsset(
	projectId: string,
	body: StoryboardAssetCreate
): Promise<StoryboardAssetResponse> {
	const created = await storyboardApi.createAsset(projectId, body);
	const k = projectKey(projectId);
	const existing = assetsByKey[k];
	if (existing) {
		assetsByKey = {
			...assetsByKey,
			[k]: { items: [...existing.items, created], total: existing.total + 1 }
		};
	}
	return created;
}

export async function updateAsset(
	projectId: string,
	assetId: string,
	body: StoryboardAssetUpdate
): Promise<StoryboardAssetResponse> {
	const k = projectKey(projectId);
	const existing = assetsByKey[k];
	// Opt-in optimistic concurrency: attach the cached token unless the caller
	// already supplied one. Assets have no keystroke-rapid field (unlike panels),
	// so a call-time read is fresh enough — no write-queue needed.
	const cached = existing?.items.find((a) => a.id === assetId);
	const withToken: StoryboardAssetUpdate =
		cached && body.expected_lock_version === undefined
			? { ...body, expected_lock_version: cached.lock_version }
			: body;
	try {
		const updated = await storyboardApi.updateAsset(assetId, withToken);
		if (existing) {
			const items = existing.items.map((a) => (a.id === assetId ? updated : a));
			assetsByKey = { ...assetsByKey, [k]: { ...existing, items } };
		}
		return updated;
	} catch (e) {
		if (isConcurrentConflict(e))
			await noteEntityConflict(projectId, 'asset', () => loadAssets(projectId));
		throw e;
	}
}

export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
	// Cached-token CAS, same contract as `deletePanel`.
	const k = projectKey(projectId);
	await storyboardApi.deleteAsset(
		assetId,
		assetsByKey[k]?.items.find((a) => a.id === assetId)?.lock_version
	);
	const existing = assetsByKey[k];
	if (existing) {
		const remaining = existing.items.filter((a) => a.id !== assetId);
		assetsByKey = {
			...assetsByKey,
			[k]: { items: remaining, total: Math.max(0, existing.total - 1) }
		};
	}
}

// ── Scenes ─────────────────────────────────────────────────────────────────

export async function loadScenes(projectId: string): Promise<StoryboardSceneResponse[]> {
	const result = await storyboardApi.listScenes(projectId);
	scenesByKey = { ...scenesByKey, [projectKey(projectId)]: result };
	return result.items;
}

export function getSceneList(projectId: string): StoryboardSceneResponse[] {
	return scenesByKey[projectKey(projectId)]?.items ?? [];
}

export async function createScene(
	projectId: string,
	body: StoryboardSceneCreate
): Promise<StoryboardSceneResponse> {
	const created = await storyboardApi.createScene(projectId, body);
	const k = projectKey(projectId);
	const existing = scenesByKey[k];
	if (existing) {
		scenesByKey = {
			...scenesByKey,
			[k]: { items: [...existing.items, created], total: existing.total + 1 }
		};
	}
	return created;
}

export async function updateScene(
	projectId: string,
	sceneId: string,
	body: StoryboardSceneUpdate
): Promise<StoryboardSceneResponse> {
	const k = projectKey(projectId);
	const existing = scenesByKey[k];
	// Opt-in optimistic concurrency: attach the cached token unless the caller
	// already supplied one (see `updateAsset`). No write-queue — scenes have no
	// keystroke-rapid field.
	const cached = existing?.items.find((s) => s.id === sceneId);
	const withToken: StoryboardSceneUpdate =
		cached && body.expected_lock_version === undefined
			? { ...body, expected_lock_version: cached.lock_version }
			: body;
	try {
		const updated = await storyboardApi.updateScene(sceneId, withToken);
		if (existing) {
			const items = existing.items.map((s) => (s.id === sceneId ? updated : s));
			scenesByKey = { ...scenesByKey, [k]: { ...existing, items } };
		}
		return updated;
	} catch (e) {
		if (isConcurrentConflict(e))
			await noteEntityConflict(projectId, 'scene', () => loadScenes(projectId));
		throw e;
	}
}

export async function deleteScene(projectId: string, sceneId: string): Promise<void> {
	// Cached-token CAS, same contract as `deletePanel`.
	const k = projectKey(projectId);
	await storyboardApi.deleteScene(
		sceneId,
		scenesByKey[k]?.items.find((s) => s.id === sceneId)?.lock_version
	);
	const existing = scenesByKey[k];
	if (existing) {
		const remaining = existing.items.filter((s) => s.id !== sceneId);
		scenesByKey = {
			...scenesByKey,
			[k]: { items: remaining, total: Math.max(0, existing.total - 1) }
		};
	}
}

/**
 * Pure selector: scenes for the project (ascending by `position`) plus a Map
 * of panels grouped by `scene_id`. Every scene id gets an entry (even empty) so
 * the board can render an empty lane; the `null` key holds unassigned panels
 * (null/undefined `scene_id`) and is always present (possibly empty). Buckets
 * keep the panel list's existing (already position-ordered) order.
 */
export function getPanelsByScene(projectId: string): {
	scenes: StoryboardSceneResponse[];
	groups: Map<string | null, StoryboardPanelResponse[]>;
} {
	const scenes = [...getSceneList(projectId)].sort((a, b) => a.position - b.position);
	const groups: Map<string | null, StoryboardPanelResponse[]> = new SvelteMap();
	groups.set(null, []); // unassigned bucket always present
	for (const s of scenes) {
		groups.set(s.id, []);
	}
	for (const p of getProjectList(projectId)) {
		const key = p.scene_id ?? null;
		// Fold orphans (scene_id referencing a scene not in the list — e.g. a
		// locally-stale panel after its scene was deleted) into the unassigned
		// bucket so they stay visible/reorderable instead of vanishing until a
		// reload. Only the scene buckets + the null bucket are ever rendered.
		const bucket = groups.get(key) ?? groups.get(null)!;
		bucket.push(p);
	}
	return { scenes, groups };
}

/**
 * Optimistically reorder the cached scenes to `orderedSceneIds`, then persist.
 * One atomic bulk PATCH to the scenes/reorder endpoint (not N per-scene PATCHes).
 * On failure we restore the snapshot and rethrow.
 */
export async function reorderScenes(projectId: string, orderedSceneIds: string[]): Promise<void> {
	const k = projectKey(projectId);
	const existing = scenesByKey[k];
	if (!existing) {
		await storyboardApi.reorderScenes(projectId, orderedSceneIds);
		return;
	}
	const snapshot = existing.items;
	const reordered = orderedSceneIds
		.map((id) => snapshot.find((s) => s.id === id))
		.filter((s): s is StoryboardSceneResponse => s !== undefined);
	// Keep any scenes the caller didn't mention (defensive) appended in place.
	const rest = snapshot.filter((s) => !orderedSceneIds.includes(s.id));
	const nextItems = [...reordered, ...rest].map((s, i) => ({ ...s, position: i }));
	scenesByKey = { ...scenesByKey, [k]: { ...existing, items: nextItems } };
	// Tokens read off the PRE-mutation snapshot rows (the optimistic copies above
	// rewrite `position`, but `lock_version` is untouched either way).
	const expectedLockVersions = lockVersionMap(reordered);
	try {
		// One atomic bulk PATCH — the backend reassigns every position in a single
		// transaction, so a failure can no longer leave a half-applied order behind (the
		// old N-per-scene loop committed each step, then could not roll them back). The
		// server owns the permutation check (400) and echoes the scenes in new order with
		// fresh lock_version tokens; we reconcile the cache with that authoritative response
		// so a post-reorder scene edit doesn't 409 against a stale token.
		const rows = await storyboardApi.reorderScenes(
			projectId,
			orderedSceneIds,
			expectedLockVersions
		);
		scenesByKey = { ...scenesByKey, [k]: { ...existing, items: rows } };
	} catch (e) {
		scenesByKey = { ...scenesByKey, [k]: { ...existing, items: snapshot } };
		throw e;
	}
}

// ── Brief → board draft + single-panel AI rewrite ───────────────────────────

/**
 * Generate a full storyboard (panels + assets + scenes) from the project brief.
 * Pessimistic: no optimism — on success we replace ALL THREE caches with the
 * server's authoritative draft.
 */
export async function draftFromBrief(
	projectId: string,
	body: StoryboardDraftRequest
): Promise<StoryboardDraftResponse> {
	const resp = await storyboardApi.draftFromBrief(projectId, body);
	const k = projectKey(projectId);
	setProjectSnapshot(projectId, { items: resp.panels, total: resp.panels.length });
	assetsByKey = { ...assetsByKey, [k]: { items: resp.assets, total: resp.assets.length } };
	scenesByKey = { ...scenesByKey, [k]: { items: resp.scenes, total: resp.scenes.length } };
	return resp;
}

/**
 * AI-rewrite a single panel. Marks `panelId` busy for the duration (drives a
 * per-card spinner via `isPanelBusy`), then patches that one row in the panel
 * cache on success (like `updatePanel`).
 *
 * Serialised against the field-PATCH queue: a rewrite and a keystroke PATCH on the
 * same panel both bump `lock_version`, so the rewrite waits for any queued/in-flight
 * PATCH (which already read its token) to land before it runs, instead of racing it
 * into a self-409. The in-flight rewrite is exposed via `rewriteDrains` so a
 * following approve/unapprove (or PATCH) waits for it in turn.
 */
export function rewritePanel(
	projectId: string,
	panelId: string,
	instruction: string,
	fields?: string[]
): Promise<StoryboardPanelResponse> {
	// Mark busy SYNCHRONOUSLY (before the first await) so `isPanelBusy` flips the
	// card spinner the instant Rewrite is clicked, not a microtask later.
	rewriting.add(panelId);
	const run = (async () => {
		try {
			// Let any queued/in-flight field PATCH on this panel finish first — and
			// ABORT if it failed, rather than running the LLM over the pre-edit text.
			// Inside the try so the rejection still clears the busy marker below;
			// StoryboardSection's `handleRewrite` catch turns it into a toast.
			await drainPanelWritesStrict(panelId);
			const updated = await storyboardApi.rewritePanel(panelId, { instruction, fields });
			const k = projectKey(projectId);
			const existing = byKey[k];
			if (existing) {
				const items = existing.items.map((p) => (p.id === panelId ? updated : p));
				byKey = { ...byKey, [k]: { ...existing, items } };
			}
			return updated;
		} finally {
			rewriting.delete(panelId);
		}
	})();
	// Publish an error-swallowed gate other writers await; clear it only if it is
	// still ours (a newer rewrite may have replaced it while this one drained).
	const gate = run.then(
		() => undefined,
		() => undefined
	);
	rewriteDrains.set(panelId, gate);
	void gate.then(() => {
		if (rewriteDrains.get(panelId) === gate) rewriteDrains.delete(panelId);
	});
	return run;
}

export function isPanelBusy(panelId: string): boolean {
	return rewriting.has(panelId);
}

/**
 * Persist brief-authored draft panels that were never saved. No-op unless the
 * project's panel cache is empty AND `briefPanels` is non-empty; otherwise
 * POSTs each panel in order (preserving position), then reloads to refresh.
 */
export async function backfillFromBrief(
	projectId: string,
	briefPanels: StoryboardPanelCreate[]
): Promise<void> {
	if (briefPanels.length === 0 || getProjectList(projectId).length > 0) {
		return;
	}
	for (const body of briefPanels) {
		await storyboardApi.createPanel(projectId, body);
	}
	await loadProject(projectId);
}

// ── Version snapshots (snapshot / restore) ──────────────────────────────────

export async function loadSnapshots(
	projectId: string,
	opts?: { limit?: number; offset?: number }
): Promise<StoryboardSnapshot[]> {
	const k = projectKey(projectId);
	snapshotsLoading = { ...snapshotsLoading, [k]: true };
	try {
		// Only forward opts when provided so a bare load lets the BE apply its own
		// defaults (and keeps the api mock called with a single arg).
		const result = opts
			? await storyboardApi.listSnapshots(projectId, opts)
			: await storyboardApi.listSnapshots(projectId);
		snapshotsByKey = { ...snapshotsByKey, [k]: result };
		snapshotsOffsetByKey = { ...snapshotsOffsetByKey, [k]: opts?.offset ?? 0 };
		return result.items;
	} finally {
		snapshotsLoading = { ...snapshotsLoading, [k]: false };
	}
}

export function getSnapshots(projectId: string): SnapshotListResponse | undefined {
	return snapshotsByKey[projectKey(projectId)];
}

/** Current 1-based page for the project's snapshot list (derived from the offset). */
export function getSnapshotsPage(projectId: string): number {
	const offset = snapshotsOffsetByKey[projectKey(projectId)] ?? 0;
	return Math.floor(offset / PAGE_SIZE) + 1;
}

/** Newest first — the list is the restore menu, so recency is the useful order. */
export function getSnapshotList(projectId: string): StoryboardSnapshot[] {
	const items = snapshotsByKey[projectKey(projectId)]?.items ?? [];
	// Date.parse (not `new Date`) — returns a number and constructs no mutable
	// Date instance, which is what svelte/prefer-svelte-reactivity guards against.
	return [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function areSnapshotsLoading(projectId: string): boolean {
	return snapshotsLoading[projectKey(projectId)] === true;
}

/**
 * Take a manual restore point of the current board. Pessimistic: we don't splice
 * the created row in by hand, we refetch — the server also stamps the scene /
 * panel / asset counts we render, so its list is the only authoritative source.
 */
export async function createSnapshot(
	projectId: string,
	note?: string
): Promise<StoryboardSnapshot> {
	const created = await storyboardApi.createSnapshot(projectId, note);
	await loadSnapshots(projectId);
	return created;
}

/**
 * Restore the board to a snapshot. This is a server-side BULK rewrite of panels
 * AND scenes AND assets (exactly like `draftFromBrief`), so every one of those
 * caches is stale the moment it returns — refetch all three or the board renders
 * the pre-restore state. It also mints a fresh `auto` snapshot of the board it
 * just overwrote, so the snapshot list is stale too.
 */
export async function restoreSnapshot(
	projectId: string,
	snapshotId: string
): Promise<RestoreResponse> {
	// ONE FLAT token map over every live scene, panel AND asset — a restore rewrites
	// the whole board, so any row that moved under us must lose the CAS. uuid7 ids
	// share one namespace, so the three lists merge without bucketing by type.
	const board = lockVersionMap([
		...getSceneList(projectId),
		...getProjectList(projectId),
		...getAssetList(projectId)
	]);
	// An EMPTY map is not a claim that the board is empty — it means nothing was
	// cached — so it is omitted rather than sent, exactly like the deletes above.
	const resp = await storyboardApi.restoreSnapshot(
		snapshotId,
		Object.keys(board).length > 0 ? board : undefined
	);
	await Promise.all([
		loadProject(projectId),
		loadAssets(projectId),
		loadScenes(projectId),
		loadSnapshots(projectId)
	]);
	return resp;
}

/**
 * Delete a user-facing (`manual`) snapshot, then refetch the CURRENT page — a
 * delete changes both `total` and the page contents, so the pager + list must
 * re-derive from the server. Pessimistic: only touch the cache on success. A
 * `409` (the BE refuses to delete an `auto` safety snapshot) propagates to the
 * caller — it is surfaced, not swallowed.
 */
export async function deleteSnapshot(projectId: string, snapshotId: string): Promise<void> {
	await storyboardApi.deleteSnapshot(projectId, snapshotId);
	const offset = snapshotsOffsetByKey[projectKey(projectId)] ?? 0;
	await loadSnapshots(projectId, { limit: PAGE_SIZE, offset });
}

// ── Branches (fork the board, rework, merge back) ───────────────────────────

export async function loadBranches(
	projectId: string,
	opts?: { limit?: number; offset?: number }
): Promise<StoryboardBranch[]> {
	const k = projectKey(projectId);
	branchesLoading = { ...branchesLoading, [k]: true };
	try {
		const result = opts
			? await storyboardApi.listBranches(projectId, opts)
			: await storyboardApi.listBranches(projectId);
		branchesByKey = { ...branchesByKey, [k]: result };
		branchesOffsetByKey = { ...branchesOffsetByKey, [k]: opts?.offset ?? 0 };
		return result.items;
	} finally {
		branchesLoading = { ...branchesLoading, [k]: false };
	}
}

export function getBranches(projectId: string): BranchListResponse | undefined {
	return branchesByKey[projectKey(projectId)];
}

/** Current 1-based page for the project's branch list (derived from the offset). */
export function getBranchesPage(projectId: string): number {
	const offset = branchesOffsetByKey[projectKey(projectId)] ?? 0;
	return Math.floor(offset / PAGE_SIZE) + 1;
}

/** Newest first — a branch list is a "what am I working on" menu, so recency wins. */
export function getBranchList(projectId: string): StoryboardBranch[] {
	const items = branchesByKey[projectKey(projectId)]?.items ?? [];
	// Date.parse (not `new Date`) — returns a number and constructs no mutable Date
	// instance, which is what svelte/prefer-svelte-reactivity guards against.
	return [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function areBranchesLoading(projectId: string): boolean {
	return branchesLoading[projectKey(projectId)] === true;
}

/**
 * Fork the board into a new branch. Pessimistic refetch rather than splicing the
 * created row in: the fork also mints a `branch_base` SNAPSHOT on the root project
 * (the merge base it pins), so the snapshot list is stale the moment this returns —
 * refetch both or the Versions panel silently misses the new fork point.
 */
export async function createBranch(projectId: string, name: string): Promise<StoryboardBranch> {
	const created = await storyboardApi.createBranch(projectId, name);
	await Promise.all([loadBranches(projectId), loadSnapshots(projectId)]);
	return created;
}

/**
 * Abandon a branch (soft close: status → 'abandoned', child project archived).
 * Refetch the CURRENT page — abandon changes the row's status in place, so `total`
 * is unchanged, but the page contents must re-derive from the server. Pessimistic:
 * only touch the cache on success; a 409 (already merged) propagates to the caller.
 */
export async function abandonBranch(projectId: string, branchId: string): Promise<void> {
	await storyboardApi.abandonBranch(branchId);
	const offset = branchesOffsetByKey[projectKey(projectId)] ?? 0;
	await loadBranches(projectId, { limit: PAGE_SIZE, offset });
}

/**
 * Three-way diff of a branch against its base snapshot. Deliberately NOT cached:
 * it is a point-in-time view whose `root_fingerprint` is only valid until the root
 * board next changes — a stale cached diff would merge against a stale fingerprint
 * and 409. Every open of the review UI (and every 409 recovery) refetches.
 */
export async function diffBranch(projectId: string, branchId: string): Promise<BranchDiffResponse> {
	return storyboardApi.diffBranch(projectId, branchId);
}

/**
 * Three-way diff of a branch against a SIBLING branch (same shape as `diffBranch`, but the
 * `main` column is the target sibling's board and `root_fingerprint` is the TARGET's token).
 * Like `diffBranch` this is deliberately NOT cached — its fingerprint is only valid until the
 * target board next moves. Errors (404 / 409 no shared base / 422 not siblings) propagate.
 */
export async function diffAgainstBranch(
	projectId: string,
	branchId: string,
	targetBranchId: string
): Promise<BranchDiffResponse> {
	return storyboardApi.diffAgainstBranch(projectId, branchId, targetBranchId);
}

/**
 * Merge a branch into the root board. Server-side this is a BULK rewrite of the
 * root's panels (like `restoreSnapshot`) preceded by an `auto` snapshot of the
 * pre-merge board — so the panel/scene/asset caches AND the snapshot list AND the
 * branch list (the row flips to 'merged') are all stale the moment it returns.
 * Refetch all five or the board renders the pre-merge state.
 *
 * Pessimistic: nothing is touched on failure. A 409 (stale `root_fingerprint`, or
 * a branch that is no longer open) and a 422 (an unresolved conflict) both
 * propagate to the caller — they are surfaced, not swallowed.
 */
export async function mergeBranch(
	projectId: string,
	branchId: string,
	body: BranchMergeRequest
): Promise<BranchMergeResponse> {
	const resp = await storyboardApi.mergeBranch(projectId, branchId, body);
	const offset = branchesOffsetByKey[projectKey(projectId)] ?? 0;
	await Promise.all([
		loadProject(projectId),
		loadAssets(projectId),
		loadScenes(projectId),
		loadSnapshots(projectId),
		loadBranches(projectId, { limit: PAGE_SIZE, offset })
	]);
	return resp;
}

/**
 * Merge a branch's board INTO a sibling branch. Server-side this bulk-rewrites the TARGET
 * board (auto-snapshotting it first) and BOTH branches stay open. The same caches go stale as
 * a root merge — the target board's panels/scenes/assets, the snapshot list (the new auto
 * snapshot), and the branch list — so run the identical five-way refetch. Pessimistic: nothing
 * is touched on failure; a 409 (stale `target_fingerprint`) and 422 (unresolved conflict)
 * propagate to the caller.
 */
export async function mergeIntoBranch(
	projectId: string,
	branchId: string,
	body: SiblingMergeRequest
): Promise<SiblingMergeResponse> {
	const resp = await storyboardApi.mergeIntoBranch(projectId, branchId, body);
	const offset = branchesOffsetByKey[projectKey(projectId)] ?? 0;
	await Promise.all([
		loadProject(projectId),
		loadAssets(projectId),
		loadScenes(projectId),
		loadSnapshots(projectId),
		loadBranches(projectId, { limit: PAGE_SIZE, offset })
	]);
	return resp;
}

// ── Per-panel AI image generation ───────────────────────────────────────────
//
// Generating a panel image is minutes of GPU work, so the endpoint is 202 +
// a TTL-bounded job record and the client has to track progress itself.
//
// THREE non-obvious constraints shape this whole section:
//
// 1. The state lives HERE, keyed by panel id — never in the card component.
//    StoryboardPanelCard remounts on every reorder (and on the conflict-reload
//    re-seed), and a 20-minute job must survive that. Component-local state
//    would silently drop the job the first time somebody dragged a card.
//
// 2. POLLING IS THE PRIMARY PATH. SSE (`panel_image_status` on the project
//    channel) is an ACCELERATOR only: the stream can be disconnected for
//    minutes at a time and reconnects do not replay. Both feed ONE reducer
//    (`applyPanelImageJob`) and the FIRST terminal state wins — a late
//    duplicate from the slower transport is ignored rather than re-animating
//    a card the user already saw finish.
//
// 3. ⚠️ NEVER copy `media_ref.url` into this state. The job's url is the
//    signature minted at generation time; only the PANEL read path re-signs
//    it, and the presign expires in an hour. So `completed` refetches the
//    board and the card renders the panel's own url. This exact trap already
//    shipped one production bug — do not "optimise" the refetch away.

/**
 * UI-level status for a panel image. The first four are the wire statuses; the
 * last three are client-side conditions the server has no status for:
 *   'lost'        — the job's TTL expired (poll 404) while SSE was silent. NOT
 *                   the same as failure and NOT a reset to idle: the generation
 *                   may well have succeeded, we simply lost the receipt.
 *   'unavailable' — 503: this deployment has no Redis, so the feature cannot run.
 *   'conflict'    — 409: somebody else moved the panel (lost compare-and-swap).
 */
export type PanelImageUiStatus =
	'queued' | 'running' | 'completed' | 'failed' | 'lost' | 'unavailable' | 'conflict';

export type PanelImageUiState = {
	jobId: string | null;
	status: PanelImageUiStatus;
	/** Verbatim server message when there is one — never a paraphrase. */
	error: string | null;
	startedAt: number;
	seed: number | null;
	reused: boolean | null;
};

/** Poll cadence: tight at first, then backed off — most jobs land in the first minute. */
const PANEL_IMAGE_POLL_MS = 5_000;
const PANEL_IMAGE_SLOW_POLL_MS = 15_000;
const PANEL_IMAGE_BACKOFF_AFTER_MS = 60_000;

// A plain array, not a Set: `svelte/prefer-svelte-reactivity` bans bare Set/Map in
// a `.svelte.ts` module, and a 5-element `includes` is not worth a SvelteSet.
const PANEL_IMAGE_TERMINAL: readonly PanelImageUiStatus[] = [
	'completed',
	'failed',
	'lost',
	'unavailable',
	'conflict'
];

/** Terminal states are STICKY — only `dismissPanelImage`/`startPanelImage` clear them. */
function isTerminalPanelImage(status: PanelImageUiStatus): boolean {
	return PANEL_IMAGE_TERMINAL.includes(status);
}

let panelImageByPanel = $state<Record<string, PanelImageUiState>>({});
/** Pending poll timers, one per panel. SvelteMap for the lint rule above; the
 *  reactivity is incidental — nothing renders off it. */
const panelImageTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

/** Current job state for a panel, or undefined when nothing has ever been started. */
export function panelImageState(panelId: string): PanelImageUiState | undefined {
	return panelImageByPanel[panelId];
}

function putPanelImageState(panelId: string, next: PanelImageUiState): void {
	panelImageByPanel = { ...panelImageByPanel, [panelId]: next };
}

function clearPanelImageTimer(panelId: string): void {
	const timer = panelImageTimers.get(panelId);
	if (timer !== undefined) clearTimeout(timer);
	panelImageTimers.delete(panelId);
}

/** Verbatim server text where we have it; the Error message otherwise. */
function panelImageErrorText(e: unknown): string | null {
	if (e instanceof ApiError) return e.detail;
	if (e instanceof Error) return e.message;
	return null;
}

/**
 * Force a CLIENT-side outcome (409/503/404 — conditions with no wire status).
 * Honours first-terminal-wins unless `force`, which only `recheckPanelImage`
 * passes: an explicit user re-check is allowed to overwrite a stale verdict.
 */
function setPanelImageOutcome(
	panelId: string,
	status: PanelImageUiStatus,
	error: string | null,
	force = false
): void {
	const current = panelImageByPanel[panelId];
	if (!force && current && isTerminalPanelImage(current.status)) return;
	clearPanelImageTimer(panelId);
	putPanelImageState(panelId, {
		jobId: current?.jobId ?? null,
		status,
		error,
		startedAt: current?.startedAt ?? Date.now(),
		seed: current?.seed ?? null,
		reused: current?.reused ?? null
	});
}

/**
 * THE reducer. Both transports (poll response and SSE event) land here, so the
 * merge rules live in exactly one place:
 *   - a terminal state is never overwritten (first terminal wins);
 *   - a job id that is not the one we are tracking is ignored (a stale event
 *     from a superseded generation must not resurrect a finished card);
 *   - `startedAt` is preserved so the poll backoff measures the REAL age, not
 *     the age since the last event.
 * On `completed` the board is refetched — that (and only that) is where a
 * fetchable, freshly-signed `media_ref.url` comes from.
 */
function applyPanelImageJob(
	projectId: string,
	panelId: string,
	job: PanelImageJobResponse,
	force = false
): void {
	const current = panelImageByPanel[panelId];
	if (!force && current && isTerminalPanelImage(current.status)) return;
	if (current?.jobId && job.job_id && current.jobId !== job.job_id) return;

	const status: PanelImageUiStatus = job.status;
	putPanelImageState(panelId, {
		jobId: job.job_id ?? current?.jobId ?? null,
		status,
		error: job.error ?? null,
		startedAt: current?.startedAt ?? Date.now(),
		// `gen` carries the seed the runner actually used (it may have come from the
		// referenced assets rather than the caller), so it supersedes the requested one.
		seed: job.gen?.seed ?? current?.seed ?? null,
		reused: job.gen?.reused ?? current?.reused ?? null
	});

	if (isTerminalPanelImage(status)) {
		clearPanelImageTimer(panelId);
		if (status === 'completed') {
			// Deliberately NOT awaited: the state flip must be visible immediately, and
			// a failed refetch is recoverable (the next board load reconciles it).
			void loadProject(projectId).catch(() => undefined);
		}
	}
}

/**
 * SSE entry point (`panel_image_status` on the project channel). Same reducer as
 * the poll, so the accelerator can never diverge from the primary path.
 */
export function applyPanelImageEvent(
	projectId: string,
	panelId: string,
	job: PanelImageJobResponse
): void {
	applyPanelImageJob(projectId, panelId, job);
}

function schedulePanelImagePoll(projectId: string, panelId: string): void {
	const current = panelImageByPanel[panelId];
	if (!current?.jobId || isTerminalPanelImage(current.status)) return;
	clearPanelImageTimer(panelId);
	const elapsed = Date.now() - current.startedAt;
	const delay =
		elapsed >= PANEL_IMAGE_BACKOFF_AFTER_MS ? PANEL_IMAGE_SLOW_POLL_MS : PANEL_IMAGE_POLL_MS;
	panelImageTimers.set(
		panelId,
		setTimeout(() => {
			void pollPanelImageOnce(projectId, panelId);
		}, delay)
	);
}

async function pollPanelImageOnce(projectId: string, panelId: string): Promise<void> {
	panelImageTimers.delete(panelId);
	const current = panelImageByPanel[panelId];
	if (!current?.jobId || isTerminalPanelImage(current.status)) return;

	// Paused, not stopped, while the tab is hidden: a backgrounded tab must not
	// keep a request in flight for 20 minutes, but the job is still ours and the
	// loop has to resume the moment the tab is looked at again.
	if (typeof document !== 'undefined' && document.hidden) {
		schedulePanelImagePoll(projectId, panelId);
		return;
	}

	try {
		const job = await storyboardApi.getPanelImageJob(panelId, current.jobId);
		applyPanelImageJob(projectId, panelId, job);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) {
			// The job record aged out of Redis. We know nothing about the outcome, so
			// say exactly that — silently resetting to idle would tell the user their
			// generation never happened, which is not something we know.
			setPanelImageOutcome(panelId, 'lost', null);
			return;
		}
		if (e instanceof ApiError && e.status === 503) {
			setPanelImageOutcome(panelId, 'unavailable', panelImageErrorText(e));
			return;
		}
		// Anything else (network blip, 5xx) is transient — keep polling rather than
		// declaring a multi-minute GPU job dead over one dropped request.
	}
	schedulePanelImagePoll(projectId, panelId);
}

/**
 * Queue an image for a panel and start tracking it.
 *
 * Order matters: the queued keystroke PATCHes are drained STRICTLY first so the
 * compare-and-swap token we read is the one the server actually holds. Sending a
 * pre-PATCH `lock_version` would 409 the user against their own typing — and a
 * generation that 409s costs a whole round trip of confusion for a button the
 * user pressed once.
 *
 * Never throws: every failure is a state the card renders.
 */
export async function startPanelImage(
	projectId: string,
	panelId: string,
	opts?: { seed?: number }
): Promise<void> {
	clearPanelImageTimer(panelId);
	// Seeded synchronously so the card shows a spinner on the click, not a tick later
	// — and so a previous terminal state is cleared by the retry itself.
	putPanelImageState(panelId, {
		jobId: null,
		status: 'queued',
		error: null,
		startedAt: Date.now(),
		seed: opts?.seed ?? null,
		reused: null
	});

	try {
		await drainPanelWritesStrict(panelId);
	} catch (e) {
		// The panel does not hold the edit the user is illustrating — generating from
		// stale text would burn GPU minutes on the wrong shot.
		setPanelImageOutcome(panelId, 'failed', panelImageErrorText(e), true);
		return;
	}

	const cached = findCachedPanel(panelId);
	const body: PanelImageRequest = {
		expected_lock_version: cached?.lock_version,
		seed: opts?.seed
	};

	try {
		const job = await storyboardApi.generatePanelImage(panelId, body);
		applyPanelImageJob(projectId, panelId, job, true);
		schedulePanelImagePoll(projectId, panelId);
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) {
			setPanelImageOutcome(panelId, 'conflict', e.detail, true);
			// Only the CAS-409 reloads the board + raises the existing conflict banner;
			// the archived-project 409 shares the status code but not the cause.
			if (isConcurrentConflict(e)) await notePanelConflict(projectId, panelId);
			return;
		}
		if (e instanceof ApiError && e.status === 503) {
			setPanelImageOutcome(panelId, 'unavailable', e.detail, true);
			return;
		}
		setPanelImageOutcome(panelId, 'failed', panelImageErrorText(e), true);
	}
}

/** Clear a panel's job state (drops a sticky terminal state and any poll timer). */
export function dismissPanelImage(panelId: string): void {
	clearPanelImageTimer(panelId);
	const next = { ...panelImageByPanel };
	delete next[panelId];
	panelImageByPanel = next;
}

/**
 * Poll once, right now, ignoring the hidden-tab pause and the sticky-terminal
 * rule. This is the user's "check again" escape hatch out of `lost` — the one
 * place where overwriting a terminal verdict is the intended behaviour.
 */
export async function recheckPanelImage(projectId: string, panelId: string): Promise<void> {
	const current = panelImageByPanel[panelId];
	if (!current?.jobId) return;
	clearPanelImageTimer(panelId);
	try {
		const job = await storyboardApi.getPanelImageJob(panelId, current.jobId);
		applyPanelImageJob(projectId, panelId, job, true);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) {
			setPanelImageOutcome(panelId, 'lost', null, true);
			return;
		}
		if (e instanceof ApiError && e.status === 503) {
			setPanelImageOutcome(panelId, 'unavailable', panelImageErrorText(e), true);
			return;
		}
		setPanelImageOutcome(panelId, 'failed', panelImageErrorText(e), true);
		return;
	}
	schedulePanelImagePoll(projectId, panelId);
}

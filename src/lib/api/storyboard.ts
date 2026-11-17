// Storyboard panels API — project-scoped board of shot panels (Phase 0).
//
// The panel is the pipeline spine element: its `shot_key` is the `clip-<n>`
// join key. Persisted panels seed `brief.storyboard`, which the generic /
// demo_video / showcase blueprints short-circuit from at run time.
//
// BE routes (unversioned `/api`, snake_case JSON):
//   GET    /api/projects/{project_id}/storyboard/panels          → StoryboardPanelListResponse
//   POST   /api/projects/{project_id}/storyboard/panels          → StoryboardPanelResponse
//   PATCH  /api/projects/{project_id}/storyboard/panels/reorder  → 200 StoryboardPanelResponse[] (body: { ordered_panel_ids })
//   PATCH  /api/storyboard/panels/{panel_id}                     → StoryboardPanelResponse
//   DELETE /api/storyboard/panels/{panel_id}                     → 204
//
// Phase 1 — brief→board draft, single-panel AI rewrite, and the asset
// (character/location/prop bible) + scene sub-resources:
//   POST   /api/projects/{project_id}/storyboard/draft           → StoryboardDraftResponse
//   POST   /api/storyboard/panels/{panel_id}/rewrite             → StoryboardPanelResponse
//   GET    /api/projects/{project_id}/storyboard/assets          → StoryboardAssetListResponse
//   POST   /api/projects/{project_id}/storyboard/assets          → StoryboardAssetResponse
//   PATCH  /api/storyboard/assets/{asset_id}                     → StoryboardAssetResponse
//   DELETE /api/storyboard/assets/{asset_id}                     → 204
//   GET    /api/projects/{project_id}/storyboard/scenes          → StoryboardSceneListResponse
//   POST   /api/projects/{project_id}/storyboard/scenes          → StoryboardSceneResponse
//   PATCH  /api/storyboard/scenes/{scene_id}                     → StoryboardSceneResponse
//   DELETE /api/storyboard/scenes/{scene_id}                     → 204
//
// Phase 1b — per-panel AI image generation (async, GPU-bound):
//   POST   /api/storyboard/panels/{panel_id}/image           → 202 PanelImageJobResponse
//   GET    /api/storyboard/panels/{panel_id}/image/{job_id}  → PanelImageJobResponse
// 202, not 200: an image is minutes of GPU work. The job record is TTL-bounded
// progress metadata living in Redis; the DURABLE result is the panel's own
// `media_ref` + `gen`, so a completed job must be followed by a panel refetch.
// The job's `media_ref.url` is the signature minted AT generation time and is
// NOT re-signed on poll — only the panel read path re-signs it, so no caller may
// cache a url off this response (the presign expires in an hour).
// Errors: 409 (stale `expected_lock_version`, or archived project — branch on the
// `detail`, not the status), 503 (no Redis on this deployment ⇒ the feature is
// unavailable, not broken), 404 on GET (job TTL expired, or the job belongs to a
// different panel — tenancy is re-checked against the PANEL, never the job).
//
// Phase 2 — version snapshots (whole-board restore points):
//   GET    /api/projects/{project_id}/storyboard/snapshots       → SnapshotListResponse
//   POST   /api/projects/{project_id}/storyboard/snapshots       → 201 StoryboardSnapshot
//   POST   /api/storyboard/snapshots/{snapshot_id}/restore       → RestoreResponse
//
// Phase 3 — branches (fork the board into a hidden child project, rework, merge):
//   GET    /api/projects/{project_id}/storyboard/branches        → BranchListResponse
//   POST   /api/projects/{project_id}/storyboard/branches        → 201 StoryboardBranch (409 if already a branch)
//   DELETE /api/storyboard/branches/{branch_id}                  → 204 (abandon: status→'abandoned', child archived)
//   GET  /api/projects/{pid}/storyboard/branches/{bid}/diff      → BranchDiffResponse
//   POST /api/projects/{pid}/storyboard/branches/{bid}/merge     → BranchMergeResponse
// The diff/merge pair ships with the orchestrator's merge service (sibling PR, not
// yet deployed) — callers must degrade gracefully on a 404.
//
// create/reorder/draft/list are project-scoped; update/delete/rewrite are
// keyed by the child id alone (tenant scoping is inherited from the parent
// project row server-side).

import type {
	StoryboardPanelCreate,
	StoryboardPanelUpdate,
	StoryboardPanelResponse,
	StoryboardPanelListResponse,
	StoryboardDraftRequest,
	StoryboardDraftResponse,
	PanelRewriteRequest,
	PanelImageRequest,
	PanelImageJobResponse,
	StoryboardAssetCreate,
	StoryboardAssetUpdate,
	StoryboardAssetResponse,
	StoryboardAssetListResponse,
	StoryboardSceneCreate,
	StoryboardSceneUpdate,
	StoryboardSceneResponse,
	StoryboardSceneListResponse,
	PanelEventListResponse,
	SnapshotListResponse,
	StoryboardSnapshot,
	RestoreResponse,
	BranchListResponse,
	StoryboardBranch,
	BranchDiffResponse,
	BranchMergeRequest,
	BranchMergeResponse,
	SiblingMergeRequest,
	SiblingMergeResponse
} from '$lib/types';
import { api } from './client.js';

/**
 * Optimistic-concurrency tokens for a MULTI-ROW write, `{ rowId: lock_version }`.
 *
 * ⚠️ WIRE FORMAT IS snake_case. The orchestrator's `_camel` ConfigDict is a
 * misnomer — `ConfigDict(populate_by_name=True, str_strip_whitespace=True)` with
 * NO `alias_generator` — so a camelCase key is silently IGNORED (pydantic's
 * default `extra="ignore"`), not rejected. Send `expected_lock_versions`.
 *
 * Deliberately NOT a generated type: the pinned OpenAPI package predates these
 * fields (the orchestrator half of this two-repo rollout ships second). Kept as a
 * local `Record` alias rather than a named response/request interface so it cannot
 * shadow a schema name later (`scripts/type-drift-check.ts`).
 */
type LockVersionMap = Record<string, number>;

/** `?expected_lock_version=<int>` when a token is known; empty string otherwise. */
function lockVersionQuery(expectedLockVersion?: number): string {
	return expectedLockVersion === undefined ? '' : `?expected_lock_version=${expectedLockVersion}`;
}

export const storyboard = {
	listPanels(projectId: string): Promise<StoryboardPanelListResponse> {
		return api.get<StoryboardPanelListResponse>(`/projects/${projectId}/storyboard/panels`);
	},

	createPanel(projectId: string, body: StoryboardPanelCreate): Promise<StoryboardPanelResponse> {
		return api.post<StoryboardPanelResponse>(`/projects/${projectId}/storyboard/panels`, body);
	},

	updatePanel(panelId: string, body: StoryboardPanelUpdate): Promise<StoryboardPanelResponse> {
		return api.patch<StoryboardPanelResponse>(`/storyboard/panels/${panelId}`, body);
	},

	// `expectedLockVersion` rides as the QUERY param `?expected_lock_version` (a
	// DELETE carries no body). Today's deployed backend ignores it; the sibling
	// orchestrator change makes it REQUIRED, which is why the frontend ships first.
	deletePanel(panelId: string, expectedLockVersion?: number): Promise<void> {
		return api.delete<void>(
			`/storyboard/panels/${panelId}${lockVersionQuery(expectedLockVersion)}`
		);
	},

	// Per-panel approval trail (orch d4a965f). approve/unapprove echo the updated
	// panel row (same shape as updatePanel); events is the append-only audit log.
	//
	// `expectedLockVersion` opts into the backend's compare-and-swap: when set it is
	// sent as snake_case `expected_lock_version` and the BE 409s ("panel was modified
	// concurrently") on a stale token. When undefined it is dropped by JSON.stringify
	// (last-write-wins). NB the archived-project case ALSO 409s but with a different
	// `detail`, so callers must branch on the detail string, not the status alone.
	approvePanel(
		panelId: string,
		note?: string,
		expectedLockVersion?: number
	): Promise<StoryboardPanelResponse> {
		return api.post<StoryboardPanelResponse>(`/storyboard/panels/${panelId}/approve`, {
			note,
			expected_lock_version: expectedLockVersion
		});
	},

	unapprovePanel(
		panelId: string,
		note?: string,
		expectedLockVersion?: number
	): Promise<StoryboardPanelResponse> {
		return api.post<StoryboardPanelResponse>(`/storyboard/panels/${panelId}/unapprove`, {
			note,
			expected_lock_version: expectedLockVersion
		});
	},

	listPanelEvents(panelId: string): Promise<PanelEventListResponse> {
		return api.get<PanelEventListResponse>(`/storyboard/panels/${panelId}/events`);
	},

	// `expectedLockVersions` maps EVERY panel id being reordered to its cached
	// `lock_version`; the backend compare-and-swaps the whole batch. The key is
	// omitted entirely (not sent as null) when the caller has no cache to read.
	reorderPanels(
		projectId: string,
		orderedPanelIds: string[],
		expectedLockVersions?: LockVersionMap
	): Promise<StoryboardPanelResponse[]> {
		// Reorder echoes the panels in their new order, each carrying a FRESH lock_version
		// (moved rows had their token advanced server-side). The store reconciles its cache
		// with this so a post-reorder edit doesn't 409 against a token the reorder bumped.
		return api.patch<StoryboardPanelResponse[]>(
			`/projects/${projectId}/storyboard/panels/reorder`,
			expectedLockVersions === undefined
				? { ordered_panel_ids: orderedPanelIds }
				: { ordered_panel_ids: orderedPanelIds, expected_lock_versions: expectedLockVersions }
		);
	},

	reorderScenes(
		projectId: string,
		orderedSceneIds: string[],
		expectedLockVersions?: LockVersionMap
	): Promise<StoryboardSceneResponse[]> {
		// Atomic bulk reorder (mirror of reorderPanels): one PATCH replaces the old
		// N sequential per-scene PATCHes, so a mid-sequence failure can no longer persist
		// a half-applied order. Echoes the scenes in new order with fresh lock_version.
		return api.patch<StoryboardSceneResponse[]>(
			`/projects/${projectId}/storyboard/scenes/reorder`,
			expectedLockVersions === undefined
				? { ordered_scene_ids: orderedSceneIds }
				: { ordered_scene_ids: orderedSceneIds, expected_lock_versions: expectedLockVersions }
		);
	},

	draftFromBrief(
		projectId: string,
		body: StoryboardDraftRequest
	): Promise<StoryboardDraftResponse> {
		return api.post<StoryboardDraftResponse>(`/projects/${projectId}/storyboard/draft`, body);
	},

	rewritePanel(panelId: string, body: PanelRewriteRequest): Promise<StoryboardPanelResponse> {
		return api.post<StoryboardPanelResponse>(`/storyboard/panels/${panelId}/rewrite`, body);
	},

	// Queue an image for one panel. Returns 202 + the job record immediately; the
	// caller polls `getPanelImageJob` (and/or watches the project SSE channel — the
	// panel carries no run_id, so `GET /api/projects/{id}/events` is the only stream).
	//
	// `expected_lock_version` is the same opt-in compare-and-swap as `updatePanel`:
	// send the panel's current token and the BE 409s if somebody else moved the row
	// out from under the generation. Every field of the body is optional (the prompt
	// and seed are composed server-side from the panel + its referenced assets), so
	// `undefined`s are dropped by JSON.stringify.
	generatePanelImage(panelId: string, body: PanelImageRequest): Promise<PanelImageJobResponse> {
		return api.post<PanelImageJobResponse>(`/storyboard/panels/${panelId}/image`, body);
	},

	// Poll one panel-image job. 404 = the job's TTL expired (or it belongs to another
	// panel) — it is NOT proof the generation failed, so callers must treat it as
	// "lost track of", not "idle".
	getPanelImageJob(panelId: string, jobId: string): Promise<PanelImageJobResponse> {
		return api.get<PanelImageJobResponse>(`/storyboard/panels/${panelId}/image/${jobId}`);
	},

	listAssets(projectId: string): Promise<StoryboardAssetListResponse> {
		return api.get<StoryboardAssetListResponse>(`/projects/${projectId}/storyboard/assets`);
	},

	createAsset(projectId: string, body: StoryboardAssetCreate): Promise<StoryboardAssetResponse> {
		return api.post<StoryboardAssetResponse>(`/projects/${projectId}/storyboard/assets`, body);
	},

	updateAsset(assetId: string, body: StoryboardAssetUpdate): Promise<StoryboardAssetResponse> {
		return api.patch<StoryboardAssetResponse>(`/storyboard/assets/${assetId}`, body);
	},

	deleteAsset(assetId: string, expectedLockVersion?: number): Promise<void> {
		return api.delete<void>(
			`/storyboard/assets/${assetId}${lockVersionQuery(expectedLockVersion)}`
		);
	},

	listScenes(projectId: string): Promise<StoryboardSceneListResponse> {
		return api.get<StoryboardSceneListResponse>(`/projects/${projectId}/storyboard/scenes`);
	},

	createScene(projectId: string, body: StoryboardSceneCreate): Promise<StoryboardSceneResponse> {
		return api.post<StoryboardSceneResponse>(`/projects/${projectId}/storyboard/scenes`, body);
	},

	updateScene(sceneId: string, body: StoryboardSceneUpdate): Promise<StoryboardSceneResponse> {
		return api.patch<StoryboardSceneResponse>(`/storyboard/scenes/${sceneId}`, body);
	},

	deleteScene(sceneId: string, expectedLockVersion?: number): Promise<void> {
		return api.delete<void>(
			`/storyboard/scenes/${sceneId}${lockVersionQuery(expectedLockVersion)}`
		);
	},

	// Version snapshots. create/list are project-scoped; restore + delete are keyed
	// by the snapshot id under the project (the project is inherited server-side).
	// A restore rewrites panels + scenes + assets server-side and mints a fresh
	// `auto` snapshot of the pre-restore board, so callers must refetch all three
	// caches AND the snapshot list afterwards.
	//
	// `list` is paginated: `limit` (default 20, 1..100) + `offset` (default 0) —
	// omitted when not provided so the BE applies its own defaults; the response
	// carries the REAL total (not the page length). `delete` is user-facing only:
	// the BE 409s on an `auto` snapshot (machine-managed), 404s on a missing/other-
	// project id.
	listSnapshots(
		projectId: string,
		opts?: { limit?: number; offset?: number }
	): Promise<SnapshotListResponse> {
		const params = new URLSearchParams();
		if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
		if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
		const qs = params.toString();
		return api.get<SnapshotListResponse>(
			`/projects/${projectId}/storyboard/snapshots${qs ? `?${qs}` : ''}`
		);
	},

	createSnapshot(projectId: string, note?: string): Promise<StoryboardSnapshot> {
		return api.post<StoryboardSnapshot>(`/projects/${projectId}/storyboard/snapshots`, {
			note: note ?? null
		});
	},

	// A restore rewrites the WHOLE board, so its token map covers every live scene,
	// panel AND asset in ONE FLAT map — uuid7 ids share a namespace, so there is no
	// bucketing by row type. This route previously sent no body at all.
	restoreSnapshot(
		snapshotId: string,
		expectedLockVersions?: LockVersionMap
	): Promise<RestoreResponse> {
		return api.post<RestoreResponse>(
			`/storyboard/snapshots/${snapshotId}/restore`,
			expectedLockVersions === undefined
				? undefined
				: { expected_lock_versions: expectedLockVersions }
		);
	},

	deleteSnapshot(projectId: string, snapshotId: string): Promise<void> {
		return api.delete<void>(`/projects/${projectId}/storyboard/snapshots/${snapshotId}`);
	},

	// Phase 3 — branches. A branch forks the whole board into a hidden child
	// project so an alternative cut can be reworked without destroying the current
	// one. `create` 409s when the project is ITSELF a branch (no branch-of-branch —
	// merge is branch→main only). `list` is paginated like snapshots and returns
	// the REAL total. `abandon` is a soft close (status → 'abandoned' + the child
	// project is archived), not a hard delete — hence DELETE returning the updated
	// row rather than 204.
	listBranches(
		projectId: string,
		opts?: { limit?: number; offset?: number }
	): Promise<BranchListResponse> {
		const params = new URLSearchParams();
		if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
		if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
		const qs = params.toString();
		return api.get<BranchListResponse>(
			`/projects/${projectId}/storyboard/branches${qs ? `?${qs}` : ''}`
		);
	},

	createBranch(projectId: string, name: string): Promise<StoryboardBranch> {
		return api.post<StoryboardBranch>(`/projects/${projectId}/storyboard/branches`, { name });
	},

	abandonBranch(branchId: string): Promise<void> {
		return api.delete<void>(`/storyboard/branches/${branchId}`);
	},

	// Merge review. `diff` is a THREE-WAY diff against the branch's base snapshot:
	// every entry carries the panel as it was at the fork (`base`), as the root has
	// it now (`main`) and as the branch has it (`branch`). Unlike the other branch
	// verbs these are project-scoped — the diff spans BOTH projects, so the root's
	// id is not inferable from the branch id alone.
	//
	// `root_fingerprint` is an optimistic-concurrency token for the root board:
	// echo the one the diff handed you back on merge, and the server 409s if the
	// root moved in the meantime (a 409 also covers a non-open branch). A 422 means
	// a conflict entry was left without a resolution — the UI must prevent that.
	diffBranch(projectId: string, branchId: string): Promise<BranchDiffResponse> {
		return api.get<BranchDiffResponse>(
			`/projects/${projectId}/storyboard/branches/${branchId}/diff`
		);
	},

	mergeBranch(
		projectId: string,
		branchId: string,
		body: BranchMergeRequest
	): Promise<BranchMergeResponse> {
		return api.post<BranchMergeResponse>(
			`/projects/${projectId}/storyboard/branches/${branchId}/merge`,
			body
		);
	},

	// Sibling merge review. Same THREE-WAY diff SHAPE as `diffBranch`, but against a SIBLING
	// branch instead of the root: `main` column = the TARGET sibling's board, `branch` = THIS
	// (source) branch's board, and `root_fingerprint` = the TARGET board's concurrency token
	// (echo it back to `mergeIntoBranch` as `target_fingerprint`). Errors: 404 (branch/target
	// gone), 409 (no shared base), 422 (not siblings).
	diffAgainstBranch(
		projectId: string,
		branchId: string,
		targetBranchId: string
	): Promise<BranchDiffResponse> {
		return api.get<BranchDiffResponse>(
			`/projects/${projectId}/storyboard/branches/${branchId}/diff-against/${targetBranchId}`
		);
	},

	// Merge THIS branch's board INTO a sibling branch. Both branches stay open; the target board
	// is auto-snapshotted first (reversible from Versions). A 409 means the target moved while the
	// diff was open (stale `target_fingerprint`); a 422 means an unresolved conflict.
	mergeIntoBranch(
		projectId: string,
		branchId: string,
		body: SiblingMergeRequest
	): Promise<SiblingMergeResponse> {
		return api.post<SiblingMergeResponse>(
			`/projects/${projectId}/storyboard/branches/${branchId}/merge-into`,
			body
		);
	}
};

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api', () => ({
	storyboard: {
		listPanels: vi.fn(),
		createPanel: vi.fn(),
		updatePanel: vi.fn(),
		approvePanel: vi.fn(),
		unapprovePanel: vi.fn(),
		deletePanel: vi.fn(),
		reorderPanels: vi.fn(),
		reorderScenes: vi.fn(),
		draftFromBrief: vi.fn(),
		rewritePanel: vi.fn(),
		generatePanelImage: vi.fn(),
		getPanelImageJob: vi.fn(),
		listAssets: vi.fn(),
		createAsset: vi.fn(),
		updateAsset: vi.fn(),
		deleteAsset: vi.fn(),
		listScenes: vi.fn(),
		createScene: vi.fn(),
		updateScene: vi.fn(),
		deleteScene: vi.fn(),
		listSnapshots: vi.fn(),
		createSnapshot: vi.fn(),
		restoreSnapshot: vi.fn(),
		deleteSnapshot: vi.fn()
	}
}));

import { storyboard as storyboardApi } from '$lib/api';
import { ApiError } from '$lib/api/client';
import type {
	StoryboardPanelListResponse,
	StoryboardPanelResponse,
	StoryboardAssetResponse,
	StoryboardAssetListResponse,
	StoryboardSceneResponse,
	StoryboardSceneListResponse,
	StoryboardSnapshot,
	PanelImageJobResponse
} from '$lib/types';
import {
	loadProject,
	getProjectList,
	isProjectLoading,
	createPanel,
	updatePanel,
	approvePanel,
	unapprovePanel,
	deletePanel,
	reorderPanels,
	invalidateAll,
	loadAssets,
	getAssetList,
	createAsset,
	updateAsset,
	deleteAsset,
	loadScenes,
	getSceneList,
	getPanelConflict,
	createScene,
	updateScene,
	deleteScene,
	getPanelsByScene,
	reorderScenes,
	draftFromBrief,
	rewritePanel,
	isPanelBusy,
	backfillFromBrief,
	loadSnapshots,
	getSnapshots,
	getSnapshotList,
	getSnapshotsPage,
	createSnapshot,
	restoreSnapshot,
	deleteSnapshot,
	panelImageState,
	startPanelImage,
	dismissPanelImage,
	recheckPanelImage,
	applyPanelImageEvent,
	PAGE_SIZE
} from './storyboard.svelte.js';

function panel(
	id: string,
	overrides: Partial<StoryboardPanelResponse> = {}
): StoryboardPanelResponse {
	return {
		id,
		project_id: 'proj-1',
		shot_key: `clip-${id}`,
		status: 'draft',
		revision: 1,
		media_ref: {},
		characters: [],
		props: [],
		...overrides
	} as StoryboardPanelResponse;
}

function list(...panels: StoryboardPanelResponse[]): StoryboardPanelListResponse {
	return { items: panels, total: panels.length };
}

function asset(
	id: string,
	overrides: Partial<StoryboardAssetResponse> = {}
): StoryboardAssetResponse {
	return {
		id,
		project_id: 'proj-1',
		kind: 'character',
		name: `asset-${id}`,
		reference_images: [],
		attributes: {},
		position: 0,
		lock_version: 0,
		created_at: '2026-07-12T00:00:00Z',
		updated_at: '2026-07-12T00:00:00Z',
		...overrides
	} as StoryboardAssetResponse;
}

function assetList(...assets: StoryboardAssetResponse[]): StoryboardAssetListResponse {
	return { items: assets, total: assets.length };
}

function scene(
	id: string,
	overrides: Partial<StoryboardSceneResponse> = {}
): StoryboardSceneResponse {
	return {
		id,
		project_id: 'proj-1',
		name: `scene-${id}`,
		position: 0,
		lock_version: 0,
		created_at: '2026-07-12T00:00:00Z',
		updated_at: '2026-07-12T00:00:00Z',
		...overrides
	} as StoryboardSceneResponse;
}

function sceneList(...scenes: StoryboardSceneResponse[]): StoryboardSceneListResponse {
	return { items: scenes, total: scenes.length };
}

function snapshot(id: string, overrides: Partial<StoryboardSnapshot> = {}): StoryboardSnapshot {
	return {
		id,
		kind: 'manual',
		note: null,
		actor_subject: null,
		created_at: '2026-07-12T00:00:00Z',
		...overrides
	};
}

describe('storyboard store', () => {
	beforeEach(() => {
		invalidateAll();
		vi.mocked(storyboardApi.listPanels).mockReset();
		vi.mocked(storyboardApi.createPanel).mockReset();
		vi.mocked(storyboardApi.updatePanel).mockReset();
		vi.mocked(storyboardApi.approvePanel).mockReset();
		vi.mocked(storyboardApi.unapprovePanel).mockReset();
		vi.mocked(storyboardApi.deletePanel).mockReset();
		vi.mocked(storyboardApi.reorderPanels).mockReset();
		vi.mocked(storyboardApi.draftFromBrief).mockReset();
		vi.mocked(storyboardApi.rewritePanel).mockReset();
		vi.mocked(storyboardApi.listAssets).mockReset();
		vi.mocked(storyboardApi.createAsset).mockReset();
		vi.mocked(storyboardApi.updateAsset).mockReset();
		vi.mocked(storyboardApi.deleteAsset).mockReset();
		vi.mocked(storyboardApi.listSnapshots).mockReset();
		vi.mocked(storyboardApi.createSnapshot).mockReset();
		vi.mocked(storyboardApi.restoreSnapshot).mockReset();
		vi.mocked(storyboardApi.deleteSnapshot).mockReset();
		vi.mocked(storyboardApi.listScenes).mockReset();
		vi.mocked(storyboardApi.createScene).mockReset();
		vi.mocked(storyboardApi.updateScene).mockReset();
		vi.mocked(storyboardApi.deleteScene).mockReset();
	});

	it('loadProject fetches and caches per project', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a'), panel('b')));
		await loadProject('proj-1');
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['a', 'b']);
		expect(getProjectList('proj-2')).toEqual([]);
	});

	it('isProjectLoading flips during loadProject', async () => {
		let resolve: (v: StoryboardPanelListResponse) => void = () => {};
		vi.mocked(storyboardApi.listPanels).mockReturnValueOnce(
			new Promise<StoryboardPanelListResponse>((r) => {
				resolve = r;
			})
		);
		const p = loadProject('proj-1');
		expect(isProjectLoading('proj-1')).toBe(true);
		resolve(list());
		await p;
		expect(isProjectLoading('proj-1')).toBe(false);
	});

	it('createPanel appends the created panel to the cache', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');
		vi.mocked(storyboardApi.createPanel).mockResolvedValueOnce(panel('b'));
		await createPanel('proj-1', { shot_key: 'clip-b' });
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['a', 'b']);
	});

	it('updatePanel replaces the row in place', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a'), panel('b')));
		await loadProject('proj-1');
		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(
			panel('a', { action_description: 'edited' })
		);
		await updatePanel('proj-1', 'a', { action_description: 'edited' });
		expect(getProjectList('proj-1').find((p) => p.id === 'a')?.action_description).toBe('edited');
	});

	// ── Optimistic concurrency (lock_version) ───────────────────────────────────

	it('updatePanel forwards expected_lock_version from the cached panel row', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 3 }))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(
			panel('a', { action_description: 'edited', lock_version: 4 })
		);
		await updatePanel('proj-1', 'a', { action_description: 'edited' });
		expect(vi.mocked(storyboardApi.updatePanel).mock.calls[0][1]).toMatchObject({
			action_description: 'edited',
			expected_lock_version: 3
		});
	});

	it('updatePanel omits expected_lock_version when the panel is not cached', async () => {
		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(panel('z', { lock_version: 1 }));
		await updatePanel('proj-x', 'z', { action_description: 'edited' });
		const body = vi.mocked(storyboardApi.updatePanel).mock.calls[0][1];
		expect(body.expected_lock_version).toBeUndefined();
	});

	it('updatePanel refetches and rethrows on a concurrent 409 (no false success)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.updatePanel).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'panel was modified concurrently')
		);
		// The post-conflict loadProject refetch.
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 9 }))
		);
		await expect(updatePanel('proj-1', 'a', { action_description: 'x' })).rejects.toBeInstanceOf(
			ApiError
		);
		// Initial load + post-409 refetch = 2.
		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(2);
		// Cache holds the refetched row, not a claimed-success edit.
		expect(getProjectList('proj-1').find((p) => p.id === 'a')?.lock_version).toBe(9);
	});

	it('updatePanel rethrows an archived-project 409 via the generic path (no refetch)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.updatePanel).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'project is archived and read-only')
		);
		await expect(updatePanel('proj-1', 'a', { action_description: 'x' })).rejects.toBeInstanceOf(
			ApiError
		);
		// Only the initial load — the archived-409 must NOT trigger a refetch.
		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(1);
	});

	it('approvePanel and unapprovePanel forward the cached lock_version', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 5 }))
		);
		await loadProject('proj-1');

		vi.mocked(storyboardApi.approvePanel).mockResolvedValueOnce(
			panel('a', { status: 'approved', lock_version: 6 })
		);
		await approvePanel('a', 'lgtm');
		expect(vi.mocked(storyboardApi.approvePanel).mock.calls[0]).toEqual(['a', 'lgtm', 5]);

		// replacePanelRow bumped the cache to lock_version 6, so unapprove sends 6.
		vi.mocked(storyboardApi.unapprovePanel).mockResolvedValueOnce(
			panel('a', { status: 'draft', lock_version: 7 })
		);
		await unapprovePanel('a', 'redo');
		expect(vi.mocked(storyboardApi.unapprovePanel).mock.calls[0]).toEqual(['a', 'redo', 6]);
	});

	it('approvePanel refetches and returns null on a concurrent 409', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.approvePanel).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'panel was modified concurrently')
		);
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 9 }))
		);
		const result = await approvePanel('a', 'lgtm');
		expect(result).toBeNull();
		// Initial load + post-409 refetch = 2.
		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(2);
		expect(getProjectList('proj-1').find((p) => p.id === 'a')?.lock_version).toBe(9);
	});

	it('approvePanel surfaces an archived-project 409 generically (return null, no refetch)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.approvePanel).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'project is archived and read-only')
		);
		const result = await approvePanel('a');
		expect(result).toBeNull();
		// Archived-409 must NOT refetch.
		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(1);
	});

	// ── A failed flush of queued keystroke PATCHes must ABORT, not just report ──
	//
	// `runPanelWrites` routes a write error to that write's own waiters and then
	// RESOLVES its drain promise, so `drainPanelWrites` never rejects. Approve /
	// unapprove / rewrite therefore have to ask whether the drain they waited on
	// actually failed — otherwise approve stamps a server row for a panel that
	// never received the user's edit, and rewrite runs the LLM over stale text.

	/** Let every pending microtask (and macrotask) settle. */
	const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

	/**
	 * Arm the next `updatePanel` mock with a request that hangs until `fail()`, then
	 * intend the write. `intend` runs the store call, which is a separate step because
	 * the deferred-enqueue path only calls the mock much later.
	 */
	function pendingWrite(
		panelId: string,
		text = 'typed but unsaved'
	): {
		write: Promise<StoryboardPanelResponse>;
		fail: (e?: unknown) => void;
	} {
		let reject: (e: unknown) => void = () => {};
		const inflight = new Promise<StoryboardPanelResponse>((_, r) => {
			reject = r;
		});
		// Never let the armed-but-unconsumed promise look like an unhandled rejection.
		inflight.catch(() => {});
		vi.mocked(storyboardApi.updatePanel).mockReturnValueOnce(inflight);
		const write = updatePanel('proj-1', panelId, { action_description: text });
		return {
			write,
			fail: (e: unknown = new ApiError(500, 'Server Error', 'patch blew up')) => reject(e)
		};
	}

	it('approvePanel aborts when the queued PATCH flush fails', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');

		const { write, fail } = pendingWrite('a');
		const approving = approvePanel('a', 'lgtm');
		fail();
		await expect(write).rejects.toBeInstanceOf(ApiError);

		expect(await approving).toBeNull();
		expect(storyboardApi.approvePanel).not.toHaveBeenCalled();
	});

	it('unapprovePanel aborts when the queued PATCH flush fails', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { status: 'approved' }))
		);
		await loadProject('proj-1');

		const { write, fail } = pendingWrite('a');
		const unapproving = unapprovePanel('a', 'redo');
		fail();
		await expect(write).rejects.toBeInstanceOf(ApiError);

		expect(await unapproving).toBeNull();
		expect(storyboardApi.unapprovePanel).not.toHaveBeenCalled();
	});

	it('rewritePanel aborts (and clears busy) when the queued PATCH flush fails', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');

		const { write, fail } = pendingWrite('a');
		const rewriting = rewritePanel('proj-1', 'a', 'punch it up');
		fail();
		await expect(write).rejects.toBeInstanceOf(ApiError);

		await expect(rewriting).rejects.toBeInstanceOf(ApiError);
		// The LLM must not run over the pre-edit text...
		expect(storyboardApi.rewritePanel).not.toHaveBeenCalled();
		// ...and the card must not be left spinning forever.
		expect(isPanelBusy('a')).toBe(false);
	});

	it('a drain failure does not poison the NEXT approve on the same panel', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');

		const { write, fail } = pendingWrite('a');
		const aborted = approvePanel('a');
		fail();
		await expect(write).rejects.toBeInstanceOf(ApiError);
		expect(await aborted).toBeNull();

		// Nothing queued now: the stale error must not veto a fresh approve.
		vi.mocked(storyboardApi.approvePanel).mockResolvedValueOnce(
			panel('a', { status: 'approved', lock_version: 3 })
		);
		const row = await approvePanel('a');
		expect(row?.status).toBe('approved');
		expect(storyboardApi.approvePanel).toHaveBeenCalledTimes(1);
	});

	// ...but ONLY when the latest edit genuinely failed. The three cases below are
	// routine traffic, and aborting on any of them would be a regression.

	it('approvePanel still proceeds when the queued PATCH lost a CAS (already recovered)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');

		const { write, fail } = pendingWrite('a');
		const approving = approvePanel('a');
		// The CAS-conflict path OWNS this failure: it reloads the board to server truth
		// and posts its own notice. Approving that reloaded row is coherent — vetoing it
		// would give the user two contradictory toasts and a refused approve.
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 9 }))
		);
		vi.mocked(storyboardApi.approvePanel).mockResolvedValueOnce(
			panel('a', { status: 'approved', lock_version: 10 })
		);
		fail(new ApiError(409, 'Conflict', 'panel was modified concurrently'));
		await expect(write).rejects.toBeInstanceOf(ApiError);

		expect((await approving)?.status).toBe('approved');
		expect(getPanelConflict('proj-1')).toBeDefined();
		// ...and against the RELOADED token, not the stale one.
		expect(vi.mocked(storyboardApi.approvePanel).mock.calls[0]).toEqual(['a', undefined, 9]);
	});

	it('approvePanel proceeds when a failed write was superseded by one that landed', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 2 }))
		);
		await loadProject('proj-1');

		// W1 is dispatched and fails; W2 queues behind it in the SAME drain run and lands.
		const { write: w1, fail } = pendingWrite('a', 'one');
		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(
			panel('a', { action_description: 'two', lock_version: 3 })
		);
		const w2 = updatePanel('proj-1', 'a', { action_description: 'two' });
		// The question is "did the LATEST edit land", not "did any write in the run fail".
		vi.mocked(storyboardApi.approvePanel).mockResolvedValueOnce(
			panel('a', { status: 'approved', lock_version: 4 })
		);
		const approving = approvePanel('a');
		fail();
		await expect(w1).rejects.toBeInstanceOf(ApiError);
		await expect(w2).resolves.toBeDefined();

		expect((await approving)?.status).toBe('approved');
		expect(storyboardApi.approvePanel).toHaveBeenCalledTimes(1);
	});

	it('approvePanel aborts on an edit deferred behind an in-flight rewrite', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');

		let finishRewrite: (v: StoryboardPanelResponse) => void = () => {};
		vi.mocked(storyboardApi.rewritePanel).mockReturnValueOnce(
			new Promise<StoryboardPanelResponse>((r) => {
				finishRewrite = r;
			})
		);
		const rewriting = rewritePanel('proj-1', 'a', 'punch it up');

		// The card's text fields are gated on `disabled`, not `busy`, so the user really
		// can type here. `updatePanel` DEFERS this write — it is in neither `queued` nor
		// `draining`, which is exactly the window a queue-membership check misses.
		const { write, fail } = pendingWrite('a');
		const approving = approvePanel('a');

		finishRewrite(panel('a', { action_description: 'ai text' }));
		await rewriting;
		await flush(); // let the deferred write enqueue and dispatch
		fail();
		await expect(write).rejects.toBeInstanceOf(ApiError);

		expect(await approving).toBeNull();
		expect(storyboardApi.approvePanel).not.toHaveBeenCalled();
	});

	it('rewritePanel does not wait on a write deferred behind ITSELF (no deadlock)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');

		let finishRewrite: (v: StoryboardPanelResponse) => void = () => {};
		vi.mocked(storyboardApi.rewritePanel).mockReturnValueOnce(
			new Promise<StoryboardPanelResponse>((r) => {
				finishRewrite = r;
			})
		);
		const rewriting = rewritePanel('proj-1', 'a', 'punch it up');
		// Deferred behind the rewrite: it can only settle AFTER the rewrite does, so a
		// rewrite that waited on it would deadlock.
		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(panel('a', { lock_version: 9 }));
		const write = updatePanel('proj-1', 'a', { action_description: 'typed mid-rewrite' });

		finishRewrite(panel('a', { action_description: 'ai text' }));
		await expect(rewriting).resolves.toBeDefined();
		await expect(write).resolves.toBeDefined();
		expect(storyboardApi.rewritePanel).toHaveBeenCalledTimes(1);
	});

	it('deletePanel removes the row', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a'), panel('b')));
		await loadProject('proj-1');
		vi.mocked(storyboardApi.deletePanel).mockResolvedValueOnce(undefined);
		await deletePanel('proj-1', 'a');
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['b']);
	});

	it('reorderPanels applies the new order optimistically', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a'), panel('b'), panel('c'))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.reorderPanels).mockResolvedValueOnce([
			panel('c'),
			panel('a'),
			panel('b')
		]);
		await reorderPanels('proj-1', ['c', 'a', 'b']);
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['c', 'a', 'b']);
	});

	it('reorderPanels reconciles cached lock_version from the response (fresh tokens)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 0 }), panel('b', { lock_version: 0 }))
		);
		await loadProject('proj-1');
		// Server moved both rows, so both tokens were bumped and echoed back.
		vi.mocked(storyboardApi.reorderPanels).mockResolvedValueOnce([
			panel('b', { lock_version: 1 }),
			panel('a', { lock_version: 1 })
		]);
		await reorderPanels('proj-1', ['b', 'a']);
		expect(getProjectList('proj-1').map((p) => [p.id, p.lock_version])).toEqual([
			['b', 1],
			['a', 1]
		]);
	});

	it('an edit after a reorder sends the FRESH post-reorder lock_version (no stale 409)', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 0 }), panel('b', { lock_version: 0 }))
		);
		await loadProject('proj-1');
		// Reorder bumps A's token to 1 and echoes it; the cache must reconcile.
		vi.mocked(storyboardApi.reorderPanels).mockResolvedValueOnce([
			panel('b', { lock_version: 1 }),
			panel('a', { lock_version: 1 })
		]);
		await reorderPanels('proj-1', ['b', 'a']);

		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(
			panel('a', { action_description: 'edited', lock_version: 2 })
		);
		await updatePanel('proj-1', 'a', { action_description: 'edited' });
		// Without the reconciliation this would send the stale 0 and 409 against the reorder.
		expect(vi.mocked(storyboardApi.updatePanel).mock.calls[0][1]).toMatchObject({
			expected_lock_version: 1
		});
	});

	it('reorderPanels reverts to the original order and rethrows on ApiError', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a'), panel('b'), panel('c'))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.reorderPanels).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'stale order')
		);
		await expect(reorderPanels('proj-1', ['c', 'a', 'b'])).rejects.toBeInstanceOf(ApiError);
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['a', 'b', 'c']);
	});

	// ── Assets ────────────────────────────────────────────────────────────────

	it('loadAssets fetches and caches per project', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(assetList(asset('a'), asset('b')));
		expect(await loadAssets('proj-1')).toHaveLength(2);
		expect(getAssetList('proj-1').map((a) => a.id)).toEqual(['a', 'b']);
		expect(getAssetList('proj-2')).toEqual([]);
	});

	it('createAsset appends to the cache', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(assetList(asset('a')));
		await loadAssets('proj-1');
		vi.mocked(storyboardApi.createAsset).mockResolvedValueOnce(asset('b'));
		await createAsset('proj-1', { kind: 'character', name: 'b' });
		expect(getAssetList('proj-1').map((a) => a.id)).toEqual(['a', 'b']);
	});

	it('updateAsset replaces the row in place', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(assetList(asset('a'), asset('b')));
		await loadAssets('proj-1');
		vi.mocked(storyboardApi.updateAsset).mockResolvedValueOnce(asset('a', { name: 'renamed' }));
		await updateAsset('proj-1', 'a', { name: 'renamed' });
		expect(getAssetList('proj-1').find((a) => a.id === 'a')?.name).toBe('renamed');
	});

	it('deleteAsset removes the row', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(assetList(asset('a'), asset('b')));
		await loadAssets('proj-1');
		vi.mocked(storyboardApi.deleteAsset).mockResolvedValueOnce(undefined);
		await deleteAsset('proj-1', 'a');
		expect(getAssetList('proj-1').map((a) => a.id)).toEqual(['b']);
	});

	// ── Scenes ────────────────────────────────────────────────────────────────

	it('loadScenes fetches and caches per project', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(sceneList(scene('a'), scene('b')));
		expect(await loadScenes('proj-1')).toHaveLength(2);
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['a', 'b']);
		expect(getSceneList('proj-2')).toEqual([]);
	});

	it('createScene appends to the cache', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(sceneList(scene('a')));
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.createScene).mockResolvedValueOnce(scene('b'));
		await createScene('proj-1', { name: 'b' });
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['a', 'b']);
	});

	it('updateScene replaces the row in place', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(sceneList(scene('a'), scene('b')));
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.updateScene).mockResolvedValueOnce(scene('a', { location: 'Rooftop' }));
		await updateScene('proj-1', 'a', { location: 'Rooftop' });
		expect(getSceneList('proj-1').find((s) => s.id === 'a')?.location).toBe('Rooftop');
	});

	it('deleteScene removes the row', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(sceneList(scene('a'), scene('b')));
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.deleteScene).mockResolvedValueOnce(undefined);
		await deleteScene('proj-1', 'a');
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['b']);
	});

	it('reorderScenes applies the new order optimistically via ONE bulk call', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(
				scene('a', { position: 0 }),
				scene('b', { position: 1 }),
				scene('c', { position: 2 })
			)
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.reorderScenes).mockResolvedValueOnce([
			scene('c', { position: 0 }),
			scene('a', { position: 1 }),
			scene('b', { position: 2 })
		]);
		await reorderScenes('proj-1', ['c', 'a', 'b']);
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['c', 'a', 'b']);
		expect(getSceneList('proj-1').map((s) => s.position)).toEqual([0, 1, 2]);
		// ONE atomic bulk PATCH, not N per-scene writes (no partial-failure window).
		expect(storyboardApi.reorderScenes).toHaveBeenCalledTimes(1);
		expect(vi.mocked(storyboardApi.reorderScenes).mock.calls[0]).toEqual([
			'proj-1',
			['c', 'a', 'b'],
			// Compare-and-swap tokens for the whole batch (see the lock-version suite).
			{ a: 0, b: 0, c: 0 }
		]);
		expect(storyboardApi.updateScene).not.toHaveBeenCalled();
	});

	it('reorderScenes reconciles cached lock_version from the response', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(
				scene('a', { position: 0, lock_version: 0 }),
				scene('b', { position: 1, lock_version: 0 })
			)
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.reorderScenes).mockResolvedValueOnce([
			scene('b', { position: 0, lock_version: 1 }),
			scene('a', { position: 1, lock_version: 1 })
		]);
		await reorderScenes('proj-1', ['b', 'a']);
		expect(getSceneList('proj-1').map((s) => [s.id, s.lock_version])).toEqual([
			['b', 1],
			['a', 1]
		]);
	});

	it('reorderScenes reverts to the snapshot and rethrows on ApiError', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(
				scene('a', { position: 0 }),
				scene('b', { position: 1 }),
				scene('c', { position: 2 })
			)
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.reorderScenes).mockRejectedValueOnce(
			new ApiError(400, 'Bad Request', 'invalid scene id in ordering')
		);
		await expect(reorderScenes('proj-1', ['c', 'a', 'b'])).rejects.toBeInstanceOf(ApiError);
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['a', 'b', 'c']);
		expect(getSceneList('proj-1').map((s) => s.position)).toEqual([0, 1, 2]);
	});

	// ── Scene/asset optimistic concurrency (lock_version) ───────────────────────
	it('updateScene forwards expected_lock_version from the cached scene row', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('a', { lock_version: 5 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.updateScene).mockResolvedValueOnce(
			scene('a', { name: 'renamed', lock_version: 6 })
		);
		await updateScene('proj-1', 'a', { name: 'renamed' });
		expect(vi.mocked(storyboardApi.updateScene).mock.calls[0][1]).toMatchObject({
			name: 'renamed',
			expected_lock_version: 5
		});
		expect(getSceneList('proj-1').find((s) => s.id === 'a')?.lock_version).toBe(6);
	});

	it('updateScene omits expected_lock_version when the scene is not cached', async () => {
		vi.mocked(storyboardApi.updateScene).mockResolvedValueOnce(scene('z', { lock_version: 1 }));
		await updateScene('proj-x', 'z', { name: 'edited' });
		expect(
			vi.mocked(storyboardApi.updateScene).mock.calls[0][1].expected_lock_version
		).toBeUndefined();
	});

	it('updateScene refetches scenes, notes the conflict, and rethrows on a concurrent 409', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('a', { lock_version: 2 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.updateScene).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'scene was modified concurrently')
		);
		// The post-conflict loadScenes refetch shows the other editor's row.
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('a', { lock_version: 9 }))
		);
		await expect(updateScene('proj-1', 'a', { name: 'x' })).rejects.toBeInstanceOf(ApiError);
		expect(storyboardApi.listScenes).toHaveBeenCalledTimes(2);
		expect(getSceneList('proj-1').find((s) => s.id === 'a')?.lock_version).toBe(9);
		expect(getPanelConflict('proj-1')).toContain('scene was changed by someone else');
	});

	it('updateScene rethrows an archived-project 409 without a refetch', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('a', { lock_version: 2 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.updateScene).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'project is archived and read-only')
		);
		await expect(updateScene('proj-1', 'a', { name: 'x' })).rejects.toBeInstanceOf(ApiError);
		expect(storyboardApi.listScenes).toHaveBeenCalledTimes(1);
	});

	it('updateAsset forwards expected_lock_version from the cached asset row', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(
			assetList(asset('a', { lock_version: 4 }))
		);
		await loadAssets('proj-1');
		vi.mocked(storyboardApi.updateAsset).mockResolvedValueOnce(
			asset('a', { canonical_descriptor: 'tall', lock_version: 5 })
		);
		await updateAsset('proj-1', 'a', { canonical_descriptor: 'tall' });
		expect(vi.mocked(storyboardApi.updateAsset).mock.calls[0][1]).toMatchObject({
			canonical_descriptor: 'tall',
			expected_lock_version: 4
		});
		expect(getAssetList('proj-1').find((a) => a.id === 'a')?.lock_version).toBe(5);
	});

	it('updateAsset refetches assets, notes the conflict, and rethrows on a concurrent 409', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(
			assetList(asset('a', { lock_version: 2 }))
		);
		await loadAssets('proj-1');
		vi.mocked(storyboardApi.updateAsset).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'asset was modified concurrently')
		);
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(
			assetList(asset('a', { lock_version: 9 }))
		);
		await expect(updateAsset('proj-1', 'a', { name: 'x' })).rejects.toBeInstanceOf(ApiError);
		expect(storyboardApi.listAssets).toHaveBeenCalledTimes(2);
		expect(getAssetList('proj-1').find((a) => a.id === 'a')?.lock_version).toBe(9);
		expect(getPanelConflict('proj-1')).toContain('asset was changed by someone else');
	});

	it('getPanelsByScene groups panels by scene_id (sorted scenes + null bucket)', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('s2', { position: 1 }), scene('s1', { position: 0 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(
				panel('p1', { scene_id: 's1' }),
				panel('p2', { scene_id: 's2' }),
				panel('p3', { scene_id: 's1' }),
				panel('p4', { scene_id: null })
			)
		);
		await loadProject('proj-1');
		const { scenes, groups } = getPanelsByScene('proj-1');
		// Scenes ascending by position.
		expect(scenes.map((s) => s.id)).toEqual(['s1', 's2']);
		expect(groups.get('s1')?.map((p) => p.id)).toEqual(['p1', 'p3']);
		expect(groups.get('s2')?.map((p) => p.id)).toEqual(['p2']);
		expect(groups.get(null)?.map((p) => p.id)).toEqual(['p4']);
	});

	it('getPanelsByScene gives every scene an entry and an always-present null bucket', () => {
		const { scenes, groups } = getPanelsByScene('proj-empty');
		expect(scenes).toEqual([]);
		expect(groups.get(null)).toEqual([]);
	});

	it('getPanelsByScene keeps an empty (present) lane for a scene with zero panels', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('s1', { position: 0 }), scene('s2', { position: 1 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('p1', { scene_id: 's1' }))
		);
		await loadProject('proj-1');
		const { groups } = getPanelsByScene('proj-1');
		// s2 has no panels but still yields an entry (empty-lane branch).
		expect(groups.has('s2')).toBe(true);
		expect(groups.get('s2')).toEqual([]);
	});

	it('getPanelsByScene folds an orphan panel (scene_id → missing scene) into the null bucket', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('s1', { position: 0 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('p1', { scene_id: 's1' }), panel('orphan', { scene_id: 's-deleted' }))
		);
		await loadProject('proj-1');
		const { groups } = getPanelsByScene('proj-1');
		// Orphan is not dropped and does not spawn a new key: it lands in the null bucket.
		expect(groups.get(null)?.map((p) => p.id)).toEqual(['orphan']);
		expect(groups.has('s-deleted')).toBe(false);
		// Only the s1 lane + the null bucket exist.
		expect(groups.size).toBe(2);
	});

	// ── draftFromBrief / rewritePanel / backfillFromBrief ───────────────────────

	it('draftFromBrief replaces the panel, asset, and scene caches', async () => {
		vi.mocked(storyboardApi.draftFromBrief).mockResolvedValueOnce({
			panels: [panel('p1'), panel('p2')],
			assets: [asset('a1')],
			scenes: [scene('s1'), scene('s2'), scene('s3')]
		});
		const resp = await draftFromBrief('proj-1', {} as never);
		expect(resp.panels).toHaveLength(2);
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['p1', 'p2']);
		expect(getAssetList('proj-1').map((a) => a.id)).toEqual(['a1']);
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['s1', 's2', 's3']);
	});

	it('rewritePanel toggles busy for the duration and patches the one panel', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a'), panel('b')));
		await loadProject('proj-1');
		let resolve: (v: StoryboardPanelResponse) => void = () => {};
		vi.mocked(storyboardApi.rewritePanel).mockReturnValueOnce(
			new Promise<StoryboardPanelResponse>((r) => {
				resolve = r;
			})
		);
		expect(isPanelBusy('a')).toBe(false);
		const p = rewritePanel('proj-1', 'a', 'punch it up');
		expect(isPanelBusy('a')).toBe(true);
		expect(isPanelBusy('b')).toBe(false);
		resolve(panel('a', { action_description: 'rewritten' }));
		await p;
		expect(isPanelBusy('a')).toBe(false);
		expect(getProjectList('proj-1').find((p) => p.id === 'a')?.action_description).toBe(
			'rewritten'
		);
		expect(getProjectList('proj-1').find((p) => p.id === 'b')?.action_description).toBeUndefined();
	});

	it('rewritePanel clears busy even when the call rejects', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');
		vi.mocked(storyboardApi.rewritePanel).mockRejectedValueOnce(new ApiError(500, 'boom', 'boom'));
		await expect(rewritePanel('proj-1', 'a', 'x')).rejects.toBeInstanceOf(ApiError);
		expect(isPanelBusy('a')).toBe(false);
	});

	it('backfillFromBrief posts each panel then reloads when the cache is empty', async () => {
		vi.mocked(storyboardApi.createPanel)
			.mockResolvedValueOnce(panel('a'))
			.mockResolvedValueOnce(panel('b'));
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a'), panel('b')));
		await backfillFromBrief('proj-1', [{ shot_key: 'clip-1' }, { shot_key: 'clip-2' }]);
		expect(storyboardApi.createPanel).toHaveBeenCalledTimes(2);
		expect(vi.mocked(storyboardApi.createPanel).mock.calls[0][1]).toEqual({ shot_key: 'clip-1' });
		expect(vi.mocked(storyboardApi.createPanel).mock.calls[1][1]).toEqual({ shot_key: 'clip-2' });
		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(1);
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['a', 'b']);
	});

	it('backfillFromBrief is a no-op when panels already exist', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');
		await backfillFromBrief('proj-1', [{ shot_key: 'clip-1' }]);
		expect(storyboardApi.createPanel).not.toHaveBeenCalled();
	});

	// ── Version snapshots ────────────────────────────────────────────────────

	it('loadSnapshots caches the list and getSnapshotList returns it newest-first', async () => {
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({
			items: [
				snapshot('old', { created_at: '2026-07-01T00:00:00Z' }),
				snapshot('new', { created_at: '2026-07-10T00:00:00Z' })
			],
			total: 2
		});
		await loadSnapshots('proj-1');
		expect(getSnapshotList('proj-1').map((s) => s.id)).toEqual(['new', 'old']);
	});

	it('createSnapshot refreshes the snapshot list from the server', async () => {
		vi.mocked(storyboardApi.createSnapshot).mockResolvedValueOnce(snapshot('s1'));
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({
			items: [snapshot('s1', { note: 'checkpoint' })],
			total: 1
		});

		const created = await createSnapshot('proj-1', 'checkpoint');

		expect(storyboardApi.createSnapshot).toHaveBeenCalledWith('proj-1', 'checkpoint');
		expect(created.id).toBe('s1');
		expect(getSnapshotList('proj-1').map((s) => s.id)).toEqual(['s1']);
	});

	// REGRESSION GUARD (stale-board bug): a restore is a server-side bulk rewrite
	// of panels AND scenes AND assets. If the store only refetches panels, the
	// board keeps rendering the pre-restore scenes/assets. All three must refresh,
	// plus the snapshot list (a restore mints a new `auto` snapshot).
	it('restoreSnapshot refreshes panels AND assets AND scenes AND the snapshot list', async () => {
		vi.mocked(storyboardApi.restoreSnapshot).mockResolvedValueOnce({
			restored_snapshot_id: 's1',
			auto_snapshot_id: 'auto-1'
		});
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('p-restored')));
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(assetList(asset('a-restored')));
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(sceneList(scene('s-restored')));
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({
			items: [snapshot('auto-1', { kind: 'auto' }), snapshot('s1')],
			total: 2
		});

		const resp = await restoreSnapshot('proj-1', 's1');

		// No board rows were cached in this scenario, so the whole-board token map is
		// omitted rather than sent empty (see the lock-version suite at the bottom).
		expect(storyboardApi.restoreSnapshot).toHaveBeenCalledWith('s1', undefined);
		expect(resp.auto_snapshot_id).toBe('auto-1');

		// The four refreshes — the whole point of the action.
		expect(storyboardApi.listPanels).toHaveBeenCalledWith('proj-1');
		expect(storyboardApi.listAssets).toHaveBeenCalledWith('proj-1');
		expect(storyboardApi.listScenes).toHaveBeenCalledWith('proj-1');
		expect(storyboardApi.listSnapshots).toHaveBeenCalledWith('proj-1');

		// …and the caches actually hold the restored board, not the stale one.
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['p-restored']);
		expect(getAssetList('proj-1').map((a) => a.id)).toEqual(['a-restored']);
		expect(getSceneList('proj-1').map((s) => s.id)).toEqual(['s-restored']);
		expect(getSnapshotList('proj-1').map((s) => s.id)).toEqual(['auto-1', 's1']);
	});

	it('restoreSnapshot does not touch the caches when the restore fails', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(list(panel('a')));
		await loadProject('proj-1');
		vi.mocked(storyboardApi.restoreSnapshot).mockRejectedValueOnce(
			new ApiError(404, 'Not Found', 'No such snapshot')
		);

		await expect(restoreSnapshot('proj-1', 'missing')).rejects.toThrow();

		expect(storyboardApi.listAssets).not.toHaveBeenCalled();
		expect(storyboardApi.listScenes).not.toHaveBeenCalled();
		expect(getProjectList('proj-1').map((p) => p.id)).toEqual(['a']);
	});

	it('loadSnapshots threads limit + offset, stores the real total, and tracks the page', async () => {
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({
			items: [snapshot('s21'), snapshot('s22')],
			total: 45
		});

		await loadSnapshots('proj-1', { limit: PAGE_SIZE, offset: 40 });

		expect(storyboardApi.listSnapshots).toHaveBeenCalledWith('proj-1', {
			limit: PAGE_SIZE,
			offset: 40
		});
		// The server total (45), not the page length (2), is what the pager reads.
		expect(getSnapshots('proj-1')?.total).toBe(45);
		// offset 40 / PAGE_SIZE 20 → page 3.
		expect(getSnapshotsPage('proj-1')).toBe(3);
	});

	it('loadSnapshots defaults to page 1 when called bare (no query args forwarded)', async () => {
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({ items: [], total: 0 });
		await loadSnapshots('proj-1');
		// A bare load forwards a single arg so the BE applies its own defaults.
		expect(storyboardApi.listSnapshots).toHaveBeenCalledWith('proj-1');
		expect(getSnapshotsPage('proj-1')).toBe(1);
	});

	it('deleteSnapshot deletes then refetches the current page', async () => {
		// Seed the store on page 3 (offset 40).
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({
			items: [snapshot('a'), snapshot('b')],
			total: 42
		});
		await loadSnapshots('proj-1', { limit: PAGE_SIZE, offset: 40 });

		vi.mocked(storyboardApi.deleteSnapshot).mockResolvedValueOnce(undefined);
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValueOnce({
			items: [snapshot('a')],
			total: 41
		});

		await deleteSnapshot('proj-1', 'b');

		expect(storyboardApi.deleteSnapshot).toHaveBeenCalledWith('proj-1', 'b');
		// Refetch stays on the same page (offset 40), not page 1.
		expect(storyboardApi.listSnapshots).toHaveBeenLastCalledWith('proj-1', {
			limit: PAGE_SIZE,
			offset: 40
		});
		expect(getSnapshotList('proj-1').map((s) => s.id)).toEqual(['a']);
		expect(getSnapshots('proj-1')?.total).toBe(41);
	});

	it('deleteSnapshot surfaces a 409 (auto snapshot) without refetching', async () => {
		vi.mocked(storyboardApi.deleteSnapshot).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'auto snapshots cannot be deleted')
		);

		await expect(deleteSnapshot('proj-1', 'auto-1')).rejects.toBeInstanceOf(ApiError);
		expect(storyboardApi.listSnapshots).not.toHaveBeenCalled();
	});

	it('backfillFromBrief is a no-op when there are no brief panels', async () => {
		await backfillFromBrief('proj-1', []);
		expect(storyboardApi.createPanel).not.toHaveBeenCalled();
	});
});

// ── Per-panel AI image generation ───────────────────────────────────────────

function job(overrides: Partial<PanelImageJobResponse> = {}): PanelImageJobResponse {
	return {
		job_id: 'job-1',
		panel_id: 'p1',
		project_id: 'proj-1',
		status: 'queued',
		...overrides
	};
}

describe('storyboard store — panel image jobs', () => {
	beforeEach(() => {
		// Also cancels any poll timer armed by a previous test.
		invalidateAll();
		vi.mocked(storyboardApi.listPanels).mockReset();
		vi.mocked(storyboardApi.generatePanelImage).mockReset();
		vi.mocked(storyboardApi.getPanelImageJob).mockReset();
	});

	async function seedPanel(lockVersion: number): Promise<void> {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('p1', { lock_version: lockVersion }))
		);
		await loadProject('proj-1');
	}

	it('sends the cached lock_version as the compare-and-swap token', async () => {
		await seedPanel(7);
		vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job());

		await startPanelImage('proj-1', 'p1', { seed: 42 });

		expect(storyboardApi.generatePanelImage).toHaveBeenCalledWith('p1', {
			expected_lock_version: 7,
			seed: 42
		});
		expect(panelImageState('p1')?.status).toBe('queued');
		expect(panelImageState('p1')?.jobId).toBe('job-1');
	});

	it('409 marks the panel conflicted and raises the board conflict notice', async () => {
		await seedPanel(7);
		vi.mocked(storyboardApi.generatePanelImage).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'panel was modified concurrently')
		);
		// notePanelConflict reloads the board before posting its notice.
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('p1', { lock_version: 8 }))
		);

		await startPanelImage('proj-1', 'p1');

		expect(panelImageState('p1')?.status).toBe('conflict');
		expect(panelImageState('p1')?.error).toBe('panel was modified concurrently');
		expect(getPanelConflict('proj-1')).toContain('changed by someone else');
		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(2);
	});

	it('503 (no Redis on this deployment) is unavailable, not failed', async () => {
		await seedPanel(1);
		vi.mocked(storyboardApi.generatePanelImage).mockRejectedValueOnce(
			new ApiError(503, 'Service Unavailable', 'image generation is not configured')
		);

		await startPanelImage('proj-1', 'p1');

		expect(panelImageState('p1')?.status).toBe('unavailable');
		expect(panelImageState('p1')?.error).toBe('image generation is not configured');
	});

	it('any other failure is sticky `failed` and carries the server message verbatim', async () => {
		await seedPanel(1);
		vi.mocked(storyboardApi.generatePanelImage).mockRejectedValueOnce(
			new ApiError(500, 'Internal Server Error', 'diffusion worker exploded')
		);

		await startPanelImage('proj-1', 'p1');

		expect(panelImageState('p1')?.status).toBe('failed');
		expect(panelImageState('p1')?.error).toBe('diffusion worker exploded');

		// Sticky until explicitly dismissed.
		applyPanelImageEvent('proj-1', 'p1', job({ status: 'running' }));
		expect(panelImageState('p1')?.status).toBe('failed');

		dismissPanelImage('p1');
		expect(panelImageState('p1')).toBeUndefined();
	});

	it('a poll 404 becomes `lost`, never a silent reset to idle', async () => {
		vi.useFakeTimers();
		try {
			await seedPanel(1);
			vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job());
			await startPanelImage('proj-1', 'p1');
			expect(panelImageState('p1')?.status).toBe('queued');

			vi.mocked(storyboardApi.getPanelImageJob).mockRejectedValueOnce(
				new ApiError(404, 'Not Found', 'job not found')
			);
			await vi.advanceTimersByTimeAsync(5_000);

			expect(storyboardApi.getPanelImageJob).toHaveBeenCalledWith('p1', 'job-1');
			expect(panelImageState('p1')?.status).toBe('lost');
			expect(panelImageState('p1')?.jobId).toBe('job-1');

			// Terminal ⇒ the loop is cleared; a further tick must not poll again.
			await vi.advanceTimersByTimeAsync(30_000);
			expect(storyboardApi.getPanelImageJob).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a transient poll error keeps polling instead of declaring the job dead', async () => {
		vi.useFakeTimers();
		try {
			await seedPanel(1);
			vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job());
			await startPanelImage('proj-1', 'p1');

			vi.mocked(storyboardApi.getPanelImageJob)
				.mockRejectedValueOnce(new ApiError(502, 'Bad Gateway', 'upstream hiccup'))
				.mockResolvedValueOnce(job({ status: 'running' }));

			await vi.advanceTimersByTimeAsync(5_000);
			expect(panelImageState('p1')?.status).toBe('queued');

			await vi.advanceTimersByTimeAsync(5_000);
			expect(panelImageState('p1')?.status).toBe('running');
			expect(storyboardApi.getPanelImageJob).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('completed refetches the board (the panel read path is what re-signs the url)', async () => {
		await seedPanel(1);
		vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job());
		await startPanelImage('proj-1', 'p1');

		vi.mocked(storyboardApi.listPanels).mockResolvedValue(
			list(panel('p1', { lock_version: 2, media_ref: { url: 'https://minio/fresh-presign' } }))
		);
		applyPanelImageEvent(
			'proj-1',
			'p1',
			job({ status: 'completed', gen: { prompt: 'x', seed: 99, asset_ids: [], reused: true } })
		);

		expect(panelImageState('p1')?.status).toBe('completed');
		expect(panelImageState('p1')?.seed).toBe(99);
		expect(panelImageState('p1')?.reused).toBe(true);
		// The refetch is fire-and-forget, so let its microtasks run.
		await vi.waitFor(() => expect(storyboardApi.listPanels).toHaveBeenCalledTimes(2));
		expect(getProjectList('proj-1')[0].media_ref).toEqual({ url: 'https://minio/fresh-presign' });
	});

	it('a late duplicate event cannot overwrite a terminal state (first terminal wins)', async () => {
		await seedPanel(1);
		vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job());
		vi.mocked(storyboardApi.listPanels).mockResolvedValue(list(panel('p1', { lock_version: 2 })));
		await startPanelImage('proj-1', 'p1');

		applyPanelImageEvent('proj-1', 'p1', job({ status: 'completed' }));
		await vi.waitFor(() => expect(panelImageState('p1')?.status).toBe('completed'));
		const refetches = vi.mocked(storyboardApi.listPanels).mock.calls.length;

		// The slower transport catches up and replays the whole job history.
		applyPanelImageEvent('proj-1', 'p1', job({ status: 'running' }));
		applyPanelImageEvent('proj-1', 'p1', job({ status: 'failed', error: 'nope' }));

		expect(panelImageState('p1')?.status).toBe('completed');
		expect(panelImageState('p1')?.error).toBeNull();
		// And no second refetch storm.
		expect(vi.mocked(storyboardApi.listPanels).mock.calls.length).toBe(refetches);
	});

	it('an event for a superseded job id is ignored', async () => {
		await seedPanel(1);
		vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job({ job_id: 'job-2' }));
		await startPanelImage('proj-1', 'p1');

		applyPanelImageEvent('proj-1', 'p1', job({ job_id: 'job-1', status: 'failed', error: 'old' }));

		expect(panelImageState('p1')?.status).toBe('queued');
		expect(panelImageState('p1')?.jobId).toBe('job-2');
	});

	it('recheck is the escape hatch out of `lost` and may overwrite a terminal state', async () => {
		vi.useFakeTimers();
		try {
			await seedPanel(1);
			vi.mocked(storyboardApi.generatePanelImage).mockResolvedValueOnce(job());
			await startPanelImage('proj-1', 'p1');
			vi.mocked(storyboardApi.getPanelImageJob).mockRejectedValueOnce(
				new ApiError(404, 'Not Found', 'job not found')
			);
			await vi.advanceTimersByTimeAsync(5_000);
			expect(panelImageState('p1')?.status).toBe('lost');

			vi.mocked(storyboardApi.listPanels).mockResolvedValue(list(panel('p1', { lock_version: 2 })));
			vi.mocked(storyboardApi.getPanelImageJob).mockResolvedValueOnce(job({ status: 'completed' }));
			await recheckPanelImage('proj-1', 'p1');

			expect(panelImageState('p1')?.status).toBe('completed');
		} finally {
			vi.useRealTimers();
		}
	});
});

// ── Lock versions on the six previously-unguarded mutations ─────────────────
//
// The store is the ONLY place these tokens can come from: the six calls carry no
// version today, and refetching the row before mutating it would re-open the very
// race the CAS closes. These assertions pin the VALUE handed to the client (the
// wire mapping itself is pinned in `src/lib/api/storyboard.test.ts`), because a
// map built from the wrong rows reaches the wire looking perfectly well-formed.
describe('storyboard store — lock versions on delete / reorder / restore', () => {
	beforeEach(() => {
		invalidateAll();
		for (const fn of Object.values(storyboardApi)) vi.mocked(fn).mockReset();
	});

	it('deletePanel sends the cached panel lock_version', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(panel('a', { lock_version: 4 }), panel('b', { lock_version: 9 }))
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.deletePanel).mockResolvedValueOnce(undefined);
		await deletePanel('proj-1', 'a');
		expect(vi.mocked(storyboardApi.deletePanel).mock.calls[0]).toEqual(['a', 4]);
	});

	it('deleteScene sends the cached scene lock_version', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(scene('s1', { lock_version: 2 }))
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.deleteScene).mockResolvedValueOnce(undefined);
		await deleteScene('proj-1', 's1');
		expect(vi.mocked(storyboardApi.deleteScene).mock.calls[0]).toEqual(['s1', 2]);
	});

	it('deleteAsset sends the cached asset lock_version', async () => {
		vi.mocked(storyboardApi.listAssets).mockResolvedValueOnce(
			assetList(asset('a1', { lock_version: 6 }))
		);
		await loadAssets('proj-1');
		vi.mocked(storyboardApi.deleteAsset).mockResolvedValueOnce(undefined);
		await deleteAsset('proj-1', 'a1');
		expect(vi.mocked(storyboardApi.deleteAsset).mock.calls[0]).toEqual(['a1', 6]);
	});

	it('a delete with nothing cached sends undefined rather than refetching', async () => {
		vi.mocked(storyboardApi.deletePanel).mockResolvedValueOnce(undefined);
		await deletePanel('proj-1', 'ghost');
		expect(vi.mocked(storyboardApi.deletePanel).mock.calls[0]).toEqual(['ghost', undefined]);
		expect(storyboardApi.listPanels).not.toHaveBeenCalled();
	});

	it('reorderPanels sends a token for every reordered panel', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValueOnce(
			list(
				panel('a', { lock_version: 1 }),
				panel('b', { lock_version: 2 }),
				panel('c', { lock_version: 3 })
			)
		);
		await loadProject('proj-1');
		vi.mocked(storyboardApi.reorderPanels).mockResolvedValueOnce([
			panel('c'),
			panel('a'),
			panel('b')
		]);
		await reorderPanels('proj-1', ['c', 'a', 'b']);
		expect(vi.mocked(storyboardApi.reorderPanels).mock.calls[0]).toEqual([
			'proj-1',
			['c', 'a', 'b'],
			{ a: 1, b: 2, c: 3 }
		]);
	});

	it('reorderScenes sends a token for every reordered scene', async () => {
		vi.mocked(storyboardApi.listScenes).mockResolvedValueOnce(
			sceneList(
				scene('s1', { position: 0, lock_version: 5 }),
				scene('s2', { position: 1, lock_version: 8 })
			)
		);
		await loadScenes('proj-1');
		vi.mocked(storyboardApi.reorderScenes).mockResolvedValueOnce([scene('s2'), scene('s1')]);
		await reorderScenes('proj-1', ['s2', 's1']);
		expect(vi.mocked(storyboardApi.reorderScenes).mock.calls[0]).toEqual([
			'proj-1',
			['s2', 's1'],
			{ s1: 5, s2: 8 }
		]);
	});

	it('restoreSnapshot sends ONE flat map over every scene, panel and asset', async () => {
		vi.mocked(storyboardApi.listPanels).mockResolvedValue(
			list(panel('p-1', { lock_version: 1 }), panel('p-2', { lock_version: 2 }))
		);
		vi.mocked(storyboardApi.listScenes).mockResolvedValue(
			sceneList(scene('s-1', { lock_version: 3 }))
		);
		vi.mocked(storyboardApi.listAssets).mockResolvedValue(
			assetList(asset('a-1', { lock_version: 4 }))
		);
		vi.mocked(storyboardApi.listSnapshots).mockResolvedValue({
			items: [snapshot('snap-1')],
			total: 1
		});
		await Promise.all([loadProject('proj-1'), loadScenes('proj-1'), loadAssets('proj-1')]);
		vi.mocked(storyboardApi.restoreSnapshot).mockResolvedValueOnce({
			restored_snapshot_id: 'snap-1',
			auto_snapshot_id: 'snap-0',
			panels: 2,
			scenes: 1,
			assets: 1
		} as Awaited<ReturnType<typeof storyboardApi.restoreSnapshot>>);
		await restoreSnapshot('proj-1', 'snap-1');
		// Every live row, one namespace, no bucketing by type — read off the caches
		// as they stood BEFORE the restore's own refetches.
		expect(vi.mocked(storyboardApi.restoreSnapshot).mock.calls[0]).toEqual([
			'snap-1',
			{ 's-1': 3, 'p-1': 1, 'p-2': 2, 'a-1': 4 }
		]);
	});
});

// Serialisation of the panel write path (follow-up to the CAS work in #315).
//
// StoryboardPanelCard fires `onUpdate` from `oninput` — one fire-and-forget PATCH
// per KEYSTROKE. A compare-and-swap that reads `lock_version` from the cache at
// CALL time therefore sends the same token twice for two characters typed before
// the first response lands, and the second write loses its CAS: the user 409s
// against their own typing and the board reloads mid-word.
//
// The first test here fails against a straight read-cache-then-send
// implementation — it is the regression guard for exactly that, not a
// paraphrase of the code.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api', () => ({
	storyboard: {
		listPanels: vi.fn(),
		updatePanel: vi.fn(),
		approvePanel: vi.fn(),
		unapprovePanel: vi.fn(),
		rewritePanel: vi.fn()
	}
}));

import { storyboard as storyboardApi } from '$lib/api';
import { ApiError } from '$lib/api/client';
import type { StoryboardPanelResponse, StoryboardPanelListResponse } from '$lib/types';
import {
	loadProject,
	updatePanel,
	approvePanel,
	rewritePanel,
	getProjectList,
	getPanelConflict,
	dismissPanelConflict,
	getBoardReloadSeq,
	invalidateAll
} from './storyboard.svelte.js';

const PROJECT = 'proj-1';

function panel(overrides: Partial<StoryboardPanelResponse> = {}): StoryboardPanelResponse {
	return {
		id: 'panel-1',
		project_id: PROJECT,
		shot_key: 'clip-1',
		status: 'draft',
		revision: 1,
		lock_version: 3,
		media_ref: {},
		characters: [],
		props: [],
		...overrides
	} as StoryboardPanelResponse;
}

function list(...panels: StoryboardPanelResponse[]): StoryboardPanelListResponse {
	return { items: panels, total: panels.length };
}

/** A promise whose settlement this test controls — holds a write in flight. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

const versionConflict = () => new ApiError(409, 'Conflict', 'panel was modified concurrently');
const archived = () => new ApiError(409, 'Conflict', 'project is archived and read-only');

function bodyOf(call: number): Record<string, unknown> {
	return vi.mocked(storyboardApi.updatePanel).mock.calls[call][1] as Record<string, unknown>;
}

describe('panel write queue', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		invalidateAll();
		vi.mocked(storyboardApi.listPanels).mockResolvedValue(list(panel()));
		await loadProject(PROJECT);
		vi.mocked(storyboardApi.listPanels).mockClear();
	});

	it('never sends the same lock_version twice for consecutive keystrokes', async () => {
		const first = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.updatePanel)
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(panel({ action_description: 'abc', lock_version: 5 }));

		// Type 'a', 'ab', 'abc' — all before the first PATCH responds.
		const writes = [
			updatePanel(PROJECT, 'panel-1', { action_description: 'a' }),
			updatePanel(PROJECT, 'panel-1', { action_description: 'ab' }),
			updatePanel(PROJECT, 'panel-1', { action_description: 'abc' })
		];

		expect(storyboardApi.updatePanel).toHaveBeenCalledTimes(1);
		first.resolve(panel({ action_description: 'a', lock_version: 4 }));
		await Promise.all(writes);

		const sent = vi
			.mocked(storyboardApi.updatePanel)
			.mock.calls.map((c) => (c[1] as Record<string, unknown>).expected_lock_version);
		// THE guard: reusing a token means the server 409s the user's own typing.
		expect(new Set(sent).size).toBe(sent.length);
		expect(sent).toEqual([3, 4]);
	});

	it('coalesces the queued keystrokes into one write carrying the latest value', async () => {
		const first = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.updatePanel)
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(panel({ action_description: 'abc', lock_version: 5 }));

		const writes = [
			updatePanel(PROJECT, 'panel-1', { action_description: 'a' }),
			updatePanel(PROJECT, 'panel-1', { action_description: 'ab' }),
			updatePanel(PROJECT, 'panel-1', { action_description: 'abc' })
		];
		first.resolve(panel({ action_description: 'a', lock_version: 4 }));
		await Promise.all(writes);

		// Three keystrokes → two requests, and the survivor carries the latest text.
		expect(storyboardApi.updatePanel).toHaveBeenCalledTimes(2);
		expect(bodyOf(1).action_description).toBe('abc');
		expect(getProjectList(PROJECT)[0].lock_version).toBe(5);
	});

	it('merges distinct fields queued behind an in-flight write', async () => {
		const first = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.updatePanel)
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(panel({ lock_version: 5 }));

		const writes = [
			updatePanel(PROJECT, 'panel-1', { action_description: 'a' }),
			updatePanel(PROJECT, 'panel-1', { dialogue: 'd' }),
			updatePanel(PROJECT, 'panel-1', { vo_text: 'v' })
		];
		first.resolve(panel({ lock_version: 4 }));
		await Promise.all(writes);

		// A coalesce must not drop a field the user edited on a different control.
		expect(bodyOf(1)).toEqual({
			dialogue: 'd',
			vo_text: 'v',
			expected_lock_version: 4
		});
	});

	it('a lost CAS reloads the board, notices it, and does NOT retry the write', async () => {
		vi.mocked(storyboardApi.updatePanel).mockRejectedValueOnce(versionConflict());
		vi.mocked(storyboardApi.listPanels).mockResolvedValue(
			list(panel({ action_description: 'theirs', lock_version: 9 }))
		);

		await expect(
			updatePanel(PROJECT, 'panel-1', { action_description: 'mine' })
		).rejects.toBeInstanceOf(ApiError);

		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(1);
		// Exactly one PATCH: replaying re-applies the local edit over the other
		// writer — the very lost update the CAS exists to prevent.
		expect(storyboardApi.updatePanel).toHaveBeenCalledTimes(1);
		expect(getProjectList(PROJECT)[0].action_description).toBe('theirs');
		expect(getPanelConflict(PROJECT)).toMatch(/clip-1 was changed by someone else/);
		expect(getBoardReloadSeq(PROJECT)).toBe(1);

		dismissPanelConflict(PROJECT);
		expect(getPanelConflict(PROJECT)).toBeUndefined();
	});

	it('does NOT treat the archived-project 409 as a version conflict', async () => {
		vi.mocked(storyboardApi.updatePanel).mockRejectedValueOnce(archived());

		await expect(updatePanel(PROJECT, 'panel-1', { dialogue: 'x' })).rejects.toBeInstanceOf(
			ApiError
		);

		// Same status, different meaning: refetching an archived project changes
		// nothing, and calling it a concurrent edit would be a lie.
		expect(storyboardApi.listPanels).not.toHaveBeenCalled();
		expect(getPanelConflict(PROJECT)).toBeUndefined();
		expect(getBoardReloadSeq(PROJECT)).toBe(0);
	});

	it('approve waits for a pending PATCH, then sends the version that PATCH produced', async () => {
		const first = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.updatePanel).mockReturnValueOnce(first.promise);
		vi.mocked(storyboardApi.approvePanel).mockResolvedValueOnce(
			panel({ status: 'approved', lock_version: 5 })
		);

		const write = updatePanel(PROJECT, 'panel-1', { action_description: 'a' });
		const approval = approvePanel('panel-1');

		// Must not fire while a PATCH is still in flight — it would send a token
		// that write is about to invalidate.
		expect(storyboardApi.approvePanel).not.toHaveBeenCalled();
		first.resolve(panel({ action_description: 'a', lock_version: 4 }));
		await Promise.all([write, approval]);

		expect(vi.mocked(storyboardApi.approvePanel).mock.calls[0]).toEqual(['panel-1', undefined, 4]);
	});

	it('a lost CAS on approve reloads and raises the board notice', async () => {
		vi.mocked(storyboardApi.approvePanel).mockRejectedValueOnce(versionConflict());
		vi.mocked(storyboardApi.listPanels).mockResolvedValue(
			list(panel({ status: 'approved', lock_version: 9 }))
		);

		await expect(approvePanel('panel-1')).resolves.toBeNull();

		expect(storyboardApi.listPanels).toHaveBeenCalledTimes(1);
		expect(getPanelConflict(PROJECT)).toBeDefined();
		expect(getBoardReloadSeq(PROJECT)).toBe(1);
	});

	it('a rewrite serialises behind an in-flight field PATCH — no self-409', async () => {
		// PATCH in flight holding lock_version=3; user triggers Rewrite on the SAME
		// panel. Both bump lock_version, so a rewrite that fired immediately would race
		// the PATCH and one would 409 ("panel was modified concurrently") against the
		// user's own edit. It must wait for the PATCH (which already read its token).
		const first = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.updatePanel).mockReturnValueOnce(first.promise);
		vi.mocked(storyboardApi.rewritePanel).mockResolvedValueOnce(
			panel({ action_description: 'rewritten', lock_version: 6 })
		);

		const write = updatePanel(PROJECT, 'panel-1', { action_description: 'a' });
		const rewrite = rewritePanel(PROJECT, 'panel-1', 'tighter framing');

		// The rewrite's API call must NOT fire while the PATCH is still in flight.
		expect(storyboardApi.rewritePanel).not.toHaveBeenCalled();

		first.resolve(panel({ action_description: 'a', lock_version: 4 }));
		await Promise.all([write, rewrite]);

		expect(storyboardApi.rewritePanel).toHaveBeenCalledTimes(1);
		// Serialised, not raced ⇒ no concurrent-edit notice, and the rewrite's result
		// (which followed the PATCH) is the one cached.
		expect(getPanelConflict(PROJECT)).toBeUndefined();
		expect(getProjectList(PROJECT)[0].action_description).toBe('rewritten');
	});

	it('approve waits for an in-flight rewrite, then sends the version it produced', async () => {
		// Rewrite in flight; user clicks Approve on the SAME panel. The rewrite bumps
		// lock_version, so approving mid-rewrite would send the pre-rewrite token (3)
		// and self-409. Approve must wait, then read the version the rewrite produced.
		const rw = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.rewritePanel).mockReturnValueOnce(rw.promise);
		vi.mocked(storyboardApi.approvePanel).mockResolvedValueOnce(
			panel({ status: 'approved', lock_version: 7 })
		);

		const rewrite = rewritePanel(PROJECT, 'panel-1', 'tighter');
		const approval = approvePanel('panel-1');

		// Approve must NOT fire while the rewrite is in flight.
		expect(storyboardApi.approvePanel).not.toHaveBeenCalled();

		rw.resolve(panel({ action_description: 'rw', lock_version: 6 }));
		await Promise.all([rewrite, approval]);

		// Sent the version the rewrite produced (6), not the pre-rewrite 3.
		expect(vi.mocked(storyboardApi.approvePanel).mock.calls[0]).toEqual(['panel-1', undefined, 6]);
		expect(getProjectList(PROJECT)[0].status).toBe('approved');
	});

	it('a field PATCH waits for an in-flight rewrite, then sends the version it produced', async () => {
		// The reverse of "a rewrite serialises behind an in-flight field PATCH": here a
		// rewrite is in flight and the user keeps TYPING on the same panel. A keystroke
		// PATCH that fired mid-rewrite would read the pre-rewrite token (3) from cache,
		// self-409 against the rewrite ("panel was modified concurrently"), and
		// `notePanelConflict` would then DROP the edit. The write must wait for the
		// rewrite and send the post-rewrite lock_version. Fails against a store that only
		// makes the rewrite wait for writes but not writes for the rewrite.
		const rw = deferred<StoryboardPanelResponse>();
		vi.mocked(storyboardApi.rewritePanel).mockReturnValueOnce(rw.promise);
		vi.mocked(storyboardApi.updatePanel).mockResolvedValueOnce(
			panel({ action_description: 'typed', lock_version: 7 })
		);

		const rewrite = rewritePanel(PROJECT, 'panel-1', 'tighter');
		const write = updatePanel(PROJECT, 'panel-1', { action_description: 'typed' });

		// The field PATCH must NOT fire while the rewrite is in flight.
		expect(storyboardApi.updatePanel).not.toHaveBeenCalled();

		rw.resolve(panel({ action_description: 'rw', lock_version: 6 }));
		await Promise.all([rewrite, write]);

		// Sent the version the rewrite produced (6), not the pre-rewrite 3 — no self-409,
		// no dropped keystroke, and the user's edit lands on top of the rewrite.
		expect(storyboardApi.updatePanel).toHaveBeenCalledTimes(1);
		expect(bodyOf(0).expected_lock_version).toBe(6);
		expect(getPanelConflict(PROJECT)).toBeUndefined();
		expect(getProjectList(PROJECT)[0].action_description).toBe('typed');
	});
});

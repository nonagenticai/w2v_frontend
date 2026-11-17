import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factories (which are hoisted above imports) can close
// over the same mock instances the tests assert against.
const h = vi.hoisted(() => {
	class MockApiError extends Error {
		status: number;
		detail: string;
		constructor(status: number, detail: string) {
			super(detail);
			this.status = status;
			this.detail = detail;
		}
	}
	return {
		MockApiError,
		createPanel: vi.fn(),
		updatePanel: vi.fn(),
		deletePanel: vi.fn(),
		reorderPanels: vi.fn(),
		getProject: vi.fn(),
		getProjectList: vi.fn(),
		loadProject: vi.fn(),
		isProjectLoading: vi.fn(),
		loadScenes: vi.fn(),
		createScene: vi.fn(),
		draftFromBrief: vi.fn(),
		rewritePanel: vi.fn(),
		isPanelBusy: vi.fn(),
		backfillFromBrief: vi.fn(),
		// StoryboardVersions (collapsed by default) imports these off the same
		// store module — an export missing from this factory throws on access.
		loadSnapshots: vi.fn(),
		getSnapshots: vi.fn(),
		getSnapshotList: vi.fn(),
		getSnapshotsPage: vi.fn(),
		areSnapshotsLoading: vi.fn(),
		createSnapshot: vi.fn(),
		restoreSnapshot: vi.fn(),
		deleteSnapshot: vi.fn(),
		// StoryboardBranches — same deal, same module, same throw-on-access trap.
		loadBranches: vi.fn(),
		getBranches: vi.fn(),
		getBranchList: vi.fn(),
		getBranchesPage: vi.fn(),
		areBranchesLoading: vi.fn(),
		createBranch: vi.fn(),
		abandonBranch: vi.fn(),
		// Optimistic-concurrency surface — same throw-on-access trap.
		getPanelConflict: vi.fn(),
		dismissPanelConflict: vi.fn(),
		getBoardReloadSeq: vi.fn(() => 0),
		storyboardCsv: vi.fn(),
		storyboardEdl: vi.fn(),
		storyboardFcpxml: vi.fn(),
		storyboardPdf: vi.fn(),
		toastSuccess: vi.fn(),
		toastError: vi.fn()
	};
});

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	createPanel: h.createPanel,
	updatePanel: h.updatePanel,
	deletePanel: h.deletePanel,
	reorderPanels: h.reorderPanels,
	getProject: h.getProject,
	getProjectList: h.getProjectList,
	loadProject: h.loadProject,
	isProjectLoading: h.isProjectLoading,
	loadScenes: h.loadScenes,
	createScene: h.createScene,
	draftFromBrief: h.draftFromBrief,
	rewritePanel: h.rewritePanel,
	isPanelBusy: h.isPanelBusy,
	backfillFromBrief: h.backfillFromBrief,
	getPanelConflict: h.getPanelConflict,
	dismissPanelConflict: h.dismissPanelConflict,
	getBoardReloadSeq: h.getBoardReloadSeq,
	loadSnapshots: h.loadSnapshots,
	getSnapshots: h.getSnapshots,
	getSnapshotList: h.getSnapshotList,
	getSnapshotsPage: h.getSnapshotsPage,
	areSnapshotsLoading: h.areSnapshotsLoading,
	createSnapshot: h.createSnapshot,
	restoreSnapshot: h.restoreSnapshot,
	deleteSnapshot: h.deleteSnapshot,
	loadBranches: h.loadBranches,
	getBranches: h.getBranches,
	getBranchList: h.getBranchList,
	getBranchesPage: h.getBranchesPage,
	areBranchesLoading: h.areBranchesLoading,
	createBranch: h.createBranch,
	abandonBranch: h.abandonBranch,
	// A plain const, not a fn — the Versions/Branches panels pass it to <Pagination>.
	// Absent from a mocked module it is `undefined`, which only bites once a test
	// expands one of those (collapsed-by-default) panels. Pinned here so it can't.
	PAGE_SIZE: 20
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: h.toastSuccess,
	toastError: h.toastError
}));
vi.mock('$lib/api', () => ({ ApiError: h.MockApiError }));
vi.mock('$lib/api/downloads.js', () => ({
	downloads: {
		storyboardCsv: h.storyboardCsv,
		storyboardEdl: h.storyboardEdl,
		storyboardFcpxml: h.storyboardFcpxml,
		storyboardPdf: h.storyboardPdf
	}
}));
// WS-2's AssetLibrary is out of scope here — stub it with a dependency-free
// component so this section test doesn't couple to its internals or fire network.
vi.mock('$lib/components/studio/storyboard/AssetLibrary.svelte', async () => ({
	default: (await import('$lib/components/ui/Spinner.svelte')).default
}));
// WS-A2's SceneBoard is out of scope here — stub it so this section test asserts
// only the wiring (data-testid + the onMovePanelToScene → updatePanel handler).
vi.mock('$lib/components/studio/storyboard/SceneBoard.svelte', async () => ({
	default: (await import('./SceneBoardStub.svelte')).default
}));

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import StoryboardSection from './StoryboardSection.svelte';
import type { ProjectDetailResponse } from '$lib/types';

const NOW = '2026-07-12T00:00:00Z';

function makeProject(over: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		id: 'p1',
		tenant_id: 't',
		owner_subject_id: 's',
		visibility: 'tenant',
		title: 'My Project',
		type: 'generic',
		brief: { angle: 'explainer' },
		brand: {},
		voice: {},
		theme: {},
		status: 'drafting',
		deliverables: [],
		children: [],
		created_at: NOW,
		updated_at: NOW,
		...over
	} as ProjectDetailResponse;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Empty board, not cached → mount effect runs loadProject.
	h.getProject.mockReturnValue(undefined);
	h.getProjectList.mockReturnValue([]);
	h.isProjectLoading.mockReturnValue(false);
	h.loadProject.mockResolvedValue({ items: [], total: 0 });
	h.isPanelBusy.mockReturnValue(false);
	h.draftFromBrief.mockResolvedValue({ items: [], total: 0 });
	h.backfillFromBrief.mockResolvedValue(undefined);
	h.loadScenes.mockResolvedValue([]);
	h.createScene.mockResolvedValue({ id: 's1' });
	h.updatePanel.mockResolvedValue({ id: 'panel-x' });
});

describe('StoryboardSection — draft from brief', () => {
	it('drafts with replace:false and toasts success', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('draft-from-brief'));
		await waitFor(() =>
			expect(h.draftFromBrief).toHaveBeenCalledWith('p1', {
				script_or_idea: null,
				instructions: null,
				replace: false
			})
		);
		await waitFor(() =>
			expect(h.toastSuccess).toHaveBeenCalledWith('Storyboard drafted', expect.any(String))
		);
	});

	it('on 409 shows an inline confirm, then retries with replace:true', async () => {
		h.draftFromBrief
			.mockRejectedValueOnce(new h.MockApiError(409, 'already exists'))
			.mockResolvedValueOnce({ items: [], total: 0 });

		const { getByTestId, queryByTestId } = render(StoryboardSection, { project: makeProject() });

		// No window.confirm — the confirm is an inline affordance.
		expect(queryByTestId('draft-confirm')).toBeNull();
		await fireEvent.click(getByTestId('draft-from-brief'));

		// 409 surfaces the inline replace confirm (not a toast).
		const replaceBtn = await waitFor(() => getByTestId('draft-confirm-replace'));
		expect(h.draftFromBrief).toHaveBeenNthCalledWith(1, 'p1', {
			script_or_idea: null,
			instructions: null,
			replace: false
		});

		await fireEvent.click(replaceBtn);
		await waitFor(() =>
			expect(h.draftFromBrief).toHaveBeenNthCalledWith(2, 'p1', {
				script_or_idea: null,
				instructions: null,
				replace: true
			})
		);
		await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
		await waitFor(() => expect(queryByTestId('draft-confirm')).toBeNull());
	});

	it('cancelling the replace confirm makes no further draft call', async () => {
		h.draftFromBrief.mockRejectedValueOnce(new h.MockApiError(409, 'already exists'));
		const { getByTestId, queryByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('draft-from-brief'));
		const cancel = await waitFor(() => getByTestId('draft-confirm-cancel'));
		await fireEvent.click(cancel);
		expect(queryByTestId('draft-confirm')).toBeNull();
		expect(h.draftFromBrief).toHaveBeenCalledTimes(1);
	});

	it('is disabled (with the reason) while the project brief has nothing to draft from', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject({ brief: {} }) });
		const btn = getByTestId('draft-from-brief') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.title).toMatch(/fill in the brief first/i);
		await fireEvent.click(btn);
		expect(h.draftFromBrief).not.toHaveBeenCalled();
	});

	it('on 422 toasts to add a script or brief first', async () => {
		h.draftFromBrief.mockRejectedValueOnce(new h.MockApiError(422, 'no script'));
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('draft-from-brief'));
		await waitFor(() =>
			expect(h.toastError).toHaveBeenCalledWith('Add a script or brief first', 'no script')
		);
	});
});

describe('StoryboardSection — scenes', () => {
	it('loads scenes on mount', async () => {
		render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(h.loadScenes).toHaveBeenCalledWith('p1'));
	});

	it('renders SceneBoard once the board is not loading', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(getByTestId('scene-board')).toBeTruthy());
	});

	it('onMovePanelToScene calls updatePanel with scene_id', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('mock-move-panel'));
		await waitFor(() =>
			expect(h.updatePanel).toHaveBeenCalledWith('p1', 'panel-x', { scene_id: 'scene-y' })
		);
	});
});

describe('StoryboardSection — add shot', () => {
	beforeEach(() => {
		h.createPanel.mockResolvedValue({ id: 'panel-new' });
	});

	it('offers an add-shot entry point beside "Draft from brief" on an empty board', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('add-shot-empty'));
		await waitFor(() =>
			expect(h.createPanel).toHaveBeenCalledWith('p1', { shot_key: 'clip-1', status: 'draft' })
		);
	});

	it('hides the empty-state add-shot once the board has panels', () => {
		h.getProjectList.mockReturnValue([{ id: 'panel-1', shot_key: 'clip-1' }]);
		const { queryByTestId } = render(StoryboardSection, { project: makeProject() });
		expect(queryByTestId('add-shot-empty')).toBeNull();
	});

	it('adding from inside a scene group creates the panel IN that scene', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('mock-add-panel-scene'));
		await waitFor(() =>
			expect(h.createPanel).toHaveBeenCalledWith('p1', {
				shot_key: 'clip-1',
				status: 'draft',
				scene_id: 'scene-y'
			})
		);
	});

	it('adding from the unassigned group omits scene_id entirely', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('mock-add-panel-unassigned'));
		await waitFor(() =>
			expect(h.createPanel).toHaveBeenCalledWith('p1', { shot_key: 'clip-1', status: 'draft' })
		);
	});

	it('derives the next shot_key from the max existing clip ordinal', async () => {
		h.getProjectList.mockReturnValue([
			{ id: 'a', shot_key: 'clip-1' },
			{ id: 'b', shot_key: 'clip-3' }
		]);
		const { getAllByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getAllByTestId('mock-add-panel-unassigned')[0]);
		await waitFor(() =>
			expect(h.createPanel).toHaveBeenCalledWith('p1', { shot_key: 'clip-4', status: 'draft' })
		);
	});

	it('toasts when the create rejects', async () => {
		h.createPanel.mockRejectedValueOnce(new h.MockApiError(500, 'boom'));
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await fireEvent.click(getByTestId('add-shot-empty'));
		await waitFor(() =>
			expect(h.toastError).toHaveBeenCalledWith('Storyboard create failed', 'boom')
		);
	});
});

describe('StoryboardSection — exports', () => {
	const CASES = [
		{ testid: 'download-csv', fn: () => h.storyboardCsv },
		{ testid: 'download-edl', fn: () => h.storyboardEdl },
		{ testid: 'download-fcpxml', fn: () => h.storyboardFcpxml },
		{ testid: 'download-pdf', fn: () => h.storyboardPdf }
	] as const;

	for (const { testid, fn } of CASES) {
		it(`downloads via ${testid} for the project when clicked`, async () => {
			h.getProjectList.mockReturnValue([{ id: 'panel-1', shot_key: 'clip-1' }]);
			fn().mockResolvedValue(undefined);
			const { getByTestId } = render(StoryboardSection, { project: makeProject() });
			await fireEvent.click(getByTestId(testid));
			await waitFor(() => expect(fn()).toHaveBeenCalledWith('p1'));
			// Each button must drive ITS OWN exporter. Without this, a row wired to
			// the wrong helper (e.g. PDF calling storyboardCsv) still passes the
			// happy-path assertion in some other row's iteration.
			for (const other of CASES) {
				if (other.testid !== testid) expect(other.fn()).not.toHaveBeenCalled();
			}
		});

		it(`disables ${testid} when the board is empty`, async () => {
			h.getProjectList.mockReturnValue([]);
			const { getByTestId } = render(StoryboardSection, { project: makeProject() });
			expect((getByTestId(testid) as HTMLButtonElement).disabled).toBe(true);
			expect(fn()).not.toHaveBeenCalled();
		});
	}
});

describe('StoryboardSection — backfill from brief', () => {
	it('seeds the table from brief.storyboard when the board loads empty', async () => {
		const project = makeProject({
			brief: {
				storyboard: [
					{
						shot_key: 'clip-1',
						action_description: 'wide establishing shot',
						shot_size: 'WS',
						duration_seconds: 4,
						// A non-StoryboardPanelCreate key must be dropped by the mapping.
						unknown_key: 'ignore me'
					}
				]
			}
		});
		render(StoryboardSection, { project });
		await waitFor(() => expect(h.backfillFromBrief).toHaveBeenCalledTimes(1));
		expect(h.backfillFromBrief).toHaveBeenCalledWith('p1', [
			{
				shot_key: 'clip-1',
				action_description: 'wide establishing shot',
				shot_size: 'WS',
				duration_seconds: 4
			}
		]);
	});

	it('does not backfill when the brief has no storyboard panels', async () => {
		render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(h.loadProject).toHaveBeenCalled());
		expect(h.backfillFromBrief).not.toHaveBeenCalled();
	});

	it('does not backfill when the board already has panels', async () => {
		h.loadProject.mockResolvedValue({ items: [{ id: 'x' }], total: 1 });
		const project = makeProject({ brief: { storyboard: [{ shot_key: 'clip-1', vo_text: 'hi' }] } });
		render(StoryboardSection, { project });
		await waitFor(() => expect(h.loadProject).toHaveBeenCalled());
		expect(h.backfillFromBrief).not.toHaveBeenCalled();
	});
});

describe('StoryboardSection — concurrent-edit notice', () => {
	it('shows nothing when there is no outstanding conflict', async () => {
		const { queryByTestId, getByTestId } = render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(getByTestId('scene-board')).toBeTruthy());
		expect(queryByTestId('panel-conflict-notice')).toBeNull();
	});

	it('renders the store notice and dismisses it on demand', async () => {
		h.getPanelConflict.mockReturnValue('clip-1 was changed by someone else — reloaded.');
		const { getByTestId, getByText } = render(StoryboardSection, { project: makeProject() });

		const notice = await waitFor(() => getByTestId('panel-conflict-notice'));
		expect(notice.textContent).toContain('clip-1 was changed by someone else');

		await fireEvent.click(getByText('Dismiss'));
		expect(h.dismissPanelConflict).toHaveBeenCalledWith('p1');
	});

	it('remounts the board when the force-reload counter advances', async () => {
		// Regression guard for the conflict refetch: StoryboardBoard keeps a local
		// working copy and only re-seeds on a MEMBERSHIP change, so a reload that
		// changes field values but not the id set would never reach the DOM.
		const { getByTestId, rerender } = render(StoryboardSection, { project: makeProject() });
		const before = await waitFor(() => getByTestId('scene-board'));

		h.getBoardReloadSeq.mockReturnValue(1);
		await rerender({ project: makeProject() });

		await waitFor(() => expect(getByTestId('scene-board')).not.toBe(before));
	});
});

describe('StoryboardSection — read-only', () => {
	it('archived project shows the read-only notice and disables the edit affordances', () => {
		const { getByTestId } = render(StoryboardSection, {
			project: makeProject({ status: 'archived' })
		});
		expect(getByTestId('storyboard-readonly-notice').textContent).toMatch(/archived/i);
		expect((getByTestId('draft-from-brief') as HTMLButtonElement).disabled).toBe(true);
		expect((getByTestId('add-shot-empty') as HTMLButtonElement).disabled).toBe(true);
	});

	it('a merged branch child shows the merged/abandoned read-only notice', () => {
		const { getByTestId } = render(StoryboardSection, {
			project: makeProject({
				branch: {
					branch_id: 'b1',
					name: 'alt',
					status: 'merged',
					root_project_id: 'p0',
					root_title: 'root'
				}
			} as unknown as Partial<ProjectDetailResponse>)
		});
		expect(getByTestId('storyboard-readonly-notice').textContent).toMatch(/merged or abandoned/i);
	});

	it('an OPEN branch child is still editable (no notice, draft not disabled)', () => {
		const { queryByTestId, getByTestId } = render(StoryboardSection, {
			project: makeProject({
				branch: {
					branch_id: 'b1',
					name: 'alt',
					status: 'open',
					root_project_id: 'p0',
					root_title: 'root'
				}
			} as unknown as Partial<ProjectDetailResponse>)
		});
		expect(queryByTestId('storyboard-readonly-notice')).toBeNull();
		expect((getByTestId('draft-from-brief') as HTMLButtonElement).disabled).toBe(false);
	});

	it('a plain drafting project shows no read-only notice', () => {
		const { queryByTestId } = render(StoryboardSection, { project: makeProject() });
		expect(queryByTestId('storyboard-readonly-notice')).toBeNull();
	});
});

// A FAILED panel load is not an empty board. The store write is pessimistic, so a
// 5xx/dropped fetch leaves the cache empty, `loading` false and `loadAttemptedFor`
// set — the section then asserts "no shots yet" and offers Draft from brief. That
// click 409s, the UI asks "A storyboard already exists — replace it?", and
// confirming DESTROYS a full board the user never saw. Mirrors AssetLibrary's
// `loadFailed` flag (`asset-library-unavailable`).
describe('StoryboardSection — a failed panel load must not invite an overwrite', () => {
	beforeEach(() => {
		h.loadProject.mockRejectedValue(new h.MockApiError(503, 'upstream unavailable'));
	});

	it('renders an unavailable notice instead of the empty-board affordances', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(h.toastError).toHaveBeenCalled());
		await waitFor(() => expect(getByTestId('storyboard-unavailable')).toBeTruthy());
	});

	it('does not offer "Draft from brief" — that path can overwrite the unseen board', async () => {
		const { getByTestId } = render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(h.toastError).toHaveBeenCalled());
		await waitFor(() =>
			expect((getByTestId('draft-from-brief') as HTMLButtonElement).disabled).toBe(true)
		);
	});

	it('does not offer the empty-board "Add shot" button', async () => {
		const { queryByTestId } = render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(h.toastError).toHaveBeenCalled());
		await waitFor(() => expect(queryByTestId('add-shot-empty')).toBeNull());
	});
});

describe('StoryboardSection — a SUCCESSFUL empty load still invites drafting', () => {
	it('shows no unavailable notice and keeps Draft from brief enabled', async () => {
		const { queryByTestId, getByTestId } = render(StoryboardSection, { project: makeProject() });
		await waitFor(() => expect(h.loadProject).toHaveBeenCalled());
		expect(queryByTestId('storyboard-unavailable')).toBeNull();
		expect((getByTestId('draft-from-brief') as HTMLButtonElement).disabled).toBe(false);
		expect(queryByTestId('add-shot-empty')).toBeTruthy();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoryboardSceneResponse, StoryboardPanelResponse } from '$lib/types';

// Mocked store: getPanelsByScene returns a mutable `grouped` snapshot; the
// mutation verbs are spies (SceneEditor also imports createScene/updateScene).
const getPanelsByScene = vi.fn();
const reorderScenes = vi.fn().mockResolvedValue(undefined);
const deleteScene = vi.fn().mockResolvedValue(undefined);
const createScene = vi.fn().mockResolvedValue({});
const updateScene = vi.fn().mockResolvedValue({});
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	getPanelsByScene: (...a: unknown[]) => getPanelsByScene(...a),
	reorderScenes: (...a: unknown[]) => reorderScenes(...a),
	deleteScene: (...a: unknown[]) => deleteScene(...a),
	createScene: (...a: unknown[]) => createScene(...a),
	updateScene: (...a: unknown[]) => updateScene(...a),
	// SceneBoard renders StoryboardBoard, which reads the panel-image job state.
	// A scene has no opinion about generation, so these are inert here — but they
	// must EXIST, or every SceneBoard test dies on a missing mock export rather
	// than on anything about scenes.
	panelImageState: () => undefined,
	startPanelImage: async () => {},
	dismissPanelImage: () => {},
	recheckPanelImage: async () => {}
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccess(...a),
	toastError: (...a: unknown[]) => toastError(...a)
}));

import { render, fireEvent, within, waitFor } from '@testing-library/svelte';
import SceneBoard from './SceneBoard.svelte';

function scene(id: string, name: string, position: number): StoryboardSceneResponse {
	return { id, project_id: 'p1', name, position } as unknown as StoryboardSceneResponse;
}
function panel(id: string, sceneId: string | null): StoryboardPanelResponse {
	return {
		id,
		project_id: 'p1',
		shot_key: `clip-${id}`,
		scene_id: sceneId,
		status: 'draft',
		revision: 0,
		media_ref: {}
	} as unknown as StoryboardPanelResponse;
}

function grouped() {
	const s1 = scene('s1', 'Scene 1', 0);
	const s2 = scene('s2', 'Scene 2', 1);
	return {
		scenes: [s1, s2],
		groups: new Map<string | null, StoryboardPanelResponse[]>([
			['s1', [panel('p1', 's1'), panel('p2', 's1')]],
			['s2', [panel('p3', 's2')]],
			[null, [panel('p4', null)]]
		])
	};
}

function baseProps(over: Record<string, unknown> = {}) {
	return {
		projectId: 'p1',
		onAddPanel: vi.fn(),
		onUpdatePanel: vi.fn(),
		onDeletePanel: vi.fn(),
		onReorderPanels: vi.fn(),
		onMovePanelToScene: vi.fn(),
		...over
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	getPanelsByScene.mockReturnValue(grouped());
});

describe('SceneBoard', () => {
	it('renders one group per scene plus a trailing unassigned group', () => {
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		expect(getAllByTestId('scene-group').length).toBe(3);
	});

	it('omits the unassigned group when there are no unassigned panels', () => {
		getPanelsByScene.mockReturnValue({
			scenes: [scene('s1', 'Scene 1', 0)],
			groups: new Map<string | null, StoryboardPanelResponse[]>([['s1', [panel('p1', 's1')]]])
		});
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		expect(getAllByTestId('scene-group').length).toBe(1);
	});

	// ── Add shot reachability + scene binding ───────────────────────────────────

	it('still mounts an unassigned group (with a reachable Add shot) on a brand-new board', async () => {
		// 0 scenes AND 0 panels: previously nothing rendered, so the first panel
		// could only come from "Draft from brief" or the raw API.
		getPanelsByScene.mockReturnValue({
			scenes: [],
			groups: new Map<string | null, StoryboardPanelResponse[]>()
		});
		const props = baseProps();
		const { getAllByTestId, getByTestId } = render(SceneBoard, { props });
		expect(getAllByTestId('scene-group').length).toBe(1);
		await fireEvent.click(getByTestId('add-shot-scene'));
		expect(props.onAddPanel).toHaveBeenCalledWith(null);
	});

	it('Add shot inside a scene group adds to THAT scene', async () => {
		const props = baseProps();
		const { getAllByTestId } = render(SceneBoard, { props });
		const secondGroup = getAllByTestId('scene-group')[1];
		await fireEvent.click(within(secondGroup).getByTestId('add-shot-scene'));
		expect(props.onAddPanel).toHaveBeenCalledWith('s2');
	});

	it('Add shot in the unassigned group adds with no scene', async () => {
		const props = baseProps();
		const { getAllByTestId } = render(SceneBoard, { props });
		const groups = getAllByTestId('scene-group');
		await fireEvent.click(within(groups[groups.length - 1]).getByTestId('add-shot-scene'));
		expect(props.onAddPanel).toHaveBeenCalledWith(null);
	});

	it('"Add scene" reveals an inline SceneEditor', async () => {
		const { getByTestId, queryByTestId } = render(SceneBoard, { props: baseProps() });
		expect(queryByTestId('scene-editor')).toBeNull();
		await fireEvent.click(getByTestId('add-scene'));
		expect(getByTestId('scene-editor')).toBeTruthy();
	});

	it('merges a scene-local reorder into a GLOBAL ordered id list', async () => {
		const props = baseProps();
		const { getAllByTestId } = render(SceneBoard, { props });
		// Reorder within scene 1 (p1,p2 → p2,p1) via keyboard on the first group.
		const firstGroup = getAllByTestId('scene-group')[0];
		const handle = within(firstGroup).getByTestId('scene-move-shots'); // ensure the group rendered its panels
		expect(handle).toBeTruthy();
		const dragHandle = firstGroup.querySelector(
			'[data-panel-id="p1"] [data-testid="panel-drag-handle"]'
		)!;
		await fireEvent.keyDown(dragHandle, { key: 'ArrowRight' });
		// Global order = reordered scene1 ids, then scene2, then unassigned.
		expect(props.onReorderPanels).toHaveBeenCalledWith(['p2', 'p1', 'p3', 'p4']);
	});

	// ── Scene move (store wiring) ───────────────────────────────────────────────

	it('moving a scene down calls reorderScenes with the swapped global scene order', async () => {
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		// Scene 1 (index 0) can move down; moveScene swaps s1/s2 → ['s2', 's1'].
		const firstGroup = getAllByTestId('scene-group')[0];
		await fireEvent.click(within(firstGroup).getByTestId('scene-move-down'));
		expect(reorderScenes).toHaveBeenCalledWith('p1', ['s2', 's1']);
	});

	it('toasts when reorderScenes rejects', async () => {
		reorderScenes.mockRejectedValueOnce(new Error('conflict'));
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		const firstGroup = getAllByTestId('scene-group')[0];
		await fireEvent.click(within(firstGroup).getByTestId('scene-move-down'));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	// ── Scene delete (store wiring) ─────────────────────────────────────────────

	// Scene delete is a two-step inline confirm (SceneHeader owns the prompt), so
	// the trash icon alone must reach NOTHING — it only opens the confirm.
	it('the trash icon alone does not delete the scene', async () => {
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		const firstGroup = getAllByTestId('scene-group')[0];
		await fireEvent.click(within(firstGroup).getByTestId('scene-delete'));
		expect(deleteScene).not.toHaveBeenCalled();
		expect(within(firstGroup).getByTestId('scene-delete-prompt')).toBeTruthy();
	});

	it('confirming the delete calls deleteScene with the project + scene id', async () => {
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		const firstGroup = getAllByTestId('scene-group')[0];
		await fireEvent.click(within(firstGroup).getByTestId('scene-delete'));
		await fireEvent.click(within(firstGroup).getByTestId('scene-delete-confirm'));
		expect(deleteScene).toHaveBeenCalledWith('p1', 's1');
	});

	it('toasts when deleteScene rejects', async () => {
		deleteScene.mockRejectedValueOnce(new Error('boom'));
		const { getAllByTestId } = render(SceneBoard, { props: baseProps() });
		const firstGroup = getAllByTestId('scene-group')[0];
		await fireEvent.click(within(firstGroup).getByTestId('scene-delete'));
		await fireEvent.click(within(firstGroup).getByTestId('scene-delete-confirm'));
		await waitFor(() => expect(toastError).toHaveBeenCalled());
	});

	// ── Edit existing scene (inline editor branch) ──────────────────────────────

	it('editing an existing scene reveals an inline SceneEditor bound to that scene', async () => {
		const { getAllByTestId, queryByTestId, container } = render(SceneBoard, {
			props: baseProps()
		});
		expect(queryByTestId('scene-editor')).toBeNull();
		const firstGroup = getAllByTestId('scene-group')[0];
		await fireEvent.click(within(firstGroup).getByTestId('scene-edit'));
		expect(queryByTestId('scene-editor')).toBeTruthy();
		// Editor is seeded from scene s1 (uid drives the input name), not a blank create form.
		expect(container.querySelector('[name="scene-name-s1"]')).toBeTruthy();
	});

	// ── Read-only mode ──────────────────────────────────────────────────────────

	it('leaves "Add scene" enabled when not disabled', () => {
		const { getByTestId } = render(SceneBoard, { props: baseProps() });
		expect((getByTestId('add-scene') as HTMLButtonElement).disabled).toBe(false);
	});

	it('disables "Add scene" when disabled', () => {
		const { getByTestId } = render(SceneBoard, { props: baseProps({ disabled: true }) });
		expect((getByTestId('add-scene') as HTMLButtonElement).disabled).toBe(true);
	});
});

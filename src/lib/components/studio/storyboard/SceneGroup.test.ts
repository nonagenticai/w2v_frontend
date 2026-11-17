import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/svelte';
import SceneGroup from './SceneGroup.svelte';
import type { StoryboardSceneResponse, StoryboardPanelResponse } from '$lib/types';

function scene(over: Partial<StoryboardSceneResponse> = {}): StoryboardSceneResponse {
	return {
		id: 's1',
		project_id: 'p1',
		name: 'Opening',
		position: 0,
		...over
	} as unknown as StoryboardSceneResponse;
}

function panel(id: string, over: Partial<StoryboardPanelResponse> = {}): StoryboardPanelResponse {
	return {
		id,
		project_id: 'p1',
		shot_key: `clip-${id}`,
		scene_id: 's1',
		status: 'draft',
		revision: 0,
		media_ref: {},
		...over
	} as unknown as StoryboardPanelResponse;
}

const sceneOptions = [
	{ id: 's1', label: 'Opening' },
	{ id: 's2', label: 'Chase' },
	{ id: null, label: 'Unassigned' }
];

function baseProps(over: Record<string, unknown> = {}) {
	return {
		scene: scene(),
		panels: [panel('p1')],
		sceneCount: 2,
		index: 0,
		onEditScene: vi.fn(),
		onDeleteScene: vi.fn(),
		onMoveScene: vi.fn(),
		onReorderPanels: vi.fn(),
		onAddPanel: vi.fn(),
		onUpdatePanel: vi.fn(),
		onDeletePanel: vi.fn(),
		onMovePanelToScene: vi.fn(),
		sceneOptions,
		...over
	};
}

describe('SceneGroup', () => {
	it('renders the SceneHeader when scene is non-null', () => {
		const { getByTestId, queryByTestId } = render(SceneGroup, { props: baseProps() });
		expect(getByTestId('scene-header')).toBeTruthy();
		expect(queryByTestId('scene-unassigned')).toBeNull();
	});

	it('renders a plain "Unassigned" heading (no header) when scene is null', () => {
		const { getByTestId, queryByTestId } = render(SceneGroup, {
			props: baseProps({ scene: null, panels: [panel('p1', { scene_id: null })] })
		});
		expect(getByTestId('scene-unassigned').textContent).toMatch(/unassigned/i);
		expect(queryByTestId('scene-header')).toBeNull();
	});

	it('renders this group’s panels (scoped board)', () => {
		const { container } = render(SceneGroup, {
			props: baseProps({ panels: [panel('p1'), panel('p2')] })
		});
		expect(container.querySelectorAll('[data-testid="panel-card"]').length).toBe(2);
	});

	// ── Add shot (the group owns the only reachable add affordance) ─────────────

	it('renders its own Add-shot control (the embedded board is header-less)', () => {
		const { getByTestId, container } = render(SceneGroup, { props: baseProps() });
		expect(getByTestId('add-shot-scene')).toBeTruthy();
		// The embedded board runs hideHeader ⇒ its own `add-shot` must NOT render,
		// otherwise every group would show two Add-shot buttons.
		expect(container.querySelector('[data-testid="add-shot"]')).toBeNull();
	});

	it('Add shot fires onAddPanel', async () => {
		const props = baseProps();
		const { getByTestId } = render(SceneGroup, { props });
		await fireEvent.click(getByTestId('add-shot-scene'));
		expect(props.onAddPanel).toHaveBeenCalledOnce();
	});

	it('labels Add shot with the scene it adds to', () => {
		const { getByTestId } = render(SceneGroup, { props: baseProps() });
		expect(getByTestId('add-shot-scene').getAttribute('aria-label')).toBe('Add shot to Opening');
	});

	it('offers Add shot on an EMPTY group (0 panels) and on the unassigned group', async () => {
		const props = baseProps({ scene: null, panels: [] });
		const { getByTestId } = render(SceneGroup, { props });
		const btn = getByTestId('add-shot-scene');
		expect(btn.getAttribute('aria-label')).toBe('Add shot to Unassigned');
		await fireEvent.click(btn);
		expect(props.onAddPanel).toHaveBeenCalledOnce();
	});

	it('move-to-scene select fires onMovePanelToScene with the panel + target id', async () => {
		const props = baseProps();
		const { getByTestId } = render(SceneGroup, { props });
		const select = within(getByTestId('scene-move-row')).getByTestId('scene-move-select');
		await fireEvent.change(select, { target: { value: 's2' } });
		expect(props.onMovePanelToScene).toHaveBeenCalledWith('p1', 's2');
	});

	it('move-to-scene select maps the empty option to the unassigned (null) bucket', async () => {
		const props = baseProps();
		const { getByTestId } = render(SceneGroup, { props });
		const select = within(getByTestId('scene-move-row')).getByTestId('scene-move-select');
		await fireEvent.change(select, { target: { value: '' } });
		expect(props.onMovePanelToScene).toHaveBeenCalledWith('p1', null);
	});

	it('labels each move-to-scene select with the shot it reassigns', () => {
		const { getByTestId } = render(SceneGroup, { props: baseProps() });
		const select = within(getByTestId('scene-move-row')).getByTestId('scene-move-select');
		expect(select.getAttribute('aria-label')).toMatch(/move shot .* to scene/i);
	});

	it('leaves add-shot and every move-select enabled when not disabled', () => {
		const { getByTestId, getAllByTestId } = render(SceneGroup, {
			props: baseProps({ panels: [panel('p1'), panel('p2')] })
		});
		expect((getByTestId('add-shot-scene') as HTMLButtonElement).disabled).toBe(false);
		const selects = getAllByTestId('scene-move-select');
		expect(selects.length).toBeGreaterThan(0);
		for (const s of selects) expect((s as HTMLSelectElement).disabled).toBe(false);
	});

	it('disables add-shot and every move-select when disabled', () => {
		const { getByTestId, getAllByTestId } = render(SceneGroup, {
			props: baseProps({ disabled: true, panels: [panel('p1'), panel('p2')] })
		});
		expect((getByTestId('add-shot-scene') as HTMLButtonElement).disabled).toBe(true);
		const selects = getAllByTestId('scene-move-select');
		expect(selects.length).toBeGreaterThan(0);
		for (const s of selects) expect((s as HTMLSelectElement).disabled).toBe(true);
	});
});

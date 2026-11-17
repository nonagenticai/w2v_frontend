import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store mutations the editor drives — captured so we can assert call args.
const createScene = vi.fn().mockResolvedValue({});
const updateScene = vi.fn().mockResolvedValue({});
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	createScene: (...a: unknown[]) => createScene(...a),
	updateScene: (...a: unknown[]) => updateScene(...a),
	loadScenes: vi.fn().mockResolvedValue(undefined),
	getSceneList: () => [],
	deleteScene: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccess(...a),
	toastError: (...a: unknown[]) => toastError(...a)
}));

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import SceneEditor from './SceneEditor.svelte';
import type { StoryboardSceneResponse } from '$lib/types';

function scene(over: Partial<StoryboardSceneResponse> = {}): StoryboardSceneResponse {
	return {
		id: 's1',
		project_id: 'p1',
		name: 'Opening',
		int_ext: 'INT',
		location: 'Kitchen',
		time_of_day: 'DAY',
		description: 'A quiet morning',
		position: 0,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...over
	} as unknown as StoryboardSceneResponse;
}

const save = (c: HTMLElement) => c.querySelector('[data-testid="scene-save"]') as HTMLButtonElement;
const cancel = (c: HTMLElement) =>
	c.querySelector('[data-testid="scene-cancel"]') as HTMLButtonElement;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('SceneEditor', () => {
	it('calls createScene with the entered fields and fires onDone when there is no scene', async () => {
		const onDone = vi.fn();
		const { container } = render(SceneEditor, { props: { projectId: 'p1', onDone } });
		await fireEvent.input(container.querySelector('#scene-name-new') as HTMLInputElement, {
			target: { value: 'Chase' }
		});
		await fireEvent.input(container.querySelector('#scene-int-ext-new') as HTMLInputElement, {
			target: { value: 'EXT' }
		});
		await fireEvent.input(container.querySelector('#scene-location-new') as HTMLInputElement, {
			target: { value: 'Rooftop' }
		});
		await fireEvent.input(container.querySelector('#scene-time-of-day-new') as HTMLInputElement, {
			target: { value: 'NIGHT' }
		});
		await fireEvent.input(
			container.querySelector('#scene-description-new') as HTMLTextAreaElement,
			{ target: { value: 'A tense pursuit' } }
		);
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(createScene).toHaveBeenCalledWith('p1', {
				name: 'Chase',
				int_ext: 'EXT',
				location: 'Rooftop',
				time_of_day: 'NIGHT',
				description: 'A tense pursuit'
			})
		);
		expect(updateScene).not.toHaveBeenCalled();
		await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
		expect(toastSuccess).toHaveBeenCalled();
	});

	it('sends null for fields left empty', async () => {
		const { container } = render(SceneEditor, { props: { projectId: 'p1', onDone: vi.fn() } });
		await fireEvent.input(container.querySelector('#scene-name-new') as HTMLInputElement, {
			target: { value: 'Bare' }
		});
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(createScene).toHaveBeenCalledWith('p1', {
				name: 'Bare',
				int_ext: null,
				location: null,
				time_of_day: null,
				description: null
			})
		);
	});

	it('calls updateScene with the scene id when editing an existing scene', async () => {
		const onDone = vi.fn();
		const { container } = render(SceneEditor, {
			props: { projectId: 'p1', scene: scene(), onDone }
		});
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateScene).toHaveBeenCalledWith('p1', 's1', {
				name: 'Opening',
				int_ext: 'INT',
				location: 'Kitchen',
				time_of_day: 'DAY',
				description: 'A quiet morning'
			})
		);
		expect(createScene).not.toHaveBeenCalled();
		await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
	});

	it('fires onDone without saving when Cancel is clicked', async () => {
		const onDone = vi.fn();
		const { container } = render(SceneEditor, { props: { projectId: 'p1', onDone } });
		await fireEvent.click(cancel(container));
		expect(onDone).toHaveBeenCalledOnce();
		expect(createScene).not.toHaveBeenCalled();
		expect(updateScene).not.toHaveBeenCalled();
	});

	it('toasts an error and keeps the editor open when the store rejects', async () => {
		createScene.mockRejectedValueOnce(new Error('boom'));
		const onDone = vi.fn();
		const { container } = render(SceneEditor, { props: { projectId: 'p1', onDone } });
		await fireEvent.input(container.querySelector('#scene-name-new') as HTMLInputElement, {
			target: { value: 'Hero' }
		});
		await fireEvent.click(save(container));
		await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to create scene', 'boom'));
		expect(onDone).not.toHaveBeenCalled();
	});
});

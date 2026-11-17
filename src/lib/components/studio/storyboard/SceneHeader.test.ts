import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SceneHeader from './SceneHeader.svelte';
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

function props(over: Record<string, unknown> = {}) {
	return {
		scene: scene(),
		canMoveUp: true,
		canMoveDown: true,
		onEdit: vi.fn(),
		onDelete: vi.fn(),
		onMove: vi.fn(),
		...over
	};
}

const btn = (c: HTMLElement, id: string) =>
	c.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('SceneHeader', () => {
	it('renders the scene name and a compact metadata line', () => {
		const { container } = render(SceneHeader, { props: props() });
		expect(
			(container.querySelector('[data-testid="scene-name"]') as HTMLElement).textContent
		).toContain('Opening');
		const meta = container.querySelector('[data-testid="scene-meta"]') as HTMLElement;
		expect(meta.textContent).toContain('INT');
		expect(meta.textContent).toContain('Kitchen');
		expect(meta.textContent).toContain('DAY');
	});

	it('falls back to "Untitled scene" when the name is missing', () => {
		const { container } = render(SceneHeader, { props: props({ scene: scene({ name: null }) }) });
		expect(
			(container.querySelector('[data-testid="scene-name"]') as HTMLElement).textContent
		).toContain('Untitled scene');
	});

	it('omits the metadata line when int_ext/location/time_of_day are all empty', () => {
		const { container } = render(SceneHeader, {
			props: props({ scene: scene({ int_ext: null, location: null, time_of_day: null }) })
		});
		expect(container.querySelector('[data-testid="scene-meta"]')).toBeNull();
	});

	it('invokes onEdit when its button is clicked', async () => {
		const onEdit = vi.fn();
		const { container } = render(SceneHeader, { props: props({ onEdit }) });
		await fireEvent.click(btn(container, 'scene-edit'));
		expect(onEdit).toHaveBeenCalledOnce();
	});

	// Deleting a scene is destructive and irreversible from this row. Every other
	// destructive action in the app (project delete, storyboard version delete,
	// tenant suspend, settings reset) is a two-step inline confirm; this one used
	// to fire on a single click of a bare trash icon. Mirrors the
	// `snapshot-delete-prompt` idiom in StoryboardVersions.svelte — deliberately
	// NOT window.confirm (invisible to Playwright, blocks the e2e suite).
	it('does NOT delete on the first click — it asks first', async () => {
		const onDelete = vi.fn();
		const { container } = render(SceneHeader, { props: props({ onDelete }) });
		await fireEvent.click(btn(container, 'scene-delete'));
		expect(onDelete).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="scene-delete-prompt"]')).toBeTruthy();
	});

	it('deletes only after the confirm button is clicked', async () => {
		const onDelete = vi.fn();
		const { container } = render(SceneHeader, { props: props({ onDelete }) });
		await fireEvent.click(btn(container, 'scene-delete'));
		await fireEvent.click(btn(container, 'scene-delete-confirm'));
		expect(onDelete).toHaveBeenCalledOnce();
	});

	it('cancelling the confirm deletes nothing and restores the row controls', async () => {
		const onDelete = vi.fn();
		const { container } = render(SceneHeader, { props: props({ onDelete }) });
		await fireEvent.click(btn(container, 'scene-delete'));
		await fireEvent.click(btn(container, 'scene-delete-cancel'));
		expect(onDelete).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="scene-delete-prompt"]')).toBeNull();
		expect(btn(container, 'scene-delete')).toBeTruthy();
	});

	it('names the scene in the confirm so the wrong row is not destroyed', async () => {
		const { container } = render(SceneHeader, { props: props() });
		await fireEvent.click(btn(container, 'scene-delete'));
		const prompt = container.querySelector('[data-testid="scene-delete-prompt"]') as HTMLElement;
		expect(prompt.textContent).toContain('Opening');
	});

	it('invokes onMove with -1 for up and 1 for down', async () => {
		const onMove = vi.fn();
		const { container } = render(SceneHeader, { props: props({ onMove }) });
		await fireEvent.click(btn(container, 'scene-move-up'));
		expect(onMove).toHaveBeenCalledWith(-1);
		await fireEvent.click(btn(container, 'scene-move-down'));
		expect(onMove).toHaveBeenCalledWith(1);
	});

	it('disables move-up when canMoveUp is false', () => {
		const { container } = render(SceneHeader, { props: props({ canMoveUp: false }) });
		expect(btn(container, 'scene-move-up').disabled).toBe(true);
		expect(btn(container, 'scene-move-down').disabled).toBe(false);
	});

	it('disables move-down when canMoveDown is false', () => {
		const { container } = render(SceneHeader, { props: props({ canMoveDown: false }) });
		expect(btn(container, 'scene-move-down').disabled).toBe(true);
		expect(btn(container, 'scene-move-up').disabled).toBe(false);
	});

	it('gives every icon button an aria-label', () => {
		const { container } = render(SceneHeader, { props: props() });
		for (const id of ['scene-move-up', 'scene-move-down', 'scene-edit', 'scene-delete']) {
			expect(btn(container, id).getAttribute('aria-label')).toBeTruthy();
		}
	});

	it('leaves scene-edit and scene-delete enabled by default (disabled: false)', () => {
		const { container } = render(SceneHeader, { props: props() });
		expect(btn(container, 'scene-edit').disabled).toBe(false);
		expect(btn(container, 'scene-delete').disabled).toBe(false);
	});

	it('disables scene-edit and scene-delete and swallows clicks when disabled', async () => {
		const onEdit = vi.fn();
		const onDelete = vi.fn();
		const { container } = render(SceneHeader, {
			props: props({ disabled: true, onEdit, onDelete })
		});
		expect(btn(container, 'scene-edit').disabled).toBe(true);
		expect(btn(container, 'scene-delete').disabled).toBe(true);
		await fireEvent.click(btn(container, 'scene-edit'));
		await fireEvent.click(btn(container, 'scene-delete'));
		expect(onEdit).not.toHaveBeenCalled();
		expect(onDelete).not.toHaveBeenCalled();
	});
});

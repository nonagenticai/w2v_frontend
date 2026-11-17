import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import StoryboardBoard from './StoryboardBoard.svelte';
import type { StoryboardPanelDraft } from '$lib/types';

function panel(id: string, over: Partial<StoryboardPanelDraft> = {}): StoryboardPanelDraft {
	return { id, shot_key: `clip-${id}`, status: 'draft', ...over };
}

const cbs = () => ({ onAdd: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn() });

describe('StoryboardBoard', () => {
	it('shows an empty state and an add-shot control with no panels', () => {
		const { container, getByText } = render(StoryboardBoard, { props: { panels: [], ...cbs() } });
		expect(getByText(/no shots yet/i)).toBeTruthy();
		expect(container.querySelector('[data-testid="add-shot"]')).toBeTruthy();
	});

	it('fires onAdd when Add shot is clicked (section mode)', async () => {
		const c = cbs();
		const { container } = render(StoryboardBoard, { props: { panels: [], ...c } });
		await fireEvent.click(container.querySelector('[data-testid="add-shot"]')!);
		expect(c.onAdd).toHaveBeenCalledOnce();
	});

	it('keeps the header Add-shot in the flat (wizard) board — hideHeader defaults to false', async () => {
		// The create wizard's fallback board renders this component directly and
		// relies on its header button; SceneGroup embeds it with hideHeader instead.
		const { container } = render(StoryboardBoard, { props: { panels: [] } });
		expect(container.querySelector('[data-testid="add-shot"]')).toBeTruthy();
		await fireEvent.click(container.querySelector('[data-testid="add-shot"]')!);
		expect(container.querySelectorAll('[data-testid="panel-card"]').length).toBe(1);
	});

	it('hides the header Add-shot when embedded header-less (hideHeader)', () => {
		const c = cbs();
		const { container } = render(StoryboardBoard, {
			props: { panels: [], hideHeader: true, ...c }
		});
		expect(container.querySelector('[data-testid="add-shot"]')).toBeNull();
	});

	it('fires onDelete with the panel id when the delete button is clicked', async () => {
		const c = cbs();
		const { container } = render(StoryboardBoard, {
			props: { panels: [panel('a'), panel('b')], ...c }
		});
		const del = container.querySelector('[data-panel-id="b"] [data-testid="panel-delete"]')!;
		await fireEvent.click(del);
		expect(c.onDelete).toHaveBeenCalledWith('b');
	});

	it('keyboard ArrowRight reorders and fires onReorder with the new id order', async () => {
		const c = cbs();
		const { container } = render(StoryboardBoard, {
			props: { panels: [panel('a'), panel('b'), panel('c')], ...c }
		});
		const handle = container.querySelector(
			'[data-panel-id="a"] [data-testid="panel-drag-handle"]'
		)!;
		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(c.onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
	});

	it('adds a panel in-memory in wizard mode (no callbacks)', async () => {
		const { container } = render(StoryboardBoard, { props: { panels: [] } });
		expect(container.querySelectorAll('[data-testid="panel-card"]').length).toBe(0);
		await fireEvent.click(container.querySelector('[data-testid="add-shot"]')!);
		expect(container.querySelectorAll('[data-testid="panel-card"]').length).toBe(1);
	});

	it('omits drag handles when reordering is disabled', () => {
		const { container } = render(StoryboardBoard, {
			props: { panels: [panel('a')], onUpdate: vi.fn() }
		});
		expect(container.querySelector('[data-testid="panel-drag-handle"]')).toBeNull();
	});

	const domOrder = (container: HTMLElement) =>
		[...container.querySelectorAll('[data-testid="panel-card"]')].map((el) =>
			el.getAttribute('data-panel-id')
		);

	it('re-syncs to the panels prop order in section mode (failed-reorder revert)', async () => {
		// The store is authoritative for order in section mode: when a failed
		// optimistic reorder reverts the store, it re-passes the original order and
		// the board must follow it (not keep the rejected order).
		const c = cbs();
		const { container, rerender } = render(StoryboardBoard, {
			props: { panels: [panel('a'), panel('b'), panel('c')], ...c }
		});
		await rerender({ panels: [panel('c'), panel('a'), panel('b')], ...c });
		expect(domOrder(container)).toEqual(['c', 'a', 'b']);
	});

	it('threads onRewrite to each card and forwards the panel id + instruction', async () => {
		const c = cbs();
		const onRewrite = vi.fn();
		const { container } = render(StoryboardBoard, {
			props: { panels: [panel('a')], ...c, onRewrite }
		});
		const input = container.querySelector('[data-panel-id="a"] #rewrite-a') as HTMLInputElement;
		expect(input).toBeTruthy();
		await fireEvent.input(input, { target: { value: 'tighter framing' } });
		const btn = container.querySelector('[data-panel-id="a"] [data-testid="panel-rewrite-btn"]')!;
		await fireEvent.click(btn);
		expect(onRewrite).toHaveBeenCalledWith('a', 'tighter framing');
	});

	it('passes isBusy through so a busy panel disables its rewrite control', () => {
		const c = cbs();
		const { container } = render(StoryboardBoard, {
			props: { panels: [panel('a')], ...c, onRewrite: vi.fn(), isBusy: (id: string) => id === 'a' }
		});
		expect(
			container.querySelector('[data-panel-id="a"] [data-testid="panel-rewrite-btn"]')
		).toBeDisabled();
	});

	it('hides the rewrite affordance in wizard mode (no onRewrite)', () => {
		const { container } = render(StoryboardBoard, { props: { panels: [panel('a')] } });
		expect(container.querySelector('[data-testid="panel-rewrite-btn"]')).toBeNull();
	});

	const actionField = (container: HTMLElement) =>
		container.querySelector('#action-a') as HTMLTextAreaElement;

	it('reverts an optimistic field edit when the section-mode write is rejected', async () => {
		// The store is pessimistic (caches only on success), so a rejected PATCH
		// (archived-409, network, timeout) leaves nothing to re-seed from. The board
		// must roll the optimistic edit back to the server value or it shows unsaved
		// text as if it were saved. Reproduces the phantom-value bug against a board
		// that fired onUpdate fire-and-forget.
		const c = cbs();
		const onUpdate = vi.fn().mockRejectedValue(new Error('project is archived and read-only'));
		const { container } = render(StoryboardBoard, {
			props: { panels: [panel('a', { action_description: 'orig' })], ...c, onUpdate }
		});

		await fireEvent.input(actionField(container), { target: { value: 'phantom' } });
		expect(onUpdate).toHaveBeenCalledWith('a', { action_description: 'phantom' });

		// After the rejection settles, the field is back to the server value — the
		// phantom does not survive as a "saved" edit.
		await waitFor(() => expect(actionField(container).value).toBe('orig'));
	});

	it('reconciles server content pushed via the panels prop on unchanged ids (section mode)', async () => {
		// A field edit changes no ids, so the re-seed effect used to early-return on a
		// matching id-sequence and keep stale/phantom content. In section mode the store
		// is authoritative for content too: a same-ids content change (e.g. a conflict
		// reload) must reach the DOM without waiting for a membership change.
		const c = cbs();
		const { container, rerender } = render(StoryboardBoard, {
			props: { panels: [panel('a', { action_description: 'orig' })], ...c }
		});
		expect(actionField(container).value).toBe('orig');

		await rerender({ panels: [panel('a', { action_description: 'theirs' })], ...c });
		await waitFor(() => expect(actionField(container).value).toBe('theirs'));
	});
});

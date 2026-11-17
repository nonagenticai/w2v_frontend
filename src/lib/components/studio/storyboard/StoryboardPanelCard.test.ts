import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import StoryboardPanelCard from './StoryboardPanelCard.svelte';
import type { StoryboardPanelDraft } from '$lib/types';

function panel(over: Partial<StoryboardPanelDraft> = {}): StoryboardPanelDraft {
	return { id: 'p1', shot_key: 'clip-1', status: 'draft', ...over };
}

describe('StoryboardPanelCard', () => {
	it('renders the read-only shot label', () => {
		const { getByText } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1' }
		});
		expect(getByText('clip-1')).toBeTruthy();
	});

	it('fires onUpdate when the action description is edited', async () => {
		const onUpdate = vi.fn();
		const { container } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onUpdate }
		});
		const ta = container.querySelector('#action-p1') as HTMLTextAreaElement;
		await fireEvent.input(ta, { target: { value: 'wide establishing shot' } });
		expect(onUpdate).toHaveBeenCalledWith({ action_description: 'wide establishing shot' });
	});

	it('fires onUpdate with the enum value when a shot size is selected', async () => {
		const onUpdate = vi.fn();
		const { container } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onUpdate }
		});
		const sel = container.querySelector('#shot_size-p1') as HTMLSelectElement;
		await fireEvent.change(sel, { target: { value: 'CU' } });
		expect(onUpdate).toHaveBeenCalledWith({ shot_size: 'CU' });
	});

	it('maps a cleared enum select back to null', async () => {
		const onUpdate = vi.fn();
		const { container } = render(StoryboardPanelCard, {
			props: { panel: panel({ shot_size: 'CU' }), shotLabel: 'clip-1', onUpdate }
		});
		const sel = container.querySelector('#shot_size-p1') as HTMLSelectElement;
		await fireEvent.change(sel, { target: { value: '' } });
		expect(onUpdate).toHaveBeenCalledWith({ shot_size: null });
	});

	it('fires onUpdate with a numeric duration', async () => {
		const onUpdate = vi.fn();
		const { container } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onUpdate }
		});
		const input = container.querySelector('#duration-p1') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '3.5' } });
		expect(onUpdate).toHaveBeenCalledWith({ duration_seconds: 3.5 });
	});

	it('hides the rewrite affordance when no onRewrite is provided (wizard mode)', () => {
		const { queryByTestId } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onUpdate: vi.fn() }
		});
		expect(queryByTestId('panel-rewrite')).toBeNull();
	});

	it('calls onRewrite with the panel id and typed instruction', async () => {
		const onRewrite = vi.fn();
		const { container, getByTestId } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onRewrite }
		});
		const input = container.querySelector('#rewrite-p1') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'make it a dramatic low-angle push-in' } });
		await fireEvent.click(getByTestId('panel-rewrite-btn'));
		expect(onRewrite).toHaveBeenCalledWith('p1', 'make it a dramatic low-angle push-in');
	});

	it('keeps the rewrite button disabled until an instruction is entered', async () => {
		const onRewrite = vi.fn();
		const { container, getByTestId } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onRewrite }
		});
		expect(getByTestId('panel-rewrite-btn')).toBeDisabled();
		const input = container.querySelector('#rewrite-p1') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'tighter framing' } });
		expect(getByTestId('panel-rewrite-btn')).not.toBeDisabled();
	});

	it('disables the rewrite affordance while the panel is busy', () => {
		const onRewrite = vi.fn();
		const isBusy = vi.fn(() => true);
		const { getByTestId, container } = render(StoryboardPanelCard, {
			props: { panel: panel(), shotLabel: 'clip-1', onRewrite, isBusy }
		});
		expect(isBusy).toHaveBeenCalledWith('p1');
		expect(getByTestId('panel-rewrite-btn')).toBeDisabled();
		expect(container.querySelector('#rewrite-p1')).toBeDisabled();
	});
});

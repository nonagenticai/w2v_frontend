import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ChildProjectList from './ChildProjectList.svelte';
import type { ProjectResponse } from '$lib/types';

function makeChild(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
	return {
		id: 'c',
		tenant_id: '00000000-0000-0000-0000-00000000000a',
		owner_subject_id: '00000000-0000-0000-0000-00000000000b',
		visibility: 'tenant',
		title: 'Lesson',
		type: 'lesson',
		parent_project_id: 'p1',
		position: 1,
		is_branch: false,
		status: 'drafting',
		created_at: '2026-05-08T00:00:00Z',
		updated_at: '2026-05-08T00:00:00Z',
		deliverable_count: 0,
		...overrides
	};
}

describe('ChildProjectList', () => {
	it('renders empty state when there are no children', () => {
		const { getByText } = render(ChildProjectList, { props: { children: [] } });
		expect(getByText('No children yet.')).toBeTruthy();
	});

	it('strict-ordering: predecessor must be completed for a row to be Start-enabled', () => {
		const items = [
			makeChild({ id: 'a', position: 1, status: 'drafting', title: 'L1' }),
			makeChild({ id: 'b', position: 2, status: 'drafting', title: 'L2' })
		];
		const { container } = render(ChildProjectList, {
			props: { children: items, onStart: vi.fn() }
		});
		const startButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
			(b) => b.textContent?.trim() === 'Start'
		);
		expect(startButtons.length).toBe(2);
		expect(startButtons[0].disabled).toBe(false);
		expect(startButtons[1].disabled).toBe(true);
	});

	it('first row Start-enabled even when alone; predecessor completed unlocks second', () => {
		const items = [
			makeChild({ id: 'a', position: 1, status: 'completed', title: 'L1' }),
			makeChild({ id: 'b', position: 2, status: 'drafting', title: 'L2' })
		];
		const { container } = render(ChildProjectList, {
			props: { children: items, onStart: vi.fn() }
		});
		const startButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
			(b) => b.textContent?.trim() === 'Start'
		);
		expect(startButtons.length).toBe(1);
		expect(startButtons[0].disabled).toBe(false);
	});

	it('emits onReorder with new id ordering on a finalize event', async () => {
		const onReorder = vi.fn();
		const items = [
			makeChild({ id: 'a', position: 1, title: 'L1' }),
			makeChild({ id: 'b', position: 2, title: 'L2' })
		];
		const { container } = render(ChildProjectList, {
			props: { children: items, onReorder }
		});
		const ul = container.querySelector('ul');
		expect(ul).not.toBeNull();
		await fireEvent(
			ul!,
			new CustomEvent('finalize', {
				detail: { items: [items[1], items[0]], info: { trigger: 'drop' } }
			})
		);
		expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
	});

	it('does not emit onReorder when the order is unchanged', async () => {
		const onReorder = vi.fn();
		const items = [makeChild({ id: 'a', position: 1 }), makeChild({ id: 'b', position: 2 })];
		const { container } = render(ChildProjectList, {
			props: { children: items, onReorder }
		});
		const ul = container.querySelector('ul')!;
		await fireEvent(
			ul,
			new CustomEvent('finalize', {
				detail: { items, info: { trigger: 'drop' } }
			})
		);
		expect(onReorder).not.toHaveBeenCalled();
	});
});

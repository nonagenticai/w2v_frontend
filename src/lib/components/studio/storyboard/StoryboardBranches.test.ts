import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store is the seam: the component owns the create/confirm UX, the store
// owns the cache + refresh. Mock every store fn the component imports — an
// un-listed export is `undefined` and calling it throws.
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
		loadBranches: vi.fn(),
		getBranches: vi.fn(),
		getBranchList: vi.fn(),
		getBranchesPage: vi.fn(),
		areBranchesLoading: vi.fn(),
		createBranch: vi.fn(),
		abandonBranch: vi.fn(),
		// Imported by the nested StoryboardBranchMerge; its behaviour is covered in
		// StoryboardBranchMerge.test.ts — here we only assert the review mounts.
		diffBranch: vi.fn(),
		mergeBranch: vi.fn(),
		toastError: vi.fn(),
		toastSuccess: vi.fn()
	};
});

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	loadBranches: h.loadBranches,
	getBranches: h.getBranches,
	getBranchList: h.getBranchList,
	getBranchesPage: h.getBranchesPage,
	areBranchesLoading: h.areBranchesLoading,
	createBranch: h.createBranch,
	abandonBranch: h.abandonBranch,
	diffBranch: h.diffBranch,
	mergeBranch: h.mergeBranch,
	PAGE_SIZE: 20
}));

vi.mock('$lib/api', () => ({ ApiError: h.MockApiError }));

vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: h.toastError,
	toastSuccess: h.toastSuccess
}));

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import StoryboardBranches from './StoryboardBranches.svelte';
import type { StoryboardBranch } from '$lib/types';

const PID = 'proj-1';

function branch(id: string, over: Partial<StoryboardBranch> = {}): StoryboardBranch {
	return {
		id,
		root_project_id: PID,
		child_project_id: `child-${id}`,
		name: `branch ${id}`,
		base_snapshot_id: `snap-${id}`,
		status: 'open',
		created_at: new Date().toISOString(),
		merged_at: null,
		...over
	};
}

/** Seed the mocked store so the component renders `items` without fetching. */
function seed(items: StoryboardBranch[], total = items.length): void {
	h.getBranches.mockReturnValue({ items, total });
	h.getBranchList.mockReturnValue(items);
	h.getBranchesPage.mockReturnValue(1);
	h.areBranchesLoading.mockReturnValue(false);
}

describe('StoryboardBranches', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getBranchesPage.mockReturnValue(1);
		h.loadBranches.mockResolvedValue({ items: [], total: 0 });
		h.createBranch.mockResolvedValue(branch('new'));
		h.abandonBranch.mockResolvedValue(undefined);
		h.diffBranch.mockResolvedValue({
			branch_id: 'a',
			root_project_id: PID,
			child_project_id: 'child-a',
			status: 'open',
			base_snapshot_id: 'snap-a',
			root_fingerprint: 'fp-1',
			conflict_count: 0,
			entries: []
		});
	});

	it('fetches the branch list on mount when the cache is cold', async () => {
		h.getBranches.mockReturnValue(undefined);
		h.getBranchList.mockReturnValue([]);
		h.areBranchesLoading.mockReturnValue(false);

		render(StoryboardBranches, { props: { projectId: PID } });
		await waitFor(() => expect(h.loadBranches).toHaveBeenCalledWith(PID));
	});

	it('does not fetch when the store already has a cached list', () => {
		seed([branch('a')]);
		render(StoryboardBranches, { props: { projectId: PID } });
		expect(h.loadBranches).not.toHaveBeenCalled();
	});

	it('renders an empty state when there are no branches', () => {
		seed([]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		expect(container.querySelector('[data-testid="branch-empty"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="branch-list"]')).toBeNull();
	});

	it('renders a row per branch in the order the store returns them (newest first)', () => {
		seed([branch('b', { name: 'newest' }), branch('a', { name: 'oldest' })]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const rows = [...container.querySelectorAll('[data-testid="branch-item"]')];
		expect(rows.length).toBe(2);
		expect(rows[0].getAttribute('data-branch-id')).toBe('b');
		expect(rows[0].textContent).toContain('newest');
		expect(rows[1].getAttribute('data-branch-id')).toBe('a');
	});

	it('disables Branch until the name is more than whitespace', async () => {
		seed([]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const input = container.querySelector('[data-testid="branch-name"]') as HTMLInputElement;
		const create = container.querySelector('[data-testid="branch-create"]') as HTMLButtonElement;
		expect(create.disabled).toBe(true);

		await fireEvent.input(input, { target: { value: '   ' } });
		expect(create.disabled).toBe(true);

		await fireEvent.input(input, { target: { value: 'shorter cold open' } });
		expect(create.disabled).toBe(false);
	});

	it('creates the branch, clears the input and toasts success', async () => {
		seed([]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const input = container.querySelector('[data-testid="branch-name"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '  shorter cold open  ' } });
		await fireEvent.click(container.querySelector('[data-testid="branch-create"]')!);

		await waitFor(() => expect(h.createBranch).toHaveBeenCalledWith(PID, 'shorter cold open'));
		await waitFor(() => expect(input.value).toBe(''));
		expect(h.toastSuccess).toHaveBeenCalled();
		expect(h.toastError).not.toHaveBeenCalled();
	});

	it('surfaces a create failure with the server detail, not a hand-rolled message', async () => {
		// Branch-of-branch is legal now (#483), so there is no "already a branch" 409 to
		// translate; the only create error is a missing/cross-tenant root (404). Whatever
		// the server says is shown verbatim — no special-casing on this endpoint anymore.
		seed([]);
		h.createBranch.mockRejectedValue(new h.MockApiError(404, 'project not found'));
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const input = container.querySelector('[data-testid="branch-name"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'nested' } });
		await fireEvent.click(container.querySelector('[data-testid="branch-create"]')!);

		await waitFor(() => expect(h.toastError).toHaveBeenCalled());
		expect(h.toastError.mock.calls[0][1]).toBe('project not found');
		expect(h.toastSuccess).not.toHaveBeenCalled();
	});

	it('creates a branch OF a branch without error — forking a branch is allowed', async () => {
		// The FE must not re-impose the removed one-level-deep rule: a normal create on a
		// project that happens to be a branch just succeeds.
		seed([]);
		h.createBranch.mockResolvedValue(undefined);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const input = container.querySelector('[data-testid="branch-name"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'nested cut' } });
		await fireEvent.click(container.querySelector('[data-testid="branch-create"]')!);

		await waitFor(() => expect(h.createBranch).toHaveBeenCalledWith(PID, 'nested cut'));
		expect(h.toastSuccess).toHaveBeenCalled();
		expect(h.toastError).not.toHaveBeenCalled();
	});

	it('requires an inline confirm before abandoning — the first click only prompts', async () => {
		seed([branch('a')]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="branch-abandon-a"]')!);

		expect(h.abandonBranch).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="branch-abandon-confirm"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="branch-abandon-cancel"]')).toBeTruthy();
	});

	it('calls abandonBranch with the project + branch id once the confirm is accepted', async () => {
		seed([branch('a')]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="branch-abandon-a"]')!);
		await fireEvent.click(container.querySelector('[data-testid="branch-abandon-confirm"]')!);

		await waitFor(() => expect(h.abandonBranch).toHaveBeenCalledWith(PID, 'a'));
	});

	it('cancelling the abandon confirm restores the Abandon button and calls nothing', async () => {
		seed([branch('a')]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="branch-abandon-a"]')!);
		await fireEvent.click(container.querySelector('[data-testid="branch-abandon-cancel"]')!);

		expect(h.abandonBranch).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="branch-abandon-confirm"]')).toBeNull();
		expect(container.querySelector('[data-testid="branch-abandon-a"]')).toBeTruthy();
	});

	it('links Open at the child project workspace', () => {
		seed([branch('a', { child_project_id: 'child-9' })]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const open = container.querySelector('[data-testid="branch-open-a"]') as HTMLAnchorElement;
		expect(open.getAttribute('href')).toBe('/projects/child-9');
	});

	it('renders no actions on a merged branch — it is read-only history', () => {
		seed([branch('m', { status: 'merged', merged_at: new Date().toISOString() })]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		expect(container.querySelector('[data-testid="branch-item"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="branch-abandon-m"]')).toBeNull();
		expect(container.querySelector('[data-testid="branch-open-m"]')).toBeNull();
		expect(container.querySelector('[data-testid="branch-review-m"]')).toBeNull();
	});

	it('opens the merge review inline for an open branch, and toggles it shut again', async () => {
		seed([branch('a')]);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		expect(container.querySelector('[data-testid="branch-merge-review"]')).toBeNull();

		await fireEvent.click(container.querySelector('[data-testid="branch-review-a"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="branch-merge-review"]')).toBeTruthy()
		);
		expect(h.diffBranch).toHaveBeenCalledWith(PID, 'a');

		await fireEvent.click(container.querySelector('[data-testid="branch-review-a"]')!);
		expect(container.querySelector('[data-testid="branch-merge-review"]')).toBeNull();
	});

	it('sizes the pager from the server total, not the page length', () => {
		// 45 branches / PAGE_SIZE 20 → 3 pages, even though one item is rendered.
		seed([branch('a')], 45);
		const { container } = render(StoryboardBranches, { props: { projectId: PID } });

		const pager = container.querySelector('[data-testid="branches-pagination"]')!;
		const numbered = [...pager.querySelectorAll('button')].map((b) => b.textContent?.trim());
		expect(numbered).toContain('3');
		expect(numbered).not.toContain('4');
	});
});

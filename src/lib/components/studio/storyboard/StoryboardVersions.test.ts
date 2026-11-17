import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store is the seam: the component owns the confirm/loading UX, the store
// owns the cache refresh. Mock every store fn the component imports — an
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
		loadSnapshots: vi.fn(),
		getSnapshots: vi.fn(),
		getSnapshotList: vi.fn(),
		getSnapshotsPage: vi.fn(),
		areSnapshotsLoading: vi.fn(),
		createSnapshot: vi.fn(),
		restoreSnapshot: vi.fn(),
		deleteSnapshot: vi.fn()
	};
});

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	loadSnapshots: h.loadSnapshots,
	getSnapshots: h.getSnapshots,
	getSnapshotList: h.getSnapshotList,
	getSnapshotsPage: h.getSnapshotsPage,
	areSnapshotsLoading: h.areSnapshotsLoading,
	createSnapshot: h.createSnapshot,
	restoreSnapshot: h.restoreSnapshot,
	deleteSnapshot: h.deleteSnapshot,
	PAGE_SIZE: 20
}));

vi.mock('$lib/api', () => ({ ApiError: h.MockApiError }));

vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn()
}));

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import StoryboardVersions from './StoryboardVersions.svelte';
import type { StoryboardSnapshot } from '$lib/types';

const PID = 'proj-1';

function snap(id: string, over: Partial<StoryboardSnapshot> = {}): StoryboardSnapshot {
	return {
		id,
		kind: 'manual',
		note: null,
		actor_subject: null,
		created_at: new Date().toISOString(),
		...over
	};
}

/** Seed the mocked store so the component renders `items` without fetching. */
function seed(items: StoryboardSnapshot[], total = items.length): void {
	h.getSnapshots.mockReturnValue({ items, total });
	h.getSnapshotList.mockReturnValue(items);
	h.getSnapshotsPage.mockReturnValue(1);
	h.areSnapshotsLoading.mockReturnValue(false);
}

describe('StoryboardVersions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.getSnapshotsPage.mockReturnValue(1);
		h.createSnapshot.mockResolvedValue(snap('new'));
		h.restoreSnapshot.mockResolvedValue({
			restored_snapshot_id: 'a',
			auto_snapshot_id: 'auto-1'
		});
		h.deleteSnapshot.mockResolvedValue(undefined);
	});

	it('renders a row per snapshot with its note', () => {
		seed([snap('a', { note: 'before act 2' }), snap('b')]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		expect(container.querySelector('[data-testid="snapshot-list"]')).toBeTruthy();
		expect(container.querySelectorAll('[data-testid="snapshot-item"]').length).toBe(2);
		expect(container.textContent).toContain('before act 2');
	});

	it('distinguishes auto from manual snapshots with a badge', () => {
		seed([snap('a', { kind: 'auto' }), snap('b', { kind: 'manual' })]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const rows = [...container.querySelectorAll('[data-testid="snapshot-item"]')];
		expect(rows[0].textContent).toContain('auto');
		expect(rows[1].textContent).toContain('manual');
	});

	it('renders an empty state when there are no snapshots', () => {
		seed([]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		expect(container.querySelector('[data-testid="snapshot-empty"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="snapshot-list"]')).toBeNull();
	});

	it('does not fetch when the store already has a cached list', () => {
		seed([snap('a')]);
		render(StoryboardVersions, { props: { projectId: PID } });
		expect(h.loadSnapshots).not.toHaveBeenCalled();
	});

	it('fetches the snapshot list on mount when the cache is cold', async () => {
		h.getSnapshots.mockReturnValue(undefined);
		h.getSnapshotList.mockReturnValue([]);
		h.areSnapshotsLoading.mockReturnValue(false);
		h.loadSnapshots.mockResolvedValue([]);

		render(StoryboardVersions, { props: { projectId: PID } });
		await waitFor(() => expect(h.loadSnapshots).toHaveBeenCalledWith(PID));
	});

	it('calls createSnapshot with the typed note when Snapshot is clicked', async () => {
		seed([]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const input = container.querySelector('[data-testid="snapshot-note"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'pre-restore' } });
		await fireEvent.click(container.querySelector('[data-testid="snapshot-create"]')!);

		await waitFor(() => expect(h.createSnapshot).toHaveBeenCalledWith(PID, 'pre-restore'));
	});

	it('omits an all-whitespace note rather than sending it', async () => {
		seed([]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const input = container.querySelector('[data-testid="snapshot-note"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '   ' } });
		await fireEvent.click(container.querySelector('[data-testid="snapshot-create"]')!);

		await waitFor(() => expect(h.createSnapshot).toHaveBeenCalledWith(PID, undefined));
	});

	it('requires an inline confirm before restoring — the first click only prompts', async () => {
		seed([snap('a')]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="snapshot-restore-a"]')!);

		expect(h.restoreSnapshot).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="snapshot-restore-confirm"]')).toBeTruthy();
	});

	it('calls restoreSnapshot once the inline confirm is accepted', async () => {
		seed([snap('a')]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="snapshot-restore-a"]')!);
		await fireEvent.click(container.querySelector('[data-testid="snapshot-restore-confirm"]')!);

		await waitFor(() => expect(h.restoreSnapshot).toHaveBeenCalledWith(PID, 'a'));
	});

	it('cancelling the confirm restores the plain Restore button and calls nothing', async () => {
		seed([snap('a')]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="snapshot-restore-a"]')!);
		await fireEvent.click(container.querySelector('[data-testid="snapshot-restore-cancel"]')!);

		expect(h.restoreSnapshot).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="snapshot-restore-confirm"]')).toBeNull();
		expect(container.querySelector('[data-testid="snapshot-restore-a"]')).toBeTruthy();
	});

	// ── Delete (manual-only, two-step confirm) ──────────────────────────────────

	it('shows a Delete control on manual snapshots and hides it on auto ones', () => {
		seed([snap('a', { kind: 'manual' }), snap('b', { kind: 'auto' })]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const manualRow = container.querySelector('[data-snapshot-id="a"]')!;
		const autoRow = container.querySelector('[data-snapshot-id="b"]')!;
		expect(manualRow.querySelector('[data-testid="delete-snapshot"]')).toBeTruthy();
		expect(autoRow.querySelector('[data-testid="delete-snapshot"]')).toBeNull();
	});

	it('requires an inline confirm before deleting — the first click only prompts', async () => {
		seed([snap('a', { kind: 'manual' })]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="delete-snapshot"]')!);

		expect(h.deleteSnapshot).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="snapshot-delete-prompt"]')).toBeTruthy();
	});

	it('calls deleteSnapshot with the project + snapshot id once the confirm is accepted', async () => {
		seed([snap('a', { kind: 'manual' })]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="delete-snapshot"]')!);
		await fireEvent.click(container.querySelector('[data-testid="snapshot-delete-confirm"]')!);

		await waitFor(() => expect(h.deleteSnapshot).toHaveBeenCalledWith(PID, 'a'));
	});

	it('cancelling the delete confirm restores the Delete button and calls nothing', async () => {
		seed([snap('a', { kind: 'manual' })]);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		await fireEvent.click(container.querySelector('[data-testid="delete-snapshot"]')!);
		await fireEvent.click(container.querySelector('[data-testid="snapshot-delete-cancel"]')!);

		expect(h.deleteSnapshot).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="snapshot-delete-prompt"]')).toBeNull();
		expect(container.querySelector('[data-testid="delete-snapshot"]')).toBeTruthy();
	});

	// ── Pagination ──────────────────────────────────────────────────────────────

	it('renders a numbered pager sized by the server total', () => {
		// 45 items / PAGE_SIZE 20 → 3 pages.
		seed([snap('a')], 45);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const pager = container.querySelector('[data-testid="snapshots-pagination"]')!;
		const numbered = [...pager.querySelectorAll('button')].map((b) => b.textContent?.trim());
		expect(numbered).toContain('3');
		expect(numbered).not.toContain('4');
	});

	it('reloads at the correct offset when a page is selected', async () => {
		seed([snap('a')], 45);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const pager = container.querySelector('[data-testid="snapshots-pagination"]')!;
		const pageTwo = [...pager.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === '2'
		)!;
		await fireEvent.click(pageTwo);

		// Page 2 → offset (2 - 1) * PAGE_SIZE = 20.
		await waitFor(() =>
			expect(h.loadSnapshots).toHaveBeenCalledWith(PID, { limit: 20, offset: 20 })
		);
	});

	it('does not render a pager when a single page holds every snapshot', () => {
		seed([snap('a'), snap('b')], 2);
		const { container } = render(StoryboardVersions, { props: { projectId: PID } });

		const pager = container.querySelector('[data-testid="snapshots-pagination"]')!;
		// Pagination renders nothing when totalPages <= 1.
		expect(pager.querySelector('button')).toBeNull();
	});
});

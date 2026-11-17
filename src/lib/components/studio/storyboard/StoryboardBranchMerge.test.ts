import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same seam as StoryboardBranches: the store owns the network + the post-merge
// cache refresh, the component owns the review UX. Mock every store fn the
// component imports — an un-listed export is `undefined` and calling it throws.
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
		diffBranch: vi.fn(),
		mergeBranch: vi.fn(),
		diffAgainstBranch: vi.fn(),
		mergeIntoBranch: vi.fn(),
		getBranchList: vi.fn(),
		loadBranches: vi.fn(),
		toastError: vi.fn(),
		toastSuccess: vi.fn()
	};
});

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	diffBranch: h.diffBranch,
	mergeBranch: h.mergeBranch,
	diffAgainstBranch: h.diffAgainstBranch,
	mergeIntoBranch: h.mergeIntoBranch,
	getBranchList: h.getBranchList,
	loadBranches: h.loadBranches
}));

vi.mock('$lib/api', () => ({ ApiError: h.MockApiError }));

vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: h.toastError,
	toastSuccess: h.toastSuccess
}));

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import StoryboardBranchMerge from './StoryboardBranchMerge.svelte';
import type { BranchDiffResponse, DiffEntry, StoryboardBranch } from '$lib/types';

const PID = 'proj-1';
const BID = 'branch-1';
const FINGERPRINT = 'fp-abc123';

const BRANCH: StoryboardBranch = {
	id: BID,
	root_project_id: PID,
	child_project_id: 'child-1',
	name: 'shorter cold open',
	base_snapshot_id: 'snap-1',
	status: 'open',
	created_at: new Date().toISOString(),
	merged_at: null
};

function entry(over: Partial<DiffEntry> = {}): DiffEntry {
	return {
		key: 'clip-1',
		kind: 'modified',
		shot_key: 'clip-1',
		base: { action_description: 'base action', dialogue: 'hi' },
		main: { action_description: 'base action', dialogue: 'hi' },
		branch: { action_description: 'branch action', dialogue: 'hi' },
		changed_fields: ['action_description'],
		main_changed_fields: [],
		...over
	};
}

// Server allowlist for these fixtures: content columns are per-field mergeable; `scene` and the
// other lineage keys are intentionally absent so the fenced-conflict case still exercises it.
const MERGEABLE_FIELDS = ['vo_text', 'dialogue', 'action_description'];

function diff(entries: DiffEntry[]): BranchDiffResponse {
	return {
		branch_id: BID,
		root_project_id: PID,
		child_project_id: 'child-1',
		status: 'open',
		base_snapshot_id: 'snap-1',
		root_fingerprint: FINGERPRINT,
		conflict_count: entries.filter((e) => e.kind === 'conflict').length,
		entries,
		mergeable_fields: MERGEABLE_FIELDS
	};
}

function mergeResp() {
	return {
		branch_id: BID,
		status: 'merged' as const,
		merged_at: new Date().toISOString(),
		auto_snapshot_id: 'snap-auto',
		applied: ['clip-1'],
		skipped: [],
		root_fingerprint: 'fp-next'
	};
}

function siblingMergeResp() {
	return {
		source_branch_id: BID,
		target_branch_id: 'branch-2',
		auto_snapshot_id: 'snap-auto',
		applied: ['clip-1'],
		skipped: [],
		target_fingerprint: 'fp-next'
	};
}

const SIBLING: StoryboardBranch = {
	id: 'branch-2',
	root_project_id: PID,
	child_project_id: 'child-2',
	name: 'longer cold open',
	base_snapshot_id: 'snap-1',
	status: 'open',
	created_at: new Date().toISOString(),
	merged_at: null
};

function mount(onClose = vi.fn()) {
	return {
		onClose,
		...render(StoryboardBranchMerge, { props: { projectId: PID, branch: BRANCH, onClose } })
	};
}

describe('StoryboardBranchMerge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.diffBranch.mockResolvedValue(diff([entry()]));
		h.mergeBranch.mockResolvedValue(mergeResp());
		h.diffAgainstBranch.mockResolvedValue(diff([entry()]));
		h.mergeIntoBranch.mockResolvedValue(siblingMergeResp());
		// No sibling branches by default → the picker is absent, default branch→root mode holds.
		h.getBranchList.mockReturnValue([]);
		h.loadBranches.mockResolvedValue([]);
	});

	it('loads the diff for this branch on mount', async () => {
		mount();
		await waitFor(() => expect(h.diffBranch).toHaveBeenCalledWith(PID, BID));
	});

	it('renders base | main | branch columns per entry, highlighting the changed fields', async () => {
		h.diffBranch.mockResolvedValue(diff([entry()]));
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-entry"]')).toBeTruthy()
		);
		const row = container.querySelector('[data-testid="merge-entry"]')!;
		expect(row.querySelector('[data-testid="merge-column-base"]')).toBeTruthy();
		expect(row.querySelector('[data-testid="merge-column-main"]')).toBeTruthy();
		expect(row.querySelector('[data-testid="merge-column-branch"]')).toBeTruthy();
		expect(row.querySelectorAll('[data-testid^="merge-column-"]').length).toBe(3);

		// The branch changed `action_description`; base + main did not.
		const cell = (side: string) =>
			row.querySelector(`[data-testid="merge-column-${side}"] [data-field="action_description"]`)!;
		expect(cell('branch').getAttribute('data-changed')).toBe('true');
		expect(cell('branch').textContent).toContain('branch action');
		expect(cell('main').getAttribute('data-changed')).toBe('false');
		expect(cell('base').getAttribute('data-changed')).toBe('false');
	});

	it('marks the side a panel is absent from (added has no base/main, deleted no branch)', async () => {
		h.diffBranch.mockResolvedValue(
			diff([
				entry({
					key: 'clip-9',
					kind: 'added',
					shot_key: 'clip-9',
					base: null,
					main: null,
					changed_fields: ['action_description'],
					main_changed_fields: []
				})
			])
		);
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-entry"]')).toBeTruthy()
		);
		const row = container.querySelector('[data-testid="merge-entry"]')!;
		expect(row.getAttribute('data-entry-kind')).toBe('added');
		expect(
			row.querySelector('[data-testid="merge-column-base"] [data-testid="merge-absent"]')
		).toBeTruthy();
		expect(
			row.querySelector('[data-testid="merge-column-branch"] [data-testid="merge-absent"]')
		).toBeNull();
	});

	it('renders the empty diff state and no merge button when there is nothing to merge', async () => {
		h.diffBranch.mockResolvedValue(diff([]));
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-empty"]')).toBeTruthy()
		);
		expect(container.querySelector('[data-testid="merge-confirm"]')).toBeNull();
	});

	it('degrades gracefully when the merge routes are not deployed (404)', async () => {
		h.diffBranch.mockRejectedValue(new h.MockApiError(404, 'Not Found'));
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-error"]')).toBeTruthy()
		);
		expect(container.querySelector('[data-testid="merge-error"]')!.textContent).toContain(
			'not available on this server yet'
		);
		expect(container.querySelector('[data-testid="merge-confirm"]')).toBeNull();
	});

	it('defaults non-conflict entries to `branch` and submits them without any clicks', async () => {
		h.diffBranch.mockResolvedValue(
			diff([
				entry({ key: 'clip-1', kind: 'modified' }),
				entry({ key: 'clip-2', kind: 'added', base: null, main: null }),
				entry({ key: 'clip-3', kind: 'deleted', branch: null })
			])
		);
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-confirm"]')).toBeTruthy()
		);
		const confirm = container.querySelector('[data-testid="merge-confirm"]') as HTMLButtonElement;
		expect(confirm.disabled).toBe(false);

		const pressed = (key: string, res: string) =>
			container
				.querySelector(`[data-testid="merge-resolution-${key}-${res}"]`)!
				.getAttribute('aria-pressed');
		expect(pressed('clip-1', 'branch')).toBe('true');
		expect(pressed('clip-1', 'main')).toBe('false');

		await fireEvent.click(confirm);
		await waitFor(() => expect(h.mergeBranch).toHaveBeenCalled());
		expect(h.mergeBranch).toHaveBeenCalledWith(PID, BID, {
			root_fingerprint: FINGERPRINT,
			resolutions: [
				{ key: 'clip-1', resolution: 'branch' },
				{ key: 'clip-2', resolution: 'branch' },
				{ key: 'clip-3', resolution: 'branch' }
			]
		});
	});

	it('blocks the merge until every conflict has a choice, then submits the picks', async () => {
		h.diffBranch.mockResolvedValue(
			diff([
				entry({ key: 'clip-1', kind: 'modified' }),
				entry({
					key: 'clip-2',
					kind: 'conflict',
					shot_key: 'clip-2',
					changed_fields: ['dialogue'],
					main_changed_fields: ['dialogue']
				})
			])
		);
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-confirm"]')).toBeTruthy()
		);
		const confirm = container.querySelector('[data-testid="merge-confirm"]') as HTMLButtonElement;

		// A conflict has NO default — the button is dead and the row says why.
		expect(confirm.disabled).toBe(true);
		// Normalised: Svelte keeps the template's newlines/tabs around the interpolation.
		const blocked = container
			.querySelector('[data-testid="merge-blocked"]')!
			.textContent!.replace(/\s+/g, ' ')
			.trim();
		expect(blocked).toContain('1 conflict needs a choice');
		expect(container.querySelector('[data-testid="merge-needs-choice"]')).toBeTruthy();
		expect(
			container
				.querySelector('[data-testid="merge-resolution-clip-2-branch"]')!
				.getAttribute('aria-pressed')
		).toBe('false');

		await fireEvent.click(container.querySelector('[data-testid="merge-resolution-clip-2-main"]')!);

		expect(confirm.disabled).toBe(false);
		expect(container.querySelector('[data-testid="merge-blocked"]')).toBeNull();
		expect(container.querySelector('[data-testid="merge-needs-choice"]')).toBeNull();

		await fireEvent.click(confirm);
		await waitFor(() =>
			expect(h.mergeBranch).toHaveBeenCalledWith(PID, BID, {
				root_fingerprint: FINGERPRINT,
				resolutions: [
					{ key: 'clip-1', resolution: 'branch' },
					{ key: 'clip-2', resolution: 'main' }
				]
			})
		);
		expect(h.mergeBranch).toHaveBeenCalledTimes(1);
	});

	it('offers keep_both on a conflict and submits it', async () => {
		h.diffBranch.mockResolvedValue(
			diff([
				entry({
					key: 'clip-2',
					kind: 'conflict',
					shot_key: 'clip-2',
					changed_fields: ['dialogue'],
					main_changed_fields: ['dialogue']
				})
			])
		);
		const { container } = mount();

		await waitFor(() =>
			expect(
				container.querySelector('[data-testid="merge-resolution-clip-2-keep_both"]')
			).toBeTruthy()
		);
		await fireEvent.click(
			container.querySelector('[data-testid="merge-resolution-clip-2-keep_both"]')!
		);
		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);

		await waitFor(() =>
			expect(h.mergeBranch).toHaveBeenCalledWith(PID, BID, {
				root_fingerprint: FINGERPRINT,
				resolutions: [{ key: 'clip-2', resolution: 'keep_both' }]
			})
		);
	});

	it('honours an override of a non-conflict entry to `skip`', async () => {
		const { container } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-confirm"]')).toBeTruthy()
		);

		await fireEvent.click(container.querySelector('[data-testid="merge-resolution-clip-1-skip"]')!);
		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);

		await waitFor(() =>
			expect(h.mergeBranch).toHaveBeenCalledWith(PID, BID, {
				root_fingerprint: FINGERPRINT,
				resolutions: [{ key: 'clip-1', resolution: 'skip' }]
			})
		);
	});

	it('closes and toasts success (mentioning the undo snapshot) on a merge', async () => {
		const { container, onClose } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-confirm"]')).toBeTruthy()
		);

		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(h.toastSuccess).toHaveBeenCalled();
		expect(h.toastSuccess.mock.calls[0][1]).toContain('snapshot');
		expect(h.toastError).not.toHaveBeenCalled();
	});

	it('surfaces a 409 as a plain-language stale-diff message with a reload action', async () => {
		h.mergeBranch.mockRejectedValue(new h.MockApiError(409, 'root fingerprint mismatch'));
		const { container, onClose } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-confirm"]')).toBeTruthy()
		);

		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-stale"]')).toBeTruthy()
		);
		const stale = container.querySelector('[data-testid="merge-stale"]')!;
		expect(stale.textContent).toContain('changed while you were reviewing');
		// Not closed, not a success — and the backend's raw detail is not leaked.
		expect(onClose).not.toHaveBeenCalled();
		expect(h.toastSuccess).not.toHaveBeenCalled();
		expect(stale.textContent).not.toContain('fingerprint');

		// The recovery is a REFETCH, not a resubmit of the same stale fingerprint.
		h.diffBranch.mockClear();
		await fireEvent.click(container.querySelector('[data-testid="merge-reload"]')!);
		await waitFor(() => expect(h.diffBranch).toHaveBeenCalledWith(PID, BID));
		expect(h.mergeBranch).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(container.querySelector('[data-testid="merge-stale"]')).toBeNull());
	});

	it('surfaces any other merge failure as an error toast and stays open', async () => {
		h.mergeBranch.mockRejectedValue(new h.MockApiError(500, 'boom'));
		const { container, onClose } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-confirm"]')).toBeTruthy()
		);

		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);

		await waitFor(() => expect(h.toastError).toHaveBeenCalled());
		expect(onClose).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="merge-stale"]')).toBeNull();
	});

	// ── per-field conflict resolution ──────────────────────────────────────────
	const twoFieldConflict = () =>
		diff([
			entry({
				key: 'clip-2',
				kind: 'conflict',
				shot_key: 'clip-2',
				changed_fields: ['vo_text', 'dialogue'],
				main_changed_fields: ['vo_text', 'dialogue']
			})
		]);

	it('offers per-field branch/main toggles on a content conflict and submits the field picks', async () => {
		h.diffBranch.mockResolvedValue(twoFieldConflict());
		const { container } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-field-picks"]')).toBeTruthy()
		);
		const confirm = container.querySelector('[data-testid="merge-confirm"]') as HTMLButtonElement;

		// A toggle per conflicting field; the merge is blocked until EVERY field is picked.
		expect(
			container.querySelector('[data-testid="merge-field-clip-2-vo_text-branch"]')
		).toBeTruthy();
		expect(
			container.querySelector('[data-testid="merge-field-clip-2-dialogue-main"]')
		).toBeTruthy();
		expect(confirm.disabled).toBe(true);

		await fireEvent.click(
			container.querySelector('[data-testid="merge-field-clip-2-vo_text-branch"]')!
		);
		expect(confirm.disabled).toBe(true); // dialogue still unpicked — negative control on the gate
		await fireEvent.click(
			container.querySelector('[data-testid="merge-field-clip-2-dialogue-main"]')!
		);
		expect(confirm.disabled).toBe(false);

		await fireEvent.click(confirm);
		await waitFor(() =>
			expect(h.mergeBranch).toHaveBeenCalledWith(PID, BID, {
				root_fingerprint: FINGERPRINT,
				resolutions: [{ key: 'clip-2', field_resolutions: { vo_text: 'branch', dialogue: 'main' } }]
			})
		);
	});

	it('shows whole-row only (no per-field toggles) when a conflicting field is fenced', async () => {
		// `scene` is a lineage key → not per-field mergeable; the whole-row buttons stay as the
		// escape hatch. (Contrast the two-field content conflict above, which DOES render toggles.)
		h.diffBranch.mockResolvedValue(
			diff([
				entry({
					key: 'clip-2',
					kind: 'conflict',
					shot_key: 'clip-2',
					changed_fields: ['scene'],
					main_changed_fields: ['scene']
				})
			])
		);
		const { container } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-entry"]')).toBeTruthy()
		);
		expect(container.querySelector('[data-testid="merge-field-picks"]')).toBeNull();
		expect(container.querySelector('[data-testid="merge-resolution-clip-2-main"]')).toBeTruthy();
	});

	it('discards per-field picks when a whole-row verdict is chosen (mutual exclusion)', async () => {
		h.diffBranch.mockResolvedValue(twoFieldConflict());
		const { container } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-field-picks"]')).toBeTruthy()
		);

		await fireEvent.click(
			container.querySelector('[data-testid="merge-field-clip-2-vo_text-branch"]')!
		);
		// Switching to a whole-row keep_both must clear the field picks — the payload carries
		// ONLY the whole-row verdict, never both (the server 422s a resolution holding both).
		await fireEvent.click(
			container.querySelector('[data-testid="merge-resolution-clip-2-keep_both"]')!
		);
		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);

		await waitFor(() =>
			expect(h.mergeBranch).toHaveBeenCalledWith(PID, BID, {
				root_fingerprint: FINGERPRINT,
				resolutions: [{ key: 'clip-2', resolution: 'keep_both' }]
			})
		);
	});

	// ── sibling merge (branch → another open branch) ────────────────────────────
	it('hides the target picker when the project has no other open branches', async () => {
		h.getBranchList.mockReturnValue([]);
		const { container } = mount();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-entry"]')).toBeTruthy()
		);
		expect(container.querySelector('[data-testid="merge-target-picker"]')).toBeNull();
		// Default mode still diffs against the root.
		expect(h.diffBranch).toHaveBeenCalledWith(PID, BID);
		expect(h.diffAgainstBranch).not.toHaveBeenCalled();
	});

	it('offers open siblings as targets and switches to a sibling diff + merge-into on select', async () => {
		h.getBranchList.mockReturnValue([
			BRANCH, // self — excluded
			SIBLING, // open sibling — offered
			{ ...SIBLING, id: 'branch-3', name: 'merged one', status: 'merged' } // not open — excluded
		]);
		const { container } = mount();

		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-target-select"]')).toBeTruthy()
		);
		const select = container.querySelector(
			'[data-testid="merge-target-select"]'
		) as HTMLSelectElement;
		// Root option + the single open sibling (self + merged excluded).
		const values = Array.from(select.options).map((o) => o.value);
		expect(values).toEqual(['', 'branch-2']);

		await fireEvent.change(select, { target: { value: 'branch-2' } });
		await waitFor(() => expect(h.diffAgainstBranch).toHaveBeenCalledWith(PID, BID, 'branch-2'));
		// Middle column is relabelled to the target branch's name.
		await waitFor(() =>
			expect(container.querySelector('[data-testid="merge-column-main"]')!.textContent).toContain(
				'longer cold open'
			)
		);

		await fireEvent.click(container.querySelector('[data-testid="merge-confirm"]')!);
		await waitFor(() =>
			expect(h.mergeIntoBranch).toHaveBeenCalledWith(PID, BID, {
				target_branch_id: 'branch-2',
				target_fingerprint: FINGERPRINT,
				resolutions: [{ key: 'clip-1', resolution: 'branch' }]
			})
		);
		// Sibling merge does NOT fall through to the root merge verb.
		expect(h.mergeBranch).not.toHaveBeenCalled();
	});
});

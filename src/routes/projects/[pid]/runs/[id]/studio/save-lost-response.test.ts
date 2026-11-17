import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Renders the Studio page and proves the property the orchestrator DB pins:
 * once a save's POST has produced a child run, the app MUST end up on that
 * child's studio URL — even when the response to the first attempt is lost.
 *
 * Evidence this is written against (nightly `pr-studio-clip-reorder`, jobs
 * 99026621358 / 99310982353): the child `runs` row was created +0.54s / +0.15s
 * after the click, the page was still on the parent 30s later, and pf.log shows
 * kubectl port-forward stream resets in the same second. Time was never the
 * constraint — a re-delivered response was.
 */
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
const goto = vi.fn().mockResolvedValue(undefined);
vi.mock('$app/navigation', () => ({
	goto: (...a: unknown[]) => goto(...a),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
const toastError = vi.fn();
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: (...a: unknown[]) => toastError(...a),
	toastSuccess: vi.fn()
}));

vi.mock('$lib/stores/job-progress', () => ({
	JobProgressState: class {
		jobStatus = 'completed';
		isTerminal = true;
		hydrateFromDetail() {}
		connect() {}
		disconnect() {}
	}
}));

// Hoisted so BOTH module mocks below can share ONE class: `+page.svelte` tests
// `err instanceof ApiError` against `$lib/api`, and `spawn-child-run` tests it
// against `$lib/api/client.js`. Two different classes there would make a 422 look
// like a lost response.
const { ApiError } = vi.hoisted(() => ({
	ApiError: class ApiError extends Error {
		constructor(
			public status: number,
			statusText: string,
			public detail: string
		) {
			super(`${status} ${statusText}`);
		}
	}
}));

const reorderClips = vi.fn();
const regenerate = vi.fn();
vi.mock('$lib/api', () => ({
	ApiError,
	runs: {
		reorderClips: (...args: unknown[]) => reorderClips(...args),
		regenerate: (...args: unknown[]) => regenerate(...args),
		applyClipEdits: vi.fn(),
		regenerateClip: vi.fn(),
		renarrateClip: vi.fn(),
		// The whole-run confirmation previews the restart plan (RestartRunModal).
		restartPlan: vi.fn().mockResolvedValue({
			run_id: 'r1',
			mode: 'full',
			full_reasons: [{ code: 'nothing_changed', message: '', stage: null, inputs: [] }],
			changed_inputs: [],
			stages: []
		})
	},
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([]),
	uploads: { voiceover: vi.fn() }
}));

// The real module — it is the unit under test, not a stub. It imports ApiError
// from `./client.js`, so give the spawn helper the SAME class the page throws.
vi.mock('$lib/api/client.js', () => ({
	ApiError,
	scopedMediaUrl: (u: string) => u
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';

function makeData() {
	return {
		project: { id: 'p1', title: 'Proj' },
		run: {
			id: 'r1',
			status: 'completed',
			config_snapshot: {},
			stage_outputs: [
				{
					stage_name: 'storyboard',
					status: 'completed',
					output: { lines: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] }
				},
				{ stage_name: 'compile', status: 'completed', output: { video_url: 'https://x/v.mp4' } }
			]
		},
		spineStageName: 'storyboard',
		// The loader now also reports whether the SERVER will accept a reorder of
		// that stage (`clip_spine_stage`); reorder is gated on it, not on run
		// status alone. These tests exercise the reorder path, so: true.
		spineReorderable: true,
		annotations: []
	} as never;
}

/** Reorder the first clip one slot right — the only thing that arms `save-order`. */
async function makeOrderDirty(container: HTMLElement) {
	const handle = container.querySelector('[data-testid="clip-drag-handle"]')!;
	await fireEvent.keyDown(handle, { key: 'ArrowRight' });
	await tick();
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio save — the child run exists, so the app must reach it', () => {
	it('navigates to the child studio when the first POST response is lost', async () => {
		// Attempt 1: the connection dies AFTER the orchestrator created the child.
		// Attempt 2 replays it under the same Idempotency-Key.
		reorderClips
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce({ id: 'child-9' });

		const { container } = render(Page, { data: makeData() });
		await makeOrderDirty(container);

		await fireEvent.click(screen.getByTestId('save-order').querySelector('button')!);

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/projects/p1/runs/child-9/studio'));
		expect(reorderClips).toHaveBeenCalledTimes(2);
		// Same key on both attempts — this is what stops the retry creating a SECOND
		// child run for the same click.
		const keyA = (reorderClips.mock.calls[0][3] as { idempotencyKey: string }).idempotencyKey;
		const keyB = (reorderClips.mock.calls[1][3] as { idempotencyKey: string }).idempotencyKey;
		expect(keyA).toBeTruthy();
		expect(keyB).toBe(keyA);
		expect(toastError).not.toHaveBeenCalled();
	});

	it('re-sends the IDENTICAL order body on the retry', async () => {
		reorderClips
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce({ id: 'child-9' });

		const { container } = render(Page, { data: makeData() });
		await makeOrderDirty(container);
		await fireEvent.click(screen.getByTestId('save-order').querySelector('button')!);
		await waitFor(() => expect(reorderClips).toHaveBeenCalledTimes(2));

		// A differing body is a DIFFERENT idempotency entry — the key would stop
		// protecting the create and the retry would spawn a second run.
		expect(reorderClips.mock.calls[1][2]).toEqual(reorderClips.mock.calls[0][2]);
		expect(reorderClips.mock.calls[0][2]).toEqual(['l2', 'l1', 'l3']);
	});

	it('still surfaces an answered failure without retrying it', async () => {
		reorderClips.mockRejectedValue(new ApiError(422, 'Unprocessable', 'still rendering'));

		const { container } = render(Page, { data: makeData() });
		await makeOrderDirty(container);
		await fireEvent.click(screen.getByTestId('save-order').querySelector('button')!);

		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(reorderClips).toHaveBeenCalledTimes(1);
		expect(goto).not.toHaveBeenCalled();
	});

	it('carries the same protection on the whole-run regenerate', async () => {
		regenerate
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce({ id: 'child-r' });

		render(Page, { data: makeData() });
		// The whole-run regenerate is CONFIRMED, not one-click (it spawns a paid
		// child run). Click through the modal; the retry protection this test
		// exists for is unchanged behind it.
		await fireEvent.click(screen.getByTestId('regenerate-run').querySelector('button')!);
		await fireEvent.click(await screen.findByRole('button', { name: 'Make new version' }));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/projects/p1/runs/child-r/studio'));
		const keyA = (regenerate.mock.calls[0][2] as { idempotencyKey: string }).idempotencyKey;
		expect((regenerate.mock.calls[1][2] as { idempotencyKey: string }).idempotencyKey).toBe(keyA);
	});
});

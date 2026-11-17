import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reorder failure toast must REPORT THE SERVER'S DIAGNOSIS, never a guess.
 *
 * Live run 01a08f79-ab79-7359-9656-3238c07e19ff failed its reorder with a 422 and
 * told the user "The run must finish rendering before its clips can be reordered."
 * The run was `completed` in the database. That sentence was a hardcoded frontend
 * string applied to ANY 422, and it sent the user hunting a rendering problem that
 * did not exist.
 *
 * `POST /runs/{id}/reorder-clips` 422s for THREE distinct reasons — the stage is
 * not a clip spine / the parent run is not completed / the blueprint has no
 * downstream compile stage (orchestrator `src/api/routes/runs/lifecycle.py`) —
 * and each already carries an accurate `detail`. Only one of the three is about
 * rendering, so a message that names rendering is wrong two times out of three.
 *
 * These tests fail if anyone reintroduces a status-keyed hardcoded message.
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

// Hoisted so BOTH module mocks below share ONE class: `+page.svelte` tests
// `err instanceof ApiError` against `$lib/api`, and `spawn-child-run` tests it
// against `$lib/api/client.js`. Two different classes there would make a 422 look
// like a lost response and send it round the retry ladder instead of the toast.
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
vi.mock('$lib/api', () => ({
	ApiError,
	runs: {
		reorderClips: (...args: unknown[]) => reorderClips(...args),
		regenerate: vi.fn(),
		applyClipEdits: vi.fn(),
		regenerateClip: vi.fn(),
		renarrateClip: vi.fn()
	},
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([]),
	uploads: { voiceover: vi.fn() }
}));

// The real spawn helper is part of the unit under test — give it the SAME
// ApiError class the page throws.
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
async function saveAReorder() {
	const { container } = render(Page, { data: makeData() });
	const handle = container.querySelector('[data-testid="clip-drag-handle"]')!;
	await fireEvent.keyDown(handle, { key: 'ArrowRight' });
	await tick();
	await fireEvent.click(screen.getByTestId('save-order').querySelector('button')!);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio reorder — the toast reports the SERVER detail, not a guess', () => {
	it("surfaces a 422 'not a clip spine' detail verbatim", async () => {
		// The exact shape that misdiagnosed the live run: a COMPLETED run whose
		// posted stage simply is not the spine.
		const detail = "stage 'script_doctor' does not carry a clip timeline";
		reorderClips.mockRejectedValue(new ApiError(422, 'Unprocessable Entity', detail));

		await saveAReorder();

		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(toastError).toHaveBeenCalledWith('Could not reorder clips', detail);
		// The sentence that lied to the user must appear nowhere in the toast.
		const body = String(toastError.mock.calls[0][1]);
		expect(body).not.toMatch(/finish rendering/i);
		expect(goto).not.toHaveBeenCalled();
	});

	it('surfaces a DIFFERENT 422 detail verbatim — the message is not status-keyed', async () => {
		// A second, unrelated 422 cause. A hardcoded branch renders both of these
		// identically; only passing the server's `detail` through can tell them apart.
		const detail = 'blueprint has no downstream compile stage';
		reorderClips.mockRejectedValue(new ApiError(422, 'Unprocessable Entity', detail));

		await saveAReorder();

		await waitFor(() => expect(toastError).toHaveBeenCalled());
		expect(toastError).toHaveBeenCalledWith('Could not reorder clips', detail);
	});

	it("falls back to 'Unknown error' for a throw that is not an ApiError", async () => {
		// No HTTP status was ever received, so there is no server detail to report.
		// (The spawn helper retries this shape to exhaustion before it reaches the
		// catch — hence the wider waitFor budget.)
		reorderClips.mockRejectedValue(new TypeError('Failed to fetch'));

		await saveAReorder();

		await waitFor(() => expect(toastError).toHaveBeenCalled(), { timeout: 5_000 });
		expect(toastError).toHaveBeenCalledWith('Could not reorder clips', 'Unknown error');
	});
});

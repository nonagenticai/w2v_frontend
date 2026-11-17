import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Per-clip server actions in the Studio (feedback note, regenerate clip) and the
// paused-run state. Three defects pinned here:
//
//   1. "Regenerate this clip" fell back to a FULL paid `runs.regenerate` on ANY
//      422, silently. Only the "pipeline has no per-clip stage" 422 may offer a
//      full re-run, and only behind a confirmation; every other 422 is shown.
//   2. Feedback / regenerate / re-narrate were addressed to the loader's DISPLAY
//      spine — a shape guess the server refuses. They now go only to the stage
//      the server named (`editGates.saveStageName`), else disabled with a reason.
//   3. A paused run with no compiled video rendered "no compiled video to edit".
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

const jp = vi.hoisted(() => ({ status: 'completed', connected: [] as string[] }));
vi.mock('$lib/stores/job-progress', () => ({
	JobProgressState: class {
		jobStatus = jp.status;
		currentStage: string | null = null;
		get isTerminal() {
			return ['completed', 'failed', 'cancelled'].includes(this.jobStatus);
		}
		hydrateFromDetail(d: { current_stage?: string | null }) {
			this.currentStage = d.current_stage ?? null;
		}
		connect() {
			jp.connected.push(this.jobStatus);
		}
		disconnect() {}
	}
}));

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

const regenerateClip = vi.fn();
const regenerate = vi.fn();
const createNote = vi.fn();
vi.mock('$lib/api', () => ({
	ApiError,
	runs: {
		regenerateClip: (...a: unknown[]) => regenerateClip(...a),
		regenerate: (...a: unknown[]) => regenerate(...a),
		applyClipEdits: vi.fn(),
		renarrateClip: vi.fn(),
		reorderClips: vi.fn()
	},
	annotations: { create: (...a: unknown[]) => createNote(...a), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([]),
	uploads: { voiceover: vi.fn() }
}));
vi.mock('$lib/api/client.js', () => ({ ApiError, scopedMediaUrl: (u: string) => u }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
});

function makeData(opts: { reorderable?: boolean; openNote?: boolean } = {}) {
	return {
		project: { id: 'p1', title: 'Proj' },
		run: {
			id: 'r1',
			status: 'completed',
			config_snapshot: {},
			stage_outputs: [
				{ stage_name: 'storyboard', status: 'completed', output: { lines: [{ id: 'l1' }] } },
				{ stage_name: 'compile', status: 'completed', output: { video_url: 'https://x/v.mp4' } }
			]
		},
		spineStageName: 'storyboard',
		spineReorderable: opts.reorderable ?? true,
		annotations: opts.openNote
			? [{ id: 'a1', status: 'open', element_id: 'l1', text: 'brighter', created_at: 'x' }]
			: []
	} as never;
}

async function openClip() {
	await fireEvent.click(screen.getAllByTestId('clip-select')[0]);
	await tick();
}

const regenButton = () => within(screen.getByTestId('regenerate-clip')).getByRole('button');

beforeEach(() => {
	vi.clearAllMocks();
	jp.status = 'completed';
	jp.connected.length = 0;
	regenerate.mockResolvedValue({ id: 'child-full' });
});

describe('Studio — regenerate clip never silently becomes a full re-run', () => {
	it('asks before a full re-run when the pipeline has no per-clip stage', async () => {
		regenerateClip.mockRejectedValue(
			new ApiError(
				422,
				'Unprocessable',
				"stage 'storyboard' has no downstream per-clip image stage to regenerate"
			)
		);
		render(Page, { data: makeData({ openNote: true }) });
		await openClip();
		await fireEvent.click(regenButton());

		const confirm = await screen.findByRole('button', { name: 'Re-render full video' });
		expect(screen.getByText(/full paid run/i)).toBeTruthy();
		expect(screen.getByText(/review checkpoints/i)).toBeTruthy();
		// Nothing was spent yet.
		expect(regenerate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();

		await fireEvent.click(confirm);
		await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
		expect(regenerate.mock.calls[0][1]).toEqual({});
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/projects/p1/runs/child-full/studio'));
	});

	it('shows any OTHER 422 and starts nothing', async () => {
		regenerateClip.mockRejectedValue(
			new ApiError(422, 'Unprocessable', "clip 'l1' has no open feedback to apply")
		);
		render(Page, { data: makeData({ openNote: true }) });
		await openClip();
		await fireEvent.click(regenButton());

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				'Could not regenerate',
				"clip 'l1' has no open feedback to apply"
			)
		);
		expect(regenerate).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'Re-render full video' })).toBeNull();
	});
});

describe('Studio — per-clip actions target only the server-named spine', () => {
	it('disables feedback and regenerate WITH a reason when the spine is a guess', async () => {
		render(Page, { data: makeData({ reorderable: false, openNote: true }) });
		await openClip();

		expect(regenButton()).toBeDisabled();
		expect(screen.getByTestId('regenerate-clip-blocked').textContent).toMatch(
			/no editable clip timeline/i
		);
		expect(screen.getByTestId('annotations-add-blocked').textContent).toMatch(
			/no editable clip timeline/i
		);
		expect(screen.queryByTestId('annotation-draft')).toBeNull();
		await fireEvent.click(regenButton());
		expect(regenerateClip).not.toHaveBeenCalled();
	});

	it('CONTROL: a server-named spine files the note against that stage', async () => {
		createNote.mockResolvedValue({ id: 'n1', status: 'open', element_id: 'l1', text: 'x' });
		render(Page, { data: makeData({ reorderable: true }) });
		await openClip();
		await fireEvent.input(screen.getByTestId('annotation-draft'), {
			target: { value: 'tighter crop' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /Add element note/ }));
		await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
		expect(createNote.mock.calls[0][1]).toBe('storyboard');
		expect(screen.queryByTestId('regenerate-clip-blocked')).toBeNull();
	});
});

describe('Studio — a paused run is not a dead end', () => {
	function pausedData() {
		return {
			project: { id: 'p1', title: 'Proj' },
			run: {
				id: 'r1',
				status: 'paused',
				pause_reason: 'checkpoint',
				current_stage: 'website_review_script',
				pause_after_stages: ['website_review_script'],
				config_snapshot: {},
				stage_outputs: [
					{ stage_name: 'website_review_script', status: 'completed', output: { lines: [] } },
					{ stage_name: 'compile', status: 'pending', output: null }
				]
			},
			spineStageName: null,
			spineReorderable: false,
			annotations: []
		} as never;
	}

	it('says it is paused for review and links to the open checkpoint', () => {
		jp.status = 'paused';
		render(Page, { data: pausedData() });

		const panel = screen.getByTestId('studio-paused');
		expect(panel.textContent).toMatch(/Needs review/);
		expect(
			within(panel)
				.getByRole('link', { name: /Review checkpoint/ })
				.getAttribute('href')
		).toBe('/projects/p1/runs/r1/stages/website_review_script');
		expect(screen.queryByTestId('studio-no-video')).toBeNull();
		// Live: approving the gate must move this page on.
		expect(jp.connected).toContain('paused');
	});

	// A run someone PAUSED has nothing to review: no review prompt, no checkpoint link.
	it('says a manually paused run is Paused, not that it needs review', () => {
		jp.status = 'paused';
		const data = pausedData() as unknown as { run: { pause_reason?: string } };
		data.run.pause_reason = 'manual';
		render(Page, { data: data as never });

		const panel = screen.getByTestId('studio-manually-paused');
		expect(panel.textContent).toMatch(/Paused/);
		expect(panel.textContent).not.toMatch(/review/i);
		expect(screen.queryByTestId('studio-paused')).toBeNull();
	});
});

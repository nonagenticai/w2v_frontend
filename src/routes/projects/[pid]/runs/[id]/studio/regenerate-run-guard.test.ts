import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// The Studio header's "Regenerate video" is the most expensive control on the
// page: it spawns a whole child run and navigates away. Two properties are
// pinned here, both of which used to be false:
//
//   1. It is not OFFERED on a run with no compiled video. `canReorder` (the
//      re-stitch gate) only reads the live job status, so a run that COMPLETED
//      with its compile stage skipped/failed rendered an enabled Regenerate
//      button directly above the panel that says "This run has no compiled
//      video to edit." — a one-click full re-render on a dead-end page.
//   2. It is CONFIRMED, via the same restart-plan preview (`RestartRunModal`)
//      the run page's Restart uses — it posts the same `regenerate {}` body. It
//      used to fire the API and `goto` away on the first click, with no
//      confirmation at all.
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

// `completed` is deliberate: it is the status that makes `canReorder` TRUE, so
// the no-video test below fails for the right reason (the guard) rather than
// because the run was still rendering anyway.
vi.mock('$lib/stores/job-progress', () => ({
	JobProgressState: class {
		jobStatus = 'completed';
		isTerminal = true;
		hydrateFromDetail() {}
		connect() {}
		disconnect() {}
	}
}));

const regenerate = vi.fn().mockResolvedValue({ id: 'child-1' });
vi.mock('$lib/api', () => ({
	ApiError: class ApiError extends Error {},
	runs: {
		regenerate: (...a: unknown[]) => regenerate(...a),
		// The confirmation previews the restart plan (RestartRunModal).
		restartPlan: vi.fn().mockResolvedValue({
			run_id: 'r1',
			mode: 'full',
			full_reasons: [{ code: 'nothing_changed', message: '', stage: null, inputs: [] }],
			changed_inputs: [],
			stages: []
		})
	},
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([])
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { ApiError as RealApiError } from '$lib/api/client';
import Page from './+page.svelte';

// jsdom implements no <dialog> showModal/close — give the shared Dialog
// something to call so its open/close $effect doesn't throw.
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
});

/**
 * A COMPLETED run carrying a clip spine. `compileOutput` is the only variable:
 * a `video_url` present means the Studio has something to edit, an empty
 * compile output is the real-world skipped/failed-compile shape.
 */
function makeData(compileOutput: Record<string, unknown>) {
	return {
		project: { id: 'p1', title: 'Proj' },
		run: {
			id: 'r1',
			status: 'completed',
			config_snapshot: {},
			stage_outputs: [
				{ stage_name: 'storyboard', status: 'completed', output: { lines: [{ id: 'l1' }] } },
				{ stage_name: 'compile', status: 'completed', output: compileOutput }
			]
		},
		spineStageName: 'storyboard',
		annotations: []
	} as never;
}

const WITH_VIDEO = () => makeData({ video_url: 'https://x/v.mp4' });
const WITHOUT_VIDEO = () => makeData({});

beforeEach(() => {
	vi.clearAllMocks();
	regenerate.mockResolvedValue({ id: 'child-1' });
});

describe('Studio — whole-run regenerate is not offered without a video', () => {
	it('renders the dead-end panel and NO regenerate control on a completed run with no video', () => {
		render(Page, { data: WITHOUT_VIDEO() });

		// Prove we are in exactly the state the defect described: the page itself
		// says there is nothing to edit...
		expect(screen.getByTestId('studio-no-video')).toBeTruthy();
		expect(screen.getByText('This run has no compiled video to edit.')).toBeTruthy();
		// ...and it is not a half-rendered page — the sibling header control is there.
		expect(screen.getByRole('link', { name: /Run details/ })).toBeTruthy();

		// The expensive affordance is absent, as an actual user-visible control.
		expect(screen.queryByTestId('regenerate-run')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Regenerate video' })).toBeNull();
	});

	it('offers the control on the same completed run once a video exists', () => {
		render(Page, { data: WITH_VIDEO() });

		expect(screen.queryByTestId('studio-no-video')).toBeNull();
		expect(screen.getByRole('button', { name: 'Regenerate video' })).toBeTruthy();
	});
});

describe('Studio — whole-run regenerate is confirmed, not one-click', () => {
	it('opens the confirmation instead of calling the API on the first click', async () => {
		render(Page, { data: WITH_VIDEO() });

		await fireEvent.click(screen.getByRole('button', { name: 'Regenerate video' }));

		expect(regenerate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
		// The shared RegenerateRunModal is what opened.
		expect(await screen.findByRole('heading', { name: 'Make a new version?' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Make new version' })).toBeTruthy();
	});

	it('calls the regenerate API and navigates to the child only on confirm', async () => {
		render(Page, { data: WITH_VIDEO() });

		await fireEvent.click(screen.getByRole('button', { name: 'Regenerate video' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Make new version' }));

		await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
		expect(regenerate.mock.calls[0][0]).toBe('r1');
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/projects/p1/runs/child-1/studio'));
	});

	it('a 402 byo_provider_required (#1150) shows the provider notice and stays on the page', async () => {
		regenerate.mockRejectedValue(
			new RealApiError(
				402,
				'Payment Required',
				'Configure your own LLM provider to continue',
				'HTTP_402',
				{
					code: 'byo_provider_required',
					modality: 'llm',
					slots: 'llm',
					message: 'Configure your own LLM provider to continue'
				}
			)
		);
		render(Page, { data: WITH_VIDEO() });

		await fireEvent.click(screen.getByRole('button', { name: 'Regenerate video' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Make new version' }));

		const notice = await screen.findByTestId('byo-provider-required');
		expect(notice.getAttribute('data-slots')).toBe('llm');
		// A server verdict, not a lost response: spawned once, never retried.
		expect(regenerate).toHaveBeenCalledTimes(1);
		expect(goto).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(screen.queryByRole('heading', { name: 'Make a new version?' })).toBeNull()
		);
	});

	it('calls nothing when the confirmation is dismissed', async () => {
		render(Page, { data: WITH_VIDEO() });

		await fireEvent.click(screen.getByRole('button', { name: 'Regenerate video' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		await waitFor(() =>
			expect(screen.queryByRole('heading', { name: 'Make a new version?' })).toBeNull()
		);
		expect(regenerate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});
});

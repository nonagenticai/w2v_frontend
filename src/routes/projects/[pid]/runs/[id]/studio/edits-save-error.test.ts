import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A failed "Apply edits & re-render" must leave a PERSISTENT, in-page trace.
 *
 * Before this, the only surface was `toastError` — and on the plain-http origin
 * the in-cluster E2E harness serves, `toastError` threw on its own
 * `crypto.randomUUID()` call, INSIDE the catch. `finally` still cleared
 * `savingEdits`, so the button re-enabled and the page was byte-for-byte
 * indistinguishable from a save that never happened. Four browser journeys had
 * nothing to assert against.
 *
 * So: the inline error is asserted independently of the toast, and the last case
 * makes `toastError` throw to prove the inline error does not depend on it.
 */
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
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

const applyClipEdits = vi.fn();
vi.mock('$lib/api', () => ({
	ApiError,
	runs: { applyClipEdits: (...args: unknown[]) => applyClipEdits(...args) },
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([]),
	uploads: { voiceover: vi.fn() }
}));
vi.mock('$lib/api/client.js', () => ({ ApiError, scopedMediaUrl: (u: string) => u }));

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
				{ stage_name: 'storyboard', status: 'completed', output: { lines: [{ id: 'l1' }] } },
				{ stage_name: 'compile', status: 'completed', output: { video_url: 'https://x/v.mp4' } }
			]
		},
		spineStageName: 'storyboard',
		spineReorderable: true,
		annotations: []
	} as never;
}

/** Dirty one clip so the apply control renders, then click it. */
async function attemptSave() {
	render(Page, { data: makeData() });
	await fireEvent.click(screen.getAllByTestId('clip-select')[0]);
	await tick();
	await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
	await tick();
	await fireEvent.click(screen.getByTestId('save-edits').querySelector('button')!);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio apply-edits — the failure has an in-page surface', () => {
	it('renders a persistent inline error carrying the server detail', async () => {
		applyClipEdits.mockRejectedValue(new ApiError(422, 'Unprocessable', 'stage is not editable'));

		// Absent before the failure, so the presence below is caused by the failure
		// and not by the banner simply always being on screen.
		render(Page, { data: makeData() });
		expect(screen.queryByTestId('edits-save-error')).toBeNull();
		await fireEvent.click(screen.getAllByTestId('clip-select')[0]);
		await tick();
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
		await tick();
		expect(screen.queryByTestId('edits-save-error')).toBeNull();
		await fireEvent.click(screen.getByTestId('save-edits').querySelector('button')!);

		const banner = await screen.findByTestId('edits-save-error');
		expect(banner.textContent).toContain('stage is not editable');
		// It must persist — not a transient that a tick clears.
		await tick();
		await tick();
		expect(screen.queryByTestId('edits-save-error')).not.toBeNull();
	});

	it('survives a toast mechanism that is itself broken', async () => {
		// Exactly the in-cluster shape: `toastError` throws inside the catch.
		toastError.mockImplementation(() => {
			throw new TypeError('crypto.randomUUID is not a function');
		});
		applyClipEdits.mockRejectedValue(new ApiError(500, 'Server Error', 'orchestrator exploded'));

		await attemptSave();

		const banner = await screen.findByTestId('edits-save-error');
		expect(banner.textContent).toContain('orchestrator exploded');
	});

	it('clears on the next attempt so a stale failure is never shown as current', async () => {
		applyClipEdits.mockRejectedValueOnce(new ApiError(500, 'Server Error', 'transient blip'));
		render(Page, { data: makeData() });
		await fireEvent.click(screen.getAllByTestId('clip-select')[0]);
		await tick();
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
		await tick();

		const btn = screen.getByTestId('save-edits').querySelector('button')!;
		await fireEvent.click(btn);
		await screen.findByTestId('edits-save-error');

		applyClipEdits.mockResolvedValueOnce({ id: 'child-2' });
		await fireEvent.click(screen.getByTestId('save-edits').querySelector('button')!);

		await waitFor(() => expect(screen.queryByTestId('edits-save-error')).toBeNull());
	});
});

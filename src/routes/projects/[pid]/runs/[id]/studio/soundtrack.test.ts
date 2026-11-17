import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Studio soundtrack <select> fetches its beds from `GET /api/music/tracks`
// on mount. These tests render the page and assert (a) only the backend list is
// offered, (b) a failed fetch disables the picker with a reason, and (c) the
// apply-edits `music` field is sent ONLY when the user changed it — omitted
// music means "keep the parent run's" (orchestrator apply-edits contract).
const listMusicTracks = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

// The live-progress tracker opens an SSE connection; stub it out so the render is
// deterministic. A completed run means the studio shows the editable timeline
// (the branch that contains the soundtrack select).
vi.mock('$lib/stores/job-progress', () => ({
	JobProgressState: class {
		jobStatus = 'completed';
		isTerminal = true;
		hydrateFromDetail() {}
		connect() {}
		disconnect() {}
	}
}));

const applyClipEdits = vi.fn().mockResolvedValue({ id: 'child' });
vi.mock('$lib/api', () => ({
	ApiError: class ApiError extends Error {},
	runs: { applyClipEdits: (...a: unknown[]) => applyClipEdits(...a) },
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: (...a: unknown[]) => listMusicTracks(...a)
}));

import { render, screen, within, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';

function makeData(config_snapshot: Record<string, unknown> = {}) {
	return {
		project: { id: 'p1', title: 'Proj' },
		run: {
			id: 'r1',
			status: 'completed',
			config_snapshot,
			stage_outputs: [
				{ stage_name: 'storyboard', status: 'completed', output: { lines: [{ id: 'l1' }] } },
				{ stage_name: 'compile', status: 'completed', output: { video_url: 'https://x/v.mp4' } }
			]
		},
		spineStageName: 'storyboard',
		// Server-named spine: clip edits + music save target only `clip_spine_stage`.
		spineReorderable: true,
		annotations: []
	} as never;
}

function optionLabels(select: HTMLElement): string[] {
	return within(select)
		.getAllByRole('option')
		.map((o) => o.textContent?.trim() ?? '');
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio soundtrack select', () => {
	it('renders the tenant-aware backend track list, with "No music" prepended', async () => {
		listMusicTracks.mockResolvedValue([
			{ id: 'epic_trailer', label: 'Epic trailer', category: 'music' },
			{ id: 'soft_piano', label: 'Soft piano', category: 'music' }
		]);

		render(Page, { data: makeData() });

		// Wait for the on-mount fetch to swap the fallback for the backend list.
		await screen.findByRole('option', { name: 'Epic trailer' });
		const select = screen.getByTestId('music-track');

		expect(listMusicTracks).toHaveBeenCalledOnce();
		expect(optionLabels(select)).toEqual(['No music', 'Epic trailer', 'Soft piano']);
		// The built-in fallback labels must be gone once the backend list lands.
		expect(within(select).queryByRole('option', { name: 'Corporate uplift' })).toBeNull();
	});

	// The built-in fallback ids were offered when the fetch failed — ids the
	// server validates against the TENANT library and can 422 the whole save on.
	it('disables the picker and says why when the track list fails, offering no fallback ids', async () => {
		listMusicTracks.mockRejectedValue(new Error('offline'));

		render(Page, { data: makeData() });

		const error = await screen.findByTestId('music-tracks-error');
		expect(error.textContent).toMatch(/couldn't load the music library/i);
		const select = screen.getByTestId('music-track') as HTMLSelectElement;
		expect(select.disabled).toBe(true);
		expect(optionLabels(select)).toEqual(['No music']);
	});

	async function clipOnlyEdit() {
		await fireEvent.click(screen.getAllByTestId('clip-select')[0]);
		await tick();
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
		await fireEvent.click(within(await screen.findByTestId('save-edits')).getByRole('button'));
		await waitFor(() => expect(applyClipEdits).toHaveBeenCalledOnce());
	}

	// Omitted music = keep the parent's; the FE never re-sends an unchanged value.
	it.each([
		['the stored bed is in the catalog', 'jazz_lounge'],
		['the stored bed is not in the catalog', 'retired_bed_2024']
	])('sends NO music on a clip-only edit when %s', async (_why, stored) => {
		listMusicTracks.mockResolvedValue([
			{ id: 'jazz_lounge', label: 'Lounge jazz', category: 'music' }
		]);
		render(Page, { data: makeData({ sound_effects: { music: stored } }) });
		await screen.findByRole('option', { name: 'Lounge jazz' });
		await clipOnlyEdit();
		expect(applyClipEdits.mock.calls[0]).toHaveLength(5);
		expect(applyClipEdits.mock.calls[0][3]).toBeUndefined();
	});

	// The track list failing must not change what a clip-only edit sends: the
	// orchestrator keeps the parent's music, so nothing is silently dropped.
	it('sends NO music on a clip-only edit when the track list failed to load', async () => {
		listMusicTracks.mockRejectedValue(new Error('offline'));
		render(Page, { data: makeData({ sound_effects: { music: 'jazz_lounge' } }) });
		await screen.findByTestId('music-tracks-error');
		await clipOnlyEdit();
		expect(applyClipEdits.mock.calls[0][3]).toBeUndefined();
	});

	it('sends NO music when the user changed the bed and then changed it back', async () => {
		listMusicTracks.mockResolvedValue([
			{ id: 'jazz_lounge', label: 'Lounge jazz', category: 'music' },
			{ id: 'epic_trailer', label: 'Epic trailer', category: 'music' }
		]);
		render(Page, { data: makeData({ sound_effects: { music: 'jazz_lounge' } }) });
		await screen.findByRole('option', { name: 'Lounge jazz' });
		const select = screen.getByTestId('music-track');
		await fireEvent.change(select, { target: { value: 'epic_trailer' } });
		await fireEvent.change(select, { target: { value: 'jazz_lounge' } });
		await clipOnlyEdit();
		expect(applyClipEdits.mock.calls[0][3]).toBeUndefined();
	});

	it('sends the chosen track when the user picks a different bed', async () => {
		listMusicTracks.mockResolvedValue([
			{ id: 'jazz_lounge', label: 'Lounge jazz', category: 'music' },
			{ id: 'epic_trailer', label: 'Epic trailer', category: 'music' }
		]);
		render(Page, { data: makeData({ sound_effects: { music: 'jazz_lounge' } }) });
		await screen.findByRole('option', { name: 'Epic trailer' });
		await fireEvent.change(screen.getByTestId('music-track'), {
			target: { value: 'epic_trailer' }
		});
		await fireEvent.click(within(await screen.findByTestId('save-edits')).getByRole('button'));
		await waitFor(() => expect(applyClipEdits).toHaveBeenCalledOnce());
		expect(applyClipEdits.mock.calls[0][3]).toMatchObject({ track: 'epic_trailer' });
	});

	it('sends music:{track:null} when the user picks "No music"', async () => {
		listMusicTracks.mockResolvedValue([
			{ id: 'jazz_lounge', label: 'Lounge jazz', category: 'music' }
		]);
		render(Page, { data: makeData({ sound_effects: { music: 'jazz_lounge' } }) });
		await screen.findByRole('option', { name: 'Lounge jazz' });
		await fireEvent.change(screen.getByTestId('music-track'), { target: { value: '' } });
		await fireEvent.click(within(await screen.findByTestId('save-edits')).getByRole('button'));
		await waitFor(() => expect(applyClipEdits).toHaveBeenCalledOnce());
		expect(applyClipEdits.mock.calls[0][3]).toMatchObject({ track: null });
	});

	it('sends the catalog ID, never the label, when the stored bed is a label', async () => {
		listMusicTracks.mockResolvedValue([
			{ id: 'jazz_lounge', label: 'smooth lounge jazz background bed', category: 'music' }
		]);
		render(Page, {
			data: makeData({ sound_effects: { music: 'smooth lounge jazz background bed' } })
		});
		await screen.findByRole('option', { name: 'smooth lounge jazz background bed' });
		const track = screen.getByTestId('music-track') as HTMLSelectElement;
		expect(track.value).toBe('jazz_lounge');

		await fireEvent.change(screen.getByTestId('music-duck'), { target: { value: '-6' } });
		await fireEvent.click(within(await screen.findByTestId('save-edits')).getByRole('button'));
		await waitFor(() => expect(applyClipEdits).toHaveBeenCalledOnce());
		expect(applyClipEdits.mock.calls[0][1]).toBe('storyboard');
		expect(applyClipEdits.mock.calls[0][3]).toMatchObject({ track: 'jazz_lounge', duck_db: -6 });
	});
});

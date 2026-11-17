import { describe, it, expect, vi, beforeEach } from 'vitest';

// When `GET /api/music/tracks` ERRORS, resolution is deliberately skipped (a
// stored bed would "miss" against the empty catalog and be dropped on mount).
// The side effect is a display lie: the select falls back to "No music" for a
// run that HAS a soundtrack, and the `music-track-dropped` notice — which only
// fires on a resolved-but-unknown value — says nothing. Nothing bad is saved,
// so this is honesty, not data: the error state must name the stored bed and
// say it could not be loaded.
const listMusicTracks = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
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

import { render, screen } from '@testing-library/svelte';
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
		spineReorderable: true,
		annotations: []
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio soundtrack — catalog ERROR must not read as "no soundtrack"', () => {
	it('names the run’s stored bed and says it could not be loaded', async () => {
		listMusicTracks.mockRejectedValue(new Error('offline'));
		render(Page, { data: makeData({ sound_effects: { music: 'jazz_lounge' } }) });

		const notice = await screen.findByTestId('music-track-unloaded');
		expect(notice).toHaveAttribute('role', 'status');
		expect(notice.textContent).toMatch(/jazz_lounge/);
		expect(notice.textContent).toMatch(/couldn't be loaded|could not be loaded/i);

		// The select still honestly shows "No music" and stays disabled — the guard
		// that skips resolution until the catalog is ready is NOT weakened.
		const select = screen.getByTestId('music-track') as HTMLSelectElement;
		expect(select.value).toBe('');
		expect(select.disabled).toBe(true);
		// And this is a DIFFERENT condition from an unresolvable bed.
		expect(screen.queryByTestId('music-track-dropped')).toBeNull();
	});

	it('says nothing extra when the run genuinely has no soundtrack', async () => {
		listMusicTracks.mockRejectedValue(new Error('offline'));
		render(Page, { data: makeData({ sound_effects: {} }) });

		await screen.findByTestId('music-tracks-error');
		expect(screen.queryByTestId('music-track-unloaded')).toBeNull();
	});

	it('says nothing when the catalog loaded fine', async () => {
		listMusicTracks.mockResolvedValue([
			{ id: 'jazz_lounge', label: 'Lounge jazz', category: 'music' }
		]);
		render(Page, { data: makeData({ sound_effects: { music: 'jazz_lounge' } }) });

		await screen.findByRole('option', { name: 'Lounge jazz' });
		expect(screen.queryByTestId('music-track-unloaded')).toBeNull();
	});
});

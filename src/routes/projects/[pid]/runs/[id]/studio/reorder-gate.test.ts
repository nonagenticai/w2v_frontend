import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reorder affordance is gated on `spineReorderable`, NOT on run status alone.
 *
 * `canReorderClips = canReorder && spineReorderable`. Save-edits, soundtrack,
 * re-narrate and per-clip edit are gated the same way (`studio/edit-gates.ts`):
 * the server's apply-edits / renarrate-clip routes share reorder's spine gate, so
 * a displayed-but-guessed spine 422s there too (prod run 01a09f82). Only the
 * whole-run regenerate stays on `canReorder` alone. The timeline still DISPLAYS.
 *
 * Every other studio test hardcodes `spineReorderable: true`, so the withheld
 * case was uncovered: deleting `&& spineReorderable` left the whole suite green.
 * These tests close that hole — each one is mutation-checked against exactly
 * that deletion (and, for the hint, against restoring the old single
 * "unlocks once the video finishes rendering" sentence).
 *
 * The run below is `completed`, so `canReorder` is TRUE throughout: the only
 * thing withholding reorder is the flag.
 */
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: vi.fn(),
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

vi.mock('$lib/api', () => ({
	ApiError,
	runs: {
		reorderClips: vi.fn(),
		regenerate: vi.fn(),
		applyClipEdits: vi.fn(),
		regenerateClip: vi.fn(),
		renarrateClip: vi.fn()
	},
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([]),
	uploads: { voiceover: vi.fn() }
}));

vi.mock('$lib/api/client.js', () => ({
	ApiError,
	scopedMediaUrl: (u: string) => u
}));

import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';

/**
 * A COMPLETED run with a displayable timeline. `spineReorderable` is the only
 * variable — the run carries no `clip_spine_stage`, so the page's own
 * `resolveClipSpine` display heuristic finds `storyboard.lines[]` either way and
 * the timeline renders in both cases (test 4 pins that down).
 */
function makeData(spineReorderable: boolean) {
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
		spineReorderable,
		annotations: []
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio reorder gate — a completed run with no reorderable spine', () => {
	it('renders NO drag handle when the server named no reorderable spine', () => {
		const { container } = render(Page, { data: makeData(false) });

		// The timeline itself is still there — only the reorder affordance is gone.
		expect(container.querySelector('[data-testid="clip-timeline"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="clip-card"]').length).toBe(3);
		expect(container.querySelectorAll('[data-testid="clip-drag-handle"]').length).toBe(0);
	});

	it('offers NO save-order control, and none can be armed', async () => {
		const { container } = render(Page, { data: makeData(false) });

		// Try to arm it the only way the UI allows. With the gate intact there is no
		// handle to press; with `&& spineReorderable` deleted this keydown reorders
		// a clip and `save-order` appears — which is what makes this test bite.
		const handle = container.querySelector('[data-testid="clip-drag-handle"]');
		if (handle) {
			await fireEvent.keyDown(handle, { key: 'ArrowRight' });
			await tick();
		}

		expect(screen.queryByTestId('save-order')).toBeNull();
	});

	it('tells the user the timeline cannot be reordered — NOT that it "unlocks once the video finishes rendering"', () => {
		const { container } = render(Page, { data: makeData(false) });

		const hint = container
			.querySelector('[data-testid="clip-timeline"]')!
			.closest('section')!
			.textContent!.replace(/\s+/g, ' ');

		expect(hint).toMatch(/timeline cannot be reordered/i);
		// The lie this branch exists to kill: the video HAS finished rendering
		// (status `completed`) and reordering never unlocks.
		expect(hint).not.toMatch(/finishes rendering/i);
		expect(hint).not.toMatch(/reordering unlocks/i);
		// Nor may it claim the drag affordance that is not there.
		expect(hint).not.toMatch(/drag clips to reorder/i);
	});

	it('CONTROL: the same completed run DOES get a drag handle when the spine is reorderable', () => {
		// Without this, the three tests above would pass on a fixture that simply
		// never renders a timeline.
		const { container } = render(Page, { data: makeData(true) });

		expect(container.querySelectorAll('[data-testid="clip-drag-handle"]').length).toBe(3);
		const hint = container
			.querySelector('[data-testid="clip-timeline"]')!
			.closest('section')!
			.textContent!.replace(/\s+/g, ' ');
		expect(hint).toMatch(/drag clips to reorder/i);
	});

	it('clip edits, re-narrate and soundtrack save are OFF too — they would POST a guessed stage', () => {
		// Prod run 01a09f82 (website_review_v1): apply-edits POSTed against the
		// guessed `website_review_script` and got 422. `apply-edits` and
		// `renarrate-clip` share reorder's spine gate server-side, so a spine the
		// server did not name is not a save target. The run still displays and the
		// whole-run regenerate (not spine-scoped) stays.
		render(Page, { data: makeData(false) });

		const track = screen.getByTestId('music-track') as HTMLSelectElement;
		expect(track.disabled).toBe(true);
		expect(screen.getByTestId('music-blocked').textContent).toMatch(/no editable clip timeline/i);
		expect(screen.getByTestId('clip-edits-blocked').textContent).toMatch(
			/no editable clip timeline/i
		);
		expect(screen.getByTestId('regenerate-run')).not.toBeNull();
	});

	it('CONTROL: a server-named spine keeps the soundtrack enabled with no blocked notice', async () => {
		render(Page, { data: makeData(true) });
		// The picker unlocks once the tenant track list has loaded (it no longer
		// offers built-in fallback ids the save could 422 on).
		await vi.waitFor(() =>
			expect((screen.getByTestId('music-track') as HTMLSelectElement).disabled).toBe(false)
		);
		expect(screen.queryByTestId('music-blocked')).toBeNull();
		expect(screen.queryByTestId('clip-edits-blocked')).toBeNull();
	});
});

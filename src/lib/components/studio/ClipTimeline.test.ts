import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ClipTimeline from './ClipTimeline.svelte';
import { setActiveTenantId } from '$lib/api/client.js';
import type { Clip } from '$lib/utils/timeline';

function clip(id: string, index: number, over: Partial<Clip> = {}): Clip {
	return {
		id,
		lineId: null,
		index,
		seconds: 3,
		startSec: index * 3,
		description: `desc ${id}`,
		narration: `line ${id}`,
		visualType: 'footage',
		thumbnailUrl: null,
		posterVideoUrl: null,
		isFootage: false,
		clipLeadSeconds: 0,
		clipAnchor: 'start',
		caption: '',
		fit: null,
		speed: null,
		transition: null,
		adjust: null,
		overlays: null,
		audio: null,
		audioUrl: null,
		audioSeconds: null,
		...over
	};
}

describe('ClipTimeline', () => {
	it('renders empty state with no clips', () => {
		const { getByText, queryByTestId } = render(ClipTimeline, { props: { clips: [] } });
		expect(getByText('This run has no clip timeline.')).toBeTruthy();
		expect(queryByTestId('clip-timeline')).toBeNull();
	});

	// The parent derives `clips` as `spine?.clips ?? []`, so undefined never
	// reaches this component through the app — but a spine that hasn't loaded
	// yet, or a malformed run, is exactly the class of input that produced the
	// "clip-timeline mounted but never visible" 30s E2E timeout: the caller's
	// TS contract (`clips: Clip[]`) doesn't stop a bad runtime value from
	// arriving. Before the fix, spreading it (`[...clips]`) threw during init
	// and aborted the whole component render, so NEITHER the empty-state text
	// NOR the `clip-timeline` testid ever mounted.
	it('renders the empty state instead of crashing when clips is undefined', () => {
		const { getByText, queryByTestId } = render(ClipTimeline, {
			// @ts-expect-error deliberately violating the Clip[] contract
			props: { clips: undefined }
		});
		expect(getByText('This run has no clip timeline.')).toBeTruthy();
		expect(queryByTestId('clip-timeline')).toBeNull();
	});

	it('renders the empty state instead of crashing when clips is null', () => {
		const { getByText, queryByTestId } = render(ClipTimeline, {
			// @ts-expect-error deliberately violating the Clip[] contract
			props: { clips: null }
		});
		expect(getByText('This run has no clip timeline.')).toBeTruthy();
		expect(queryByTestId('clip-timeline')).toBeNull();
	});

	it('renders a card per clip and fires onSelect on click', async () => {
		const onSelect = vi.fn();
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0), clip('s2', 1)], onSelect }
		});
		const cards = container.querySelectorAll('[data-testid="clip-card"]');
		expect(cards.length).toBe(2);
		const select = container.querySelector('[data-clip-id="s2"] [data-testid="clip-select"]')!;
		await fireEvent.click(select);
		expect(onSelect).toHaveBeenCalledWith('s2');
	});

	it('shows a note badge with the open-note count', () => {
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0)], noteCounts: { s1: 3 } }
		});
		const badge = container.querySelector('[data-testid="clip-note-badge"]');
		expect(badge?.textContent).toContain('3');
	});

	it('keyboard ArrowRight reorders and fires onReorder with the new order', async () => {
		const onReorder = vi.fn();
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0), clip('s2', 1), clip('s3', 2)], onReorder }
		});
		const handle = container.querySelector('[data-clip-id="s1"] [data-testid="clip-drag-handle"]')!;
		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(onReorder).toHaveBeenCalledWith(['s2', 's1', 's3']);
	});

	it('announces the new position via the live region after a keyboard move', async () => {
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0), clip('s2', 1), clip('s3', 2)], onReorder: vi.fn() }
		});
		const handle = container.querySelector('[data-clip-id="s1"] [data-testid="clip-drag-handle"]')!;
		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		const announcer = container.querySelector('[data-testid="clip-move-announcer"]');
		expect(announcer?.getAttribute('aria-live')).toBe('polite');
		expect(announcer?.textContent).toBe('Clip moved to position 2 of 3');
	});

	it('keeps only a single select tab stop per card (thumb button is not focusable)', () => {
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0)], onSelect: vi.fn() }
		});
		const thumb = container.querySelector('[data-clip-id="s1"] [data-testid="clip-thumb"]');
		expect(thumb?.getAttribute('tabindex')).toBe('-1');
		expect(thumb?.getAttribute('aria-hidden')).toBe('true');
	});

	const domOrder = (container: HTMLElement) =>
		[...container.querySelectorAll('[data-testid="clip-card"]')].map((el) =>
			el.getAttribute('data-clip-id')
		);

	it('keeps the reordered DOM order when the parent re-passes the same clips', async () => {
		// The parent stores a pending order but keeps re-passing the ORIGINAL clips
		// prop (it doesn't mutate `clips` until save). A sequence-based re-seed would
		// snap the timeline back to the original order here; the set-based re-seed
		// must leave the user's reorder intact.
		const { container, rerender } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0), clip('s2', 1), clip('s3', 2)], onReorder: vi.fn() }
		});
		const handle = container.querySelector('[data-clip-id="s1"] [data-testid="clip-drag-handle"]')!;
		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(domOrder(container)).toEqual(['s2', 's1', 's3']);

		await rerender({ clips: [clip('s1', 0), clip('s2', 1), clip('s3', 2)], onReorder: vi.fn() });
		expect(domOrder(container)).toEqual(['s2', 's1', 's3']);
	});

	it('re-seeds when a new run brings a different set of clips', async () => {
		const { container, rerender } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0), clip('s2', 1)], onReorder: vi.fn() }
		});
		await rerender({ clips: [clip('s1', 0), clip('s3', 1)], onReorder: vi.fn() });
		expect(domOrder(container)).toEqual(['s1', 's3']);
	});

	it('falls back to the placeholder when a thumbnail fails to load', async () => {
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0, { thumbnailUrl: 'https://cdn/broken.png' })] }
		});
		const img = container.querySelector('[data-clip-id="s1"] [data-testid="clip-thumb-img"]')!;
		expect(img).toBeTruthy();
		await fireEvent.error(img);
		expect(
			container.querySelector('[data-clip-id="s1"] [data-testid="clip-thumb-img"]')
		).toBeNull();
		expect(
			container.querySelector('[data-clip-id="s1"] [data-testid="clip-thumb-placeholder"]')
		).toBeTruthy();
	});

	it('renders an <img> when the clip has a thumbnail, else a placeholder icon', () => {
		const { container } = render(ClipTimeline, {
			props: {
				clips: [clip('s1', 0, { thumbnailUrl: '/api/still.png' }), clip('s2', 1)]
			}
		});
		const img = container.querySelector('[data-clip-id="s1"] [data-testid="clip-thumb-img"]');
		expect(img?.getAttribute('src')).toBe('/api/still.png');
		expect(
			container.querySelector('[data-clip-id="s2"] [data-testid="clip-thumb-placeholder"]')
		).toBeTruthy();
		expect(
			container.querySelector('[data-clip-id="s2"] [data-testid="clip-thumb-img"]')
		).toBeNull();
	});

	it('renders a <video> poster when only posterVideoUrl is set', () => {
		const { container } = render(ClipTimeline, {
			props: { clips: [clip('s1', 0, { posterVideoUrl: '/api/clip.mp4' })] }
		});
		const video = container.querySelector('[data-testid="clip-thumb-video"]');
		expect(video?.getAttribute('src')).toBe('/api/clip.mp4');
	});

	// The two tests above are the no-switch case: same-tenant src must stay byte-
	// identical. With a switch active the tenant has to move into the query string,
	// because <img>/<video> are browser-initiated and carry no custom header.
	it('carries an active tenant switch in the media URLs', () => {
		setActiveTenantId('tenant-b');
		try {
			const { container } = render(ClipTimeline, {
				props: {
					clips: [
						clip('s1', 0, { thumbnailUrl: '/api/still.png' }),
						clip('s2', 1, { posterVideoUrl: '/api/clip.mp4' })
					]
				}
			});
			expect(
				container
					.querySelector('[data-clip-id="s1"] [data-testid="clip-thumb-img"]')
					?.getAttribute('src')
			).toBe('/api/still.png?active_tenant=tenant-b');
			expect(
				container
					.querySelector('[data-clip-id="s2"] [data-testid="clip-thumb-video"]')
					?.getAttribute('src')
			).toBe('/api/clip.mp4?active_tenant=tenant-b');
		} finally {
			setActiveTenantId(null);
		}
	});

	it('omits drag handles when onReorder is not provided', () => {
		const { container } = render(ClipTimeline, { props: { clips: [clip('s1', 0)] } });
		expect(container.querySelector('[data-testid="clip-drag-handle"]')).toBeNull();
	});
});

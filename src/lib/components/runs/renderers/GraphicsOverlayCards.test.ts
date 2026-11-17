import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import GraphicsOverlayCards from './GraphicsOverlayCards.svelte';

const all = (container: HTMLElement, id: string): HTMLElement[] => [
	...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
];
const one = (container: HTMLElement, id: string): HTMLElement | null =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (container: HTMLElement, id: string): string =>
	(one(container, id)?.textContent ?? '').replace(/\s+/g, ' ').trim();

const output = {
	cards: [
		{
			id: 'c1',
			shot_id: 'seg-1',
			kind: 'title',
			text: 'Ship it in a day',
			at_seconds: 0,
			seconds: 3,
			url: '/api/runs/r1/artifact/card-1.webm'
		},
		{
			id: 'c2',
			shot_id: '',
			kind: 'lower_third',
			text: 'nonagentic.ai',
			at_seconds: 4,
			seconds: 2,
			url: '/api/runs/r1/artifact/card-2.webm'
		}
	],
	cards_render_failed: false,
	notes: []
};

describe('GraphicsOverlayCards — the graphics gate', () => {
	it('previews each alpha card on the transparency checkerboard', () => {
		const { container } = render(GraphicsOverlayCards, { output });
		expect(text(container, 'graphics-card-count')).toBe('2 overlays designed');
		expect(all(container, 'graphics-card-video').map((el) => el.getAttribute('src'))).toEqual([
			'/api/runs/r1/artifact/card-1.webm',
			'/api/runs/r1/artifact/card-2.webm'
		]);
		// The backdrop is deliberately theme-INDEPENDENT: a white lower third on a
		// light --color-surface is invisible and a reviewer approves a blank box.
		expect(all(container, 'graphics-card-backdrop')[0].getAttribute('style')).toContain('#8c8c8c');
		expect(text(container, 'graphics-card-shot')).toContain('pinned to shot');
	});

	// REVERTED (an empty-list condition sharing one "no cards" line, or a
	// cards-only render of the banner) ⇒ the ONE payload a reviewer must see —
	// `cards: []` + `cards_render_failed: true`, the render OUTAGE — renders as
	// "the designer chose no overlays" and the reel ships with no graphics on it
	// while the gate said nothing went wrong.
	it('shows the DANGER banner for a render outage with zero cards', () => {
		const { container } = render(GraphicsOverlayCards, {
			output: { cards: [], cards_render_failed: true, notes: [] }
		});
		expect(text(container, 'graphics-warning-render-failed')).toContain(
			'Graphics failed to render'
		);
		expect(text(container, 'graphics-warning-render-failed')).toContain('NO graphics');
		// The neutral editorial line must NOT also appear — two contradictory
		// readings of one empty list is worse than either alone.
		expect(one(container, 'graphics-no-cards')).toBeNull();
	});

	// The mirror-image lie: asserting an outage about a brief that legitimately had
	// no title card would send a reviewer to re-run a stage that did its job.
	it('shows a NEUTRAL empty state when the list is empty WITHOUT the flag', () => {
		const { container } = render(GraphicsOverlayCards, {
			output: { cards: [], cards_render_failed: false, notes: [] }
		});
		expect(text(container, 'graphics-no-cards')).toContain('nothing failed');
		expect(one(container, 'graphics-warning-render-failed')).toBeNull();
	});

	it('treats an ABSENT flag as unknown, not as a failure', () => {
		// `=== true` on purpose: a payload that merely omitted the field must not be
		// reported as an outage.
		const { container } = render(GraphicsOverlayCards, { output: { cards: [] } });
		expect(one(container, 'graphics-warning-render-failed')).toBeNull();
		expect(one(container, 'graphics-no-cards')).not.toBeNull();
	});

	// REVERTED (key the lists back to the note string / card id) ⇒ Svelte throws
	// each_key_duplicate — in production too — and the gate page, which has no
	// error boundary, loses its entire output panel on exactly the degraded payload
	// these lists exist to report.
	it('renders DUPLICATE note strings and DUPLICATE card ids without throwing', () => {
		const dup = 'card render failed for shot seg-1';
		let container!: HTMLElement;
		expect(() => {
			container = render(GraphicsOverlayCards, {
				output: {
					cards: [
						{ id: 'dup', kind: 'title', url: '/a.webm' },
						{ id: 'dup', kind: 'title', url: '/b.webm' },
						{ kind: 'lower_third', url: '/c.webm' },
						{ kind: 'lower_third', url: '/d.webm' }
					],
					cards_render_failed: true,
					notes: [dup, dup]
				}
			}).container;
		}).not.toThrow();
		expect(all(container, 'graphics-note')).toHaveLength(2);
		expect(all(container, 'graphics-card')).toHaveLength(4);
	});

	it('says a card has no overlay URL instead of showing an empty box', () => {
		const { container } = render(GraphicsOverlayCards, {
			output: { cards: [{ id: 'c1', kind: 'title', url: '' }] }
		});
		expect(text(container, 'graphics-card-no-url')).toContain('no overlay URL');
		expect(all(container, 'graphics-card-video')).toHaveLength(0);
	});

	// Presigned overlay urls carry a TTL; a gate paused overnight has dead links,
	// and a silently-black <video> on a checkerboard reads as "the card is empty".
	it('replaces a dead presigned overlay with an expired-link message', async () => {
		const { container } = render(GraphicsOverlayCards, { output });
		all(container, 'graphics-card-video')[0].dispatchEvent(new Event('error'));
		await tick();
		expect(text(container, 'graphics-card-expired')).toContain('re-run graphics_design');
	});

	it('never throws on a malformed payload', () => {
		expect(() => render(GraphicsOverlayCards, { output: {} })).not.toThrow();
		expect(() =>
			render(GraphicsOverlayCards, {
				output: { cards: [null, 'nope', { id: 'c1' }], cards_render_failed: 'yes', notes: 7 }
			})
		).not.toThrow();
	});
});

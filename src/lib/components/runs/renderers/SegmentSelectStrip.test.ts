import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SegmentSelectStrip from './SegmentSelectStrip.svelte';

// Container-scoped queries, same shape as CutPlanTimeline.test.ts — several cases
// render more than once, so a document-wide lookup would be ambiguous.
const all = (container: HTMLElement, id: string): HTMLElement[] => [
	...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
];
const one = (container: HTMLElement, id: string): HTMLElement | null =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
// Whitespace-collapsed: the markup is Prettier-formatted and a sentence can be
// reflowed at any time. Pin the WORDS, never the line breaks.
const text = (container: HTMLElement, id: string): string =>
	(one(container, id)?.textContent ?? '').replace(/\s+/g, ' ').trim();

const output = {
	segments: [
		{ id: 's1', source_id: 'src-a', in_seconds: 0, out_seconds: 3, seconds: 3, score: 0.8 },
		{ id: 's2', source_id: 'src-a', in_seconds: 5, out_seconds: 8, seconds: 3, score: 0.7 },
		{
			id: 's3',
			source_id: 'src-b',
			in_seconds: 1,
			out_seconds: 3,
			seconds: 2,
			score: 0.3,
			rationale: 'Weakest of the three but adds a second angle.'
		}
	],
	near_duplicates_dropped: 0,
	near_duplicates_kept_for_coverage: 0,
	notes: []
};

describe('SegmentSelectStrip — the footage-selection gate', () => {
	// REVERTED ⇒ the reviewer sees "3 segments" and cannot tell that 75% of the reel
	// came out of ONE clip. Source dominance is the defect a row list cannot show,
	// which is the entire reason this bar exists above the rows.
	it('sizes each coverage slice in proportion to that source_id total', () => {
		const { container } = render(SegmentSelectStrip, { output });
		const slices = all(container, 'segment-select-coverage-slice').map((el) => [
			el.getAttribute('data-source-id'),
			el.getAttribute('data-percent')
		]);
		// 6s from src-a, 2s from src-b, in first-appearance order.
		expect(slices).toEqual([
			['src-a', '75.0'],
			['src-b', '25.0']
		]);
		expect(text(container, 'segment-select-source-count')).toContain('from 2 sources');
		expect(text(container, 'segment-select-verdict')).toContain('3 segments');
	});

	// REVERTED (key back to `(note)`) ⇒ Svelte throws each_key_duplicate — in
	// PRODUCTION as well as dev — and the gate page has no error boundary, so the
	// whole output panel disappears. segment_select.py appends
	// `dropped unusable window on source {source_id}` once per rejected window
	// inside ONE loop, so two bad windows on the same source emit byte-identical
	// strings: the crash lands on exactly the degraded payload the notes report.
	it('renders DUPLICATE note strings without throwing', () => {
		const dup = 'dropped unusable window on source src-a';
		let container!: HTMLElement;
		expect(() => {
			container = render(SegmentSelectStrip, {
				output: { ...output, notes: [dup, dup, 'capped at 24 segments; later candidates dropped'] }
			}).container;
		}).not.toThrow();
		expect(all(container, 'segment-select-note')).toHaveLength(3);
	});

	// Same class, second surface: two segments may carry the same id (or none) —
	// JSONB from the wire guarantees nothing — and keying the row list on the id
	// blanked the panel the same way.
	it('renders segments with DUPLICATE and missing ids without throwing', () => {
		let container!: HTMLElement;
		expect(() => {
			container = render(SegmentSelectStrip, {
				output: {
					segments: [
						{ id: 'dup', source_id: 'src-a', in_seconds: 0, out_seconds: 1, seconds: 1 },
						{ id: 'dup', source_id: 'src-a', in_seconds: 1, out_seconds: 2, seconds: 1 },
						{ source_id: 'src-b', in_seconds: 0, out_seconds: 1, seconds: 1 },
						{ source_id: 'src-b', in_seconds: 1, out_seconds: 2, seconds: 1 }
					]
				}
			}).container;
		}).not.toThrow();
		expect(all(container, 'segment-select-segment')).toHaveLength(4);
	});

	// REVERTED ⇒ the gate prints two bare zeros. `dropped === 0` ALONE is also what
	// a selection full of RE-ADMITTED duplicates reports, so a reviewer reading the
	// number as reassurance approves the repeated-shot reel the guard exists to flag.
	it('says (0, 0) in words, and never as two bare numbers', () => {
		const { container } = render(SegmentSelectStrip, { output });
		const said = text(container, 'segment-select-duplicates');
		expect(said).toContain('No near-duplicates found');
		expect(said).toContain('distinct moment');
		expect(said).not.toMatch(/\b0\b/);
	});

	it('reports KEPT near-duplicates as a warning, not as a clean draw', () => {
		const { container } = render(SegmentSelectStrip, {
			output: { ...output, near_duplicates_dropped: 0, near_duplicates_kept_for_coverage: 2 }
		});
		const said = text(container, 'segment-select-duplicates');
		expect(said).toContain('KEPT ANYWAY');
		expect(said).not.toContain('No near-duplicates found');
	});

	it('never throws on a malformed payload', () => {
		expect(() => render(SegmentSelectStrip, { output: {} })).not.toThrow();
		expect(() =>
			render(SegmentSelectStrip, {
				output: { segments: [null, 'nope', { source_id: 'a' }], notes: 'x' }
			})
		).not.toThrow();
	});
});

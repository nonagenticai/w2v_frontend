import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ShotAnalysisSummary from './ShotAnalysisSummary.svelte';

// A realistic curve: the analyzer emits hundreds of points per source. The
// renderer must never put those on the page one row at a time.
const curve = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ t: i * 0.25, motion: (i % 10) / 10 }));

const output = {
	sources: [
		{
			id: 'src-a',
			duration_s: 42,
			scene_boundaries: [1.2, 8.4, 19.9, 30.1],
			motion_timeline: curve(400),
			mean_sharpness: 0.6,
			mean_brightness: 0.5,
			motion_score: 0.72,
			overall_score: 0.81,
			error: ''
		},
		{
			id: 'src-b',
			duration_s: 0,
			scene_boundaries: [],
			motion_timeline: [],
			overall_score: 0,
			error: 'ffprobe failed: moov atom not found'
		}
	],
	notes: []
};

const all = (container: HTMLElement, id: string): HTMLElement[] => [
	...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
];
const text = (container: HTMLElement, id: string): string =>
	container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

describe('ShotAnalysisSummary — per-source measurements', () => {
	it('renders one row per source, keyed by source id', () => {
		const { container } = render(ShotAnalysisSummary, { output });
		expect(all(container, 'shot-analysis-source').map((e) => e.dataset.sourceId)).toEqual([
			'src-a',
			'src-b'
		]);
	});

	// The regression this renderer exists to prevent: the generic fallback printed
	// every scene boundary and every motion point as text.
	it('collapses scene cuts to a COUNT, never a list', () => {
		const { container } = render(ShotAnalysisSummary, { output });
		expect(all(container, 'shot-analysis-cut-count').map((e) => e.textContent)).toEqual([
			'4 cuts',
			'0 cuts'
		]);
		expect(container.textContent).not.toContain('19.9');
	});

	it('downsamples a 400-point motion curve to a fixed-width bar strip', () => {
		const { container } = render(ShotAnalysisSummary, { output });
		const spark = all(container, 'shot-analysis-sparkline');
		expect(spark).toHaveLength(1); // the errored source gets no curve
		expect(spark[0].dataset.bars).toBe('32');
		expect(spark[0].querySelectorAll('rect')).toHaveLength(32);
	});

	// The bar COUNT is 32 for any non-empty input, so asserting it proves nothing
	// about the downsample. These two assert the bar HEIGHTS, which a constant or
	// inverted bucketer would get wrong.
	it('gives a rising curve rising bars, and a flat curve equal ones', () => {
		const ramp = Array.from({ length: 128 }, (_, i) => ({ t: i * 0.1, motion: i / 127 }));
		const { container } = render(ShotAnalysisSummary, {
			output: { sources: [{ id: 'ramp', duration_s: 12.8, motion_timeline: ramp }] }
		});
		// y = 10 - height, so a taller bar has a SMALLER y: a ramp must be strictly
		// descending in y from first bar to last.
		const ys = [...all(container, 'shot-analysis-sparkline')[0].querySelectorAll('rect')].map((r) =>
			Number(r.getAttribute('y'))
		);
		expect(ys).toHaveLength(32);
		expect(ys[0]).toBeGreaterThan(ys[31]);
		expect(ys).toEqual([...ys].sort((a, b) => b - a));

		const flat = Array.from({ length: 128 }, (_, i) => ({ t: i * 0.1, motion: 0.5 }));
		const { container: c2 } = render(ShotAnalysisSummary, {
			output: { sources: [{ id: 'flat', duration_s: 12.8, motion_timeline: flat }] }
		});
		const flatYs = [...all(c2, 'shot-analysis-sparkline')[0].querySelectorAll('rect')].map((r) =>
			Number(r.getAttribute('y'))
		);
		expect(new Set(flatYs).size).toBe(1);
		expect(flatYs[0]).toBeCloseTo(5, 5);
	});

	// The label used to announce `bars.length` — a fixed 32 — for every source.
	it('announces the INPUT sample count, not the bucket count', () => {
		const { container } = render(ShotAnalysisSummary, {
			output: {
				sources: [
					{
						id: 'two',
						duration_s: 1,
						motion_timeline: [
							{ t: 0, motion: 0.1 },
							{ t: 1, motion: 0.9 }
						]
					}
				]
			}
		});
		const label = all(container, 'shot-analysis-sparkline')[0].getAttribute('aria-label') ?? '';
		expect(label).toContain('2 samples');
		expect(label).not.toBe('Motion over time, 32 samples');
	});

	// A null element passes the registry matcher (it only inspects sources[0]) and
	// used to TypeError here, blanking the entire output panel.
	it('survives a null element in sources', () => {
		const payload: Record<string, unknown> = {
			sources: [{ id: 'ok', duration_s: 3, motion_timeline: [{ t: 0, motion: 0.5 }] }, null, 7]
		};
		expect(() => render(ShotAnalysisSummary, { output: payload })).not.toThrow();
		const { container } = render(ShotAnalysisSummary, { output: payload });
		expect(all(container, 'shot-analysis-source')).toHaveLength(1);
	});

	// The stage-level soft-degradation channel; dropping it made every degradation
	// outside a per-source error invisible on the review gate.
	it('shows stage notes', () => {
		const { container } = render(ShotAnalysisSummary, {
			output: {
				sources: [{ id: 'a', duration_s: 1, motion_timeline: [{ t: 0, motion: 0.2 }] }],
				notes: ['source 019f: analysis failed']
			}
		});
		expect(text(container, 'shot-analysis-note')).toContain('analysis failed');
	});

	// A source with an error contributed NOTHING to the reel; that must not read
	// the same as "measured, and it is a dull clip".
	it('shows a source error prominently instead of a flat curve', () => {
		const { container } = render(ShotAnalysisSummary, { output });
		expect(text(container, 'shot-analysis-error')).toContain('moov atom not found');
		expect(text(container, 'shot-analysis-error')).toContain('Not measured');
	});

	it('says so explicitly when a healthy source has no motion curve', () => {
		const { container } = render(ShotAnalysisSummary, {
			output: { sources: [{ id: 'src-c', duration_s: 5, motion_timeline: [] }] }
		});
		expect(text(container, 'shot-analysis-no-motion')).toContain('No motion curve');
	});

	it('never throws on a malformed payload', () => {
		const bad: Record<string, unknown> = {
			sources: [{ id: 1, motion_timeline: 'nope', scene_boundaries: 3 }]
		};
		expect(() => render(ShotAnalysisSummary, { output: {} })).not.toThrow();
		expect(() => render(ShotAnalysisSummary, { output: bad })).not.toThrow();
	});
});

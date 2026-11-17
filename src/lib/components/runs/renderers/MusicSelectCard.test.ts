import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MusicSelectCard from './MusicSelectCard.svelte';

const all = (container: HTMLElement, id: string): HTMLElement[] => [
	...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
];
const one = (container: HTMLElement, id: string): HTMLElement | null =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (container: HTMLElement, id: string): string =>
	(one(container, id)?.textContent ?? '').replace(/\s+/g, ' ').trim();

const output = {
	track_id: 'trk-1',
	track_key: 'driving_synth',
	track_url: '/api/runs/r1/artifact/bed.mp3',
	duration_s: 8,
	bpm: 120,
	bpm_confidence: 0.9,
	beats: [0, 1, 2, 3, 4, 5, 6, 7],
	downbeats: [0, 4],
	onsets: [0.1, 4.1],
	meter: '4/4',
	grid_source: 'librosa',
	notes: []
};

describe('MusicSelectCard — the music gate', () => {
	it('leads with the bed itself: a player, the track name and the measured BPM', () => {
		const { container } = render(MusicSelectCard, { output });
		expect(container.querySelector('[data-testid="audio-player"]')).not.toBeNull();
		expect(text(container, 'music-select-track')).toBe('driving_synth');
		expect(text(container, 'music-select-bpm')).toContain('120 BPM');
		expect(text(container, 'music-select-bpm-confidence')).toContain('90% confidence');
	});

	// REVERTED ⇒ the gate prints "0 BPM", an affirmative measurement of a track that
	// was never beat-tracked. 0.0 is the backend's "not measured" sentinel; on a
	// review surface an UNKNOWN rendered as a number is the same class of lie as
	// shot_analysis reporting "0 cuts" for a payload it never analysed.
	it('renders bpm 0 as "not measured", never as "0 BPM"', () => {
		const { container } = render(MusicSelectCard, { output: { ...output, bpm: 0 } });
		const said = text(container, 'music-select-bpm');
		expect(said).toContain('BPM not measured');
		expect(said).not.toMatch(/\b0 BPM/);
		// A confidence figure for a measurement that does not exist would be worse
		// than the number it replaced.
		expect(one(container, 'music-select-bpm-confidence')).toBeNull();
	});

	// REVERTED ⇒ the one property of the bed a reviewer CANNOT hear goes unreported.
	// With no grid the compiler falls back to even spacing, and the finished reel
	// looks deliberate — you only notice it is not cut to the music if you already
	// know the track.
	it('warns loudly when grid_source is empty, even with beats present', () => {
		const { container } = render(MusicSelectCard, { output: { ...output, grid_source: '' } });
		expect(text(container, 'music-select-warning-no-grid')).toContain('No beat grid');
		expect(text(container, 'music-select-warning-no-grid')).toMatch(/EVEN-SPACED/);
		expect(one(container, 'music-select-grid')).toBeNull();
	});

	it('warns when the beat list is empty despite a named grid source', () => {
		const { container } = render(MusicSelectCard, { output: { ...output, beats: [] } });
		expect(text(container, 'music-select-warning-no-grid')).toContain('No beat grid');
	});

	it('counts the grid and draws downbeats separately from plain beats', () => {
		const { container } = render(MusicSelectCard, { output });
		expect(text(container, 'music-select-beat-count')).toBe('8 beats');
		expect(text(container, 'music-select-downbeat-count')).toBe('2 downbeats');
		// A downbeat is also a beat; drawing both would double the ink at every bar
		// line, so 8 beats − 2 downbeats = 6 short ticks + 2 tall ones.
		expect(all(container, 'music-select-downbeat-tick')).toHaveLength(2);
		expect(container.querySelectorAll('[data-testid="music-select-tick-strip"] rect')).toHaveLength(
			8
		);
	});

	// REVERTED (key the tick blocks back to the time value) ⇒ Svelte throws
	// each_key_duplicate in production, and the boundary-less gate page loses its
	// whole output panel. A repeated float in a beat grid is a legal payload — a
	// stuttering analyzer emits `beats: [1.0, 1.0]` — and it is precisely the
	// degraded grid a reviewer is being asked to judge.
	it('renders DUPLICATE beat and downbeat values without throwing', () => {
		let container!: HTMLElement;
		expect(() => {
			container = render(MusicSelectCard, {
				output: {
					...output,
					beats: [1.0, 1.0, 2.0],
					downbeats: [2.0, 2.0],
					onsets: [0.5, 0.5]
				}
			}).container;
		}).not.toThrow();
		expect(text(container, 'music-select-beat-count')).toBe('3 beats');
		expect(all(container, 'music-select-downbeat-tick')).toHaveLength(2);
	});

	it('renders DUPLICATE note strings without throwing', () => {
		const dup = 'no beat grid for this bed; falling back to even spacing';
		let container!: HTMLElement;
		expect(() => {
			container = render(MusicSelectCard, { output: { ...output, notes: [dup, dup] } }).container;
		}).not.toThrow();
		expect(all(container, 'music-select-note')).toHaveLength(2);
	});

	it('says the bed cannot be auditioned rather than showing a dead player', () => {
		const { container } = render(MusicSelectCard, { output: { ...output, track_url: '' } });
		expect(text(container, 'music-select-no-audio')).toContain('cannot be auditioned');
		expect(container.querySelector('[data-testid="audio-player"]')).toBeNull();
	});

	it('never throws on a malformed payload', () => {
		expect(() => render(MusicSelectCard, { output: {} })).not.toThrow();
		expect(() =>
			render(MusicSelectCard, {
				output: { track_id: 't', beats: 'n/a', downbeats: [null, 'x'], bpm: 'fast' }
			})
		).not.toThrow();
	});
});

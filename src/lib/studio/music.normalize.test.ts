import { describe, expect, it } from 'vitest';
import { normalizeMusicTrack } from './music';

const opts = [
	{ id: '', label: 'No music' },
	{ id: 'jazz_lounge', label: 'smooth lounge jazz background bed' },
	{ id: 'ambient_tech', label: 'Ambient tech' }
];

describe('normalizeMusicTrack — send the catalog id, never the label', () => {
	it('maps a stored label back to its id', () => {
		expect(normalizeMusicTrack('Smooth  lounge jazz background bed', opts)).toBe('jazz_lounge');
	});
	it('keeps a known id', () => {
		expect(normalizeMusicTrack('ambient_tech', opts)).toBe('ambient_tech');
	});
	// These two used to pin the OPPOSITE: an unknown value was passed through
	// unchanged ("an id from a catalog not loaded must survive a re-save"). That
	// pass-through is the 422 — see music.dropped.test.ts. A value the catalog does
	// not carry now resolves to "no music".
	it('drops an unknown value to null, and maps empty/absent to null', () => {
		expect(normalizeMusicTrack('future_bed', opts)).toBeNull();
		expect(normalizeMusicTrack('', opts)).toBeNull();
		expect(normalizeMusicTrack(null, opts)).toBeNull();
	});
	it('never maps the "No music" label to a track — it is not a bed', () => {
		expect(normalizeMusicTrack('No music', opts)).toBeNull();
	});
});

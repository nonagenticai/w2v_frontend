// N1 — a music value the catalog does not carry must NEVER reach `music.track`.
//
// The orchestrator 422s an unknown bed (`_require_known_music_track`,
// lifecycle.py:734). PR #440 mapped a stored LABEL back to its id but FELL BACK
// to returning the raw value on a miss, and the Studio then offered that raw
// value as a pickable option — so the label went straight back to the server and
// 422'd again. These tests pin the two halves of the fix: an unresolvable value
// resolves to "no music" and is REPORTED, and the picker offers catalog ids only.
import { describe, expect, it } from 'vitest';
import { normalizeMusicTrack, pickableMusicOptions, resolveMusicTrack } from './music';

const opts = [
	{ id: '', label: 'No music' },
	{ id: 'jazz_lounge', label: 'smooth lounge jazz background bed' },
	{ id: 'ambient_tech', label: 'Ambient tech' }
];

describe('resolveMusicTrack — a miss becomes "no music", loudly', () => {
	it('drops a value that is neither an id nor a label, and names it', () => {
		expect(resolveMusicTrack('future_bed', opts)).toEqual({ track: null, dropped: 'future_bed' });
		// The exact defect from the live 422: the human label of a bed this
		// tenant's catalog does not carry.
		expect(resolveMusicTrack('epic orchestral swell', opts)).toEqual({
			track: null,
			dropped: 'epic orchestral swell'
		});
	});

	it('normalizeMusicTrack never yields a non-catalog value', () => {
		// Pre-fix this returned 'future_bed' — the value that 422s.
		expect(normalizeMusicTrack('future_bed', opts)).toBeNull();
		// The "No music" LABEL is not a bed either, so it is dropped too.
		expect(normalizeMusicTrack('No music', opts)).toBeNull();
	});

	it('still resolves a label to its id, and keeps a known id, with nothing dropped', () => {
		expect(resolveMusicTrack('Smooth  lounge jazz background bed', opts)).toEqual({
			track: 'jazz_lounge',
			dropped: null
		});
		expect(resolveMusicTrack('ambient_tech', opts)).toEqual({
			track: 'ambient_tech',
			dropped: null
		});
	});

	it('reports nothing dropped for an absent/empty track', () => {
		expect(resolveMusicTrack(null, opts)).toEqual({ track: null, dropped: null });
		expect(resolveMusicTrack('', opts)).toEqual({ track: null, dropped: null });
		// The built-in empty id is a catalog entry, and spells "no music" as null.
		expect(resolveMusicTrack('', opts).dropped).toBeNull();
	});
});

describe('pickableMusicOptions — catalog ids only', () => {
	it('does not offer the run’s unknown bed as a pickable option', () => {
		const offered = pickableMusicOptions(opts, 'epic orchestral swell');
		// Pre-fix the page appended {id: track, label: track} here, which is how a
		// non-id became selectable and round-tripped into the save.
		expect(offered.map((o) => o.id)).toEqual(['', 'jazz_lounge', 'ambient_tech']);
		expect(offered.some((o) => o.id === 'epic orchestral swell')).toBe(false);
	});

	it('offers exactly the catalog when the current bed is known or absent', () => {
		expect(pickableMusicOptions(opts, 'jazz_lounge').map((o) => o.id)).toEqual([
			'',
			'jazz_lounge',
			'ambient_tech'
		]);
		expect(pickableMusicOptions(opts, null).map((o) => o.id)).toEqual([
			'',
			'jazz_lounge',
			'ambient_tech'
		]);
	});

	it('every offered id is one the catalog carries, for any current value', () => {
		const catalogIds = new Set(opts.map((o) => o.id));
		for (const current of ['future_bed', 'No music', 'jazz_lounge', '', null]) {
			for (const o of pickableMusicOptions(opts, current)) {
				expect(catalogIds.has(o.id)).toBe(true);
			}
		}
	});
});

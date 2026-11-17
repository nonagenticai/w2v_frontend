import { describe, it, expect } from 'vitest';
import {
	readCurrentMusic,
	MUSIC_TRACKS,
	DUCK_PRESETS,
	DEFAULT_DUCK_DB,
	musicTracksToOptions
} from './music';

describe('readCurrentMusic', () => {
	it('reads track + knobs (incl. duck_db) from sound_effects', () => {
		expect(
			readCurrentMusic({
				sound_effects: {
					music: 'corporate_uplift',
					music_gain_db: -14,
					fade_in_s: 1,
					fade_out_s: 2,
					duck_db: -18
				}
			})
		).toEqual({
			track: 'corporate_uplift',
			gain_db: -14,
			fade_in_s: 1,
			fade_out_s: 2,
			duck_db: -18
		});
	});

	it('returns a null-track bed when no music / no sound_effects', () => {
		const empty = { track: null, gain_db: null, fade_in_s: null, fade_out_s: null, duck_db: null };
		expect(readCurrentMusic({ sound_effects: { transitions: true } })).toEqual(empty);
		expect(readCurrentMusic({})).toEqual(empty);
	});

	it('is defensive against null / non-object snapshots', () => {
		for (const bad of [null, undefined, 42, 'x', { sound_effects: 'nope' }]) {
			expect(readCurrentMusic(bad).track).toBeNull();
		}
	});

	it('exposes the built-in track catalog with a no-music option', () => {
		expect(MUSIC_TRACKS[0].id).toBe('');
		expect(MUSIC_TRACKS.map((t) => t.id)).toContain('jazz_lounge');
	});

	it('exposes ducking presets incl. the backend default', () => {
		expect(DUCK_PRESETS.map((d) => d.db)).toContain(DEFAULT_DUCK_DB);
		expect(DUCK_PRESETS.every((d) => d.db <= 0)).toBe(true);
	});
});

describe('musicTracksToOptions', () => {
	it('maps backend tracks to {id,label} options with "no music" prepended', () => {
		expect(
			musicTracksToOptions([
				{ id: 'epic_trailer', label: 'Epic trailer', category: 'music' },
				{ id: 'soft_piano', label: 'Soft piano', category: 'music' }
			])
		).toEqual([
			{ id: '', label: 'No music' },
			{ id: 'epic_trailer', label: 'Epic trailer' },
			{ id: 'soft_piano', label: 'Soft piano' }
		]);
	});

	it('drops the backend `category` field and always leads with the none option', () => {
		const opts = musicTracksToOptions([{ id: 'x', label: 'X', category: 'music' }]);
		expect(opts[0]).toEqual({ id: '', label: 'No music' });
		expect(opts[1]).not.toHaveProperty('category');
	});

	it('returns just the none option for an empty backend list', () => {
		expect(musicTracksToOptions([])).toEqual([{ id: '', label: 'No music' }]);
	});
});

// Run-level music bed for the Studio: the catalog of selectable tracks and a
// defensive reader that lifts the current music from a run's config snapshot.
import type { MusicEdit } from '$lib/api/runs';
import type { MusicTrack } from '$lib/api/music';

// Built-in sound-catalog music ids (backend `sound_catalog.py`). Now used as the
// OFFLINE FALLBACK when the tenant-aware `GET /api/music/tracks` endpoint can't
// be reached; the Studio fetches the live list on mount. The empty id = "no
// music" and is always the first option.
export const MUSIC_TRACKS = [
	{ id: '', label: 'No music' },
	{ id: 'corporate_uplift', label: 'Corporate uplift' },
	{ id: 'ambient_tech', label: 'Ambient tech' },
	{ id: 'jazz_lounge', label: 'Lounge jazz' }
] as const;

// The select's option shape: a subset of the built-in `MUSIC_TRACKS` items and
// of the backend `MusicTrack` (which also carries `category`). Both adapt to it.
export interface MusicOption {
	id: string;
	label: string;
}

// The built-in empty-id "no music" option — always first in the select.
const NO_MUSIC: MusicOption = { id: MUSIC_TRACKS[0].id, label: MUSIC_TRACKS[0].label };

/**
 * Adapt backend `MusicTrack{id,label,category}` rows to the Studio select's
 * `{id,label}` option shape, prepending the built-in "no music" entry (the
 * endpoint returns only real beds, never the empty-id none option).
 */
export function musicTracksToOptions(tracks: MusicTrack[]): MusicOption[] {
	return [NO_MUSIC, ...tracks.map((t) => ({ id: t.id, label: t.label }))];
}

// How deep the music dips under narration (dB). -12 is the backend/compiler
// default (its legacy fixed ratio); the value maps to the sidechain ratio there.
export const DUCK_PRESETS = [
	{ db: -6, label: 'Light' },
	{ db: -12, label: 'Standard' },
	{ db: -18, label: 'Deep' }
] as const;
export const DEFAULT_DUCK_DB = -12;

/**
 * The run's current music bed, read from its config snapshot's `sound_effects`
 * block. `track` is null when no music is set; numeric knobs default to null so a
 * re-applied override keeps the backend/computed default. Fully defensive — the
 * snapshot is untyped JSON.
 */
export function readCurrentMusic(configSnapshot: unknown): MusicEdit {
	const cfg = (configSnapshot ?? {}) as Record<string, unknown>;
	const sound = (cfg.sound_effects ?? {}) as Record<string, unknown>;
	const numOrNull = (v: unknown) => (typeof v === 'number' ? v : null);
	return {
		track: typeof sound.music === 'string' ? sound.music : null,
		gain_db: numOrNull(sound.music_gain_db),
		fade_in_s: numOrNull(sound.fade_in_s),
		fade_out_s: numOrNull(sound.fade_out_s),
		duck_db: numOrNull(sound.duck_db)
	};
}

/**
 * The beds the picker may offer: the catalog, and NOTHING else.
 *
 * The Studio used to append the run's stored value as a synthetic
 * `{id: track, label: track}` option so an unknown bed stayed visible. That made
 * the unknown value PICKABLE, so it round-tripped back into `music.track` and
 * 422'd the save. `current` is accepted (and deliberately ignored) so the
 * call-site reads as "given what the run has, what may I offer?" — the answer is
 * always the catalog; an unresolvable bed is explained by a notice, not an option.
 */
export function pickableMusicOptions(
	options: readonly MusicOption[],
	_current?: string | null
): MusicOption[] {
	return [...options];
}

/** The outcome of resolving a stored music value against the live catalog. */
export interface MusicResolution {
	/**
	 * A catalog id, or `null` for "no music". NEVER a value the catalog does not
	 * carry — the orchestrator 422s `music.track` against the tenant library
	 * (`_require_known_music_track`), so an unresolvable value must not survive
	 * into a save.
	 */
	track: string | null;
	/**
	 * The stored value that matched no catalog entry and was therefore dropped to
	 * "no music", so the UI can say WHICH soundtrack it could not honour. `null`
	 * when nothing was dropped.
	 */
	dropped: string | null;
}

/**
 * Resolve a stored music value to a catalog id, reporting what was dropped.
 *
 * `sound_effects.music` must be a catalog id (`jazz_lounge`), but the catalog
 * also carries a human label (`smooth lounge jazz background bed`). A value that
 * matches no option id yet matches an option's LABEL (case/space-insensitive) is
 * mapped back to that option's id, so the select shows the right bed and a save
 * sends the id — never the label.
 *
 * Anything else resolves to "no music" (`null`) and is reported in `dropped`.
 * It used to be returned unchanged, on the theory that "an id from a catalog this
 * build has not loaded must survive a re-save" — but that is exactly how the label
 * `smooth lounge jazz background bed` round-tripped back into `music.track` and
 * 422'd the apply-edits at w2v_orchestrator lifecycle.py:734. A value the tenant
 * library does not carry cannot be saved by anyone, so keeping it only defers the
 * failure to the server; dropping it (loudly) is the only representable outcome.
 */
export function resolveMusicTrack(
	track: string | null | undefined,
	options: readonly MusicOption[]
): MusicResolution {
	if (!track) return { track: null, dropped: null };
	// `''` is the built-in "no music" id; MusicEdit spells that as null.
	if (options.some((o) => o.id === track)) return { track: track || null, dropped: null };
	const key = track.trim().toLowerCase().replace(/\s+/g, ' ');
	const byLabel = options.find((o) => o.id && o.label.trim().toLowerCase() === key);
	if (byLabel) return { track: byLabel.id, dropped: null };
	return { track: null, dropped: track };
}

/**
 * The catalog id a stored music value resolves to — `null` for "no music" AND for
 * any value the catalog does not carry. See `resolveMusicTrack` for why a miss can
 * never be passed through, and use that function when you need to tell the user
 * which soundtrack was dropped.
 */
export function normalizeMusicTrack(
	track: string | null | undefined,
	options: readonly MusicOption[]
): string | null {
	return resolveMusicTrack(track, options).track;
}

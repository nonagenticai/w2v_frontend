// Studio timeline model — resolve a run's compiled video + its ordered clip
// spine. The compiled video is still found by OUTPUT SHAPE (see
// `utils/stage-output.ts`). The clip spine answers TWO questions that are NOT
// the same: what to DISPLAY (shape heuristic is fine, and is all several
// blueprints have) and what the server will accept a REORDER against (only the
// orchestrator's authoritative `clip_spine_stage`). See `resolveClipSpine`.

import type { RunDetail } from '$lib/types/runs';
import type {
	ClipAdjust,
	ClipAudio,
	ClipOverlay,
	ClipTransition,
	OverlayPosition
} from '$lib/api/runs';
import { findResultStage, isVideoStage, type StageOutput } from './stage-output';

/** One clip on the studio timeline, assembled from a spine element. */
export interface Clip {
	/** Stable element id — the pin/reorder key (shot.id / line.id). */
	id: string;
	/** The narration line this clip plays over, when distinct from `id`. */
	lineId: string | null;
	/** 0-based position in the current order. */
	index: number;
	/** Clip duration in seconds (0 when the spine doesn't carry it yet). */
	seconds: number;
	/** Cumulative start offset in the compiled video (sum of prior durations). */
	startSec: number;
	/** Human label: shot `description` or line `text`. */
	description: string;
	/** The narration line spoken over this clip (`shot.narration`, or the line's
	 *  own `text` on a `lines[]` spine). '' when the spine carries none. Pre-fills
	 *  the Studio's re-narrate box. */
	narration: string;
	/** footage / slide / html / ai_image, when the spine tags it. */
	visualType: string | null;
	/** A still to show on the card, joined from a producer stage by `line_id`
	 *  (or resolved off the spine node itself). Null → the card shows an icon. */
	thumbnailUrl: string | null;
	/** A recorded/motion clip to use as the card's moving thumbnail when no still
	 *  exists (demo_video `demo_video_record.clips[].video_url`). Null otherwise. */
	posterVideoUrl: string | null;
	/** True when this clip is backed by recorded footage (a joined video). Only
	 *  footage clips honour the trim/anchor edit controls — the compositor's
	 *  `clip_lead_seconds`/`clip_anchor` framing is a no-op on image/text shots. */
	isFootage: boolean;
	/** Seconds of footage skipped at the clip's head (compositor `clip_lead_seconds`,
	 *  anchor `start`). 0 when unauthored — the current trim override on the spine. */
	clipLeadSeconds: number;
	/** Which end of the recording the clip window anchors to (`start` shows the
	 *  head after any lead; `end` shows the settled tail). Defaults to `start`. */
	clipAnchor: 'start' | 'end';
	/** Authored burned-in caption override on the spine, '' when unauthored. */
	caption: string;
	/** Authored compositor fit override, `null` when unauthored (compositor
	 *  defaults to `contain`). */
	fit: 'contain' | 'cover' | 'scroll' | null;
	// ── Edit fields merged onto the spine by apply-edits ───────────────────
	// `POST /api/runs/{id}/apply-edits` shallow-merges every editable clip field
	// onto the child run's spine element, so a RE-STITCHED run's spine genuinely
	// carries these. Reading them here is what lets the inspector report what the
	// run actually contains instead of the unauthored default. `null` throughout
	// means "the spine carries no authored value" — the caller supplies the
	// documented default (1× / cut / no grade / no overlays / no-op audio / TTS).
	/** Authored playback rate (compositor `speed`), `null` when unauthored. */
	speed: number | null;
	/** Authored transition INTO this clip, `null` when unauthored (hard cut). */
	transition: ClipTransition | null;
	/** Authored color grade, `null` when unauthored (no grade). */
	adjust: ClipAdjust | null;
	/** Authored burned-in text overlays, `null` when unauthored/empty. */
	overlays: ClipOverlay[] | null;
	/** Authored primary-audio level/mute/fade, `null` when unauthored (no-op). */
	audio: ClipAudio | null;
	/** Authored replacement voiceover URL, `null` when unauthored (TTS). */
	audioUrl: string | null;
	/** Declared duration of `audioUrl`, `null` when unauthored. */
	audioSeconds: number | null;
}

/** A per-clip visual resolved from a downstream producer stage. */
interface Still {
	imageUrl?: string;
	videoUrl?: string;
}

/** The resolved clip spine: which stage + array key holds the ordered clips. */
export interface ClipSpine {
	stage: StageOutput;
	stageName: string;
	/** The output key the clip array lives under (`shots` or `lines`). */
	key: 'shots' | 'lines';
	clips: Clip[];
	/**
	 * True only when the ORCHESTRATOR named this stage as the run's clip spine
	 * (`clip_spine_stage`) — i.e. the one stage `POST /runs/{id}/reorder-clips`
	 * will accept. False means "these clips are safe to DISPLAY but a reorder
	 * would 422": either the server said the run has no reorderable timeline
	 * (`clip_spine_stage: null`) or it is an older orchestrator that does not
	 * publish the field at all, in which case we cannot know and must not offer
	 * a button that fails.
	 *
	 * DISPLAY and REORDER-ELIGIBILITY are deliberately separate: 9 of the 16
	 * blueprints in the registry (action_reel_v1, audiobook_v1, cro_audit_v1,
	 * growth_bundle_v1, marketing_scorecard_v1, seo_audit_v1, web_design_v1/v2,
	 * website_review_v1) have no reorderable spine, yet several render a real
	 * Studio timeline today. Collapsing the two would take their timeline,
	 * annotations, clip edits, soundtrack save and per-clip regenerate with it.
	 */
	reorderable: boolean;
}

type Rec = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Like `num`, but absence stays `null`. The 0 default of `num` would read as an
 *  AUTHORED value for the merged edit fields (speed 0×, a 0s voiceover), so
 *  anything whose default is "unauthored" must use this. */
const numOrNull = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : null;
/** A plain object node (not an array, not null), else null — the shape guard for
 *  the object-valued spine fields (`adjust`, `audio`, `transition`). */
const rec = (v: unknown): Rec | null =>
	!!v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;

// Literal sets typed against the API types so a backend enum change is a COMPILE
// error here rather than a silently-dropped spine value.
const TRANSITION_TYPES: readonly ClipTransition['type'][] = [
	'fade',
	'dissolve',
	'wipeleft',
	'slideright'
];
const ADJUST_PRESETS: readonly NonNullable<ClipAdjust['preset']>[] = [
	'warm',
	'cool',
	'bw',
	'vivid',
	'cinematic'
];
const OVERLAY_POSITIONS: readonly OverlayPosition[] = [
	'top-left',
	'top-center',
	'top-right',
	'middle-left',
	'middle-center',
	'middle-right',
	'bottom-left',
	'bottom-center',
	'bottom-right'
];

/** The playback rate merged onto the spine, or null (default 1× real time). A
 *  non-positive rate is not a rate — the compositor would produce no frames. */
function readSpeed(v: unknown): number | null {
	const speed = numOrNull(v);
	return speed !== null && speed > 0 ? speed : null;
}

/** The transition merged onto the spine, or null (default hard cut). A node with
 *  no recognised `type` is not a transition at all; a missing/garbage duration
 *  falls back to the backend default 0.5s rather than rejecting the whole cut. */
function readTransition(v: unknown): ClipTransition | null {
	const n = rec(v);
	if (!n) return null;
	const type = TRANSITION_TYPES.find((t) => t === n.type);
	if (!type) return null;
	const duration = numOrNull(n.duration);
	return { type, duration: duration !== null && duration > 0 ? duration : 0.5 };
}

/** The color grade merged onto the spine, or null (no grade). */
function readAdjust(v: unknown): ClipAdjust | null {
	const n = rec(v);
	if (!n) return null;
	const brightness = numOrNull(n.brightness);
	const contrast = numOrNull(n.contrast);
	const saturation = numOrNull(n.saturation);
	const gamma = numOrNull(n.gamma);
	const preset = ADJUST_PRESETS.find((p) => p === n.preset);
	const adjust: ClipAdjust = {
		...(brightness !== null && { brightness }),
		...(contrast !== null && { contrast }),
		...(saturation !== null && { saturation }),
		...(gamma !== null && { gamma }),
		...(preset && { preset })
	};
	return Object.keys(adjust).length > 0 ? adjust : null;
}

/** The primary-audio block merged onto the spine, or null (no-op). */
function readAudio(v: unknown): ClipAudio | null {
	const n = rec(v);
	if (!n) return null;
	const gainDb = numOrNull(n.gain_db);
	const fadeIn = numOrNull(n.fade_in_s);
	const fadeOut = numOrNull(n.fade_out_s);
	const audio: ClipAudio = {
		...(gainDb !== null && { gain_db: gainDb }),
		...(typeof n.mute === 'boolean' && { mute: n.mute }),
		...(fadeIn !== null && { fade_in_s: fadeIn }),
		...(fadeOut !== null && { fade_out_s: fadeOut })
	};
	return Object.keys(audio).length > 0 ? audio : null;
}

/** The burned-in overlays merged onto the spine, or null (none). Entries without
 *  text are dropped — they draw nothing and would render an empty inspector row. */
function readOverlays(v: unknown): ClipOverlay[] | null {
	if (!Array.isArray(v)) return null;
	const overlays: ClipOverlay[] = [];
	for (const el of v) {
		const n = rec(el);
		const text = n ? str(n.text) : null;
		if (!n || text === null) continue;
		const position = OVERLAY_POSITIONS.find((p) => p === n.position);
		const x = numOrNull(n.x);
		const y = numOrNull(n.y);
		const fontSize = numOrNull(n.font_size);
		const color = str(n.color);
		const start = numOrNull(n.start);
		const end = numOrNull(n.end);
		overlays.push({
			text,
			...(position && { position }),
			...(x !== null && { x }),
			...(y !== null && { y }),
			...(fontSize !== null && { font_size: fontSize }),
			...(color !== null && { color }),
			...(start !== null && { start }),
			...(end !== null && { end })
		});
	}
	return overlays.length > 0 ? overlays : null;
}

function elementsWithIds(output: Rec, key: string): Rec[] {
	const arr = output[key];
	if (!Array.isArray(arr)) return [];
	return arr.filter((n): n is Rec => !!n && typeof n === 'object' && typeof n.id === 'string');
}

/** The compiled-MP4 stage (terminal compile/render/stitch), or null. */
export function resolveVideoStage(run: RunDetail): StageOutput | null {
	return findResultStage(run, isVideoStage);
}

const THUMBNAIL_KEYS = ['thumbnail_url', 'image_url', 'poster_url', 'still_url'] as const;
const VIDEO_KEYS = ['video_url', 'motion_video_url'] as const;

// Producer-stage array keys that carry per-clip visuals: `ai_image_gen.images`,
// `promo_slides.slides` / `showcase_slides.slides`, `demo_video_record.clips`.
// Joined to the spine by `line_id`. Stills are already rewritten to same-origin
// `/api/runs/{id}/artifact/...` proxy URLs by the backend, so they load under the
// strict CSP without any client-side proxying.
const PRODUCER_KEYS = ['images', 'slides', 'clips'] as const;

const firstStr = (n: Rec, keys: readonly string[]): string | null =>
	keys.map((k) => str(n[k])).find((v) => v !== null) ?? null;

/**
 * The per-clip visual index for a run: a `line_id → {imageUrl, videoUrl}` map
 * plus an ordered image pool for the positional (round-robin) fallback used by
 * the generic pipeline, whose `ai_image_gen` images carry no `line_id`. Built by
 * scanning every completed stage's producer arrays (see `PRODUCER_KEYS`).
 */
export interface StillIndex {
	byLineId: Map<string, Still>;
	imagePool: string[];
}

export function buildStillIndex(run: RunDetail): StillIndex {
	const byLineId = new Map<string, Still>();
	const imagePool: string[] = [];
	const completed = (run.stage_outputs ?? []).filter((s) => s.status === 'completed');
	// Key loop is OUTER so producer priority is by type, not stage order: a
	// story-grounded `ai_image_gen.images[]` still is preferred over a
	// `promo_slides.slides[]` designed slide, which is preferred over a recorded
	// `demo_video_record.clips[]` video. First writer wins per join key.
	for (const key of PRODUCER_KEYS) {
		for (const s of completed) {
			const arr = (s.output ?? ({} as Rec))[key];
			if (!Array.isArray(arr)) continue;
			for (const el of arr) {
				if (!el || typeof el !== 'object') continue;
				const n = el as Rec;
				const img = firstStr(n, THUMBNAIL_KEYS);
				const vid = firstStr(n, VIDEO_KEYS);
				const lid = str(n.line_id);
				if (!lid) {
					// No join key → this still can only be placed positionally. Stills
					// that DO carry a line_id are joined precisely below and must NOT
					// also enter the pool, or the round-robin fallback could hand one
					// clip's joined still to a different, unmatched clip.
					if (img) imagePool.push(img);
					continue;
				}
				const existing = byLineId.get(lid) ?? {};
				if (img && !existing.imageUrl) existing.imageUrl = img;
				if (vid && !existing.videoUrl) existing.videoUrl = vid;
				byLineId.set(lid, existing);
			}
		}
	}
	return { byLineId, imagePool };
}

function toClips(nodes: Rec[], stills: StillIndex): Clip[] {
	let cursor = 0;
	return nodes.map((n, i) => {
		const seconds = num(n.seconds);
		const startSec = cursor;
		cursor += seconds;
		// Prefer a producer still joined by the clip's join key (its `line_id`, or
		// its own `id` when the spine carries no line_id — e.g. demo_video lines
		// whose id IS the join key `clip-<n>`), then a still already on the spine
		// node, then the positional round-robin pool (generic pipeline).
		const lineId = str(n.line_id);
		const joinKey = lineId ?? (n.id as string);
		const joined = stills.byLineId.get(joinKey);
		const nodeThumb = firstStr(n, THUMBNAIL_KEYS);
		const positional =
			stills.imagePool.length > 0 ? stills.imagePool[i % stills.imagePool.length] : null;
		const thumbnailUrl = joined?.imageUrl ?? nodeThumb ?? positional ?? null;
		const joinedVideoUrl = joined?.videoUrl ?? null;
		const posterVideoUrl = thumbnailUrl ? null : joinedVideoUrl;
		return {
			id: n.id as string,
			lineId,
			index: i,
			seconds,
			startSec,
			description: str(n.description) ?? str(n.text) ?? '',
			// A `shots[]` spine carries the spoken line under `narration` (its
			// `description` is the VISUAL); a `lines[]` spine's `text` IS the line.
			narration: str(n.narration) ?? str(n.text) ?? '',
			visualType: str(n.visual_type),
			thumbnailUrl,
			posterVideoUrl,
			// Footage-backed when a recorded clip joins here (even if a still also
			// covers the card) — that's what makes trim/anchor meaningful.
			isFootage: joinedVideoUrl !== null,
			clipLeadSeconds: num(n.clip_lead_seconds),
			clipAnchor: str(n.clip_anchor) === 'end' ? 'end' : 'start',
			caption: str(n.caption) ?? '',
			fit: (['contain', 'cover', 'scroll'] as const).find((f) => f === n.fit) ?? null,
			// Merged-edit fields (see the Clip interface): present on a re-stitched
			// run's spine, absent on a freshly-generated one.
			speed: readSpeed(n.speed),
			transition: readTransition(n.transition),
			adjust: readAdjust(n.adjust),
			overlays: readOverlays(n.overlays),
			audio: readAudio(n.audio),
			audioUrl: str(n.audio_url),
			audioSeconds: numOrNull(n.audio_seconds)
		};
	});
}

/** Build a spine from one already-selected stage row, or null when that row
 *  carries no id-bearing `shots[]`/`lines[]` array. */
function spineFromStage(
	stage: StageOutput,
	stills: StillIndex,
	reorderable: boolean
): ClipSpine | null {
	for (const key of ['shots', 'lines'] as const) {
		const nodes = elementsWithIds((stage.output ?? {}) as Rec, key);
		if (nodes.length > 0) {
			return {
				stage,
				stageName: stage.stage_name,
				key,
				clips: toClips(nodes, stills),
				reorderable
			};
		}
	}
	return null;
}

/**
 * DISPLAY-ONLY shape heuristic — picks a spine purely by OUTPUT SHAPE: the last
 * completed non-video stage carrying a `shots[]` (preferred) or `lines[]`.
 *
 * ⚠️ Everything it returns is `reorderable: false`, and that is the whole point.
 * As a REORDER target this heuristic is the DEFECT `clip_spine_stage` exists to
 * fix: on a demo_video run FOUR stages (`demo_video_gen`, `script_doctor`,
 * `retention_plan`, `reconcile_timeline`) carry an identical `lines[]` of the
 * same ids while only `demo_video_gen` is a legal reorder spine server-side —
 * and the orchestrator's `list_for_run` query has no ORDER BY, so "last" is
 * arbitrary and the page POSTs a stage the server 422s 3 times out of 4.
 *
 * As a DISPLAY source it is still the only thing several live blueprints have
 * (`action_reel_v1`'s `cut_plan.shots[]`, `website_review_v1` and the audit
 * blueprints' `<x>_script.lines[]`), so it must keep working. Do not extend it,
 * and never hand its result to the reorder route.
 */
function resolveClipSpineByShape(run: RunDetail, stills: StillIndex): ClipSpine | null {
	const video = resolveVideoStage(run);
	const completed = (run.stage_outputs ?? []).filter(
		(s) => s.status === 'completed' && s.stage_name !== video?.stage_name
	);
	for (const key of ['shots', 'lines'] as const) {
		// Last match wins — the storyboard sits after earlier line-bearing stages.
		for (let i = completed.length - 1; i >= 0; i--) {
			const s = completed[i];
			const nodes = elementsWithIds((s.output ?? {}) as Rec, key);
			if (nodes.length > 0) {
				return {
					stage: s,
					stageName: s.stage_name,
					key,
					clips: toClips(nodes, stills),
					// A guessed stage is NEVER a reorder target — see the doc above.
					reorderable: false
				};
			}
		}
	}
	return null;
}

/**
 * The run's clip spine — the stage whose ordered array drives the compiled
 * video's clip order — plus whether the server will accept a REORDER of it.
 *
 * The two questions are answered separately, because they have different
 * consequences: getting DISPLAY wrong empties the timeline (and with it
 * annotations, clip edits, soundtrack save, per-clip regenerate), while getting
 * REORDER wrong shows a button that 422s.
 *
 * | `clip_spine_stage`      | spine                     | `reorderable` |
 * |-------------------------|---------------------------|---------------|
 * | a string that resolves  | exactly that stage        | `true`        |
 * | a string that does NOT  | `null`                    | —             |
 * | `null`                  | shape heuristic           | `false`       |
 * | absent (`undefined`)    | shape heuristic           | `false`       |
 *
 * - **String → resolve it and NOTHING else.** A missing row, a non-`completed`
 *   row, or a row with no id-bearing clip array yields `null` and we do NOT fall
 *   back: the server named a stage and it did not resolve, which is a real
 *   inconsistency, not a legacy response. Guessing here is the bug this replaces.
 * - **`null` → the server says this run has no reorderable timeline.** Most of
 *   the registry is in this bucket. Still render it — `action_reel_v1`'s
 *   `cut_plan.shots[]` and `website_review_v1`'s `<x>_script.lines[]` are real,
 *   working timelines today — just never offer a reorder.
 * - **Absent → an orchestrator predating the field.** Render, but we cannot know
 *   which stage the server would accept, so reorder stays off. This is a
 *   rollout-window case only: it self-heals the moment the backend carrying
 *   `clip_spine_stage` is deployed, with no frontend change. Reorder was already
 *   422-ing on these runs, so nothing that worked stops working.
 */
export function resolveClipSpine(run: RunDetail): ClipSpine | null {
	const stills = buildStillIndex(run);
	const spineStage = run.clip_spine_stage;
	if (typeof spineStage === 'string' && spineStage.length > 0) {
		const stage = (run.stage_outputs ?? []).find((s) => s.stage_name === spineStage);
		// Returning null here looks like a display regression; it is not, so do not
		// "fix" it with a fallback. The orchestrator only ever names a stage whose
		// row is ALREADY `completed` (`resolve_clip_spine_stage` requires it), and a
		// re-stitch child seeds every preserved stage as `completed` at insert
		// (`run_setup.py` `insert_initial_stage_rows`). So a named-but-unusable
		// stage is not a normal in-flight state — it means the payload disagrees
		// with itself, and guessing a different stage there is exactly what this
		// field exists to stop. The one reachable case is a stale field from the
		// initial load while a live poll flips that stage non-terminal, and it
		// resolves itself on the next fetch.
		if (!stage || stage.status !== 'completed') return null;
		return spineFromStage(stage, stills, true);
	}
	return resolveClipSpineByShape(run, stills);
}

/** The clip whose [startSec, startSec+seconds) window contains `t`, else null.
 *  Falls back to the first clip when durations are unknown (all zero). */
export function activeClipAt(clips: Clip[], t: number): string | null {
	if (clips.length === 0) return null;
	const totalKnown = clips.some((c) => c.seconds > 0);
	if (!totalKnown) return clips[0].id;
	for (const c of clips) {
		if (t >= c.startSec && t < c.startSec + c.seconds) return c.id;
	}
	// Past the last clip's end → clamp to the final clip.
	return clips[clips.length - 1].id;
}

// Cross-stage assembly: many pipeline stages key their items by a shared
// `line_id` (script line → storyboard shot → narration clip → slide image → AI
// image → motion clip → visual-director screen). This joins them into one
// ordered list of per-line cards so a marketing user sees the video assembling
// itself line by line, rather than as separate technical stage dumps.
//
// Three quirks of the real pipeline drive the shape of this file:
//
//   1. The line key is not always `line_id`. Lesson stages key by
//      `paragraph_id`, and slide-like items address *several* lines at once via
//      `line_ids[]` / `paragraph_ids[]`. See `lineKeys`.
//   2. `clips` is overloaded. It means narration audio in `*_narrate` (and in
//      `website_review_record`, which IS that blueprint's narration stage), but
//      per-line screen video in `demo_video_record` and `motion_graphics_gen`.
//      The field name, not the stage name, tells them apart. See `clipUrls`.
//   3. Rendered visuals are often addressed indirectly: `recordings[]` names the
//      slide it rendered (`slide_id`), and `assignments[]` names a section or
//      screen that some other stage published under `visuals[]`. Both hops are
//      resolved through one asset index built up front. See `buildAssetIndex`.
//
// Precedence is expressed as ordered passes over all stages, never as the order
// stages happen to appear in `stage_outputs` — a line has one canvas, and the
// slide authored for it must outrank generic decoration (template motion, page
// captures) regardless of which stage the DAG emitted first.
//
// Self-gating: returns [] when no stage exposes a line key (audiobook, which is
// chapter/chunk-keyed, and critique-only runs) — those render via the per-stage
// renderers + RunOutputPanel instead.
import type { RunDetail } from '$lib/types/runs';

export interface StorylineLine {
	lineId: string;
	index: number;
	text?: string;
	seconds?: number;
	speaker?: string;
	shot?: string;
	visualType?: string;
	audioUrl?: string;
	imageUrl?: string;
	motionUrl?: string;
	screenId?: string;
	previewSource?: 'Captured screen' | 'Slide fallback';
}

type Rec = Record<string, unknown>;
const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.length > 0 ? v : undefined;
const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);
const strs = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(str).filter((s): s is string => s !== undefined) : [];

/** Extensions that mark a URL as video even when it arrives under `artifact_url`.
 *  Presigned MinIO links carry a query string, hence the `?`/`#` terminators. */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/**
 * Every line an item claims. Plural forms fan one item out to all of them (a
 * lesson slide covers several paragraphs; an audit slide covers several lines).
 * An empty result means the item is not line-keyed — `site_capture` clips and
 * audiobook chunks — and it must be skipped rather than inventing a card.
 */
function lineKeys(item: Rec): string[] {
	const many = [...strs(item.line_ids), ...strs(item.paragraph_ids)];
	if (many.length) return [...new Set(many)];
	const one = str(item.line_id) ?? str(item.paragraph_id);
	return one ? [one] : [];
}

/**
 * Split a `clips[]` item into the slots it fills. Field name is the primary
 * signal: `video_url` is always video, `artifact_url` is audio unless its
 * extension says otherwise. The stage name is deliberately NOT consulted —
 * `website_review_record` is a `_record` stage emitting narration `.wav`, so a
 * suffix rule would silently mute that blueprint. An extension-less
 * `artifact_url` stays audio, which is what this join has always done.
 */
function clipUrls(c: Rec): { audio?: string; video?: string } {
	const video = str(c.video_url);
	const artifact = str(c.artifact_url);
	if (artifact && VIDEO_EXT.test(artifact)) return { video: video ?? artifact };
	return { audio: artifact, video };
}

interface Asset {
	imageUrl?: string;
	motionUrl?: string;
}

/**
 * Index every addressable visual asset by the ids other stages refer to it by:
 * its own `id`, and — for a recording — the `slide_id` it rendered. This is what
 * makes the two indirect hops work, including across stage boundaries
 * (`lesson_slides` and `lesson_record` are separate stage outputs, as are
 * `website_review_visual_director` and `website_redesign`).
 */
function buildAssetIndex(stages: { output?: unknown }[]): Map<string, Asset> {
	const index = new Map<string, Asset>();
	const put = (id: string | undefined, a: Asset) => {
		if (!id || (!a.imageUrl && !a.motionUrl)) return;
		const cur = index.get(id);
		// First write wins, so a duplicated id resolves stably.
		index.set(id, {
			imageUrl: cur?.imageUrl ?? a.imageUrl,
			motionUrl: cur?.motionUrl ?? a.motionUrl
		});
	};
	for (const s of stages) {
		const o = (s.output ?? {}) as Rec;
		for (const key of ['visuals', 'recordings', 'slides', 'images', 'screens'] as const) {
			for (const it of arr(o[key])) {
				const asset: Asset = {
					imageUrl: str(it.image_url) ?? str(it.artifact_url),
					motionUrl: str(it.motion_video_url) ?? str(it.video_url) ?? str(it.clip_url)
				};
				put(str(it.id), asset);
				put(str(it.slide_id), asset);
			}
		}
	}
	return index;
}

/** Role prefix the redesign stage gives a per-section still (orchestrator
 *  `grounding.SECTION_ROLE_PREFIX`). */
const SECTION_ROLE_PREFIX = 'redesign_section:';
/** Page-order index in a section still's file name (`…/07_cta.png`). */
const STILL_ORDER = /\/(\d+)_[^/]*$/;

/**
 * The website_review visual director grounds lines on INVENTORY section ids, not
 * raw visual ids: when two rendered sections share a visual id `sec`, the later
 * one (in page order) is renamed `sec-2`, `sec-3`, … skipping any suffix already
 * taken. This mirrors orchestrator `grounding._section_visuals` +
 * `_unique_ids` exactly — same filter, same page order (the still's file-name
 * number, else `1000 + list index`; the `visuals[]` list itself is NOT in page
 * order), same suffix rule — so each inventory id maps to its own still. Without
 * it a `sec-2` line resolves to nothing, and `sec` resolves to whichever
 * duplicate came first in list order rather than page order.
 */
function buildSectionIndex(stages: { output?: unknown }[]): Map<string, Asset> {
	const index = new Map<string, Asset>();
	for (const s of stages) {
		const o = (s.output ?? {}) as Rec;
		const found: { id: string; order: number; asset: Asset }[] = [];
		arr(o.visuals).forEach((v, i) => {
			const id = str(v.id);
			const image = str(v.image_url);
			if (!id || !image || !(str(v.role) ?? '').startsWith(SECTION_ROLE_PREFIX)) return;
			const m = STILL_ORDER.exec(image);
			found.push({
				id,
				order: m ? Number(m[1]) : 1000 + i,
				asset: { imageUrl: image, motionUrl: str(v.motion_video_url) ?? str(v.video_url) }
			});
		});
		found.sort((a, b) => a.order - b.order); // stable, like Python's sorted()
		const taken = new Set(found.map((f) => f.id));
		const seen = new Set<string>();
		for (const f of found) {
			let uid = f.id;
			if (seen.has(uid)) {
				let n = 2;
				while (taken.has(`${f.id}-${n}`)) n++;
				uid = `${f.id}-${n}`;
				taken.add(uid);
			}
			seen.add(uid);
			if (!index.has(uid)) index.set(uid, f.asset);
		}
	}
	return index;
}

export function buildStoryline(run: RunDetail | null | undefined): StorylineLine[] {
	const stages = (run?.stage_outputs ?? []).filter((s) => s.status === 'completed' && s.output);
	const assets = buildAssetIndex(stages);
	const sections = buildSectionIndex(stages);
	const byId = new Map<string, StorylineLine>();
	const order: string[] = [];
	const get = (key: string): StorylineLine => {
		let e = byId.get(key);
		if (!e) {
			e = { lineId: key, index: order.length };
			byId.set(key, e);
			order.push(key);
		}
		return e;
	};
	const outputs = stages.map((s) => s.output as Rec);
	const screens = new Map(outputs.flatMap((o) => arr(o.screens)).map((s) => [str(s.id), s]));

	// 1) Seed canonical order from the script (its `id` IS the line key).
	for (const o of outputs) {
		const scriptLines = arr(o.lines).some((l) => str(l.text))
			? arr(o.lines)
			: arr(o.paragraphs).some((l) => str(l.text))
				? arr(o.paragraphs)
				: [];
		for (const l of scriptLines) {
			const key = str(l.id) ?? str(l.line_id) ?? str(l.paragraph_id);
			if (!key) continue;
			const e = get(key);
			e.text = str(l.text) ?? e.text;
			e.seconds = num(l.seconds) ?? e.seconds;
			e.speaker = str(l.speaker) ?? e.speaker;
		}
	}

	// 2) Storyboard shots — description and visual type only.
	for (const o of outputs) {
		for (const shot of arr(o.shots)) {
			for (const key of lineKeys(shot)) {
				const e = get(key);
				e.shot = str(shot.description) ?? e.shot;
				e.visualType = str(shot.visual_type) ?? e.visualType;
			}
		}
	}

	// 3) Directly-attached visuals: slides, AI images, app-review visuals, motion clips.
	for (const o of outputs) {
		for (const sl of arr(o.slides)) {
			for (const key of lineKeys(sl)) {
				const e = get(key);
				e.imageUrl = e.imageUrl ?? str(sl.image_url);
				if (e.imageUrl && e.visualType === 'footage') e.previewSource = 'Slide fallback';
				e.motionUrl = e.motionUrl ?? str(sl.motion_video_url);
			}
		}
		for (const im of arr(o.images)) {
			for (const key of lineKeys(im)) {
				const e = get(key);
				e.imageUrl = e.imageUrl ?? str(im.image_url) ?? str(im.artifact_url);
			}
		}
		// `visuals[]` is line-keyed in app_review_record and id-keyed in
		// website_redesign; the latter has no line key and falls through to the
		// assignment hop below.
		for (const v of arr(o.visuals)) {
			for (const key of lineKeys(v)) {
				const e = get(key);
				e.imageUrl = e.imageUrl ?? str(v.image_url) ?? str(v.artifact_url);
				e.motionUrl = e.motionUrl ?? str(v.motion_video_url) ?? str(v.video_url);
			}
		}
		for (const m of arr(o.motion_clips)) {
			for (const key of lineKeys(m)) {
				const e = get(key);
				e.motionUrl = e.motionUrl ?? str(m.artifact_url) ?? str(m.video_url);
			}
		}
	}

	// 4) Slide → recording hop: the deck names the lines, a later stage renders it.
	for (const o of outputs) {
		for (const sl of arr(o.slides)) {
			const asset = assets.get(str(sl.id) ?? '');
			if (!asset) continue;
			for (const key of lineKeys(sl)) {
				const e = get(key);
				e.imageUrl = e.imageUrl ?? asset.imageUrl;
				e.motionUrl = e.motionUrl ?? asset.motionUrl;
			}
		}
	}

	// 5) Assignment hop: the visual director binds a line to a screen or redesign
	//    section that another stage published. A dangling reference is simply a
	//    line without a visual.
	for (const o of outputs) {
		for (const a of arr(o.assignments)) {
			const keys = lineKeys(a);
			if (!keys.length) continue;
			const ref = str(a.screen_id) ?? str(a.section_id);
			// Inventory section ids first (they disambiguate duplicates by page order),
			// then any other published visual by its own id.
			const asset = ref ? (sections.get(ref) ?? assets.get(ref)) : undefined;
			for (const key of keys) {
				const e = get(key);
				e.screenId = ref ?? e.screenId;
				if (!asset) continue;
				const screen = screens.get(ref);
				if (screen && (e.visualType === 'footage' || !e.visualType)) {
					e.imageUrl = asset.imageUrl;
					e.motionUrl = asset.motionUrl;
					e.previewSource = 'Captured screen';
					continue;
				}
				e.imageUrl = e.imageUrl ?? asset.imageUrl;
				e.motionUrl = e.motionUrl ?? asset.motionUrl;
			}
		}
	}

	// Authored URL shots contract screen.id == line.id. Resolve them even before
	// the visual director runs; never infer an unrelated capture by position.
	const shotlist = arr((run?.config_snapshot?.brief as Rec | undefined)?.shotlist).filter(
		(shot) => {
			const kind = (str(shot.kind) ?? (str(shot.url) ? 'url' : 'slide')).trim().toLowerCase();
			return str(shot.narration)?.trim() && ['url', 'slide'].includes(kind);
		}
	);
	for (const [i, shot] of shotlist.entries()) {
		if ((str(shot.kind) ?? (str(shot.url) ? 'url' : 'slide')).trim().toLowerCase() !== 'url')
			continue;
		const key = `shot-${String(i).padStart(3, '0')}`;
		const line = byId.get(key);
		if (!line) continue;
		const screen = screens.get(key);
		if (screen && (str(screen.image_url) || str(screen.clip_url))) {
			line.imageUrl = str(screen.image_url);
			line.motionUrl = str(screen.clip_url);
			line.screenId = key;
			line.previewSource = 'Captured screen';
		} else if (line.imageUrl) {
			line.previewSource = 'Slide fallback';
		}
	}

	// 6) Clips, last. Audio is last-write-wins — a later retake supersedes the
	//    original, and an absent url is a no-op. Clip video fills `motionUrl` only
	//    if nothing above claimed it: a `demo_video_record` screen capture is the
	//    line's only visual, but a `motion_graphics_gen` template must never
	//    displace the slide it was generated to decorate. Running this pass after
	//    the visual passes is what makes that precedence independent of the order
	//    stages happen to appear in `stage_outputs`.
	//
	//    A video-only clip may not CREATE a line. Some producers number their
	//    clips independently of the script — showcase's `demo_video_record` emits
	//    `clip-1…clip-13` against `b1-need`-style script ids, and promo's
	//    `motion_graphics_gen` emits `l-001` against script UUIDs. Those refs match
	//    no line, and admitting them would append bare video tiles with no text,
	//    no audio and no shot to runs that render correctly today.
	for (const o of outputs) {
		for (const c of [...arr(o.clips), ...arr(o.narrations)]) {
			const { audio, video } = clipUrls(c);
			for (const key of lineKeys(c)) {
				if (!audio && !byId.has(key)) continue;
				const e = get(key);
				e.audioUrl = audio ?? e.audioUrl;
				e.motionUrl = e.motionUrl ?? video;
				e.seconds = e.seconds ?? num(c.seconds);
			}
		}
	}

	// Only worth showing once a line carries more than just its own id.
	const lines = order.map((k) => byId.get(k)!);
	const meaningful = lines.filter(
		(l) => l.text || l.audioUrl || l.imageUrl || l.motionUrl || l.shot
	);
	return meaningful;
}

/** Aggregate counts for the storyline summary bar. */
export function storylineSummary(lines: StorylineLine[]) {
	return {
		count: lines.length,
		totalSeconds: lines.reduce((acc, l) => acc + (l.seconds ?? 0), 0),
		withText: lines.filter((l) => l.text).length,
		withAudio: lines.filter((l) => l.audioUrl).length,
		withVisual: lines.filter((l) => l.imageUrl || l.motionUrl).length
	};
}

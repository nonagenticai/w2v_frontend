// Shape registry: maps a stage output payload to a dedicated visual renderer,
// resolved by SHAPE not by stage name (extends the doctrine in
// $lib/utils/stage-output.ts to intermediate outputs). StageOutputView calls
// resolveRenderer(); a match renders the rich component, a miss falls through to
// the generic media/list/scalar view. Raw JSON is always available beneath,
// behind an "Advanced" affordance — never the default.
//
// RENDERERS is an explicitly-ordered list (more specific matchers first, e.g.
// audiobook plan before generic narration, slides before a generic image list).
// Entries — and their component imports — are added phase by phase below.
import type { Component } from 'svelte';
import { isAuditScorecardOutput } from '$lib/utils/stage-output';
import type {
	ScriptOutput,
	NarrationOutput,
	GalleryOutput,
	CritiqueOutput,
	RedesignOutput,
	StoryboardOutput,
	CutPlanOutput,
	SegmentSelectOutput,
	MusicSelectOutput,
	GraphicsDesignOutput,
	ShotAnalysisOutput,
	FootageProbeOutput,
	MediaDiscoveryOutput,
	GrowthOutput,
	VisualDirectorOutput,
	SourceOutput,
	CourseOutlineOutput,
	AudiobookPlanOutput,
	TextInsightOutput,
	RenderManifestOutput
} from './stage-outputs';
import ScriptDialogue from './ScriptDialogue.svelte';
import ScriptPacingTimeline from './ScriptPacingTimeline.svelte';
import RenderManifestCard from './RenderManifestCard.svelte';
import NarrationTrack from './NarrationTrack.svelte';
import SlideGallery from './SlideGallery.svelte';
import CritiqueScorecard from './CritiqueScorecard.svelte';
import AuditScorecard from './AuditScorecard.svelte';
import RedesignCompare from './RedesignCompare.svelte';
import StoryboardStrip from './StoryboardStrip.svelte';
import CutPlanTimeline from './CutPlanTimeline.svelte';
import SegmentSelectStrip from './SegmentSelectStrip.svelte';
import MusicSelectCard from './MusicSelectCard.svelte';
import GraphicsOverlayCards from './GraphicsOverlayCards.svelte';
import ShotAnalysisSummary from './ShotAnalysisSummary.svelte';
import FootageProbeGrid from './FootageProbeGrid.svelte';
import MediaDiscoveryGrid from './MediaDiscoveryGrid.svelte';
import GrowthSnippetCards from './GrowthSnippetCards.svelte';
import VisualDirectorMap from './VisualDirectorMap.svelte';
import SourceGallery from './SourceGallery.svelte';
import CourseOutlineTree from './CourseOutlineTree.svelte';
import AudiobookPlan from './AudiobookPlan.svelte';
import TextInsightPanel from './TextInsightPanel.svelte';

export interface RendererProps {
	output: Record<string, unknown>;
	runId?: string;
	dense?: boolean;
}

export interface OutputRenderer {
	id: string;
	label: string;
	match: (o: Record<string, unknown>) => boolean;
	component: Component<RendererProps>;
}

// ---- shared shape helpers (mirror stage-output.ts style) ----
export const isArr = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;
export const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** First element of an array field, as a record (for shape-sniffing list items). */
export const first = (v: unknown): Record<string, unknown> =>
	isArr(v) && v[0] && typeof v[0] === 'object' ? (v[0] as Record<string, unknown>) : {};

// Each matcher below narrows the untyped payload to its stage-outputs.ts
// interface ONCE, then reads TYPED field names — so renaming a field in the
// interface (e.g. ScriptLine.text) is a compile error in both the matcher here
// AND the component that reads it, keeping the two in lockstep. The `?.[0]?.field`
// access is behaviourally identical to the old `first(o.field).field` (undefined
// when the array is missing/empty), and isStr/isArr keep the same accept/reject
// semantics — nothing that resolved before stops resolving.

// Ordered renderer table. Append entries (with their imports) as phases land.
export const RENDERERS: OutputRenderer[] = [
	// Phase 1 — storyboard hero shapes.
	// Annotated pacing timeline MUST precede `script`: retention_plan / cold_open /
	// script_doctor re-emit the same lines[] as a plain script but decorate lines
	// with decision annotations. Fire ONLY when some line carries one, so plain
	// promo/lesson scripts (no annotations) fall through to ScriptDialogue below.
	{
		id: 'script-pacing',
		label: 'Pacing & decisions',
		match: (o) => {
			const d = o as unknown as ScriptOutput;
			return (
				Array.isArray(d.lines) &&
				d.lines.some(
					(l) =>
						l.beat_role || l.hook_role || l.doctor_note || l.clip_anchor || l.pin_position != null
				)
			);
		},
		component: ScriptPacingTimeline as Component<RendererProps>
	},
	{
		id: 'script',
		label: 'Script',
		match: (o) => {
			const d = o as unknown as ScriptOutput;
			return isStr(d.lines?.[0]?.text) || isStr(d.paragraphs?.[0]?.text);
		},
		component: ScriptDialogue as Component<RendererProps>
	},
	{
		id: 'narration',
		label: 'Narration',
		match: (o) => isStr((o as unknown as NarrationOutput).clips?.[0]?.artifact_url),
		component: NarrationTrack as Component<RendererProps>
	},
	{
		id: 'gallery',
		label: 'Visuals',
		match: (o) => {
			const d = o as unknown as GalleryOutput;
			return (
				isStr(d.slides?.[0]?.image_url) ||
				isStr(d.images?.[0]?.artifact_url) ||
				isStr(d.images?.[0]?.image_url) ||
				isStr(d.motion_clips?.[0]?.artifact_url)
			);
		},
		component: SlideGallery as Component<RendererProps>
	},
	// Phase 2 — critique / web-design family.
	{
		// Audit scorecard: one renderer for every analysis_service scorecard scan —
		// SEO audit (groups[]), CRO audit (subsections[]), marketing scorecard
		// (dimensions[]). Each is a weighted 0-100 breakdown + A-F grade. Since
		// orchestrator #1118 the scans also carry findings[]; this entry sits BEFORE the
		// critique matcher below, and isCritiqueOutput excludes audits, so an audit scan
		// never renders as a critique.
		// The match predicate is shared verbatim with `isAuditStage` (stage-output.ts)
		// — RunOutputPanel finds the stage there and renders it here, so the two must
		// agree or the hero + PDF silently vanish. AuditScorecard is robust to a
		// missing per-item label, so `grade` + a breakdown array is sufficient.
		id: 'audit-scorecard',
		label: 'Audit scorecard',
		match: isAuditScorecardOutput,
		component: AuditScorecard as Component<RendererProps>
	},
	{
		id: 'critique',
		label: 'Critique',
		match: (o) => isArr((o as unknown as CritiqueOutput).findings),
		component: CritiqueScorecard as Component<RendererProps>
	},
	{
		id: 'redesign',
		label: 'Redesign',
		// visuals[] (redesign/web_design) OR a live preview / verification report
		// (web_design_v2 assembly, which may ship without before/after stills).
		match: (o) => {
			const d = o as unknown as RedesignOutput;
			return (
				isArr(d.visuals) || isStr(d.live_html_url) || (!!d.verification_report && !isStr(d.url))
			);
		},
		component: RedesignCompare as Component<RendererProps>
	},
	// Phase 3 — supporting strips.
	{
		// action_reel cut_plan. MUST precede `storyboard`: both key on `shots[]`, and
		// a cut plan is the more specific shape — so it is claimed here rather than
		// left to the looser matcher below. The two stay disjoint by construction:
		// this requires a shot to carry the SOURCE-TRIM keys (source_id/in_seconds),
		// which StoryboardShot has no notion of (it carries description/visual_type/
		// seconds), AND a cut-plan-only top-level scalar (bpm / beat grid / solver
		// flags / shortfall). A storyboard payload satisfies neither half, so this
		// entry cannot shadow it; `total_seconds` alone is deliberately NOT a
		// discriminator because ScriptOutput also carries it.
		id: 'cut-plan',
		label: 'Cut plan',
		match: (o) => {
			const d = o as unknown as CutPlanOutput;
			const s = d.shots?.[0];
			if (!s || typeof s !== 'object') return false;
			const shotShaped = isStr(s.source_id) || isNum(s.in_seconds) || isNum(s.out_seconds);
			const planShaped =
				isNum(d.bpm) ||
				isNum(d.shortfall_seconds) ||
				isNum(d.frame_rate) ||
				typeof d.beat_grid_available === 'boolean' ||
				typeof d.solver_stubbed === 'boolean' ||
				typeof s.beat_locked === 'boolean' ||
				isNum(s.beat_index) ||
				isNum(s.start_seconds);
			return shotShaped && planShaped;
		},
		component: CutPlanTimeline as Component<RendererProps>
	},
	// The other three action_reel review gates, placed IMMEDIATELY AFTER `cut-plan`
	// on purpose. All four action_reel gate shapes are pairwise disjoint (see each
	// matcher's note), so ordering among them is not load-bearing for correctness —
	// but `cut-plan` is the strictest matcher of the four and the one whose payload
	// carries the most fields that LOOK like the others (`bpm`, `music_url`,
	// `music_track_id`, per-shot `source_id`/`in_seconds`). Putting it first means
	// a future loosening of any matcher below still cannot steal a cut plan, which
	// is exactly the failure mode the shot-analysis note above documents.
	{
		// action_reel segment_select. Keys on `segments[]` — which is NOT unique to
		// this stage: `promo`'s html_segments emits `segments: list[PromoHtmlSegment]`
		// = {id, image_url, label} in a different blueprint, and a bare `segments[]`
		// test would claim it and render "0.00→0.00s" trims and an empty coverage
		// bar as an affirmative reading of a payload that has no time dimension at
		// all. So BOTH halves are required: a string `source_id` (PromoHtmlSegment
		// has no such field) AND a numeric in/out trim (PromoHtmlSegment has no
		// numeric field whatsoever). `id` and `seconds` alone are deliberately NOT
		// sufficient — `seconds` appears on StoryboardShot, CutPlanShot and
		// AudiobookChunk items too.
		// PromoHtmlSegment fields (do NOT key on any of these): id, image_url, label.
		id: 'segment-select',
		label: 'Selected footage',
		match: (o) => {
			const d = o as unknown as SegmentSelectOutput;
			const s = d.segments?.[0];
			if (!s || typeof s !== 'object') return false;
			return isStr(s.source_id) && (isNum(s.in_seconds) || isNum(s.out_seconds));
		},
		component: SegmentSelectStrip as Component<RendererProps>
	},
	{
		// action_reel music_select. Keys on `track_id`, a field no other stage in the
		// estate emits (verified against the orchestrator: the ONLY other music
		// carrier is `cut_plan`, which names the same facts `music_track_id` /
		// `music_url` — DIFFERENT keys, so it cannot be claimed here, and the
		// cut-plan entry above would win anyway). The second half requires at least
		// one grid/track field so a bare `{track_id}` echo from some future stage
		// does not land on a card that is entirely "not measured".
		id: 'music-select',
		label: 'Music bed',
		match: (o) => {
			const d = o as unknown as MusicSelectOutput;
			if (!isStr(d.track_id)) return false;
			return (
				Array.isArray(d.beats) ||
				isNum(d.bpm) ||
				isStr(d.grid_source) ||
				isStr(d.track_url) ||
				isStr(d.track_key)
			);
		},
		component: MusicSelectCard as Component<RendererProps>
	},
	{
		// action_reel graphics_design. `typeof cards_render_failed === 'boolean'` is
		// SUFFICIENT ON ITS OWN and must stay that way: the render-outage payload is
		// exactly `cards: []` + `cards_render_failed: true`, so a cards-only
		// predicate would miss the single case a reviewer most needs to see and drop
		// it to the generic JSON view. The flag name is unique in the estate (grep
		// of the orchestrator finds no other `cards` output field at all), so it
		// needs no second discriminator. The `cards[]` half is the fallback for a
		// successful render whose flag a future serializer omits.
		id: 'graphics-design',
		label: 'Graphics',
		match: (o) => {
			const d = o as unknown as GraphicsDesignOutput;
			if (typeof d.cards_render_failed === 'boolean') return true;
			const c = d.cards?.[0];
			if (!c || typeof c !== 'object') return false;
			return isStr(c.url) || isStr(c.kind) || isStr(c.shot_id);
		},
		component: GraphicsOverlayCards as Component<RendererProps>
	},
	{
		id: 'storyboard',
		label: 'Storyboard',
		match: (o) => {
			const d = o as unknown as StoryboardOutput;
			return isStr(d.shots?.[0]?.description) || isStr(d.shots?.[0]?.visual_type);
		},
		component: StoryboardStrip as Component<RendererProps>
	},
	{
		// More specific than a generic items[] list: discovered media carries
		// media_type/thumbnail_url (rubric-review items carry criterion/score).
		id: 'media-discovery',
		label: 'Media',
		match: (o) => {
			const d = o as unknown as MediaDiscoveryOutput;
			return isStr(d.items?.[0]?.media_type) || isStr(d.items?.[0]?.thumbnail_url);
		},
		component: MediaDiscoveryGrid as Component<RendererProps>
	},
	{
		id: 'growth',
		label: 'Growth copy',
		match: (o) => {
			const d = o as unknown as GrowthOutput;
			return isStr(d.snippets?.[0]?.channel) || isStr(d.snippets?.[0]?.text);
		},
		component: GrowthSnippetCards as Component<RendererProps>
	},
	{
		id: 'visual-director',
		label: 'Visual direction',
		match: (o) => isStr((o as unknown as VisualDirectorOutput).assignments?.[0]?.screen_id),
		component: VisualDirectorMap as Component<RendererProps>
	},
	// Phase 4 — long tail. (Source images carry url/caption/source_ref, not the
	// artifact_url/image_url the gallery matcher claims, so no overlap.)
	{
		// action_reel shot_analysis. Keys on `sources[]` — a field no OTHER renderer
		// reads (SourceOutput uses images[]/grounding_text; MediaDiscoveryOutput's
		// `sources_queried` is a string list under a different name). But `sources[]`
		// is NOT unique to this stage: the SIBLING action_reel stage `footage_probe`
		// emits `sources: list[ProbedSource]` in the SAME run, and ProbedSource
		// (footage_probe.py) always carries `duration_s: float = 0.0` — so keying on
		// duration_s let this renderer claim a footage_probe pause and report
		// "0 cuts / No motion curve recorded", an affirmative FALSE measurement,
		// while dropping filename/codec/resolution. The discriminators below are the
		// fields present on AnalyzedSource (shot_analysis.py) and ABSENT from
		// ProbedSource; each is a pydantic-defaulted field, so shot_analysis always
		// emits all of them and footage_probe emits none. duration_s / id / a bare
		// `sources: ['unsplash']` list are deliberately NOT sufficient.
		// ProbedSource fields (do NOT add any of these): id, filename, bytes,
		// content_type, preview_status, duration_s, fps, codec, width, height,
		// original_url, preview_url.
		id: 'shot-analysis',
		label: 'Shot analysis',
		match: (o) => {
			const d = o as unknown as ShotAnalysisOutput;
			const s = d.sources?.[0];
			if (!s || typeof s !== 'object') return false;
			return (
				Array.isArray(s.motion_timeline) ||
				Array.isArray(s.scene_boundaries) ||
				isNum(s.motion_score) ||
				isNum(s.mean_sharpness) ||
				isNum(s.mean_brightness) ||
				isNum(s.overall_score)
			);
		},
		component: ShotAnalysisSummary as Component<RendererProps>
	},
	{
		// action_reel footage_probe — the sibling stage the shot-analysis note above
		// exists to stay clear of, and the FIRST gate a reviewer sees. Placed
		// IMMEDIATELY AFTER shot-analysis on purpose: the two share `sources[]`, so
		// the stricter measurement matcher gets first refusal and this one can never
		// steal a shot_analysis pause even if it were later loosened.
		//
		// The discriminator is `filename` — a field ProbedSource declares REQUIRED
		// (no default, so every emitted source carries it) and that AnalyzedSource
		// does not have at all. It is therefore disjoint from shot-analysis by
		// construction, in both directions: shot-analysis keys only on measurement
		// fields (motion_timeline / scene_boundaries / *_score / mean_*), none of
		// which ProbedSource emits. The second half requires one more
		// upload-descriptor field so a bare `sources: [{filename}]` echo from some
		// future stage does not land on a card that is entirely "not probed".
		// AnalyzedSource fields (do NOT key on any of these): id, duration_s,
		// scene_boundaries, motion_timeline, mean_sharpness, mean_brightness,
		// motion_score, overall_score, error. `id` and `duration_s` are shared by
		// BOTH shapes and are deliberately NOT discriminators here.
		id: 'footage-probe',
		label: 'Uploaded footage',
		match: (o) => {
			const d = o as unknown as FootageProbeOutput;
			const s = d.sources?.[0];
			if (!s || typeof s !== 'object') return false;
			if (!isStr(s.filename)) return false;
			return (
				isStr(s.preview_status) ||
				isStr(s.content_type) ||
				isStr(s.preview_url) ||
				isStr(s.original_url) ||
				isNum(s.bytes)
			);
		},
		component: FootageProbeGrid as Component<RendererProps>
	},
	{
		id: 'source',
		label: 'Sources',
		match: (o) => {
			const d = o as unknown as SourceOutput;
			return isStr(d.grounding_text) || isStr(d.images?.[0]?.source_ref);
		},
		component: SourceGallery as Component<RendererProps>
	},
	{
		id: 'course-outline',
		label: 'Outline',
		match: (o) => isStr((o as unknown as CourseOutlineOutput).sections?.[0]?.title),
		component: CourseOutlineTree as Component<RendererProps>
	},
	{
		id: 'audiobook-plan',
		label: 'Audiobook plan',
		match: (o) => {
			const d = o as unknown as AudiobookPlanOutput;
			return isArr(d.chapters) || isArr(d.chunks) || isArr(d.casting);
		},
		component: AudiobookPlan as Component<RendererProps>
	},
	{
		id: 'text-insight',
		label: 'Insights',
		match: (o) => {
			const d = o as unknown as TextInsightOutput;
			return isArr(d.prompts) || isArr(d.pain_points) || isArr(d.hooks);
		},
		component: TextInsightPanel as Component<RendererProps>
	},
	// Phase 5 — provenance. render_manifest ships a nested override-ledger; a
	// distinct shape (manifest.override_ledger[]) that overlaps no earlier matcher,
	// so it appends at the end.
	{
		id: 'render-manifest',
		label: 'Render manifest',
		match: (o) => Array.isArray((o as unknown as RenderManifestOutput).manifest?.override_ledger),
		component: RenderManifestCard as Component<RendererProps>
	}
];

/** First renderer whose matcher accepts the payload, or null to use the generic fallback. */
export function resolveRenderer(
	output: Record<string, unknown> | null | undefined
): OutputRenderer | null {
	if (!output || typeof output !== 'object') return null;
	for (const r of RENDERERS) {
		try {
			if (r.match(output)) return r;
		} catch {
			// A malformed payload must never break the page — skip and try the next.
		}
	}
	return null;
}

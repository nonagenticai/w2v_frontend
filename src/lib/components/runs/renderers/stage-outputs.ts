// Hand-authored typed contract for the per-stage output payloads each renderer
// consumes. The orchestrator emits stage outputs as JSONB (`Record[str, Any]`),
// so `types.gen.ts` carries NO per-stage shape — a renderer reading `output.lines`
// has no compile-time anchor. These interfaces are that anchor: each lists the
// fields the matching component (registry.ts) + its matcher actually READ, with
// honest optionality (backend payloads vary run-to-run, so nearly everything is
// optional). They are a COMPILE-TIME shape only — the payload still arrives as
// `Record<string, unknown>` at the registry boundary; each renderer narrows once
// (`const data = output as unknown as XOutput`) and keeps its runtime
// defensiveness (optional chaining / fallbacks). Rename a field here and both the
// component and the matcher that reference it stop compiling.
//
// Ordering mirrors the RENDERERS table in registry.ts.

/** Optional-everything item bags: keep loose but named so field renames bite. */

// ---- script ----------------------------------------------------------------
export interface ScriptLine {
	id?: string;
	line_id?: string;
	speaker?: string; // 'a' | 'b' | narrator name; presence toggles two-speaker layout
	text?: string;
	seconds?: number;
	// Decision annotations re-emitted by the retention_plan / cold_open /
	// script_doctor stages onto the SAME lines[] shape. All optional — a plain
	// promo/lesson script carries none of them and stays on ScriptDialogue.
	beat_role?: string; // retention beat: hook | build | payoff | ...
	hook_role?: string; // hook-doctor role tag
	pin_position?: string | number; // cold-open pin (which line to open on)
	clip_anchor?: string; // cold-open clip anchor: 'start' | 'end' | peak time
	clip_lead_seconds?: number; // lead pulled in front of the anchor
	doctor_note?: string; // script-doctor rewrite rationale for this line
	min_seconds?: number; // time-budget floor for this line
	max_seconds?: number; // time-budget ceiling for this line
	vo_rate?: number; // voice-over words/sec target
}
export interface ScriptOutput {
	lines?: ScriptLine[];
	paragraphs?: ScriptLine[]; // lesson scripts carry paragraphs[] instead of lines[]
	learning_objective?: string;
	total_seconds?: number;
}

// ---- narration -------------------------------------------------------------
export interface NarrationClip {
	id?: string;
	line_id?: string;
	chunk_id?: string; // audiobook chunks key by chunk_id, not line_id
	artifact_url?: string;
	voice_id?: string;
	speaker?: string;
	speed?: number;
	seconds?: number;
}
export interface NarrationOutput {
	clips?: NarrationClip[];
}

// ---- gallery ---------------------------------------------------------------
export interface GallerySlide {
	id?: string;
	line_id?: string;
	image_url?: string;
	motion_video_url?: string;
}
export interface GalleryImage {
	id?: string;
	line_id?: string;
	image_url?: string;
	artifact_url?: string;
}
export interface GalleryMotionClip {
	line_id?: string;
	artifact_url?: string;
}
export interface GalleryOutput {
	slides?: GallerySlide[];
	images?: GalleryImage[];
	motion_clips?: GalleryMotionClip[];
}

// ---- audit-scorecard -------------------------------------------------------
// One shape for SEO (groups[]) / CRO (subsections[]) / marketing (dimensions[]).
// The breakdown item's label key differs per kind (group|section|dimension), so
// all three are optional on one item type. Matcher = isAuditScorecardOutput
// (stage-output.ts) — do NOT re-derive its behavior here; this only types the
// fields the component reads.
export interface AuditBucket {
	group?: string;
	section?: string;
	dimension?: string;
	/** `null` = not measured (see `note`) — never a 0 or a 100. */
	score?: number | null;
	weight?: number;
	count?: number;
	measured?: boolean;
	note?: string | null;
}
// "great report" enrichment (analysis_service PR1-4); every field is optional and
// absent unless the run opted into include_llm, so the scorecard renders exactly as
// before when they are missing. Shapes mirror analysis_service scorecards/schemas.py.
export interface AuditRecommendation {
	fix_prose?: string;
	rationale?: string;
	example?: string;
	effort?: string;
}
export interface AuditProjection {
	baseline?: number;
	projected?: number;
	delta?: number;
	removed?: string[];
}
export interface AuditGrounding {
	check_id?: string;
	supported?: boolean;
	evidence_ref?: string;
}
export interface AuditExecSummary {
	summary?: string;
	so_what?: string;
	roadmap?: string[];
}
export interface AuditCritique {
	score?: number;
	generic_check_ids?: string[];
	ungrounded_check_ids?: string[];
	rerun_stages?: string[];
}
export interface AuditRef {
	check_id?: string;
	group?: string;
	section?: string;
	dimension?: string;
	title?: string;
	severity?: string;
	priority?: number;
	rank?: number;
	evidence?: string;
	recommendation?: AuditRecommendation;
}
export interface AuditAssessment {
	element?: string;
	score?: number;
	assessment?: string;
	suggestion?: string;
}
export interface AuditFinding {
	check_id?: string;
	title?: string;
	section?: string;
	experiment?: { hypothesis?: string; primary_metric?: string; variant?: string } | null;
}
export interface AuditScorecardOutput {
	/** New outputs: which audit this is. Absent on runs older than the field. */
	project_type?: string;
	/** AI-analysis status (mirrors orchestrator AiStatusOut). Absent on older runs. */
	ai?: import('$lib/utils/audit-kind').AuditAiStatus | null;
	/** Deterministic page facts, per type (SEO: title/meta/indexable, CRO: journey, …). */
	facts?: Record<string, unknown>;
	findings?: AuditFinding[];
	grade?: string;
	overall_score?: number | null;
	url?: string;
	llm_enriched?: boolean;
	groups?: AuditBucket[];
	subsections?: AuditBucket[];
	dimensions?: AuditBucket[];
	quick_wins?: AuditRef[];
	strategic?: AuditRef[];
	llm_judgments?: AuditAssessment[]; // CRO
	llm_assessments?: AuditAssessment[]; // marketing
	// "great report" enrichment — top-level, presence-gated (include_llm).
	exec_summary?: AuditExecSummary;
	projection?: AuditProjection;
	grounding?: AuditGrounding[];
	critique?: AuditCritique;
}

// ---- critique --------------------------------------------------------------
export interface CritiqueFinding {
	id?: string;
	severity?: string;
	title?: string;
	category?: string;
	description?: string;
	recommendation?: string;
}
export interface CritiqueOutput {
	findings?: CritiqueFinding[];
	overall_score?: number;
	summary?: string;
	url?: string;
	category_scores?: Record<string, unknown>; // name -> numeric-ish score
}

// ---- redesign --------------------------------------------------------------
export interface RedesignVisual {
	label?: string;
	role?: string; // 'before' | 'after' | other
	image_url?: string;
	video_url?: string;
}
export interface RedesignVerificationFinding {
	severity?: string; // 'hard' | 'advisory'
	check?: string;
	message?: string;
}
export interface RedesignVerificationReport {
	status?: string; // 'passed' | 'failed' | 'skipped'
	findings?: RedesignVerificationFinding[];
}
export interface RedesignOutput {
	style?: string;
	accessibility_score?: number;
	url?: string;
	redesign_job_id?: string;
	visuals?: RedesignVisual[];
	live_html_url?: string;
	pdf_url?: string;
	verification_status?: string;
	verification_report?: RedesignVerificationReport;
}

// ---- storyboard ------------------------------------------------------------
export interface StoryboardShot {
	id?: string;
	line_id?: string;
	description?: string;
	visual_type?: string; // footage | slide | html | ai_image
	visual_style?: string;
	seconds?: number;
}
export interface StoryboardOutput {
	shots?: StoryboardShot[];
}

// ---- cut-plan (action_reel) ------------------------------------------------
// The action_reel `cut_plan` stage pauses at a human review gate, so this shape
// is what a reviewer approves. Mirrors CutPlanOutput / PlannedShot in
// w2v_orchestrator services/stages/action_reel/cut_plan.py — the persisted
// payload is the model field names verbatim (dag_executor does model_dump()).
// Backend defaults everything except `shots`, but a stage output may still land
// half-written, so every field stays optional here.
export interface CutPlanShot {
	/** The segment_select segment id — NOT a fresh uuid. */
	id?: string;
	source_id?: string;
	video_url?: string;
	/** SOURCE trim, absolute seconds into the source clip. */
	in_seconds?: number;
	out_seconds?: number;
	/** Length this shot occupies on the REEL timeline (the beat window). */
	seconds?: number;
	/** (out_seconds - in_seconds) / seconds — 1.0 means no time-warp. */
	speed?: number;
	/** Index into music_select.beats; -1 when there was no grid to fit to. */
	beat_index?: number;
	/** Where the shot starts on the reel/video timeline. */
	start_seconds?: number;
	/** False when the speed had to be clamped, or there was no beat grid at all. */
	beat_locked?: boolean;
	rationale?: string;
}
export interface CutPlanOutput {
	shots?: CutPlanShot[];
	total_seconds?: number;
	music_track_id?: string;
	music_url?: string;
	bpm?: number;
	/** False when music_select could not fetch a grid — the plan is even-spaced. */
	beat_grid_available?: boolean;
	/** True means the beat-fit solver did NOT run; shots are the degradation. */
	solver_stubbed?: boolean;
	frame_rate?: number;
	/** What the author asked for; 0 when they asked for nothing. */
	target_seconds?: number;
	/** target_seconds - total_seconds when the reel came out SHORTER. */
	shortfall_seconds?: number;
	notes?: string[];
}

// ---- segment-select (action_reel) ------------------------------------------
// Mirrors SegmentSelectOutput / SelectedSegment in
// w2v_orchestrator services/stages/action_reel/segment_select.py. This stage
// pauses at a review gate, so this shape is what a reviewer approves.
//
// ⚠️ `segments[]` is NOT unique to this stage. `promo`'s html_segments stage
// emits `segments: list[PromoHtmlSegment]` = {id, image_url, label} — no
// source_id and no numeric trim — so the matcher in registry.ts requires BOTH
// a string `source_id` AND a numeric in/out trim. Do NOT relax it to a bare
// `segments[]` test: that is the same mistake that let shot_analysis claim
// footage_probe's `sources[]` and print an affirmative false measurement.
export interface SelectedSegment {
	/** Addresses the segment for annotations/regeneration; cut_plan keys shots off it. */
	id?: string;
	/** The video_sources row id this window was cut from. */
	source_id?: string;
	/** SOURCE trim, absolute seconds into the source clip. */
	in_seconds?: number;
	out_seconds?: number;
	/** out_seconds - in_seconds, as the selector emitted it. */
	seconds?: number;
	/** 0..1 confidence the selector put on this window. */
	score?: number;
	rationale?: string;
}
export interface SegmentSelectOutput {
	segments?: SelectedSegment[];
	/** How many segments the near-duplicate guard actually REMOVED. */
	near_duplicates_dropped?: number;
	/**
	 * How many detected near-duplicates were KEPT ANYWAY because dropping them
	 * would have starved the cut planner. Read as a PAIR with the field above:
	 * (0, 0) is the only "no duplicates existed" reading; (0, n>0) means
	 * duplicates existed and every one is still in the reel. Never report
	 * `near_duplicates_dropped === 0` alone as "the draw was already varied".
	 */
	near_duplicates_kept_for_coverage?: number;
	notes?: string[];
}

// ---- music-select (action_reel) --------------------------------------------
// Mirrors MusicSelectOutput in
// w2v_orchestrator services/stages/action_reel/music_select.py. Review gate.
//
// ⚠️ `cut_plan` carries the SAME facts under DIFFERENT names — `music_track_id`
// / `music_url` / `bpm` (see CutPlanOutput above). The matcher therefore keys on
// `track_id`, which cut_plan never emits, so the two can never claim each other.
// Do not "unify" these field names here; they are genuinely different on the wire.
export interface MusicSelectOutput {
	track_id?: string;
	/** Library key of the chosen bed — the human-readable handle. */
	track_key?: string;
	track_url?: string;
	rationale?: string;
	duration_s?: number;
	/** 0.0 means NOT MEASURED, never "a track at zero beats per minute". */
	bpm?: number;
	/** 0..1 confidence in `bpm`. */
	bpm_confidence?: number;
	/** Absolute seconds from the head of the track. Legitimately EMPTY when the
	 *  analyzer could not beat-track the bed — the cut then goes even-spaced. */
	beats?: number[];
	downbeats?: number[];
	onsets?: number[];
	meter?: string;
	/** Which analyzer produced the grid; "" means there is no grid. */
	grid_source?: string;
	notes?: string[];
}

// ---- graphics-design (action_reel) -----------------------------------------
// Mirrors GraphicsDesignOutput / GraphicsCard in
// w2v_orchestrator services/stages/action_reel/graphics_design.py. Review gate.
//
// Cards are alpha-channel VP9/WebM overlay clips the compiler composites ON TOP
// of the footage — they are never full-frame shots, so they must be previewed
// against a backdrop, not on the page surface.
export interface GraphicsCard {
	id?: string;
	/** The cut_plan shot this card is pinned to; "" = a full-frame/unpinned card. */
	shot_id?: string;
	kind?: string; // 'title' today; callouts/end-card are the follow-up
	text?: string;
	/** Relative to the SHOT's start (and on the shot's SOURCE timeline), not the reel. */
	at_seconds?: number;
	seconds?: number;
	/** Stored alpha-WebM. The backend NEVER emits a card with an empty url. */
	url?: string;
	x?: string;
	y?: string;
	opacity?: number;
}
export interface GraphicsDesignOutput {
	cards?: GraphicsCard[];
	/**
	 * True ONLY when a card was designed and its render/store FAILED. `cards: []`
	 * with this false means the designer legitimately chose no cards. Both states
	 * produce an empty list plus a note, so this flag is the ONLY machine-readable
	 * way to tell an outage from an editorial decision — never infer either by
	 * testing `cards.length === 0`, and never make the matcher depend on cards[]:
	 * the outage payload is exactly `cards: []` + this flag, i.e. the case a
	 * reviewer most needs to see.
	 */
	cards_render_failed?: boolean;
	notes?: string[];
}

// ---- shot-analysis (action_reel) -------------------------------------------
// Mirrors ShotAnalysisOutput / AnalyzedSource / MotionPoint in
// w2v_orchestrator services/stages/action_reel/shot_analysis.py. `scene_cuts`
// are bare floats (`scene_boundaries`), and `motion_timeline` is a dense curve —
// hundreds of points per source, so the renderer downsamples rather than listing.
export interface MotionPoint {
	/** Seconds into the source. */
	t?: number;
	/** 0..1 motion energy at `t`. */
	motion?: number;
}
export interface AnalyzedSource {
	/** The video_sources row id (same key footage_probe emitted). */
	id?: string;
	duration_s?: number;
	/** Cut points detected IN the footage, absolute seconds. */
	scene_boundaries?: number[];
	motion_timeline?: MotionPoint[];
	mean_sharpness?: number;
	mean_brightness?: number;
	motion_score?: number;
	overall_score?: number;
	/** "" when the analyzer succeeded; the failure sentence otherwise. */
	error?: string;
}
export interface ShotAnalysisOutput {
	sources?: AnalyzedSource[];
	notes?: string[];
}

// ---- footage-probe (action_reel) -------------------------------------------
// Mirrors FootageProbeOutput / ProbedSource in
// w2v_orchestrator services/stages/action_reel/footage_probe.py. This is the
// FIRST review gate of an action_reel run: one flat descriptor per uploaded
// clip, read out of the `video_sources` row (ffprobe ran at upload time).
//
// ⚠️ `sources[]` is shared with the SIBLING stage `shot_analysis`, whose
// AnalyzedSource carries measurements (motion_timeline/scene_boundaries/scores)
// and NO `filename`. The two matchers in registry.ts stay disjoint on exactly
// that: shot-analysis keys only on measurement fields, footage-probe only on the
// upload-descriptor fields below.
//
// Every numeric field is pydantic-DEFAULTED to 0 on the orchestrator side, so a
// zero means "not probed", not "measured as zero" — the renderer must say so
// rather than print `0x0` / `0fps`.
export interface ProbedSource {
	/** The video_sources row id — THE join key every stage below uses. */
	id?: string;
	/** The operator's original file name. Display only, never a storage key. */
	filename?: string;
	bytes?: number;
	content_type?: string;
	/** 'pending' | 'ready' | 'failed' (DB CHECK constraint), verbatim. */
	preview_status?: string;
	duration_s?: number;
	fps?: number;
	codec?: string;
	width?: number;
	height?: number;
	/** Presigned GET for the original upload; "" when unpresignable. */
	original_url?: string;
	/** Presigned GET for the small seekable proxy; "" until the worker rendered it. */
	preview_url?: string;
}
export interface FootageProbeOutput {
	sources?: ProbedSource[];
	total_duration_s?: number;
	notes?: string[];
}

// ---- media-discovery -------------------------------------------------------
export interface MediaDiscoveryItem {
	id?: string;
	title?: string;
	url?: string;
	thumbnail_url?: string;
	composite_url?: string;
	media_type?: string;
	source?: string;
	quality_score?: number;
}
export interface MediaDiscoveryOutput {
	items?: MediaDiscoveryItem[];
	query?: string;
	// Wire shape is the list of provider names queried (e.g. ["unsplash",
	// "pexels"]), not a count — typing it `number` hid the "· N sources" chip.
	sources_queried?: string[];
}

// ---- growth ----------------------------------------------------------------
export interface GrowthSnippet {
	id?: string;
	channel?: string;
	text?: string;
	cta_url?: string;
}
export interface GrowthOutput {
	snippets?: GrowthSnippet[];
}

// ---- visual-director -------------------------------------------------------
export interface VisualDirectorAssignment {
	id?: string;
	line_id?: string;
	screen_id?: string;
}
export interface VisualDirectorOutput {
	assignments?: VisualDirectorAssignment[];
}

// ---- source ----------------------------------------------------------------
export interface SourceImage {
	id?: string;
	url?: string;
	alt_text?: string;
	caption?: string;
	source_ref?: string; // matcher key: source images carry source_ref
}
export interface SourceOutput {
	images?: SourceImage[];
	grounding_text?: string;
	references?: string[];
}

// ---- course-outline --------------------------------------------------------
export interface CourseSection {
	id?: string;
	title?: string;
	objective?: string;
	lesson_project_id?: string;
}
export interface CourseOutlineOutput {
	sections?: CourseSection[];
	intro_summary?: string;
}

// ---- audiobook-plan --------------------------------------------------------
export interface AudiobookChapter {
	id?: string;
	title?: string;
	page_range?: string;
	artifact_url?: string;
}
export interface AudiobookChunk {
	seconds?: number;
}
export interface AudiobookCasting {
	speaker?: string;
	voice_id?: string;
}
export interface AudiobookPlanOutput {
	chapters?: AudiobookChapter[];
	chunks?: AudiobookChunk[];
	casting?: AudiobookCasting[];
}

// ---- text-insight ----------------------------------------------------------
export interface TextInsightPrompt {
	line_id?: string;
	prompt_text?: string;
	text?: string;
}
export interface TextInsightOutput {
	pain_points?: string[];
	hooks?: string[];
	tonal_guidance?: string;
	prompts?: TextInsightPrompt[];
}

// ---- render-manifest (Phase 5 — provenance) --------------------------------
// The orchestrator's render_manifest stage emits an override-ledger + a
// reproducibility spine describing HOW a video was assembled: every resolved
// knob, the seed/input-hash fingerprint, and an audited-completeness fraction.
// Distinct shape (nested `manifest.override_ledger`) — no overlap with any
// existing renderer.
export interface ProvenanceLedgerEntry {
	key: string; // knob name, e.g. 'music.ducking_db'
	value?: unknown; // resolved value (may be a nested object)
	source?: string; // 'default' | 'smart-auto' | 'override' | 'llm-clamped'
	computed_by?: string; // optional: which stage/heuristic set it
}
export interface RenderManifest {
	master_seed?: number | null;
	input_hash?: string | null;
	override_ledger?: ProvenanceLedgerEntry[];
	completeness?: number; // 0..1 fraction of knobs deliberately resolved
	output_sha256?: string | null; // reserved — not on the wire yet
	mastering?: Record<string, unknown> | null; // reserved — not on the wire yet
	artifact_url?: string | null;
	duration_seconds?: number | null;
}
export interface RenderManifestOutput {
	manifest?: RenderManifest;
}

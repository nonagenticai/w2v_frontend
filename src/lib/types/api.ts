// API type definitions for web_to_video frontend
// Mirrors backend Python schemas (schemas.py, models.py)

import type { components } from '$lib/api/types.gen.js';

// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

export type SourceType = 'web' | 'ios' | 'android' | 'other';

export type PipelineStatus =
	| 'pending'
	| 'processing'
	| 'completed'
	| 'failed'
	| 'cancelled'
	| 'paused'
	| 'awaiting_review';

export type StageStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'skipped'
	// Stranded pending/running stages of a hard-failed run are terminalized to
	// 'cancelled' by the orchestrator (PR #706) — they never executed.
	| 'cancelled';

export type PipelineMode =
	| 'full'
	| 'dry_run'
	| 'critique_only'
	| 'redesign'
	| 'short_form'
	| 'app_demo'
	| 'document_analysis'
	// Pack modes
	| 'prospect_microsite'
	| 'competitive_displacement'
	| 'conversion_rescue'
	| 'app_growth'
	| 'trust_enterprise'
	| 'tutorial_kit'
	| 'launch_kit'
	// Frontend testing
	| 'frontend_test'
	// Legacy (maps to prospect_microsite)
	| 'growth'
	| 'growth_mode';

export type CritiqueRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type CritiqueCategory = 'seo' | 'a11y' | 'security' | 'performance' | 'ux';

export type CritiqueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type PipelineWebSocketEvent =
	| 'pipeline_started'
	| 'stage_started'
	| 'stage_completed'
	| 'stage_failed'
	| 'pipeline_completed'
	| 'pipeline_failed'
	| 'pipeline_cancelled'
	// Studio events (BE phases 3 / 6 / 7)
	| 'stage_paused_for_review'
	| 'verbatim_item_placed'
	| 'verbatim_item_missing'
	| 'lesson_completed'
	| 'curriculum_design_completed'
	| 'deliverable_completed'
	| 'project_completed'
	// Studio v2 BE-2 — annotation lifecycle events on the job channel
	| 'annotation_created'
	| 'annotation_updated'
	| 'annotation_dismissed'
	| 'annotation_applied';

// ---------------------------------------------------------------------------
// Pipeline Request / Response Types (new API)
// ---------------------------------------------------------------------------

export interface CreatePipelineRequest {
	url: string;
	source_type?: SourceType;
	config?: {
		stages_enabled?: string[];
		max_concurrent_stages?: number;
		timeout_seconds?: number;
		retry_max_attempts?: number;
		mode?: PipelineMode | string;
		video_style?: string;
		campaign_pack?: Record<string, unknown>;
		growth?: Record<string, unknown>;
	};
	user_context?: Record<string, unknown> | null;
	site_name?: string;
}

export interface StageExecutionResponse {
	stage_name: string;
	status: StageStatus;
	service_name: string | null;
	service_job_id: string | null;
	duration_seconds: number | null;
	retry_count: number;
	error: string | null;
}

export interface ArtifactResponse {
	stage_name: string;
	artifacts: Record<string, unknown>;
}

export interface PipelineVideo {
	type: string;
	label: string;
	url: string;
}

export interface AssetProvenance {
	source?: string;
	source_stage?: string;
	role?: string;
	kind?: string;
	page_url?: string;
	asset_id?: string;
	asset_type?: string;
	linked_asset_id?: string;
}

export interface VisualAsset {
	asset_id: string;
	title: string;
	kind: string;
	role: string;
	url: string;
	source: string;
	page_url?: string | null;
	approval_status?: string;
	metadata?: {
		approval_status?: string;
		provenance?: AssetProvenance;
		[key: string]: unknown;
	} | null;
}

export interface SlideDeckSlideAsset {
	index: number;
	role?: string;
	download_url?: string;
	download_path?: string;
	url?: string;
}

export interface SlideDeckManifest {
	slide_count?: number;
	slides?: Array<Record<string, unknown>>;
	assets?: {
		manifest?: Record<string, unknown> | string;
		pptx?: Record<string, unknown> | string;
		pdf?: Record<string, unknown> | string;
		slides?: SlideDeckSlideAsset[];
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface SlideDeckArtifact {
	job_id: string;
	manifest?: SlideDeckManifest;
	manifest_url?: string;
	pptx_url?: string;
	pdf_url?: string;
	slide_roles?: Record<string, { preview_url?: string }>;
	slides?: Array<Record<string, unknown>>;
	raw?: Record<string, unknown>;
}

export interface FrontendTestSummary {
	total: number;
	passed: number;
	failed: number;
	skipped: number;
	flaky: number;
	pass_rate: number;
}

export interface FrontendTestCaseResult {
	name: string;
	feature: string;
	status: string;
	duration_ms: number;
	error: string;
	screenshot_url?: string;
	trace_url?: string;
}

export interface FrontendTestArtifact {
	job_id: string;
	summary: FrontendTestSummary;
	test_results: FrontendTestCaseResult[];
	report_url?: string;
	execution_time_seconds?: number;
	raw?: Record<string, unknown>;
}

export interface CancelPipelineResponse {
	job_id: string;
	status: string;
	message: string;
}

export interface DownstreamHealthResponse {
	services: Record<string, { status: string; latency_ms?: number; error?: string }>;
	overall: string;
}

// ---------------------------------------------------------------------------
// Critique Interfaces
// ---------------------------------------------------------------------------

export interface CritiqueFinding {
	finding_id: string;
	category: CritiqueCategory;
	severity: CritiqueSeverity;
	title: string;
	description: string;
	url?: string;
	recommendation?: string;
	selector?: string;
}

export interface CritiqueResponse {
	id: string;
	job_id: string | null;
	url: string;
	status: CritiqueRunStatus;
	categories: CritiqueCategory[];
	findings: CritiqueFinding[];
	scores: Record<string, number>;
	summary: string | null;
	pages_scanned: number;
	github_repo_url: string | null;
	repo_detection_confidence: string | null;
	error_message: string | null;
	created_at: string;
	completed_at: string | null;
}

export interface CritiqueList {
	items: CritiqueResponse[];
	total: number;
	page: number;
	page_size: number;
}

// ---------------------------------------------------------------------------
// Redesign Interfaces (analysis_service redesign domain, via orchestrator proxy)
// ---------------------------------------------------------------------------

// Backend `status` is a free string; we narrow against a terminal set rather
// than a closed union so an unrecognised upstream status never breaks the UI.
export type RedesignJobStatus = string;

export interface RedesignJob {
	job_id: string;
	status: RedesignJobStatus;
	error?: string | null;
}

export interface RedesignVariant {
	variant_id: string;
	style: string;
	status: string;
	redesigned_html_path?: string | null;
	error?: string | null;
}

export interface RedesignResult {
	job_id: string;
	url: string;
	scope: string;
	style: string;
	redesigned_html_path?: string | null;
	variants?: RedesignVariant[] | null;
}

// ---------------------------------------------------------------------------
// App Upload
// ---------------------------------------------------------------------------

export type AppInputType = 'store_url' | 'upload' | 'download_url' | 'local_path';

export interface AppUploadResponse {
	file_id: string;
	filename: string;
	size_bytes: number;
	platform: 'android' | 'ios';
	minio_uri: string;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthComponentStatus {
	status: string;
	latency_ms?: number;
	error?: string;
}

export interface HealthResponse {
	status: string;
	components: {
		database: HealthComponentStatus;
		redis: HealthComponentStatus;
		api: HealthComponentStatus;
	};
}

// ---------------------------------------------------------------------------
// Device Farm
// ---------------------------------------------------------------------------

export type DeviceFarmProvider = 'browserstack' | 'docker_android' | 'local';

export interface DeviceFarmDevice {
	name: string;
	os_version: string;
	platform: string;
	real_device: boolean;
}

export interface DeviceFarmHealthResponse {
	connected: boolean;
	provider: string;
	devices: DeviceFarmDevice[];
	error?: string | null;
}

// ---------------------------------------------------------------------------
// Config Status
// ---------------------------------------------------------------------------

export interface ConfigStatusResponse {
	llm_configured: boolean;
	llm_provider: string;
	llm_models: {
		fast: string;
		balanced: string;
		capable: string;
	};
	has_webscraper_key: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Dashboard project counts. `null` = the count could not be loaded (not zero). */
export interface DashboardStats {
	total: number | null;
	completed: number | null;
	producing: number | null;
	failed: number | null;
}

// ---------------------------------------------------------------------------
// Storyline
// ---------------------------------------------------------------------------

export interface StorylineChapter {
	number: number;
	title: string;
	subtitle: string;
	estimated_duration_seconds: number;
	start_seconds?: number; // actual start time from compilation
	duration_seconds?: number; // actual duration from compilation
	level?: number; // 0 = lesson (top), 1 = mid-lesson sub-chapter
	parent_sequence?: number | null; // owning lesson's sequence for a level-1 row
}

// A course's per-lesson + mid-lesson chapter markers, as produced by
// `course_stitch` (orchestrator). Distinct from the storyline-wizard
// `StorylineChapter`; the video page maps between them.
export interface CourseChapter {
	sequence: number;
	title: string;
	start_seconds: number;
	duration_seconds: number;
	level?: number;
	parent_sequence?: number | null;
	lesson_project_id?: string | null;
	/** Stable override key: lesson_project_id at level 0, `${lesson_project_id}#${ordinal}` at level 1. */
	chapter_key?: string | null;
	/** Operator-hidden level-1 sub-chapter (dropped from YouTube + the player). Absent/false on old runs. */
	hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Reviews (pipeline Stage 3 — AI-powered review artifacts)
// ---------------------------------------------------------------------------

export interface ReviewCategory {
	score: number;
	observations?: string[];
	issues?: string[];
	recommendations?: string[];
}

export interface ScoredReview {
	overall_score: number;
	categories: Record<string, ReviewCategory>;
	strengths?: string[];
	weaknesses?: string[];
	recommendations?: string[];
	critical_issues?: Array<{
		severity: string;
		description: string;
		affected_pages?: string[];
		recommendation: string;
	}>;
	quick_wins?: string[];
	long_term_improvements?: string[];
	issues?: string[];
}

export interface FeatureReview {
	vertical: string;
	feature_completeness_score: number;
	present_features: Record<string, { features: string[]; completeness: string; notes: string }>;
	missing_features: Array<{
		feature: string;
		importance: string;
		reason: string;
	}>;
	differentiators: Array<{
		feature: string;
		impact: string;
		description: string;
	}>;
	suggestions: Array<{
		feature: string;
		priority: string;
		rationale: string;
	}>;
}

export interface FeatureSuggestion {
	id: number;
	title: string;
	category: string;
	impact: string;
	complexity: string;
	estimated_effort: string;
	description: string;
	rationale: string;
}

export interface FeatureSuggestionsReview {
	total_proposals: number;
	proposals: FeatureSuggestion[];
	priority_matrix?: Record<string, FeatureSuggestion[]>;
}

export interface JobReviews {
	design_review?: ScoredReview;
	usability_review?: ScoredReview;
	feature_review?: FeatureReview;
	content_quality_review?: ScoredReview;
	feature_suggestions?: FeatureSuggestionsReview;
}

// ---------------------------------------------------------------------------
// Studio v3: Project + Deliverable (BE PR-1)
//
// Source of truth is `src/lib/api/types.gen.ts` (auto-generated from BE
// OpenAPI). The aliases below carry the names the rest of the FE uses;
// changing the BE contract regenerates `types.gen.ts` and surfaces breakage
// at the call sites that depended on the old shape.
// ---------------------------------------------------------------------------

import type { components as gen } from '$lib/api/types.gen';

export type ProjectType = NonNullable<gen['schemas']['ProjectResponse']['type']>;
export type ProjectStatus = NonNullable<gen['schemas']['ProjectResponse']['status']>;
export type RunStatus = NonNullable<gen['schemas']['RunSummary']['status']>;
export type DeliverableFormat = NonNullable<gen['schemas']['DeliverableResponse']['format']>;
export type CaptionsMode = NonNullable<gen['schemas']['DeliverableResponse']['captions_mode']>;
export type DeliverableStatus = NonNullable<gen['schemas']['DeliverableResponse']['status']>;
export type Visibility = NonNullable<gen['schemas']['ProjectResponse']['visibility']>;

/** Free-form creative brief. JSONB on the backend; structured on the frontend. */
/** One source attached to a project brief (the universal multi-source list).
 *  `url` is scraped, `document` is parsed (its `ref` is the storage ref from
 *  `POST /api/uploads/document`), `media` is a pinned media-discovery item (`ref` is
 *  its URL). Read by the orchestrator's `source_ingest` stage. */
export interface ProjectSource {
	kind: 'url' | 'document' | 'media';
	ref: string;
	label?: string;
	auth_info?: ProjectBrief['auth_info'];
	/** Optional preview thumbnail for a pinned `media` item, carried from the
	 *  media-discovery search result so the Review step can show it without re-fetching. The
	 *  orchestrator ignores it (the brief is a free-form dict). */
	thumbnail_url?: string;
	/** `image` | `video` for a pinned media item (from the media-discovery result), so the UI
	 *  can badge clips. Optional + ignored by the backend. */
	media_type?: string;
}

/** Viewport an authored URL shot is captured at. */
export type ShotViewport = 'desktop' | 'tablet' | 'mobile';

/** A live-URL capture shot: film part of a page, then narrate over it. */
export interface UrlShot {
	kind: 'url';
	/** Absolute URL or a path relative to brief.source_url/target_url. */
	url: string;
	/** Verbatim narration spoken over this shot. */
	narration: string;
	directives: {
		/** CSS selector to scroll into view before holding (recorder follow-up). */
		scroll_to?: string;
		/** CSS selector to click before holding (navigates the SPA to this shot). */
		click?: string;
		/** Pause (ms) on this shot so the viewer can read it. */
		hold_ms: number;
		/** CSS selector to wait for before capturing (recorder follow-up). */
		wait_for?: string;
		viewport: ShotViewport;
	};
}

/** An authored slide shot, placeable anywhere between URL shots. */
export interface SlideShot {
	kind: 'slide';
	/** Verbatim narration spoken over this slide. */
	narration: string;
	slide: {
		template: 'title' | 'bullets' | 'cta';
		eyebrow?: string;
		title?: string;
		body?: string;
		bullets?: string[];
		cta_url?: string;
	};
}

/** One entry in an authored shotlist (promo / website_review). Consumed by the
 *  orchestrator's deterministic shotlist-driven compile path; presence opts in
 *  (an empty list is omitted from the brief). */
export type Shot = UrlShot | SlideShot;

/** showcase / demo_video authored mode: one hand-authored narration beat bound to
 *  a recorded `@clip-<n>` clip. Derived from the generated `ShowcaseLine` (BE
 *  contract) so a field rename surfaces at the FE call sites — but the server
 *  defaults id/seconds/scenario_name/gherkin, so for the authoring flow only
 *  id/text/seconds are required and the rest are optional-until-submit (cleanLines
 *  fills/strips them). A backend field change tightens `clip_anchor` (`"end"|null`)
 *  and the rest here automatically. */
export type ShowcaseLine = Pick<gen['schemas']['ShowcaseLine'], 'id' | 'text' | 'seconds'> &
	Partial<Omit<gen['schemas']['ShowcaseLine'], 'id' | 'text' | 'seconds'>> & {
		/** Authored intro/outro/interstitial card for this beat. NOT a model field
		 *  (absent from the generated schema): the orchestrator's `showcase_slides`
		 *  stage reads the raw `brief.lines[*].card` dict (`template` + slide fields)
		 *  and renders it via slide_service. A beat without one plays footage. */
		card?: Record<string, unknown>;
	};

export interface ProjectBrief {
	audience?: string;
	/** Universal multi-source grounding list (promo/generic): website + PDF/book/
	 *  docx uploads + pinned media, combined. Ingested by the source_ingest stage. */
	sources?: ProjectSource[];
	/** Opt-in: let the pipeline auto-discover media via media-discovery (media_discovery stage).
	 *  Presence opts in (empty {} still opts in). */
	media_discovery?: Record<string, unknown>;
	key_messages?: string[];
	tone?: string;
	references?: string[];
	notes?: string;
	/** Literal script to narrate verbatim. When non-empty the script-generation
	 *  stage narrates it exactly and skips the LLM. Optional everywhere. */
	source_script?: string;
	/** AI image-generation opt-in config (generic blueprint only). The
	 *  orchestrator lifts this into the run config the image-gen stage reads;
	 *  mere presence of the block opts the project in (empty {} still opts in). */
	ai_image_gen?: Record<string, unknown>;
	/** AI video-generation opt-in config (generic blueprint only). Same
	 *  presence-is-opt-in contract as ai_image_gen. */
	ai_video_gen?: Record<string, unknown>;
	/** Deterministic branded motion-graphics opt-in config (promo/generic). The
	 *  orchestrator lifts this into the run config motion_graphics_gen reads,
	 *  which frame-steps an HTML/CSS motion template into an MP4 per line. Same
	 *  presence-is-opt-in contract as ai_image_gen (empty {} still opts in, but
	 *  the toggle writes { enabled: true, template_id } so the stage has a
	 *  template to render). */
	motion_graphics?: Record<string, unknown>;
	/** Audiobook: opaque storage ref for the uploaded manuscript (set by the
	 *  manuscript upload step; read by the audiobook_ingest stage). */
	manuscript_ref?: string;
	/** Audiobook: original manuscript filename (drives extension-based parsing). */
	manuscript_name?: string;
	/** Audiobook: 'auto' (detect chapters) | 'single' (one chapter). */
	chapter_mode?: 'auto' | 'single';
	/** Audiobook output + one-command-lift options. `output_format`/`chapter_gap_ms`
	 *  are read by the audiobook_stitch stage; the three PR-8c opt-ins ride through
	 *  the free-form brief untyped and are consumed by the lift stages:
	 *   - `propose_pronunciations` — audiobook_ingest proposer auto-suggests
	 *     pronunciations for names / invented words (opt-in, default off).
	 *   - `pause_for_review` — the two review gates (after ingest & casting) pause
	 *     by default; an explicit `false` (the "skip review" toggle) autopilots the
	 *     book end-to-end. Absent/`true` ⇒ today's behaviour (both gates pause
	 *     before paid narration).
	 *   - `direction` — free-text narration guidance (tone / pace / delivery) read
	 *     by the audiobook_direct stage. */
	audiobook?: {
		output_format?: 'mp3' | 'wav';
		chapter_gap_ms?: number;
		propose_pronunciations?: boolean;
		pause_for_review?: boolean;
		direction?: string;
	};
	/** Audiobook: opt-in multi-voice casting. When true, audiobook_cast runs an
	 *  LLM pass that assigns a distinct kokoro voice per character; when absent
	 *  the whole book is narrated in the single project voice. */
	voice_acting?: boolean;
	/** Audiobook: optional per-character voice pins (speaker name → kokoro
	 *  voice_id). The cast stage treats these as authoritative and lets the LLM
	 *  fill in everyone else. Names must match how the speaker appears in the
	 *  manuscript. */
	voice_cast?: Record<string, string>;
	/** promo: optional source site → recorded as background footage + scraped to
	 *  ground the script (read by the orchestrator's site_capture stage). NOT
	 *  target_url — that's the app_review/website_review inspection target. */
	source_url?: string;
	/** promo: free-text instructions passed verbatim to the script stage. */
	instructions?: string;
	/** Site auth for the recorder (promo) / scanner (website_review). Forwarded
	 *  opaquely; canonical shape is analysis_service AuthInfo. Dropped when type
	 *  is "none". A STORED secret is returned as `{redacted: true}` (orchestrator
	 *  auth_secrets.REDACTED); echoing that back keeps the saved value. */
	auth_info?: {
		type?: 'none' | 'basic' | 'bearer' | 'cookies';
		username?: string;
		password?: string | { redacted: true };
		token?: string | { redacted: true };
		cookie_header?: string | { redacted: true };
		login_url?: string;
	};
	/** demo_video: login-gated demo auth. Forwarded by the orchestrator
	 *  (demo_video_gen → bdd_playwright_service; demo_video_record →
	 *  frontend_test_runner_service) which drives a Playwright storageState
	 *  form login (AUTH_LOGIN_URL/AUTH_USERNAME/AUTH_PASSWORD). Canonical shape
	 *  is frontend_test_runner_service AuthConfig {type, login_url, username,
	 *  password}. Dropped when type is "none". NOTE: distinct from auth_info
	 *  (the analysis_service critique shape) — demo recording needs an
	 *  interactive form login, not header/cookie injection. */
	auth_config?: {
		type?: 'none' | 'form';
		login_url?: string;
		username?: string;
		password?: string;
	};
	/** showcase / demo_video (authored mode): presigned URL of an uploaded
	 *  Playwright recording-package zip (set by POST /api/uploads/package). When
	 *  present, demo_video_record re-runs THIS package live instead of the
	 *  auto-generated scenarios, and demo_video_gen skips BDD generation. */
	package_url?: string;
	/** showcase (authored mode): the hand-authored clip↔beat spine. Presence
	 *  switches demo_video_gen into authored mode. Uploaded as a lines.json array. */
	lines?: ShowcaseLine[];
	/** promo: opt-in site-recording config (presence opts in; read by
	 *  site_capture). Keys: paths[], max_clips, viewport{width,height}, scroll. */
	site_capture?: Record<string, unknown>;
	/** Authored, ordered shotlist (promo / website_review). Each entry is a live-URL
	 *  capture directive or an authored slide; the orchestrator runs them in order,
	 *  binding narration 1:1. Presence opts into the deterministic shotlist compile;
	 *  absent = legacy auto/site_capture path. */
	shotlist?: Shot[];
	/** Authored, ordered storyboard panels (generic / demo_video). Each panel is a
	 *  shot on the `clip-<n>` spine; the generic script_draft + demo_video gen
	 *  short-circuits render from these when present. Absent = legacy auto-direct
	 *  path. Persisted panels (storyboard table) win over this inline seed at run
	 *  time. */
	storyboard?: Record<string, unknown>[];
	/** Opt-in two-voice dialogue mode. promo: a Q&A two-hander; lesson: a Socratic
	 *  instructor + student. When `enabled`, the script stage writes the script as
	 *  dialogue and the narrate stage casts each speaker ("a"/"b") to a distinct
	 *  kokoro voice. Absent/false → single narrator. `personas` optionally overrides
	 *  the default speaker descriptions. */
	dialogue?: { enabled: boolean; personas?: { a?: string; b?: string } };
	/** website_review independent output opt-ins. Each toggles its orchestrator
	 *  stage; absent = on (preserves the original full pipeline for old projects +
	 *  the E2E). `generate_video` implies the redesign server-side (the narrated
	 *  review is the before→after of the redesign). */
	generate_critique?: boolean;
	generate_redesign?: boolean;
	generate_video?: boolean;
	/** website_review: pause for operator review after the redesign and after the
	 *  script (default true). `false` runs the pipeline straight through. */
	pause_for_review?: boolean;
	/** seo_audit / cro_audit opt-in: run the advisory micro-LLM analyzers for extra
	 *  context. The deterministic score is unchanged; absent/false → scan only. */
	include_llm?: boolean;
	/** Audit opt-in: audience / goal that steers the enriched recommendation prose +
	 *  executive summary (only meaningful with include_llm). Absent → generic recs. */
	intent?: string;
	/** website_review / web_design opt-in: when true, the redesign / web_design
	 *  stage records a deterministic scroll-through motion clip of the generated
	 *  page and attaches it to the hero visual (soft-fail keeps the static
	 *  screenshot). Absent/false → static only. */
	redesign_motion?: boolean;
	/** Opt-in animated intro/outro title card (promo / website_review / course /
	 *  generic). The orchestrator lifts this into the run config; the compile tail
	 *  renders a branded animated_title_card clip and splices it at the front/back
	 *  of the video. Soft-fail — a render error just omits the card. Absent → no
	 *  card. Must be a TRUTHY block (`{ enabled: true }`); `{}` lifts as falsy. */
	title_card?: {
		enabled?: boolean;
		intro?: boolean;
		outro?: boolean;
		title?: string;
		subtitle?: string;
		duration_seconds?: number;
	};
	/** Opt-in Ken Burns: the compile tail animates each bare still shot (AI/curated
	 *  image, slide PNG) into a deterministic pan/zoom clip. Soft-fail per shot →
	 *  keeps the still. Absent → no motion. Must be a TRUTHY block (`{ enabled: true }`). */
	/** Output resolution tier — the ONLY key the orchestrator reads for it
	 *  (run_setup → config_snapshot.resolution → quality_tier; unknown ⇒ 2k). */
	resolution?: '1080p' | '2k' | '4k';
	ken_burns?: {
		enabled?: boolean;
		preset?: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down';
		duration_seconds?: number;
	};
	[key: string]: unknown;
}

// Project-level identity blobs. The backend treats them as free-form JSONB but
// reads a specific set of keys (see w2v_orchestrator stages). We type the keys
// the orchestrator actually consumes so the Brief-section editors write
// consumable JSON, while the index signature keeps unknown keys (e.g. the
// palette/fonts auto-extracted by resolve_brand_context) type-safe and
// round-tripped untouched on save.
export interface BrandConfig {
	/** Hex colors fed to lesson image prompts (lesson/slides.py). */
	primary_color?: string;
	secondary_color?: string;
	accent_color?: string;
	/** Typography for redesigns (promo/storyboard.py). */
	display_font?: string;
	body_font?: string;
	font_family?: string;
	/** Logo URL used by website redesigns. */
	logo_url?: string;
	[key: string]: unknown;
}
export interface VoiceConfig {
	/** kokoro voice id; validated server-side against the 54-voice catalog. */
	voice_id?: string;
	/** TTS rate, 0.5–2.0. */
	speed?: number;
	/** Free-text tone hint fed to LLM script stages. */
	descriptor?: string;
	/** Speaker-code → voice_id, set by two-voice dialogue flows (preserved, not edited here). */
	cast?: Record<string, string>;
	[key: string]: unknown;
}
export interface ThemeConfig {
	/** Promo storyboard background/accent color hints (promo/storyboard.py). */
	background?: string;
	accent?: string;
	[key: string]: unknown;
}

export type DeliverableResponse = gen['schemas']['DeliverableResponse'];

// List-view metadata fields carried on the generated ProjectResponse/ProjectDetail
// schemas. Re-declared here only to alias `last_run_status` to the FE `RunStatus`
// type; the server marks these fields REQUIRED, so they must match it (making them
// optional here would let the FE drift LOOSER than the server).
type ProjectListMeta = {
	status: ProjectStatus;
	/** Set when the project reached 'completed' (all deliverables done). */
	finished_at?: string | null;
	/** Number of deliverables on the project (server-required). */
	deliverable_count: number;
	/** Status of the most recent run across the project's deliverables. */
	last_run_status?: RunStatus | null;
	/** Poster for the card: the most recent completed run's video thumbnail,
	 *  already rewritten to a browser-reachable /api/runs/{id}/artifact path.
	 *  Null when no completed run produced one. (Hand-extended ahead of the
	 *  orchestrator OpenAPI republish; collapses to a no-op once types.gen.ts
	 *  carries it.) */
	thumbnail_url?: string | null;
};
export type ProjectResponse = Omit<gen['schemas']['ProjectResponse'], 'status'> &
	ProjectListMeta & {
		/** True when this project is the hidden child of a storyboard branch.
		 *  Hand-extended ahead of the orchestrator OpenAPI republish (orch 447557c). */
		is_branch?: boolean;
	};
/** A project detail carries `branch` only when the project IS a branch — it is the
 *  ONLY thing that tells the workspace it is looking at a fork rather than the real
 *  board (branches are excluded from the projects list, so there is no other way
 *  back to the root). Null/absent on every ordinary project. */
export type ProjectDetailResponse = Omit<gen['schemas']['ProjectDetail'], 'status' | 'children'> &
	ProjectListMeta & {
		children: ProjectResponse[];
		branch?: BranchContext | null;
		is_branch?: boolean;
	};

/** PR-2 will revive the lesson summary JSONB; kept as `unknown` shape until then. */
export interface LessonSummary {
	summary_text: string;
	key_points: string[];
	referenced_terms: string[];
}

/** BE returns `{items, total, limit, offset}`. Aliased to `projects` for callers
 *  that pre-date the rename; see `projects.list` below. */
export type ProjectListResponse = Omit<gen['schemas']['ProjectList'], 'items'> & {
	items: ProjectResponse[];
};

// `captions_mode` widened to optional: omitting it lets the orchestrator resolve
// the workspace default (P6 ORCH-2, `/api/tenant/defaults` captions.mode) instead of
// the wizard pinning 'none'. The pinned OpenAPI package still marks it required;
// collapses to the plain alias once types.gen.ts regenerates.
export type DeliverableInput = Omit<gen['schemas']['DeliverableCreate'], 'captions_mode'> & {
	captions_mode?: gen['schemas']['DeliverableCreate']['captions_mode'] | null;
};

// `type` widened to the hand-extended ProjectType so the wizard can create a
// website_review project before the BE OpenAPI republish (collapses to a no-op
// once types.gen.ts regenerates).
// `deliverables` widened to `DeliverableInput` (optional `captions_mode`, P6) for the
// same one-codegen-cycle reason.
export type CreateProjectRequest = Omit<
	gen['schemas']['ProjectCreate'],
	'type' | 'deliverables'
> & {
	type: ProjectType;
	deliverables: DeliverableInput[];
};

export type UpdateProjectRequest = gen['schemas']['ProjectUpdate'];

export type CreateChildProjectRequest = gen['schemas']['CreateChildProject'];

export type ReorderChildrenRequest = gen['schemas']['ReorderChildren'];

// Studio: Storyboard panels (Phase 0). Generated schemas + enums straight from
// the orchestrator OpenAPI; `StoryboardPanelDraft` is the editable in-memory
// shape shared by the board/card + the create-wizard step (a persisted
// `StoryboardPanelResponse` is structurally assignable to it).
export type PanelStatus = gen['schemas']['PanelStatus'];
export type ShotSize = gen['schemas']['ShotSize'];
export type CameraAngle = gen['schemas']['CameraAngle'];
export type CameraMovement = gen['schemas']['CameraMovement'];
export type TransitionOut = gen['schemas']['TransitionOut'];
export type VisualType = gen['schemas']['VisualType'];
export type StoryboardPanelResponse = gen['schemas']['StoryboardPanelResponse'];
export type StoryboardPanelListResponse = gen['schemas']['StoryboardPanelListResponse'];
export type StoryboardPanelCreate = gen['schemas']['StoryboardPanelCreate'];
export type StoryboardPanelUpdate = gen['schemas']['StoryboardPanelUpdate'];
export type ReorderPanelsRequest = gen['schemas']['ReorderPanels'];

// Phase 1: assets (character/location/prop bible), scenes, and the
// brief→storyboard draft + single-panel AI rewrite verbs.
export type AssetKind = gen['schemas']['AssetKind']; // "character"|"location"|"prop"
export type StoryboardAssetResponse = gen['schemas']['StoryboardAssetResponse'];
export type StoryboardAssetListResponse = gen['schemas']['StoryboardAssetListResponse'];
export type StoryboardAssetCreate = gen['schemas']['StoryboardAssetCreate'];
export type StoryboardAssetUpdate = gen['schemas']['StoryboardAssetUpdate'];
export type StoryboardSceneResponse = gen['schemas']['StoryboardSceneResponse'];
export type StoryboardSceneListResponse = gen['schemas']['StoryboardSceneListResponse'];
export type StoryboardSceneCreate = gen['schemas']['StoryboardSceneCreate'];
export type StoryboardSceneUpdate = gen['schemas']['StoryboardSceneUpdate'];
export type StoryboardDraftRequest = gen['schemas']['StoryboardDraftRequest'];
export type StoryboardDraftResponse = gen['schemas']['StoryboardDraftResponse'];
export type PanelRewriteRequest = gen['schemas']['PanelRewriteRequest'];

// Studio: per-panel AI image generation (orch `storyboard.panels.generateImage`).
//
// `MediaRef` is where the panel's picture lives; `PanelGen` is the reproducibility
// record (prompt + seed — the runner is text→image plus a seed, so those two are
// the ONLY things that can reproduce a frame or keep a character on-model).
//
// ⚠️ `media_ref.url` on a JOB is the signature minted at generation time and is
// never re-signed; the always-fetchable url only comes from re-reading the PANEL.
// Nothing may cache a url off `PanelImageJobResponse` (the presign dies in an hour).
//
// `PanelImageStatus` is derived from the response rather than a standalone schema
// (the orchestrator inlines the enum), the same way `SnapshotKind` narrows a bare
// `string` — it is the WIRE status only. The store's UI-level union
// (`PanelImageUiStatus`) adds lost/unavailable/conflict on top of these four.
export type MediaRef = gen['schemas']['MediaRef'];
export type PanelGen = gen['schemas']['PanelGen'];
export type PanelImageRequest = gen['schemas']['PanelImageRequest'];
export type PanelImageJobResponse = gen['schemas']['PanelImageJobResponse'];
export type PanelImageStatus = PanelImageJobResponse['status'];

// Per-panel approval trail (orch d4a965f). A `PanelEvent` is one row of the
// append-only audit log a panel accrues as it is approved/unapproved/rewritten.
export type PanelEvent = gen['schemas']['PanelEventResponse'];
export interface PanelEventListResponse {
	items: PanelEvent[];
	total: number;
}

// Storyboard version snapshots (restore points for the whole board — panels +
// scenes + assets). `kind` is a bare `string` on the wire, narrowed here to the
// three values the orchestrator mints:
//   'manual'      — an explicit user snapshot; the only kind the user may delete.
//   'auto'        — the safety snapshot taken immediately before a restore
//                   overwrites the board (capped by a server-side retention cap).
//   'branch_base' — the fork point pinned by a storyboard branch (orch migration
//                   0052). It is a THIRD kind precisely because neither of the
//                   others is safe to pin: 'auto' is swept by the retention prune
//                   and 'manual' is user-deletable, and either would break the
//                   branch's FK. It is therefore NOT deletable here — the delete
//                   button is gated on 'manual', so that falls out for free.
export type SnapshotKind = 'manual' | 'auto' | 'branch_base';
export type StoryboardSnapshot = Omit<gen['schemas']['SnapshotResponse'], 'kind'> & {
	kind: SnapshotKind;
};
export type SnapshotCreateRequest = gen['schemas']['SnapshotCreateRequest'];
export interface SnapshotListResponse {
	items: StoryboardSnapshot[];
	total: number;
}
export type RestoreResponse = gen['schemas']['RestoreResponse'];

// Storyboard branches (orch migration 0052). A branch is a hidden child project
// carrying its own complete copy of the storyboard graph, so you can rework a cut
// without destroying the current one, then merge it back.
//
// Hand-written rather than derived from `gen['schemas'][...]`: the generated types
// are pinned to an orchestrator OpenAPI package that predates these routes. Swap
// these to `gen['schemas']['BranchResponse']` when the pin is bumped (follow-up).
//
// Wire is snake_case like every sibling storyboard response — the backend's
// `_camel` ConfigDict is a misnomer (`populate_by_name` + `str_strip_whitespace`,
// no `alias_generator`), so field names serialize verbatim.
export type BranchStatus = 'open' | 'merged' | 'abandoned';
export interface StoryboardBranch {
	id: string;
	root_project_id: string;
	child_project_id: string;
	name: string;
	base_snapshot_id: string;
	status: BranchStatus;
	created_at: string;
	merged_at?: string | null;
}
export interface BranchListResponse {
	items: StoryboardBranch[];
	total: number;
}

// The branch's-eye view, embedded on `ProjectDetail.branch` (orch 447557c). Where
// `StoryboardBranch` is what the ROOT board knows about its forks, this is what a
// FORK knows about itself: which board it came from (`root_project_id` +
// `root_title`, so the banner can link home without a second fetch) and whether it
// is still a live lane (`status === 'open'`) or read-only history.
//
// Hand-written for the same reason as `StoryboardBranch` above: the generated types
// are pinned to an orchestrator OpenAPI package that predates these routes.

// One hop of a branch's lineage on the way back to the ultimate root. Branch-of-branch
// is supported (a fork's link row points at whatever it forked, so a branch's "root" is
// really its IMMEDIATE parent), so a branch can sit several hops below the root.
// `is_branch` distinguishes an intermediate parent (itself a branch) from the ultimate
// root (a normal project) so the banner can render the chain and mark its terminal.
export interface BranchAncestor {
	project_id: string;
	title: string;
	is_branch: boolean;
}

export interface BranchContext {
	branch_id: string;
	name: string;
	status: BranchStatus;
	// The IMMEDIATE parent (the merge target + back-navigation), NOT necessarily the
	// ultimate root — see `ancestors`. Kept for the one-hop banner + link.
	root_project_id: string;
	root_title: string;
	// The full lineage, immediate-parent-first (`ancestors[0]` === the immediate parent)
	// → ultimate-root-last; a single element for a direct branch. Lets the banner show
	// "branch of B, which is a branch of A". Optional so the FE tolerates an
	// orchestrator that predates the field (falls back to the one-hop `root_*` render).
	ancestors?: BranchAncestor[];
}

// Branch merge — the three-way diff (base = the fork point, main = the root board
// as it stands NOW, branch = the fork's board) and the merge that folds the branch
// back into the root.
//
// Hand-written for the same reason as the branch types above: the generated schema
// pin predates these routes. Swap to `gen['schemas'][...]` when the pin is bumped.
//
// A side (`base`/`main`/`branch`) is a NORMALISED PANEL VIEW — the content-bearing
// fields of a panel, keyed by field name. It is `null` on a side where the panel
// does not exist (added ⇒ no base/main; deleted ⇒ no branch). Deliberately typed as
// an open record rather than `StoryboardPanelResponse`: the server normalises the
// row (it is NOT the panel wire shape — no id/revision/media_ref), and the UI only
// ever reads it through `changed_fields` / `main_changed_fields`.
export type DiffPanelView = Record<string, unknown>;

// - 'added'    — the branch created this panel (base/main null).
// - 'modified' — the branch changed it and main did not; safe to take.
// - 'deleted'  — the branch removed it (branch null).
// - 'conflict' — BOTH sides changed it since the fork. Has NO default resolution:
//                the server 422s the merge if any conflict is left unresolved.
export type DiffEntryKind = 'added' | 'modified' | 'deleted' | 'conflict';
export interface DiffEntry {
	key: string;
	kind: DiffEntryKind;
	shot_key: string;
	base: DiffPanelView | null;
	main: DiffPanelView | null;
	branch: DiffPanelView | null;
	/** Fields the BRANCH changed relative to base. */
	changed_fields: string[];
	/** Fields MAIN changed relative to base (non-empty ⇒ the root moved under you). */
	main_changed_fields: string[];
}
export interface BranchDiffResponse {
	branch_id: string;
	root_project_id: string;
	child_project_id: string;
	status: BranchStatus;
	base_snapshot_id: string;
	/** Optimistic-concurrency token for the ROOT board. Echo it back on merge; a
	 *  409 means the root moved while the diff was open. */
	root_fingerprint: string;
	conflict_count: number;
	entries: DiffEntry[];
	/** Server ALLOWLIST of per-field-mergeable columns: a conflict is offered per-field only
	 *  when EVERY one of its conflicting fields is in here. Everything else (shot_key/position/
	 *  scene/characters/props/location, …) is fenced to a whole-row verdict. */
	mergeable_fields: string[];
}

// 'branch' takes the fork's version, 'main' keeps the root's, 'skip' leaves the
// entry out of the merge entirely, 'keep_both' (conflicts only) keeps the root's
// version AND brings the fork's across as a new panel with a fresh shot_key.
export type MergeResolution = 'branch' | 'main' | 'skip' | 'keep_both';
// Per-column pick for a field-resolvable conflict: keep the branch's value or the root's.
export type FieldResolution = 'branch' | 'main';
export interface MergeResolutionInput {
	key: string;
	// Exactly one of these is sent (server-enforced XOR): a whole-row verdict, OR a per-field
	// map that resolves a conflict column-by-column (keys = the conflicting content fields).
	resolution?: MergeResolution;
	field_resolutions?: Record<string, FieldResolution>;
}
export interface BranchMergeRequest {
	root_fingerprint: string;
	resolutions: MergeResolutionInput[];
}
// Sibling merge — fold one open branch's board INTO another open branch (not the root). Both
// branches stay open. `target_fingerprint` is the target board's optimistic-concurrency token
// (the diff-against response's `root_fingerprint`); a 409 means the target moved under you.
export interface SiblingMergeRequest {
	target_branch_id: string;
	target_fingerprint: string;
	resolutions: MergeResolutionInput[];
}
export interface SiblingMergeResponse {
	source_branch_id: string;
	target_branch_id: string;
	/** Safety snapshot of the PRE-merge TARGET board — the merge is reversible from Versions. */
	auto_snapshot_id: string;
	applied: string[];
	skipped: string[];
	target_fingerprint: string;
}
export interface BranchMergeResponse {
	branch_id: string;
	status: BranchStatus;
	merged_at: string;
	/** The safety snapshot of the PRE-merge root board — a merge is reversible from
	 *  the Versions panel via this. */
	auto_snapshot_id: string;
	applied: string[];
	skipped: string[];
	root_fingerprint: string;
}

export interface StoryboardPanelDraft {
	id?: string; // present for persisted rows, absent for wizard drafts
	project_id?: string | null; // present for persisted rows (server-scoped), absent for wizard drafts
	scene_id?: string | null; // scene grouping key; null/undefined = unassigned lane
	shot_key: string; // clip-<n> spine id (wizard assigns clip-{i+1} by position)
	shot_number?: string | null;
	action_description?: string | null;
	dialogue?: string | null;
	vo_text?: string | null;
	shot_size?: ShotSize | null;
	angle?: CameraAngle | null;
	movement?: CameraMovement | null;
	transition_out?: TransitionOut | null;
	duration_seconds?: number | null;
	status?: PanelStatus | null;
	approved_at?: string | null; // set when status === 'approved'
	approved_by?: string | null; // subject id of the approver
	// Image-bearing fields, present on persisted rows only (the wire shape types
	// both as an open record). Widened to `Record<string, unknown>` so a
	// `StoryboardPanelResponse` stays structurally assignable to this draft.
	//
	// ⚠️ `media_ref.url` is a presign minted by the panel READ path and expires in
	// an hour. Render it DERIVED from the panel; never copy it into component state.
	media_ref?: Record<string, unknown> | null;
	// Non-empty ⇒ this panel was generated at least once. That is what separates
	// "never had an image" from "had one, and its url is gone".
	gen?: Record<string, unknown> | null;
}

export type CreateDeliverableRequest = DeliverableInput;
export type DeliverableUpdateRequest = gen['schemas']['DeliverableUpdate'];

/** PR-1: deliverable start moves into PR-2 (`/api/runs`). The shape is a stub
 *  for legacy call sites; remove when those routes are rewritten. */
export interface DeliverableStartResponse {
	deliverable_id: string;
	run_id: string;
	status: DeliverableStatus;
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
	generic: 'Generic',
	promo: 'Promo video',
	app_review: 'App review / critique',
	website_review: 'Website review',
	course: 'Course',
	lesson: 'Lesson',
	audiobook: 'Audiobook',
	web_design: 'Web design',
	web_design_v2: 'Web design (interactive)',
	demo_video: 'Demo video',
	showcase: 'Product showcase',
	action_reel: 'Action reel',
	// Not wizard-creatable (no New-Project wiring) — label only so the Record stays
	// exhaustive over ProjectType and these projects still render in lists.
	growth_bundle: 'Growth bundle',
	seo_audit: 'SEO audit',
	cro_audit: 'CRO audit',
	marketing_scorecard: 'Marketing scorecard'
};

export const DELIVERABLE_FORMAT_LABELS: Record<DeliverableFormat, string> = {
	'16x9': '16:9 horizontal',
	'9x16': '9:16 vertical',
	'1x1': '1:1 square',
	'4x5': '4:5 portrait',
	audio: 'Audio (audiobook)'
};

export const CAPTIONS_MODE_LABELS: Record<CaptionsMode, string> = {
	none: 'No captions',
	burned_in: 'Burned-in captions',
	overlay: 'Overlay captions'
};

// ---------------------------------------------------------------------------
// Stage Drafts (BE phase 2 substrate; phase 3 adds mutation verbs)
// ---------------------------------------------------------------------------

/**
 * Origin of a draft. The four kinds are enforced at the DB level by a CHECK
 * constraint (see backend migration 0007).
 *
 * - `llm_initial`     — first run of the stage (autopilot or pre-pause)
 * - `llm_regen`       — whole-stage rerun with feedback (BE phase 5)
 * - `llm_element_regen` — single-element rerun preserving target id (BE phase 5)
 * - `user_edit`       — operator-typed change via PATCH /output or element CRUD
 */
export type StageDraftSource = 'llm_initial' | 'llm_regen' | 'llm_element_regen' | 'user_edit';

export interface StageDraft {
	draft_id: string;
	job_id: string;
	stage_name: string;
	source: StageDraftSource;
	parent_draft_id: string | null;
	feedback_note: string | null;
	target_element_id: string | null;
	content_json: Record<string, unknown>;
	is_accepted: boolean;
	created_at: string;
}

export interface StageDraftListResponse {
	drafts: StageDraft[];
	stage_name: string;
	job_id: string;
}

export const STAGE_DRAFT_SOURCE_LABELS: Record<StageDraftSource, string> = {
	llm_initial: 'Initial generation',
	llm_regen: 'Stage regeneration',
	llm_element_regen: 'Element regeneration',
	user_edit: 'Operator edit'
};

// ---------------------------------------------------------------------------
// Stage steering verbs (BE phase 3)
// ---------------------------------------------------------------------------

// `CheckpointsRequest` / `CheckpointsResponse` used to be hand-written here and
// re-exported from `$lib/types`. Both were dead AND wrong: the response declared
// `job_id` where the orchestrator schema says `run_id`, and every live caller
// (`stores/checkpoints.svelte.ts`, `routes/projects/[pid]/runs/[id]/+page.ts`)
// already imports the generated `CheckpointsResponse` / `CheckpointsUpdate` from
// `$lib/api/runs`. Two same-named types with different field names is a trap, so
// the hand-written pair is gone — use `$lib/api/runs`.

// ---------------------------------------------------------------------------
// Stage element CRUD (BE phase 4)
// ---------------------------------------------------------------------------

/** A single element with stable id. The element_type's spec defines which
 * key is the id field (chapter_id / scene_id / slide_id / line_id /
 * lesson_id). All other keys are stage-specific shape. */
export type StageElement = Record<string, unknown>;

export interface ElementInsertRequest {
	/** The element JSON. Stable id is server-minted; any client-supplied id is overwritten. */
	element: StageElement;
	/** 0-indexed insertion position. Omitted or past-end appends. */
	position?: number | null;
}

export interface ElementUpdateRequest {
	/** Shallow-merge overlay; the stable id field is preserved. */
	partial: StageElement;
}

export interface ElementReorderRequest {
	order: string[];
}

export interface ElementListResponse {
	job_id: string;
	stage_name: string;
	element_type: string;
	elements: StageElement[];
	total: number;
}

export interface ElementResponse {
	job_id: string;
	stage_name: string;
	element_type: string;
	element_id: string;
	element: StageElement;
}

export interface ElementMutationResponse {
	job_id: string;
	stage_name: string;
	element_type: string;
	/** Null on reorder; the element id on insert/update/delete. */
	element_id: string | null;
	/** The new accepted draft id created by the mutation. */
	draft_id: string;
	/** Post-mutation elements list (saves a follow-up GET). */
	elements: StageElement[];
}

/**
 * Per-stage / per-element_type addressing. Mirrors BE
 * src/services/orchestration/registry.py ELEMENT_SPECS. Drives editor wiring
 * on the stage-editor route — each entry pairs the stable-id field with the
 * editor component that renders the elements.
 */
export const ELEMENT_SPECS = {
	storyline: { chapters: { idField: 'chapter_id' } },
	shotlist: { scenes: { idField: 'scene_id' } },
	slide_deck: { slides: { idField: 'slide_id' } },
	narrate: { lines: { idField: 'line_id' } },
	curriculum_syllabus: { lessons: { idField: 'lesson_id' } }
} as const;

export type ElementCapableStage = keyof typeof ELEMENT_SPECS;

// ---------------------------------------------------------------------------
// Verbatim items (BE phase 6)
// ---------------------------------------------------------------------------

/**
 * The two consumer kinds the orchestrator currently understands. Maps to
 * stages: ``slide`` is consumed by ``slide_deck``, ``tts`` by ``narrate``.
 * The plan reserves the right to add more kinds (e.g. on-screen ticker,
 * captions overlay) without breaking the wire contract.
 */
export type VerbatimKind = 'slide' | 'tts';

/** Where the requested text must end up. */
export type VerbatimScope = 'pipeline' | 'chapter' | 'scene' | 'shot' | 'slide';

/**
 * Lifecycle status. ``pending`` items get retried (auto-regen up to 2x);
 * ``placed`` are the ones the orchestrator's verify_placement matched
 * to a carrier element id; ``rejected`` is currently unused but reserved
 * for an explicit operator skip / dismiss action.
 */
export type VerbatimStatus = 'pending' | 'placed' | 'rejected';

// DERIVED, not hand-mirrored. The hand-written version told the compiler that
// `tenant_id` and `subject_id` are required non-null strings; the schema marks
// both optional AND nullable, and there is no adapter at this boundary —
// `api/verbatim.ts` casts the raw response straight to this type. It also
// declared `created_at` nullable (the schema requires it) and omitted
// `updated_at` entirely. `stores/verbatim.svelte.ts` already carried a
// `SortableItem` cast working around the mismatch.
export type VerbatimItemResponse = components['schemas']['VerbatimItemResponse'];

export type VerbatimItemListResponse = components['schemas']['VerbatimItemListResponse'];

/**
 * Body for ``POST /api/projects/{id}/verbatim-items``. Verbatim items
 * live on the project and cascade to every Deliverable / Run from it
 * (see src/routes/projects/[pid]/runs/[id]/+page.svelte).
 */
export interface VerbatimItemCreateRequest {
	kind: VerbatimKind;
	text: string;
	hint?: string | null;
	scope?: VerbatimScope;
	scope_target?: string | null;
}

/**
 * Body for ``PATCH /api/verbatim-items/{item_id}``. Every field is optional
 * — the BE patches only what is sent, so a text-only edit must not clear the
 * hint / scope the item was created with. Keyed by item id alone (no project
 * segment), same as DELETE.
 */
export interface VerbatimItemUpdateRequest {
	kind?: VerbatimKind;
	text?: string;
	hint?: string | null;
	scope?: VerbatimScope;
	scope_target?: string | null;
	position?: number | null;
}

/**
 * Run-start variant embedded in CreatePipelineRequest.verbatim_items.
 * Wire-identical to the create request (same shape; different host).
 */
export type VerbatimItemRunStartRequest = VerbatimItemCreateRequest;

export const VERBATIM_KIND_LABELS: Record<VerbatimKind, string> = {
	slide: 'On a slide',
	tts: 'Spoken aloud'
};

export const VERBATIM_SCOPE_LABELS: Record<VerbatimScope, string> = {
	pipeline: 'Anywhere in the pipeline',
	chapter: 'In a specific chapter',
	scene: 'In a specific scene',
	shot: 'In a specific shot',
	slide: 'In a specific slide'
};

export const VERBATIM_STATUS_LABELS: Record<VerbatimStatus, string> = {
	pending: 'Pending',
	placed: 'Placed',
	// NOT "Rejected". The API enum is `rejected`, but that word tells the user
	// their wording was considered and refused — a judgement the backend never
	// makes. What it actually reports is narrower and mechanical: every stage
	// that ran in this run is forbidden from consuming this item's kind, so
	// nothing could have used it. "Not used" is that fact and no more.
	rejected: 'Not used'
};

/**
 * The script stages whose persisted output can CARRY a verbatim phrase, i.e.
 * the stages whose completion can change an item's derived placement.
 *
 * This replaces `VERBATIM_STAGE_TO_KIND`, which was deleted rather than
 * corrected. That constant claimed to mirror a BE symbol `_consumer_kinds`
 * that has never existed, and its two keys (`slide_deck`, `narrate`) are not
 * stage names the orchestrator emits at all — so it was wrong in its comment,
 * wrong in its keys, and had zero consumers to keep it honest. The BE's real
 * per-stage table is `STAGE_VERBATIM_KIND`; the FE does not need the KIND
 * (placement comes back on the item, already resolved), only the stage NAMES,
 * so only the names are mirrored here.
 *
 * Server-side these stages are ordered CHAINS with precedence and per-chain
 * kind eligibility. None of that structure matters here: this list is used for
 * exactly one decision — "is it worth re-reading the verbatim list now?" — and
 * the answer is the flattened union of every chain's members. The derivation
 * itself stays server-side, where it belongs.
 *
 * Drift risk is real but bounded: a missing carrier stage means the run view
 * refetches one stage late (on the next carrier stage or on run completion),
 * never that it shows a wrong value.
 */
export const VERBATIM_CARRIER_STAGES: ReadonlySet<string> = new Set([
	'script_draft',
	'promo_script',
	'lesson_script',
	'app_review_script',
	'website_review_script',
	'seo_audit_script',
	'cro_audit_script',
	// The demo/showcase spine, whose stages supersede one another server-side.
	'reconcile_timeline',
	'retention_plan',
	'claim_finish',
	'script_doctor',
	'demo_video_gen'
]);

// ---------------------------------------------------------------------------
// YouTube Upload
// ---------------------------------------------------------------------------

export type YouTubePrivacyStatus = 'public' | 'unlisted' | 'private';

/** youtube_upload_service `AuthStatusResponse.status`. */
export type YouTubeConnectionState =
	| 'connected'
	| 'reconnect_required'
	| 'platform_default'
	| 'not_connected';

/**
 * Which channel an upload for this tenant would use (per-tenant YouTube config):
 * `tenant` = the workspace's own grant, `platform` = the operator's platform
 * channel, `none` = nothing — a publish fails.
 */
export type YouTubeMode = 'tenant' | 'platform' | 'none';

/**
 * GET /api/youtube/auth/status (proxied youtube_upload_service AuthStatusResponse).
 * `connected` is true ONLY for the tenant's own live grant; gate publishing on
 * `can_publish`. `status` / `can_publish` are optional because an older backend
 * omits them (there `connected` meant "can publish") — read via
 * `$lib/utils/youtube-status`.
 */
export interface YouTubeAuthStatusResponse {
	connected: boolean;
	status?: YouTubeConnectionState;
	can_publish?: boolean;
	/** Per-tenant config backend: which of tenant / platform / none applies. */
	mode?: YouTubeMode;
	/** The own grant exists but cannot be used (refused, or issued by a replaced OAuth client). */
	needs_reconnect?: boolean;
	reconnect_reason?: string | null;
	tenant_id: string;
	channel_id?: string | null;
	channel_title?: string | null;
	scopes?: string[];
	connected_at?: string | null;
	updated_at?: string | null;
	token_expiry?: string | null;
}

export interface YouTubeUploadRequest {
	pipeline_job_id: string;
	title: string;
	description?: string;
	tags?: string[];
	category_id?: string;
	privacy_status?: YouTubePrivacyStatus;
}

export interface YouTubeUploadJobResponse {
	job_id: string;
	status: string;
	youtube_video_id?: string | null;
	youtube_url?: string | null;
	// Presigned MinIO URL for the minted soft-CC .srt, echoed by the orchestrator
	// on the initial publish (start_upload) response only — the poll response does
	// not carry it. Time-limited (~1h); absent when no caption track was produced.
	caption_source?: string | null;
	error_message?: string | null;
}

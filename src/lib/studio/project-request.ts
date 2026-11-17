// Single source of truth for turning wizard input into the backend's
// ProjectCreate / CreateChildProject payloads.
//
// WHY this exists: the orchestrator blueprints read a *specific* set of brief
// keys per project type (verified against the stage code). The wizard used to
// collect different keys, so every run fell back to stub content or hard-failed.
// The per-type contract below is the canonical mapping; `project-request.test.ts`
// asserts the built payload satisfies it, so wizard↔blueprint drift can't return.
//
// Blueprint reads this encodes (file:line in w2v_orchestrator):
//   promo      analyze.py:97-101 / script.py:94,123  -> audience, value_proposition,
//                                                        call_to_action, target_duration_seconds
//              growth_bundle/handler.py:70-71         -> call_to_action, cta_url (opt)
//   generic    brief_intake.py:44-46                  -> angle, audience, target_duration_seconds
//   app_review inspect.py:111 (REQUIRED)              -> target_url
//              inspect.py:135 / critique.py:65-66 / script.py:58 -> competitor_urls, review_lens,
//                                                        audience, duration_seconds (opt)
//   website_review website_review/critique.py (REQUIRED) -> target_url
//              redesign.py: redesign_style (opt, default "modern") ; script.py: duration_seconds (opt)
//   lesson     script.py:58-59                        -> learning_objective, duration_minutes
//   course     outline.py:57-58                       -> audience, outcome (+ >=1 child lesson)
//   voice      */narrate.py,record.py: voice.voice_id ; analyze/brief_intake: voice.descriptor

import type {
	ProjectType,
	ProjectBrief,
	ProjectSource,
	Shot,
	ShowcaseLine,
	UrlShot,
	SlideShot,
	DeliverableInput,
	CreateProjectRequest,
	CreateChildProjectRequest,
	StoryboardPanelDraft,
	UpdateProjectRequest
} from '$lib/types';

// `lesson` is child-only (created via a course, never top-level). `showcase` is
// now a first-class wizard type (generated-from-URL + authored package-upload
// modes). `growth_bundle` (#377) and `seo_audit` are real orchestrator product
// types with no New-Project wizard wiring yet, so they're excluded from the
// createable set / brief maps (same reason showcase was excluded before #227) —
// each surfaced when an OpenAPI bump added it to the generated ProjectType enum.
export type PickType = Exclude<ProjectType, 'lesson' | 'growth_bundle'>;

/**
 * Every type a persisted project can carry that has a brief contract — PickType
 * plus `growth_bundle`, which is not creatable from the wizard (product decision
 * pending) but CAN exist (API-created), and its workspace renders the brief form.
 */
export type BriefType = Exclude<ProjectType, 'lesson'>;

/**
 * Canonical ordered list of project types a user can CREATE (the New Project
 * wizard) and FILTER BY (the /projects type chips). Single source of truth so the
 * two surfaces can't drift — they used to be hand-maintained separately and fell
 * out of sync (the filter still offered the dormant `app_review` while omitting the
 * createable `web_design`).
 *
 * Excluded deliberately:
 *  - `app_review` — dormant: the orchestrator blueprint still exists
 *    (`services/blueprints/app_review.py`) but the create option is hidden, so it
 *    must not be a filter chip either (you can't make one).
 *  - `lesson` — child-only: lessons are created via a course's "Add lesson", never
 *    as a top-level project, and surface only when drilling into a course.
 */
export const CREATABLE_PROJECT_TYPES = [
	'promo',
	'course',
	'website_review',
	'web_design',
	'web_design_v2',
	'demo_video',
	'showcase',
	'action_reel',
	'seo_audit',
	'cro_audit',
	'marketing_scorecard',
	'generic',
	'audiobook'
] as const satisfies readonly PickType[];

interface TypeBriefSpec {
	/** Brief keys the blueprint needs for real (non-stub / non-fail) output. */
	required: readonly string[];
	/** Where the deliverable duration is mirrored onto the brief, if anywhere. */
	durationKey?: 'target_duration_seconds' | 'duration_seconds';
	durationDefault?: number;
	/**
	 * Smallest deliverable duration (seconds) the wizard accepts for a VIDEO of
	 * this type.
	 *
	 * website_review was floored at 30s on the belief that a 10s order cannot fit
	 * an intro + a finding + a before/after. The backend accepts 10s, so the UI
	 * was refusing orders the API would have taken — which is why short orders
	 * behaved oddly. Owner decision: the floor is 10s everywhere, matching the
	 * orchestrator's server-side floor. A duration the server still rejects comes
	 * back as a typed 400 and is surfaced from `ApiError.detail`.
	 */
	minDurationSeconds?: number;
	/**
	 * The type pauses for operator review at its checkpoints unless the brief says
	 * `pause_for_review: false`. buildBrief always writes the explicit boolean
	 * (default true) so the backend never has to infer it from absence.
	 */
	pauseForReview?: boolean;
	/**
	 * Keeps the source URL on the brief as `source_url` (NOT `target_url`).
	 * Consumed by the orchestrator's opt-in `site_capture` stage (promo): it
	 * records the live site as background footage and scrapes its copy to
	 * ground the script. Unlike `urlToTargetUrl` types the URL is OPTIONAL —
	 * `source_url` is not in `required`, so the Source step accepts an empty
	 * value (see `sourceUrlOptional`).
	 */
	usesSourceUrl?: boolean;
	/** app_review / website_review: the URL is the inspection target → `brief.target_url`. */
	urlToTargetUrl?: boolean;
	/** audiobook: the Source step uploads a manuscript file → `brief.manuscript_ref`. */
	usesManuscript?: boolean;
	/** This type's footage is uploaded per-project via POST /api/projects/{id}/video-sources. */
	usesVideoSources?: boolean;
	/**
	 * The type's blueprint runs `source_ingest` (+ opt-in `media_discovery`), so
	 * the wizard shows the multi-source Sources step (websites / docs + the media
	 * finder). promo/generic ground their script directly; website_review grounds
	 * its review script alongside the required `target_url`; course grounds the
	 * outline AND propagates its sources onto each lesson child. Pinned/discovered
	 * media is ingested for all four but only composited into the video for
	 * promo/generic today (no real-media compositor elsewhere yet).
	 */
	multiSource?: boolean;
	/**
	 * The type offers a "generate review video" opt-in: the critique always runs;
	 * the video pipeline (redesign → script → TTS → compile) is optional. When set,
	 * the wizard collects `generateVideo` and `buildBrief` writes `generate_video`
	 * onto the brief — the orchestrator's video-subgraph stages skip themselves
	 * when it is false (critique + PDF only). website_review only.
	 */
	videoOptIn?: boolean;
	/**
	 * The type is a URL → deterministic scorecard audit (seo_audit / cro_audit /
	 * marketing_scorecard). `kind` labels the family; `scanOnly` is true when the
	 * type has NO narrated-video variant (marketing_scorecard) — its run is always
	 * report-first, so the wizard must not treat it as a video type. The single
	 * source of truth for `typeIsAudit` / `typeIsScanOnlyAudit`; the run-output
	 * hero + PDF are gated by payload SHAPE (`isAuditStage`), not this.
	 */
	audit?: { kind: 'seo' | 'cro' | 'marketing'; scanOnly: boolean };
}

export const TYPE_BRIEF: Record<BriefType, TypeBriefSpec> = {
	promo: {
		required: ['audience', 'value_proposition', 'call_to_action', 'target_duration_seconds'],
		durationKey: 'target_duration_seconds',
		durationDefault: 30,
		// Optional source site → brief.source_url → site_capture stage records it
		// as background footage + scrapes copy to ground the script.
		usesSourceUrl: true,
		multiSource: true
	},
	generic: {
		required: ['angle', 'audience', 'target_duration_seconds'],
		durationKey: 'target_duration_seconds',
		durationDefault: 60,
		multiSource: true
	},
	app_review: {
		required: ['target_url'],
		durationKey: 'duration_seconds',
		durationDefault: 120,
		urlToTargetUrl: true
	},
	website_review: {
		// website_review/critique.py reads brief.target_url; redesign defaults to
		// style "modern" when brief.redesign_style is absent; script.py reads
		// duration_seconds.
		required: ['target_url'],
		durationKey: 'duration_seconds',
		durationDefault: 120,
		minDurationSeconds: 10,
		pauseForReview: true,
		urlToTargetUrl: true,
		// Grounds website_review_script in extra sources alongside the required
		// target_url (the site being reviewed). target_url + sources coexist.
		multiSource: true,
		// The critique always runs; the narrated review video (redesign → script →
		// TTS → compile) is an opt-in. Default off — the fast path is critique + PDF.
		videoOptIn: true
	},
	course: {
		required: ['audience', 'outcome'],
		// Grounds course_outline AND each lesson child (sources propagated by
		// buildLessonChildren) in the operator's extra sources.
		multiSource: true
	},
	audiobook: {
		// audiobook_ingest reads brief.manuscript_ref (collected by the manuscript
		// upload step, not typed). No deliverable-driven duration — the audio
		// length is whatever the narration runs to.
		required: ['manuscript_ref'],
		usesManuscript: true
	},
	web_design: {
		// web_design stage reads brief.description (the design brief). Optional
		// brief.target_url (a reference URL) + redesign_style/page_type/audience are
		// collected in the Brief step. No source/sources/shotlist/video steps.
		required: ['description']
	},
	web_design_v2: {
		// web_design_v2 (computed-assembly + verified) blueprint: the `design` stage
		// requires brief.description (falls back to brief.angle) and reads optional
		// page_type / audience / interactivity / component_set / embeds / goals;
		// brand_extract reads optional brief.target_url as a reference site. Same
		// Brief-step shape as web_design — no source/voice/video steps.
		required: ['description']
	},
	demo_video: {
		// demo_video_gen reads brief.target_url (the app/site URL to demo) plus
		// optional focus_areas / max_scenarios_per_feature / auth_config from the
		// Brief step. No deliverable-driven duration — the length is whatever the
		// recorded scenarios + narration run to (like audiobook). Narrates each
		// scenario, so voice.voice_id is required.
		required: ['target_url'],
		urlToTargetUrl: true
	},
	showcase: {
		// Same backend stages as demo_video, two modes selected in the Source step:
		//  - generated: target_url only → demo_video_gen auto-generates the scenarios
		//    (reuses demo_video's focus_areas / max_scenarios / auth_config brief keys).
		//  - authored: target_url + an uploaded recording package (brief.package_url)
		//    + optional clip↔beat spine (brief.lines) → record re-runs the package live.
		// target_url is required either way; package_url/lines are optional authored
		// extras that ride through briefFields (set by RecordingPackageSource).
		required: ['target_url'],
		urlToTargetUrl: true
	},
	action_reel: {
		// ActionReelBlueprint (action_reel_v1): the operator's own clips are uploaded
		// per-project via POST /api/projects/{id}/video-sources AFTER create, so there
		// is nothing the Brief step must collect — `required` is empty (like audiobook's
		// Brief step, which is also field-less). music_select reads optional
		// brief.title/goal/audience/tone (+ brief.music.track_id to pin a bed) and
		// narrate reads optional brief.narration.lines; all ride through briefFields.
		// cut_plan's `_target_seconds` resolves brief.target_duration_seconds (after the
		// run config + deliverable descriptor) as the reel's target length.
		required: [],
		durationKey: 'target_duration_seconds',
		durationDefault: 45,
		usesVideoSources: true
	},
	seo_audit: {
		// seo_audit_scan reads brief.target_url (the site to audit). include_llm and
		// generate_video are optional boolean toggles collected in the Brief step and
		// ride through briefFields (no duration / voice / video steps by default — the
		// scorecard is the deliverable unless generate_video opts the narrated video in).
		required: ['target_url'],
		urlToTargetUrl: true,
		audit: { kind: 'seo', scanOnly: false }
	},
	cro_audit: {
		// cro_audit_scan reads brief.target_url. Same report-first shape as seo_audit;
		// include_llm / generate_video ride through briefFields.
		required: ['target_url'],
		urlToTargetUrl: true,
		audit: { kind: 'cro', scanOnly: false }
	},
	marketing_scorecard: {
		// marketing_scorecard_scan reads brief.target_url. Same report-first shape as
		// seo_audit / cro_audit but scan-only (no narrated-video variant); include_llm
		// rides through briefFields.
		required: ['target_url'],
		urlToTargetUrl: true,
		audit: { kind: 'marketing', scanOnly: true }
	},
	// Not creatable (absent from CREATABLE_PROJECT_TYPES — product decision
	// pending) but an API-created growth_bundle project still opens a workspace
	// whose brief form reads this spec. growth_bundle/handler.py's copywriter
	// allowlist reads call_to_action + cta_url (both optional).
	growth_bundle: {
		required: []
	}
};

/**
 * The brief spec for `type`, or undefined for a type with none (lesson, or a type
 * a newer orchestrator added before the FE learned it). Every reader goes through
 * this so a project of an unmapped type renders instead of throwing on
 * `TYPE_BRIEF[type].x`.
 */
export function typeBriefSpec(type: string): TypeBriefSpec | undefined {
	return (TYPE_BRIEF as Partial<Record<string, TypeBriefSpec>>)[type];
}

/**
 * The orchestrator's output resolution tiers (`motion_slides._TIER_SCALE`).
 * run_setup reads the tier off `brief.resolution` (a per-run override wins) and
 * normalizes it with `quality_tier` — anything else silently becomes the default
 * tier (2k). Nothing reads `theme.resolution`.
 */
export const RESOLUTION_TIERS = ['1080p', '2k', '4k'] as const;
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];

/** `value` as a known tier (case/whitespace-insensitive), else undefined. */
export function resolutionTier(value: unknown): ResolutionTier | undefined {
	if (typeof value !== 'string') return undefined;
	const v = value.trim().toLowerCase();
	return (RESOLUTION_TIERS as readonly string[]).includes(v) ? (v as ResolutionTier) : undefined;
}

/** Types whose pipeline narrates → `voice.voice_id` must be sent. Course narrates via lessons. */
export const REQUIRES_VOICE_ID: ReadonlySet<ProjectType> = new Set<ProjectType>([
	'promo',
	'generic',
	'app_review',
	'website_review',
	'lesson',
	'audiobook',
	'demo_video',
	'showcase'
]);

export function requiredBriefKeys(type: PickType): readonly string[] {
	return typeBriefSpec(type)?.required ?? [];
}

/**
 * True when the type's pipeline actually consumes a single URL — app_review and
 * website_review inspect the target URL. The wizard only shows the Source step
 * for these; promo/generic don't read a URL, so collecting one would be a dead
 * input. Flip on `usesSourceUrl` (and add an ingestion stage) to extend this.
 */
export function typeUsesSourceUrl(type: PickType): boolean {
	const spec = typeBriefSpec(type);
	return spec?.urlToTargetUrl === true || spec?.usesSourceUrl === true;
}

/**
 * True when the type's footage is uploaded per-project as video sources
 * (action_reel) via `POST /api/projects/{id}/video-sources` — i.e. AFTER the
 * project exists, unlike every other upload the wizard does. The Source step
 * renders the clip uploader for these.
 */
export function typeUsesVideoSources(type: PickType): boolean {
	return typeBriefSpec(type)?.usesVideoSources === true;
}

/** True when the type's Source step uploads a manuscript file (audiobook). */
export function typeUsesManuscript(type: PickType): boolean {
	return typeBriefSpec(type)?.usesManuscript === true;
}

/**
 * True when the type offers the "generate review video" opt-in (website_review):
 * the critique always runs, the video pipeline is optional. The wizard shows the
 * toggle (default off) and gates the video-only steps (shotlist / voice) on it.
 */
export function typeUsesVideoOptIn(type: PickType): boolean {
	return typeBriefSpec(type)?.videoOptIn === true;
}

/**
 * True when the type's blueprint ingests a multi-source list (websites / docs +
 * pinned/discovered media) → the wizard shows the Sources step. promo / generic /
 * website_review / course. Independent of `typeUsesTargetUrl`, so website_review
 * shows BOTH its required target-URL Source step and the Sources step.
 */
export function typeUsesMultiSource(type: PickType): boolean {
	return typeBriefSpec(type)?.multiSource === true;
}

/**
 * True when the type is a URL → scorecard audit (seo_audit / cro_audit /
 * marketing_scorecard). The wizard treats audits as report-first — the scorecard
 * is the deliverable and video is gated behind `brief.generate_video`, so
 * `producesVideo` must be false unless that flag is explicitly set.
 */
export function typeIsAudit(type: PickType): boolean {
	return typeBriefSpec(type)?.audit !== undefined;
}

/**
 * True for the scan-only audits with NO narrated-video variant
 * (marketing_scorecard). These never produce video regardless of any flag.
 */
export function typeIsScanOnlyAudit(type: PickType): boolean {
	return typeBriefSpec(type)?.audit?.scanOnly === true;
}

/**
 * True when the type REQUIRES a single inspection target URL → `brief.target_url`
 * (app_review / website_review). Drives the dedicated single-URL Source step,
 * kept separate from the multi-source Sources step.
 */
export function typeUsesTargetUrl(type: PickType): boolean {
	return typeBriefSpec(type)?.urlToTargetUrl === true;
}

/**
 * True when the Source URL is OPTIONAL — the `usesSourceUrl` types (promo) read
 * the URL via an opt-in stage, so an empty value is valid. `urlToTargetUrl`
 * types (app_review / website_review) inspect the URL and require it.
 */
export function sourceUrlOptional(type: PickType): boolean {
	const spec = typeBriefSpec(type);
	return spec?.usesSourceUrl === true && spec.urlToTargetUrl !== true;
}

// Keys that are NOT typed into the brief form: durations are derived from the
// deliverable, target_url comes from the Source step, manuscript_ref from the
// manuscript upload step.
const DERIVED_OR_SOURCE_KEYS: ReadonlySet<string> = new Set([
	'target_duration_seconds',
	'duration_seconds',
	'target_url',
	'manuscript_ref'
]);

/** Required brief keys the user must type in the Brief step (excludes derived/source keys). */
export function userBriefKeys(type: PickType): string[] {
	return (typeBriefSpec(type)?.required ?? []).filter((k) => !DERIVED_OR_SOURCE_KEYS.has(k));
}

export interface LessonDraft {
	title: string;
	learning_objective: string;
	duration_minutes: number;
	source_script?: string;
}

export interface VoiceInput {
	provider: string;
	/** Kokoro voice id (e.g. "af_heart") — read by every narrate/record stage. */
	voice_id: string;
	speed: number;
	/** Free-text tone hint — read as `voice.descriptor`. */
	descriptor?: string;
	/**
	 * Named speaker-role → kokoro voice_id map (showcase multi-voice dialogue).
	 * The orchestrator's dialogue stage looks up each beat's `speaker` here,
	 * falling back to `voice_id`. Empty for single-voice narration.
	 */
	cast?: Record<string, string>;
}

export interface BuildInput {
	type: PickType;
	title: string;
	titleHint: string;
	/** Per-type brief fields collected by BriefForm (audience, value_proposition, …). */
	briefFields: ProjectBrief;
	/** URL from the single-URL Source step ('' for course / multi-source types). */
	sourceUrl: string;
	/**
	 * Multi-source list from the Sources step (promo / generic / website_review /
	 * course): websites, uploaded documents, and pinned media. Ingested by the
	 * orchestrator's source_ingest stage. Empty for the single-URL / manuscript
	 * types.
	 */
	sources?: ProjectSource[];
	/** When true (multi-source types), set brief.media_discovery so the pipeline
	 *  also auto-discovers media during the run. */
	mediaDiscovery?: boolean;
	/** website_review (videoOptIn types): independent output opt-ins, written to
	 *  brief.generate_{critique,redesign,video}. Each toggles its stage in the
	 *  orchestrator; video implies redesign (enforced server-side). Undefined for
	 *  non-opt-in types (the flag is never written → orchestrator default-on). */
	generateCritique?: boolean;
	generateRedesign?: boolean;
	generateVideo?: boolean;
	/** Authored shotlist (promo / website_review). Attached to brief.shotlist after
	 *  cleaning; dropped entirely when nothing well-formed survives (opt-in, like
	 *  site_capture). The wizard passes undefined for non-shotlist types. */
	shotlist?: Shot[];
	/** Authored storyboard panels (generic / demo_video). Attached to
	 *  brief.storyboard after cleaning; dropped when nothing well-formed survives
	 *  (opt-in). The wizard passes undefined for non-storyboard types. */
	panels?: StoryboardPanelDraft[];
	deliverables: DeliverableInput[];
	voice: VoiceInput;
	brand: Record<string, unknown>;
	theme: Record<string, unknown>;
	/** Output resolution tier from the Look picker → `brief.resolution`. */
	resolution?: string;
	cloneFrom?: string;
}

const PLACEHOLDER_DELIVERABLE: DeliverableInput = {
	name: 'placeholder',
	format: '16x9',
	captions_mode: 'none'
};

// Audiobook deliverables are audio-only; the wizard hides the deliverable
// editor and we inject this single audio deliverable (mirrors how course
// injects a placeholder). format 'audio' is allowed by the orchestrator's
// ck_deliverables_format constraint (migration 0018).
const AUDIO_DELIVERABLE: DeliverableInput = {
	name: 'Audiobook',
	format: 'audio' as DeliverableInput['format'],
	captions_mode: 'none'
};

/**
 * Clean an authored shotlist for the brief. Mirrors the `sources` opt-in filter:
 * drop URL shots without a url and slide shots with no text at all, trim strings,
 * drop blank bullets, and strip empty optional directive keys so the emitted
 * shape matches the orchestrator's canonical contract (no empty strings). Returns
 * [] when nothing survives, so `buildBrief` omits the key entirely.
 */
export function cleanShotlist(shots: Shot[]): Shot[] {
	const out: Shot[] = [];
	for (const shot of shots) {
		const narration = (shot.narration ?? '').trim();
		if (shot.kind === 'url') {
			const url = (shot.url ?? '').trim();
			if (!url) continue; // a URL shot needs a url
			const d = shot.directives ?? { hold_ms: 3000, viewport: 'desktop' };
			const directives: UrlShot['directives'] = {
				hold_ms: d.hold_ms || 3000,
				viewport: d.viewport || 'desktop'
			};
			const scrollTo = (d.scroll_to ?? '').trim();
			const click = (d.click ?? '').trim();
			const waitFor = (d.wait_for ?? '').trim();
			if (scrollTo) directives.scroll_to = scrollTo;
			if (click) directives.click = click;
			if (waitFor) directives.wait_for = waitFor;
			out.push({ kind: 'url', url, narration, directives });
		} else {
			const s = shot.slide ?? { template: 'title' };
			const bullets = (s.bullets ?? []).map((b) => b.trim()).filter((b) => b.length > 0);
			const eyebrow = (s.eyebrow ?? '').trim();
			const title = (s.title ?? '').trim();
			const body = (s.body ?? '').trim();
			const ctaUrl = (s.cta_url ?? '').trim();
			// Keep a slide shot only when it carries some content or narration.
			if (!narration && !title && !eyebrow && !body && !ctaUrl && bullets.length === 0) continue;
			const slide: SlideShot['slide'] = { template: s.template || 'title' };
			if (eyebrow) slide.eyebrow = eyebrow;
			if (title) slide.title = title;
			if (body) slide.body = body;
			if (ctaUrl) slide.cta_url = ctaUrl;
			if (bullets.length > 0) slide.bullets = bullets;
			out.push({ kind: 'slide', narration, slide });
		}
	}
	return out;
}

/**
 * True when the brief carries at least one non-empty STRING — the gate for the
 * storyboard "Draft from brief" button. The orchestrator's `_brief_text`
 * (services/storyboard/assist.py) falls back to ANY scalar, numbers included, so
 * a brief holding only `target_duration_seconds: 30` would be "drafted" from the
 * string "target_duration_seconds: 30". Every wizard-built brief carries a
 * duration number, so counting numbers left the button permanently enabled.
 * Only string values count here; numbers / booleans / objects are ignored.
 */
export function briefHasDraftableText(brief: Record<string, unknown> | null | undefined): boolean {
	return Object.values(brief ?? {}).some((v) => typeof v === 'string' && v.trim().length > 0);
}

/** A JSON-ish value is "empty" when it carries no authored content. */
function isEmptyValue(v: unknown): boolean {
	if (v == null) return true;
	if (typeof v === 'string') return v.trim().length === 0;
	if (typeof v === 'number') return !Number.isFinite(v);
	if (Array.isArray(v)) return v.length === 0;
	if (typeof v === 'object') return Object.keys(v as object).length === 0;
	return false;
}

/**
 * Clean an authored clip↔beat spine (showcase). Mirrors `cleanShotlist`: drop
 * beats with no narration text, trim strings, ensure a stable id, coerce the
 * numeric fields, and strip empty optional keys so the emitted shape matches the
 * orchestrator's ShowcaseLine contract (no empty strings). Returns [] when nothing
 * survives, so `buildBrief` omits `lines` entirely (→ generated / auto-narrate mode).
 *
 * EVERY authored key rides through — not a whitelist. The orchestrator's
 * `AuthoredLine` carries ~35 per-beat overrides (locked / pin / beat_role /
 * clip_out_seconds / expected_text / min_seconds / max_seconds / vo_rate / …) and
 * `showcase_slides` reads the raw `brief.lines[*].card` block (not even a model
 * field). A whitelist here silently dropped all of them, so no authored showcase
 * ever got a branded card. Only empty values (''/null/[]/{}) are stripped.
 */
export function cleanLines(lines: ShowcaseLine[]): ShowcaseLine[] {
	const out: ShowcaseLine[] = [];
	lines.forEach((line, idx) => {
		const text = (line.text ?? '').trim();
		if (!text) return; // a beat needs narration
		const extra: Record<string, unknown> = {};
		for (const [key, raw] of Object.entries(line as Record<string, unknown>)) {
			if (key === 'id' || key === 'text' || key === 'seconds') continue;
			const value = typeof raw === 'string' ? raw.trim() : raw;
			if (isEmptyValue(value)) continue;
			extra[key] = value;
		}
		// clip_anchor is the Literal 'end' | 'auto' or unset.
		if (extra.clip_anchor !== 'end' && extra.clip_anchor !== 'auto') delete extra.clip_anchor;
		// A non-positive head skip is "unset" (the compiler plays from the start).
		if ('clip_lead_seconds' in extra) {
			const lead = Number(extra.clip_lead_seconds);
			if (lead > 0) extra.clip_lead_seconds = lead;
			else delete extra.clip_lead_seconds;
		}
		// `card` must be a non-empty object (showcase_slides skips anything else).
		if ('card' in extra && (typeof extra.card !== 'object' || Array.isArray(extra.card))) {
			delete extra.card;
		}
		out.push({
			...extra,
			id: (line.id ?? '').trim() || `clip-${idx + 1}`,
			text,
			seconds: Number(line.seconds) || 0
		} as ShowcaseLine);
	});
	return out;
}

/**
 * Clean an authored storyboard for the brief. Mirrors `cleanShotlist` /
 * `cleanLines`: drop panels with no authored content, trim strings, coerce
 * duration, strip empty optional keys, and (re)assign the `clip-<n>` spine id by
 * surviving position so the emitted `brief.storyboard` shape matches what the
 * orchestrator's `authored_storyboard.storyboard_panels(brief)` reads. Returns []
 * when nothing survives, so `buildBrief` omits the key entirely.
 */
export function cleanPanels(panels: StoryboardPanelDraft[]): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	panels.forEach((panel) => {
		const action = (panel.action_description ?? '').trim();
		const dialogue = (panel.dialogue ?? '').trim();
		const voText = (panel.vo_text ?? '').trim();
		const shotNumber = (panel.shot_number ?? '').trim();
		const hasContent =
			action ||
			dialogue ||
			voText ||
			shotNumber ||
			panel.shot_size ||
			panel.angle ||
			panel.movement ||
			panel.transition_out ||
			(panel.duration_seconds != null && Number(panel.duration_seconds) > 0);
		if (!hasContent) return; // an empty panel is a no-op
		const dict: Record<string, unknown> = { shot_key: `clip-${out.length + 1}` };
		if (action) dict.action_description = action;
		if (dialogue) dict.dialogue = dialogue;
		if (voText) dict.vo_text = voText;
		if (shotNumber) dict.shot_number = shotNumber;
		if (panel.shot_size) dict.shot_size = panel.shot_size;
		if (panel.angle) dict.angle = panel.angle;
		if (panel.movement) dict.movement = panel.movement;
		if (panel.transition_out) dict.transition_out = panel.transition_out;
		if (panel.duration_seconds != null && Number(panel.duration_seconds) > 0) {
			dict.duration_seconds = Number(panel.duration_seconds);
		}
		if (panel.status) dict.status = panel.status;
		out.push(dict);
	});
	return out;
}

/** Minimum deliverable duration (seconds) for this type's video, or null for no floor. */
export function minDurationSecondsFor(type: PickType): number | null {
	return typeBriefSpec(type)?.minDurationSeconds ?? null;
}

/** Build the project's `brief` with exactly the keys its blueprint reads. */
export function buildBrief(input: BuildInput): ProjectBrief {
	const spec = TYPE_BRIEF[input.type];
	const brief: ProjectBrief = { ...input.briefFields };

	if (spec.durationKey) {
		const d = input.deliverables[0]?.target_duration_seconds ?? spec.durationDefault;
		if (d != null) brief[spec.durationKey] = d;
	}

	const url = input.sourceUrl.trim();
	if (url) {
		if (spec.urlToTargetUrl) brief.target_url = url;
		else if (spec.usesSourceUrl) brief.source_url = url;
	}

	// Multi-source list (promo/generic). Keep only well-formed entries.
	const sources = (input.sources ?? []).filter((s) => s.ref.trim().length > 0);
	if (sources.length > 0) {
		brief.sources = sources.map((s) => ({ ...s, ref: s.ref.trim() }));
		// Back-compat for promo: mirror the first URL source onto source_url so the
		// opt-in site_capture stage still records footage of the primary site.
		// source_ingest skips that exact URL to avoid a double fetch.
		if (spec.usesSourceUrl && !brief.source_url) {
			const firstUrl = sources.find((s) => s.kind === 'url');
			if (firstUrl) brief.source_url = firstUrl.ref.trim();
		}
	}

	if (input.mediaDiscovery) brief.media_discovery = {};

	// Output resolution tier. The orchestrator reads ONLY `brief.resolution`
	// (run_setup), never `theme.resolution` — the picker's value used to ride on
	// the theme and was dropped, so every order rendered at the default tier.
	// audiobook is audio-only (no render). An unknown value is omitted (the
	// orchestrator would coerce it to its default anyway).
	const tier = resolutionTier(input.resolution);
	if (tier && input.type !== 'audiobook') brief.resolution = tier;

	// Authored shotlist (promo / website_review). Opt-in: only attach when at least
	// one well-formed shot survives cleaning, so an empty editor leaves the legacy
	// auto/site_capture path untouched.
	const shots = cleanShotlist(input.shotlist ?? []);
	if (shots.length > 0) brief.shotlist = shots;

	// Authored storyboard (generic / demo_video). Opt-in: only attach when at least
	// one well-formed panel survives, so an empty board leaves the legacy auto-direct
	// path untouched. Key MUST be `storyboard` — the generic script_draft +
	// demo_video gen short-circuits read `brief["storyboard"]`.
	const panels = cleanPanels(input.panels ?? []);
	if (panels.length > 0) brief.storyboard = panels;

	// Authored clip↔beat spine (showcase authored mode). Opt-in: prune half-filled
	// beats; an empty editor drops `lines` so the pipeline auto-narrates the package.
	const lines = cleanLines(input.briefFields.lines ?? []);
	if (lines.length > 0) brief.lines = lines;
	else delete brief.lines;

	// Multi-voice showcase: a cast of >=2 roles is a two-hander, which the
	// orchestrator only honours when `brief.dialogue.enabled` is set (its
	// `dialogue_cast` predicate returns None otherwise → one voice reads every
	// line). Showcase has no Dialogue toggle (DialogueSection is course-only), so
	// the cast itself is the opt-in. Never turns an authored `enabled:false` on.
	if (input.type === 'showcase' && Object.keys(input.voice.cast ?? {}).length >= 2) {
		if (brief.dialogue?.enabled !== false) brief.dialogue = { ...brief.dialogue, enabled: true };
	}

	// Output opt-ins (website_review): write the three flags explicitly so the
	// orchestrator skips the stages whose output wasn't requested. Only set for
	// videoOptIn types — every other type leaves them absent (orchestrator = on).
	// Review checkpoints (website_review: after the redesign and after the script).
	// Default ON — only an explicit `false` from the wizard toggle opts out.
	if (spec.pauseForReview) {
		brief.pause_for_review = input.briefFields.pause_for_review !== false;
	}

	if (spec.videoOptIn) {
		brief.generate_critique = input.generateCritique === true;
		brief.generate_redesign = input.generateRedesign === true;
		brief.generate_video = input.generateVideo === true;
	}

	return brief;
}

function buildVoice(voice: VoiceInput): Record<string, unknown> {
	return {
		provider: voice.provider,
		voice_id: voice.voice_id,
		speed: voice.speed,
		...(voice.descriptor?.trim() ? { descriptor: voice.descriptor.trim() } : {}),
		...(voice.cast && Object.keys(voice.cast).length ? { cast: voice.cast } : {})
	};
}

export function buildProjectRequest(input: BuildInput): CreateProjectRequest {
	return {
		title: input.title.trim() || input.titleHint || 'New project',
		type: input.type,
		visibility: 'tenant',
		brief: buildBrief(input),
		brand: input.brand,
		voice: buildVoice(input.voice),
		theme: input.theme,
		// Courses own no deliverables — each lesson child carries its own. Send one
		// placeholder so the course row + its run target are valid. Audiobooks are
		// audio-only → inject the single audio deliverable.
		deliverables:
			input.type === 'course'
				? [PLACEHOLDER_DELIVERABLE]
				: input.type === 'audiobook'
					? [AUDIO_DELIVERABLE]
					: input.deliverables,
		...(input.cloneFrom ? { clone_from_project_id: input.cloneFrom } : {})
	};
}

/**
 * The finalize PATCH for a wizard draft (`PATCH /projects/{id}`): the authored
 * brief/config of the full create request, plus `clone_from_project_id` when the
 * operator picked "Clone settings from". The draft flow creates the project
 * before Review, so without the clone id HERE the select was silently dropped
 * (only `POST /projects` carried it). w2v_orchestrator#1116 accepts it on PATCH:
 * cloned values are the base, this body (and the draft's current values) win.
 */
export function buildFinalizePatch(req: CreateProjectRequest): UpdateProjectRequest {
	return {
		title: req.title,
		brief: req.brief,
		brand: req.brand,
		voice: req.voice,
		theme: req.theme,
		...(req.clone_from_project_id ? { clone_from_project_id: req.clone_from_project_id } : {})
	};
}

/** `error.details.code` of the 404 for an unknown / other-tenant clone source. */
export const CLONE_SOURCE_NOT_FOUND = 'clone_source_not_found';

/**
 * The person-facing message for a create/draft/PATCH refused because the
 * "Clone settings from" project no longer exists (or is not in this workspace),
 * or null for any other error. Duck-typed on `status` + `details` (ApiError).
 */
export function cloneSourceNotFoundMessage(err: unknown): string | null {
	if (typeof err !== 'object' || err === null) return null;
	const e = err as { status?: unknown; details?: unknown; code?: unknown };
	if (e.status !== 404) return null;
	const details = e.details as { code?: unknown } | undefined;
	if (details?.code !== CLONE_SOURCE_NOT_FOUND && e.code !== CLONE_SOURCE_NOT_FOUND) return null;
	return 'The project you chose under “Clone settings from” no longer exists or is not in this workspace. Pick another project there, or clear it, and try again.';
}

/**
 * Lesson children for a course. Each MUST carry a deliverable: run_engine skips
 * children without one (`if not full.deliverables: continue`), which would make
 * the course outline empty.
 *
 * The orchestrator does NOT inherit course→lesson config, so anything the lesson
 * pipeline needs is written onto each child's brief here:
 * - `opts.dialogue` (the course brief's two-voice flag) → `dialogue.enabled` so
 *   lesson_script/lesson_narrate render the Socratic two-voice mode.
 * - `opts.sources` / `opts.mediaDiscovery` (the course's multi-source grounding)
 *   → `sources` / `media_discovery` so each lesson's opt-in source_ingest stage
 *   grounds lesson_script in the same material the course outline used.
 * - `opts.aiVideoGen` (the course brief's AI-video opt-in) → `ai_video_gen` so
 *   each lesson's opt-in ai_video_gen stage renders generative B-roll. The block
 *   must be TRUTHY: run_setup lifts `brief.ai_video_gen` only when truthy and the
 *   stage skips on a falsy config, so an empty `{}` is a no-op — the toggle writes
 *   `{ enabled: true }`. Prompts are derived per-lesson from each lesson's title.
 * - `opts.resolution` / `opts.kenBurns` (the course brief's `resolution` tier and
 *   `ken_burns` block) → the same keys on each child. run_setup reads the tier
 *   off the project BRIEF (`brief.resolution`), per run — a lesson run never sees
 *   its parent's brief, so a 2k/4k course otherwise got lessons rendered at the
 *   default tier and course_stitch concatenated (upscaled) them into the master.
 */
export function buildLessonChildren(
	lessons: LessonDraft[],
	opts: {
		dialogue?: ProjectBrief['dialogue'];
		sources?: ProjectSource[];
		mediaDiscovery?: boolean;
		aiVideoGen?: ProjectBrief['ai_video_gen'];
		resolution?: unknown;
		kenBurns?: ProjectBrief['ken_burns'];
	} = {}
): CreateChildProjectRequest[] {
	const twoVoice = opts.dialogue?.enabled === true;
	const resolution = typeof opts.resolution === 'string' ? opts.resolution.trim() : '';
	const sources = (opts.sources ?? [])
		.filter((s) => s.ref.trim().length > 0)
		.map((s) => ({ ...s, ref: s.ref.trim() }));
	return lessons
		.filter((l) => l.title.trim().length > 0)
		.map((l) => ({
			type: 'lesson',
			title: l.title.trim(),
			brief: {
				learning_objective: l.learning_objective.trim() || 'Learn the topic.',
				duration_minutes: l.duration_minutes,
				...(l.source_script?.trim() ? { source_script: l.source_script.trim() } : {}),
				...(twoVoice ? { dialogue: { enabled: true } } : {}),
				...(sources.length > 0 ? { sources } : {}),
				...(opts.mediaDiscovery ? { media_discovery: {} } : {}),
				...(opts.aiVideoGen ? { ai_video_gen: opts.aiVideoGen } : {}),
				...(resolution ? { resolution } : {}),
				...(opts.kenBurns ? { ken_burns: opts.kenBurns } : {})
			},
			deliverables: [
				{
					name: `${l.title.trim()} video`,
					format: '16x9',
					captions_mode: 'none',
					target_duration_seconds: Math.round(l.duration_minutes * 60)
				}
			]
		}));
}

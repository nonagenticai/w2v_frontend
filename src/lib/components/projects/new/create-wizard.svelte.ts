// Create-project wizard state, extracted from projects/new/+page.svelte as a
// shared runes store (module singleton class) so each wizard step subcomponent
// reads/writes the same state without deep prop-drilling. Mirrors the existing
// `wizard` store pattern ($lib/stores/wizard.svelte.ts) — a class instance with
// $state fields exported as a singleton.
//
// This store owns the local form state + the pure derivations + the pure
// state-mutation methods. Side-effecting flows that need route data / lifecycle
// (onMount seeding, submit → API + navigation) stay in +page.svelte.
//
// Because it is a module singleton (persists across navigations, like `wizard`),
// +page.svelte MUST call `reset()` onMount to restore first-visit state — the
// original local $state was fresh on every component mount. That reset is
// bracketed by `takePersisted()` / `resume()`: a page RELOAD (where the
// singleton is genuinely fresh) re-attaches to a still-live draft project
// instead of orphaning it, while a client-side navigation in still gets the
// clean wizard the reset was written for. See § Crash/reload recovery below.

import type {
	CaptionsMode,
	DeliverableInput,
	ProjectBrief,
	ProjectDetailResponse,
	ProjectSource,
	ProjectType,
	Shot,
	StoryboardPanelDraft
} from '$lib/types';
import { ApiError, projects as projectsApi, uploads, type VideoSourceResponse } from '$lib/api';
import { createDraft, update as projectsUpdate } from '$lib/stores/projects.svelte.js';
import {
	buildProjectRequest,
	cloneSourceNotFoundMessage,
	minDurationSecondsFor,
	userBriefKeys,
	typeIsAudit,
	typeUsesManuscript,
	typeUsesMultiSource,
	typeUsesTargetUrl,
	typeUsesVideoOptIn,
	typeUsesVideoSources,
	sourceUrlOptional,
	type BuildInput,
	type LessonDraft,
	type PickType
} from '$lib/studio/project-request';
import { wizardControls, type WizardControls } from '$lib/studio/create-wizard-controls';
import { wizard } from '$lib/stores/wizard.svelte.js';
import { isValidUrl } from '$lib/utils/validation';
import { extractHostname } from '$lib/utils/format';

export type StepKey =
	| 'type'
	| 'sources'
	| 'source'
	| 'shotlist'
	| 'beats'
	| 'storyboard'
	| 'brief'
	| 'lessons'
	| 'review';

// --- Crash/reload recovery -------------------------------------------------
//
// A pre-created draft project is REAL server state: for action_reel it already
// holds the operator's uploaded clips (gigabytes), and for the storyboard path
// it holds authored panels. Before this existed, `reset()` on every mount meant
// a refresh silently ABANDONED that draft — the wizard came back empty and the
// operator re-uploaded everything into a second draft. So the draft id (plus
// just enough form state to make resuming coherent) is mirrored into
// sessionStorage: same tab, cleared when the tab closes, never shared.
//
// The WHOLE wizard is mirrored once the operator has moved past the Type step
// (or a draft exists): a reload used to restore only the draft id, brief, title
// and step, silently dropping sources, deliverables, lessons, shotlist, cast …
// (ui-review 2026-10-17 X6). v1 snapshots (draft-only) still load; their missing
// fields keep the reset defaults.
const PERSIST_KEY = 'w2v:create-wizard';

/** The `wizard` settings-store fields the create flow submits (voice/brand/theme). */
type PersistedSettings = {
	ttsProvider: string;
	voice: string;
	narrationSpeed: number;
	theme: string;
	brandColor: string;
	resolution: string;
	frameRate: string;
	videoQuality: number;
	transitionType: string;
};

type PersistedWizard = {
	v: 1 | 2;
	/** '' when no draft has been pre-created. */
	projectId: string;
	projectType: ProjectType;
	title: string;
	brief: ProjectBrief;
	stepIndex: number;
	sourceUrl: string;
	showcaseMode: 'generated' | 'authored';
	videoSources: VideoSourceResponse[];
	// v2
	cloneFrom?: string;
	deliverables?: DeliverableInput[];
	lessons?: LessonDraft[];
	sources?: ProjectSource[];
	mediaDiscovery?: boolean;
	generateCritique?: boolean;
	generateRedesign?: boolean;
	generateVideo?: boolean;
	shotlist?: Shot[];
	panels?: StoryboardPanelDraft[];
	cast?: { name: string; voice: string }[];
	clipRoster?: string[];
	createdDeliverableIds?: string[];
	settings?: PersistedSettings;
};

/**
 * The deliverable a type starts with. demo_video / showcase treat the deliverable
 * duration as an ORDERED length (gen.py `_target_seconds`, duration_conformance
 * `demo_video_ordered_seconds`), so they start with none — a length is ordered
 * only when the operator types one (ui-review X4).
 */
/**
 * True when the current document was loaded by a reload or back/forward of the
 * page the user is on now — the only arrivals that mean "resume the wizard I was
 * in". A fresh navigation (typed URL, link, bookmark) or a reload of a different
 * page followed by a client-side visit is a NEW wizard. Environments without
 * Navigation Timing (no entry) keep the old resume-if-pristine behaviour, so a
 * missing API can never cost an operator their draft.
 */
function documentWasReloadedHere(): boolean {
	if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
		return true;
	}
	const nav = performance.getEntriesByType('navigation')[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (!nav) return true;
	if (nav.type !== 'reload' && nav.type !== 'back_forward') return false;
	try {
		return typeof location === 'undefined' || new URL(nav.name).pathname === location.pathname;
	} catch {
		return true;
	}
}

export function defaultDeliverablesFor(type: ProjectType): DeliverableInput[] {
	if (type === 'demo_video' || type === 'showcase') {
		return [{ name: 'Horizontal', format: '16x9', target_duration_seconds: null }];
	}
	return [{ name: '60s horizontal', format: '16x9', target_duration_seconds: 60 }];
}

/**
 * What a type that makes NO video submits as its deliverable. A run is started
 * per deliverable, so these types still need one row — but never the hidden
 * "60s horizontal" video it used to inherit (ui-review X4): no duration, no
 * captions, named for what the run actually produces.
 */
function nonVideoDeliverable(type: ProjectType): DeliverableInput {
	const name =
		type === 'web_design' || type === 'web_design_v2'
			? 'Web page'
			: type === 'website_review'
				? 'Review report'
				: 'Scorecard';
	return { name, format: '16x9', captions_mode: 'none' };
}

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof ApiError ? err.detail : err instanceof Error ? err.message : fallback;
}

class CreateWizard {
	// --- Form state ---
	title = $state('');
	projectType = $state<ProjectType>('promo');
	brief = $state<ProjectBrief>({});
	cloneFrom = $state<string>('');
	// No `captions_mode`: an unpicked caption mode is omitted so the orchestrator
	// applies the workspace default (P6). `defaultCaptionsMode` is only what the
	// captions select shows as "Workspace default (…)".
	deliverables = $state<DeliverableInput[]>(defaultDeliverablesFor('promo'));
	defaultCaptionsMode = $state<CaptionsMode | null>(null);
	lessons = $state<LessonDraft[]>([{ title: '', learning_objective: '', duration_minutes: 6 }]);
	// Multi-source list (promo/generic): websites + uploaded documents + pinned
	// media. Ingested by the orchestrator source_ingest stage.
	sources = $state<ProjectSource[]>([]);
	mediaDiscovery = $state(false);
	// website_review independent output opt-ins. Critique (findings + PDF) is on by
	// default — the fast path. Redesign (new HTML + before/after) and the narrated
	// Video are off by default. Video implies redesign (the narrated review IS the
	// before→after of the redesign), enforced via `producesRedesign` below.
	generateCritique = $state(true);
	generateRedesign = $state(false);
	generateVideo = $state(false);
	// Authored shotlist (promo / website_review): an ordered list of URL shots and
	// slides the operator directs by hand. Attached to brief.shotlist (opt-in).
	shotlist = $state<Shot[]>([]);
	// Authored storyboard (generic / demo_video): an ordered list of shot panels the
	// operator directs by hand. Serialized to brief.storyboard (opt-in); the generic
	// script_draft + demo_video gen short-circuits render from it when present.
	panels = $state<StoryboardPanelDraft[]>([]);
	showAdvanced = $state(false);
	isSubmitting = $state(false);
	submitError = $state('');
	stepIndex = $state(0);
	// Storyboard path only: when the user reaches the storyboard step for a
	// `generic` project we PRE-CREATE a `drafting` project so the step renders
	// the real project-scoped storyboard UI (scenes/assets/AI-draft) live. The
	// Review submit then finalizes this draft (PATCH + add deliverables + run)
	// instead of creating from scratch. `null` on every other type ⇒ the
	// unchanged create-at-submit path.
	projectId = $state<string | null>(null);
	draftProject = $state<ProjectDetailResponse | null>(null);
	// In-flight guard so a re-fired step effect (or an impatient Retry click)
	// can't race a second draft POST. `$state` because the Retry button renders
	// its pending state from it.
	draftPending = $state(false);
	// Why the draft pre-create failed, kept SEPARATE from `submitError` so the
	// Source step can offer a Retry for exactly this failure (and so a later
	// submit failure doesn't leave a stale retry affordance on screen).
	draftError = $state('');
	// Guards the sessionStorage write until the mount has decided between
	// resume and clean-wizard — otherwise the first effect run would overwrite
	// the snapshot we are about to read with the freshly reset (empty) state.
	private persistArmed = false;
	// Deliverable ids already created during a finalize attempt — lets a retry
	// after a mid-finalize failure resume instead of re-adding duplicates.
	createdDeliverableIds = $state<string[]>([]);
	// Showcase has two Source-step modes: 'generated' (auto-generate the walkthrough
	// from the target URL, like demo_video) or 'authored' (upload a hand-crafted
	// recording package + optional clip↔beat spine). Mode is UI-only; the backend
	// infers it from brief.package_url / brief.lines presence.
	showcaseMode = $state<'generated' | 'authored'>('generated');
	// Footage-clip roster parsed from the uploaded package (@clip-<n> tags → clip-<n>
	// join keys). Threaded Source step → Beats step so the clip↔beat editor offers a
	// <select> of real clips. UI-only, never submitted.
	clipRoster = $state<string[]>([]);
	// Named voice cast (showcase): ordered role → kokoro voice rows the author defines
	// so each beat's speaker can be a named character (Mark/Lisa/…) with its own voice,
	// instead of the old fixed a/b toggle. Serialized into `voice.cast` at submit; the
	// role names also populate the clip↔beat editor's Speaker dropdown. Empty ⇒
	// single-voice narration (the global voice), so it never blocks non-cast flows.
	cast = $state<{ name: string; voice: string }[]>([]);
	// action_reel only: the clips already registered against the pre-created draft
	// project (POST /api/projects/{id}/video-sources). Server-owned rows, NOT brief
	// state — they persist the moment they upload and are never submitted. Held
	// here so the Source step's validation (≥1 clip) can see them.
	videoSources = $state<VideoSourceResponse[]>([]);

	// --- Derived flags ---
	get isCourse(): boolean {
		return this.projectType === 'course';
	}
	get isAudiobook(): boolean {
		return this.projectType === 'audiobook';
	}
	get isShowcase(): boolean {
		return this.projectType === 'showcase';
	}
	get hasPackage(): boolean {
		return typeof this.brief.package_url === 'string' && this.brief.package_url.trim().length > 0;
	}
	// web_design + web_design_v2 are brief→HTML types: no source/sources/shotlist/
	// video/deliverable steps — just the Brief (description + optional reference
	// URL) → Review.
	get isWebDesign(): boolean {
		return this.projectType === 'web_design' || this.projectType === 'web_design_v2';
	}
	get pickType(): PickType {
		return this.projectType as PickType;
	}
	/** Which optional controls this type's pipeline actually reads (one table). */
	get controls(): WizardControls {
		return wizardControls(this.pickType);
	}
	// seo_audit / cro_audit / marketing_scorecard are report-first: the scorecard is the
	// deliverable, not a video. So they must NOT force a video deliverable + voice by
	// default — the video chain is opt-in via the BriefForm `generate_video` toggle
	// (seo/cro only; marketing_scorecard is scan-only). Descriptor-driven so a new audit
	// type can't drift back into being treated as a video type.
	get isAudit(): boolean {
		return typeIsAudit(this.pickType);
	}
	// website_review offers the "generate review video" opt-in: the critique always
	// runs; the video pipeline is optional (default off → critique + PDF only).
	get usesVideoOptIn(): boolean {
		return typeUsesVideoOptIn(this.pickType);
	}
	// True when this run will actually produce a video: every non-opt-in video type
	// always does; website_review only when the operator turned the video on; an audit
	// only when its brief.generate_video toggle is on (default off → scorecard-only).
	// When false the wizard hides EVERY video-only config — grounding sources, shotlist,
	// deliverable format/captions, and the narration/theme settings.
	get producesVideo(): boolean {
		return (
			!this.isWebDesign &&
			(this.isAudit
				? this.brief.generate_video === true
				: !this.usesVideoOptIn || this.generateVideo)
		);
	}
	// True when a redesign will run — directly requested, or implied by the video.
	// Drives the redesign-style brief field (the only redesign-specific input).
	get producesRedesign(): boolean {
		return !this.usesVideoOptIn || this.generateRedesign || this.generateVideo;
	}
	// website_review must pick at least one output; everything else always has one.
	get hasOutput(): boolean {
		return (
			!this.usesVideoOptIn || this.generateCritique || this.generateRedesign || this.generateVideo
		);
	}
	// Audiobooks are audio-only — the wizard injects a single audio deliverable
	// (project-request.ts), so the deliverable editor is hidden like for courses.
	// A critique-only website_review hides it too (the default deliverable still
	// rides through buildProjectRequest; only its video config is suppressed).
	get needsDeliverables(): boolean {
		return !this.isCourse && !this.isAudiobook && this.producesVideo;
	}
	// Multi-source Sources step (websites/PDFs/books + the media finder) — the
	// types whose blueprints run source_ingest + media_discovery: promo, generic,
	// website_review, course. For course it also grounds each lesson child. For
	// website_review the sources only ground the video SCRIPT (the critique reads
	// just the target URL), so they're hidden on a critique-only run.
	get usesMultiSource(): boolean {
		return typeUsesMultiSource(this.pickType) && this.producesVideo;
	}
	// Single-URL / manuscript Source step: app_review + website_review (inspect one
	// target URL) + audiobook (upload a manuscript). INDEPENDENT of usesMultiSource
	// so website_review shows BOTH its target-URL step and the Sources step. Course
	// has no single-source step (it owns lessons + grounds via Sources).
	get usesSingleSource(): boolean {
		return (
			!this.isCourse &&
			(typeUsesTargetUrl(this.pickType) ||
				typeUsesManuscript(this.pickType) ||
				this.usesVideoSources)
		);
	}
	// action_reel: the operator brings their OWN footage, so the Source step is a
	// clip uploader instead of a URL box — the same shape as audiobook's manuscript
	// upload, except the endpoint is PROJECT-scoped, so the step must pre-create a
	// draft project first (see ensureDraftProject).
	get usesVideoSources(): boolean {
		return typeUsesVideoSources(this.pickType);
	}
	// promo/generic composite pinned/discovered media into the video.
	get usesMediaRendered(): boolean {
		return this.projectType === 'promo' || this.projectType === 'generic';
	}
	// What the Find-media panel promises will happen to pinned media, per type.
	// `null` = the plain promo/generic case, which needs no caveat.
	//
	// website_review DOES put real media on screen — `website_review/compile.py`
	// `collect_real_media_urls` + `assign_real_media_by_line` overlay pinned /
	// discovered images & clips onto the full-page SCROLL fallback lines (viewport
	// screenshots and reveal clips are protected and never displaced). This panel
	// claimed the opposite ("ingested but not shown on screen yet") and that copy
	// was simply false for the type most likely to pin media.
	//
	// The remaining multi-source types (course &c.) really do only ingest it, so
	// they keep the original caveat.
	get pinnedMediaNote(): string | null {
		if (this.usesMediaRendered) return null;
		if (this.projectType === 'website_review') {
			return '(Shown on screen in the review video, replacing the full-page scrolling shots — your site screenshots are never displaced.)';
		}
		return '(Composited into the video for promo & generic; for this type it is ingested and used as grounding, but not shown on screen yet.)';
	}
	// Authored shotlist step: URL/site-driven video types where directing shot by
	// shot makes sense (promo + website_review). Gated on producesVideo — a
	// critique-only website_review has no video to storyboard. The orchestrator
	// runs the shotlist deterministically when present; an empty editor is a no-op.
	get usesShotlist(): boolean {
		return (
			(this.projectType === 'promo' || this.projectType === 'website_review') && this.producesVideo
		);
	}
	// Authored clip↔beat editor step: showcase in authored mode only. The beats bind
	// to brief.lines; an empty editor is a no-op (the pipeline auto-narrates the
	// package's scenarios). Generated mode has no package to bind beats to.
	get usesBeats(): boolean {
		return this.isShowcase && this.showcaseMode === 'authored';
	}
	// Authored storyboard step: generic only — the freeform video type with no
	// existing authoring step, whose script_draft short-circuits from
	// brief.storyboard. Gated on producesVideo; an empty board is a no-op (the
	// pipeline auto-directs from the brief). demo_video also consumes a storyboard
	// but authors it post-create via the workspace section (its create flow is a
	// screen-recording Target-URL walkthrough); showcase authors via the clip↔beat
	// editor (brief.lines), not the storyboard table.
	get usesStoryboard(): boolean {
		return this.projectType === 'generic' && this.producesVideo;
	}
	// Named cast serialized for `voice.cast` — role name → voice id, dropping blank
	// rows and de-duping by trimmed name (last write wins, mirroring AudiobookSource).
	get castMap(): Record<string, string> {
		const map: Record<string, string> = {};
		for (const row of this.cast) {
			const name = row.name.trim();
			if (name && row.voice) map[name] = row.voice;
		}
		return map;
	}
	// Role names for the clip↔beat editor's Speaker dropdown (in author order).
	get castRoles(): string[] {
		return this.cast.map((r) => r.name.trim()).filter(Boolean);
	}

	// --- Step model ---
	// The type is the spine: it picks the blueprint AND the step sequence. Courses
	// hold no deliverables of their own — they own lessons (child projects). The
	// single-source (target URL / manuscript) and multi-source (Sources) steps are
	// independent: website_review shows both.
	//
	// Order is Type → Source(s) → Brief → authoring → Review. The authoring steps
	// (shotlist / beats / storyboard) come AFTER the Brief they are derived from:
	// the storyboard step used to come first and offered "Draft from brief" against
	// a brief-less draft, which always 422'd (ui-review 2026-10-17 X1).
	get steps(): StepKey[] {
		return this.isCourse
			? ['type', 'sources', 'brief', 'lessons', 'review']
			: [
					'type',
					...(this.usesSingleSource ? (['source'] as StepKey[]) : []),
					...(this.usesMultiSource ? (['sources'] as StepKey[]) : []),
					'brief',
					...(this.usesShotlist ? (['shotlist'] as StepKey[]) : []),
					...(this.usesBeats ? (['beats'] as StepKey[]) : []),
					...(this.usesStoryboard ? (['storyboard'] as StepKey[]) : []),
					'review'
				];
	}
	get currentStep(): StepKey {
		return this.steps[Math.min(this.stepIndex, this.steps.length - 1)];
	}

	// "Sources" reads ambiguously next to the single-URL "Source" step
	// (website_review shows both), so label the multi-source step "References"
	// there; promo/generic/course keep "Sources".
	get sourcesStepLabel(): string {
		return this.usesSingleSource ? 'References' : 'Sources';
	}
	get stepLabels(): Record<StepKey, string> {
		return {
			type: 'Type',
			sources: this.sourcesStepLabel,
			// The single-source step is a clip uploader for action_reel — "Source"
			// would read as a URL there, so label it for what it collects.
			source: this.usesVideoSources ? 'Footage' : 'Source',
			shotlist: 'Shotlist',
			beats: 'Beats',
			storyboard: 'Storyboard',
			brief: 'Brief',
			lessons: 'Lessons',
			review: 'Review'
		};
	}

	// app_review / website_review inspect a live target (URL required); promo
	// features an OPTIONAL source site — site_capture records it as background
	// footage + scrapes copy to ground the script.
	get sourceOptional(): boolean {
		return !this.isCourse && sourceUrlOptional(this.pickType);
	}
	get sourceLabel(): string {
		return this.projectType === 'app_review' ||
			this.projectType === 'website_review' ||
			this.projectType === 'demo_video' ||
			this.projectType === 'showcase' ||
			this.isAudit
			? 'Target URL'
			: this.sourceOptional
				? 'Source URL (optional — site to feature & scrape)'
				: 'Source URL';
	}
	get sourceValue(): string {
		return this.isCourse ? '' : wizard.url.trim();
	}
	// First URL among the multi-source list, used to smart-default the title when
	// the operator leaves the Sources step.
	get firstUrlSource(): string {
		return this.sources.find((s) => s.kind === 'url' && s.ref.trim())?.ref.trim() ?? '';
	}
	// Prefer the required target URL (website_review/app_review) for the title hint;
	// otherwise fall back to the first multi-source URL (promo/generic/course).
	get titleHint(): string {
		return this.usesSingleSource && this.sourceValue
			? extractHostname(this.sourceValue)
			: this.firstUrlSource
				? extractHostname(this.firstUrlSource)
				: '';
	}

	// --- Per-step validation ---
	// Audiobook's Source step is "manuscript uploaded" (brief.manuscript_ref set
	// by AudiobookSource); action_reel's is "at least one clip uploaded";
	// URL-based types validate the URL.
	//
	// The ≥1-clip rule is not cosmetic: the blueprint's footage_probe stage hard
	// FAILS a run with no sources, so letting the operator through here trades a
	// clear message now for a confusing failed run several minutes later.
	get sourceValid(): boolean {
		return (
			this.isCourse ||
			!this.usesSingleSource ||
			(this.usesVideoSources
				? this.videoSources.length > 0
				: this.isAudiobook
					? typeof this.brief.manuscript_ref === 'string' && this.brief.manuscript_ref.length > 0
					: this.isShowcase
						? // Showcase always needs a valid target URL; authored mode also needs
							// an uploaded recording package (generated mode auto-records from the URL).
							wizard.url.trim().length > 0 &&
							isValidUrl(wizard.url.trim()) &&
							(this.showcaseMode === 'generated' || this.hasPackage)
						: this.sourceOptional
							? // Optional source (promo): empty is fine; if filled it must be valid.
								wizard.url.trim().length === 0 || isValidUrl(wizard.url.trim())
							: wizard.url.trim().length > 0 && isValidUrl(wizard.url.trim()))
		);
	}

	// The brief keys the user must type for this type (durations/target_url are
	// derived from the deliverable / Source step, so they're excluded here).
	get requiredKeys(): string[] {
		return userBriefKeys(this.pickType);
	}
	get briefFieldsValid(): boolean {
		return this.requiredKeys.every(
			(k) => typeof this.brief[k] === 'string' && (this.brief[k] as string).trim().length > 0
		);
	}
	// Smallest target duration this type's VIDEO accepts (website_review: 10s), or
	// null. Only while a video is produced — a critique-only review has no duration.
	get minDurationSeconds(): number | null {
		return this.producesVideo ? minDurationSecondsFor(this.pickType) : null;
	}
	// An empty duration falls back to the type's default (>= the floor), so only a
	// typed value below the floor blocks.
	get durationsValid(): boolean {
		const min = this.minDurationSeconds;
		if (min === null || !this.needsDeliverables || !this.controls.deliverableDuration) return true;
		return this.deliverables.every(
			(d) => d.target_duration_seconds == null || d.target_duration_seconds >= min
		);
	}
	get briefValid(): boolean {
		return (
			this.title.trim().length > 0 &&
			this.briefFieldsValid &&
			this.durationsValid &&
			(!this.needsDeliverables ||
				(this.deliverables.length > 0 && this.deliverables.every((d) => d.name.trim().length > 0)))
		);
	}
	/** A titled lesson's minutes become `target_duration_seconds` (1..3600 server-side). */
	lessonDurationValid(l: LessonDraft): boolean {
		const m = l.duration_minutes;
		return typeof m === 'number' && Number.isFinite(m) && m >= 1 && m <= 60;
	}
	// Every TITLED lesson needs a 1–60 minute duration: a 0/blank one 400s on the
	// child POST after the course already exists, leaving an orphan course.
	get lessonsValid(): boolean {
		const titled = this.lessons.filter((l) => l.title.trim().length > 0);
		return titled.length > 0 && titled.every((l) => this.lessonDurationValid(l));
	}

	/**
	 * Whether `key`'s own gate is satisfied. The ONE predicate behind both Next
	 * (`canProceed`) and the step rail (`stepReachable`) — the rail used to check a
	 * subset and could jump past website_review's "pick at least one output".
	 */
	stepValid(key: StepKey): boolean {
		switch (key) {
			case 'source':
				// website_review must select at least one output (critique/redesign/video).
				return this.sourceValid && this.hasOutput;
			case 'brief':
				return this.briefValid;
			case 'lessons':
				return this.lessonsValid;
			default:
				return true;
		}
	}

	get canProceed(): boolean {
		switch (this.currentStep) {
			case 'type':
				return true;
			// Sources are optional grounding — never block progress. Any half-typed
			// URL row is simply ignored by buildBrief (it filters empty refs).
			case 'sources':
				return true;
			// The shotlist is optional direction — half-filled rows are dropped by
			// buildBrief's cleanShotlist, so it never blocks progress.
			case 'shotlist':
				return true;
			// Beats are optional authoring — an empty editor just auto-narrates the
			// package's scenarios, and cleanLines drops half-filled beats. Never blocks.
			case 'beats':
				return true;
			// The storyboard is optional direction — half-filled panels are dropped by
			// buildBrief's cleanPanels, so it never blocks progress.
			case 'storyboard':
				return true;
			case 'source':
			case 'brief':
			case 'lessons':
				return this.stepValid(this.currentStep);
			case 'review':
				return !this.isSubmitting;
			default:
				return false;
		}
	}

	stepReachable(target: number): boolean {
		const steps = this.steps;
		for (let i = 0; i < target; i++) {
			if (!this.stepValid(steps[i])) return false;
		}
		return true;
	}

	goToStep(target: number) {
		if (target <= this.stepIndex || this.stepReachable(target)) this.stepIndex = target;
	}

	next() {
		if (!this.canProceed || this.stepIndex >= this.steps.length - 1) return;
		// Smart-default the title when leaving Source: hostname for URL types,
		// the manuscript filename (sans extension) for audiobooks.
		if (
			(this.currentStep === 'source' || this.currentStep === 'sources') &&
			this.title.trim().length === 0
		) {
			if (this.usesVideoSources && this.videoSources.length > 0) {
				// No URL and no manuscript on this path — the first clip's name is the
				// only human label the operator has already given us.
				this.title = this.videoSources[0].filename.replace(/\.[^.]+$/, '');
			} else if (this.isAudiobook && typeof this.brief.manuscript_name === 'string') {
				this.title = this.brief.manuscript_name.replace(/\.[^.]+$/, '');
			} else if (this.titleHint) {
				this.title = this.titleHint;
			}
		}
		this.stepIndex += 1;
	}

	back() {
		if (this.stepIndex > 0) this.stepIndex -= 1;
	}

	// Switching showcase back to generated mode drops the authored-only brief keys
	// so the backend (which infers mode from their presence) doesn't see a stale
	// package_url / lines from an abandoned authored attempt.
	setShowcaseMode(mode: 'generated' | 'authored') {
		this.showcaseMode = mode;
		if (mode === 'generated') {
			const { package_url: _p, lines: _l, ...rest } = this.brief;
			this.brief = rest;
			this.clipRoster = [];
			// The named cast only maps authored beat speakers; drop it with the spine.
			this.cast = [];
		}
	}

	/**
	 * Change the project type. A type change after a server draft exists used to
	 * keep the old draft: submit PATCHed the new type's brief onto a project whose
	 * server-side type (immutable via PATCH) was still the old one, so the wrong
	 * pipeline ran (ui-review X2). Now the abandoned draft is dropped (best-effort
	 * soft delete — it may hold uploaded clips) and every type-specific piece of
	 * state is reset, so no key of the old type rides into the new brief.
	 * Type-agnostic input (title, sources, clone source, voice/look) is kept.
	 */
	setProjectType(type: ProjectType) {
		if (type === this.projectType) return;
		const abandoned = this.projectId;
		this.projectType = type;
		this.projectId = null;
		this.draftProject = null;
		this.draftError = '';
		this.submitError = '';
		this.createdDeliverableIds = [];
		this.videoSources = [];
		this.brief = {};
		this.deliverables = defaultDeliverablesFor(type);
		this.lessons = [{ title: '', learning_objective: '', duration_minutes: 6 }];
		this.generateCritique = true;
		this.generateRedesign = false;
		this.generateVideo = false;
		this.shotlist = [];
		this.panels = [];
		this.showcaseMode = 'generated';
		this.clipRoster = [];
		this.cast = [];
		// A URL typed into a single-source step must not become an invisible
		// `source_url` on a type without that step.
		if (!this.usesSingleSource) wizard.url = '';
		if (abandoned) void projectsApi.remove(abandoned).catch(() => {});
	}

	addDeliverable() {
		this.deliverables = [
			...this.deliverables,
			{ name: '', format: '16x9', target_duration_seconds: null }
		];
	}
	removeDeliverable(index: number) {
		this.deliverables = this.deliverables.filter((_, i) => i !== index);
	}

	addLesson() {
		this.lessons = [...this.lessons, { title: '', learning_objective: '', duration_minutes: 6 }];
	}
	removeLesson(index: number) {
		this.lessons = this.lessons.filter((_, i) => i !== index);
	}

	/**
	 * The deliverables actually sent (ui-review X4). A type that makes no video
	 * sends one non-video deliverable instead of the hidden "60s horizontal"; a
	 * type whose pipeline never reads a duration sends none.
	 */
	get submittedDeliverables(): DeliverableInput[] {
		if (!this.producesVideo) return [nonVideoDeliverable(this.projectType)];
		if (this.controls.deliverableDuration) return this.deliverables;
		return this.deliverables.map((d) => {
			const { target_duration_seconds: _unread, ...rest } = d;
			return rest;
		});
	}

	buildInput(): BuildInput {
		const brand: Record<string, unknown> = {};
		if (wizard.theme === 'custom' && wizard.brandColor) brand.primary_color = wizard.brandColor;
		const theme: Record<string, unknown> = {
			name: wizard.theme,
			frame_rate: wizard.frameRate,
			video_quality: wizard.videoQuality,
			transition_type: wizard.transitionType
		};
		return {
			type: this.pickType,
			title: this.title,
			titleHint: this.titleHint,
			briefFields: this.brief,
			sourceUrl: this.sourceValue,
			sources: this.usesMultiSource ? this.sources : undefined,
			mediaDiscovery: this.usesMultiSource ? this.mediaDiscovery : false,
			generateCritique: this.usesVideoOptIn ? this.generateCritique : undefined,
			generateRedesign: this.usesVideoOptIn ? this.generateRedesign : undefined,
			generateVideo: this.usesVideoOptIn ? this.generateVideo : undefined,
			shotlist: this.usesShotlist ? this.shotlist : undefined,
			panels: this.usesStoryboard ? this.panels : undefined,
			deliverables: this.submittedDeliverables,
			voice: {
				provider: wizard.ttsProvider,
				voice_id: wizard.voice,
				speed: wizard.narrationSpeed,
				// Multi-voice cast is showcase-only; every other type stays single-voice.
				...(this.isShowcase && Object.keys(this.castMap).length ? { cast: this.castMap } : {})
			},
			brand,
			theme,
			resolution: wizard.resolution,
			cloneFrom: this.cloneFrom || undefined
		};
	}

	// Storyboard path only: pre-create a `drafting` project the moment the user
	// reaches the storyboard step, so it can render the live project-scoped
	// board. Idempotent (no-op once `projectId` is set) and gated on
	// `usesStoryboard` so no other type is affected. Failures are swallowed into
	// `submitError` — the step degrades to the in-memory board rather than
	// throwing, keeping the wizard usable if the draft POST fails.
	// action_reel reuses this verbatim for the same reason: its clip uploader posts
	// to `/projects/{id}/video-sources`, so there must be an `id` before the first
	// byte moves. Only the failure MODE differs — the storyboard degrades to an
	// in-memory board, while footage has no offline fallback (there is nowhere to
	// put the bytes), so the uploader surfaces `submitError` and stays disabled.
	// A failure leaves `projectId` null, so the `$effect` that first called this
	// never re-fires (its dependencies did not change) — the retry MUST be a
	// user-invoked call of this same method. It is safe to call repeatedly: the
	// `projectId` / `draftPending` guards mean a retry after a draft that
	// actually succeeded (e.g. the response was merely slow) can never POST a
	// second draft.
	async ensureDraftProject(): Promise<void> {
		if ((!this.usesStoryboard && !this.usesVideoSources) || this.projectId || this.draftPending)
			return;
		this.draftPending = true;
		this.draftError = '';
		try {
			const project = await createDraft({
				type: this.projectType,
				title: this.title || undefined,
				// "Clone settings from" seeds the draft too (w2v_orchestrator#1116);
				// the finalize PATCH re-sends it so a pick made later still lands.
				...(this.cloneFrom ? { clone_from_project_id: this.cloneFrom } : {})
			});
			this.projectId = project.id;
			this.draftProject = project;
			this.submitError = '';
			// The storyboard draft's "Draft from brief" reads the SERVER brief, and a
			// draft is created brief-less (ProjectDraftCreate has only type/title).
			if (this.usesStoryboard) await this.pushBriefToDraft();
		} catch (err) {
			this.draftError =
				cloneSourceNotFoundMessage(err) ?? errorMessage(err, 'Failed to create draft project');
			// Mirrored so the storyboard step's existing degrade message still reads.
			this.submitError = this.draftError;
		} finally {
			this.draftPending = false;
		}
	}

	/**
	 * Storyboard path: PATCH the brief typed so far onto the draft, so the
	 * storyboard step's "Draft from brief" (which reads `project.brief` server-side)
	 * has something to draft from — and stays current when the operator goes back
	 * and edits the Brief. Failures are surfaced like a draft failure.
	 */
	async pushBriefToDraft(): Promise<void> {
		if (!this.projectId) return;
		const req = buildProjectRequest(this.buildInput());
		await projectsUpdate(this.projectId, { title: req.title, brief: req.brief });
		// StoryboardSection gates "Draft from brief" on the project's brief.
		if (this.draftProject) {
			this.draftProject = { ...this.draftProject, title: req.title, brief: req.brief ?? {} };
		}
	}

	/** Storyboard step entry: create the draft, or refresh its brief if it exists. */
	async prepareStoryboardDraft(): Promise<void> {
		if (!this.usesStoryboard || this.draftPending) return;
		if (!this.projectId) return this.ensureDraftProject();
		this.draftPending = true;
		this.draftError = '';
		try {
			await this.pushBriefToDraft();
		} catch (err) {
			this.draftError = errorMessage(err, 'Failed to save the brief to the draft');
			this.submitError = this.draftError;
		} finally {
			this.draftPending = false;
		}
	}

	// --- Reload recovery ---

	// Reads every field the snapshot carries (so a `$effect` calling `persist()`
	// tracks all of them), then returns null when there is nothing worth resuming:
	// no draft and still on the Type step.
	private snapshot(): PersistedWizard | null {
		const snap: PersistedWizard = {
			v: 2,
			projectId: this.projectId ?? '',
			projectType: this.projectType,
			title: this.title,
			brief: $state.snapshot(this.brief) as ProjectBrief,
			stepIndex: this.stepIndex,
			sourceUrl: wizard.url,
			showcaseMode: this.showcaseMode,
			videoSources: $state.snapshot(this.videoSources) as VideoSourceResponse[],
			cloneFrom: this.cloneFrom,
			deliverables: $state.snapshot(this.deliverables) as DeliverableInput[],
			lessons: $state.snapshot(this.lessons) as LessonDraft[],
			sources: $state.snapshot(this.sources) as ProjectSource[],
			mediaDiscovery: this.mediaDiscovery,
			generateCritique: this.generateCritique,
			generateRedesign: this.generateRedesign,
			generateVideo: this.generateVideo,
			shotlist: $state.snapshot(this.shotlist) as Shot[],
			panels: $state.snapshot(this.panels) as StoryboardPanelDraft[],
			cast: $state.snapshot(this.cast) as { name: string; voice: string }[],
			clipRoster: $state.snapshot(this.clipRoster) as string[],
			createdDeliverableIds: $state.snapshot(this.createdDeliverableIds) as string[],
			settings: {
				ttsProvider: wizard.ttsProvider,
				voice: wizard.voice,
				narrationSpeed: wizard.narrationSpeed,
				theme: wizard.theme,
				brandColor: wizard.brandColor,
				resolution: wizard.resolution,
				frameRate: wizard.frameRate,
				videoQuality: wizard.videoQuality,
				transitionType: wizard.transitionType
			}
		};
		return snap.projectId || snap.stepIndex > 0 ? snap : null;
	}

	/** Mirror the current wizard into sessionStorage. Call from a `$effect`. */
	persist(): void {
		const snap = this.snapshot();
		if (!this.persistArmed || typeof sessionStorage === 'undefined') return;
		try {
			if (snap) sessionStorage.setItem(PERSIST_KEY, JSON.stringify(snap));
			else sessionStorage.removeItem(PERSIST_KEY);
		} catch {
			// Storage disabled / quota exceeded — recovery is best-effort, never fatal.
		}
	}

	/**
	 * Read AND consume the persisted snapshot. MUST be called BEFORE `reset()`,
	 * because the discriminator between the two ways of arriving at
	 * /projects/new is whether this singleton is still pristine:
	 *
	 *  - a full page load (F5, restored tab) re-evaluates the module, so the
	 *    singleton is pristine (no `projectId`, Type step) ⇒ resume the snapshot;
	 *  - a client-side navigation in from a project or /projects leaves the
	 *    previous wizard's `projectId` / step on the singleton ⇒ the operator
	 *    asked for a NEW project, so return null (clean wizard) and drop the
	 *    stale snapshot. That is the case the mount-time `reset()` exists for.
	 *
	 * Only a snapshot with a draft id or past the Type step is ever written, so
	 * "pristine" and "nothing was persisted for this singleton" coincide.
	 *
	 * A pristine singleton alone is NOT proof of a reload, though: an abandoned
	 * wizard leaves its snapshot behind (only a successful submit clears it), and
	 * a later full load of /projects/new — typed URL, bookmark, a hard link — or a
	 * client-side visit after reloading some OTHER page also starts pristine. Those
	 * used to resurrect the abandoned wizard's step and answers (ui-review
	 * 2026-10-18). So resume only when this document was a reload (or back/forward)
	 * of THIS page; every other arrival is "new project".
	 */
	takePersisted(): PersistedWizard | null {
		const freshPageLoad =
			this.projectId === null && this.stepIndex === 0 && documentWasReloadedHere();
		if (typeof sessionStorage === 'undefined') return null;
		let raw: string | null;
		try {
			raw = sessionStorage.getItem(PERSIST_KEY);
			sessionStorage.removeItem(PERSIST_KEY);
		} catch {
			return null;
		}
		if (!freshPageLoad || !raw) return null;
		try {
			const parsed = JSON.parse(raw) as Partial<PersistedWizard>;
			if (parsed?.v === 1 && typeof parsed.projectId === 'string' && parsed.projectId) {
				return parsed as PersistedWizard;
			}
			if (parsed?.v === 2 && typeof parsed.projectId === 'string' && parsed.projectType) {
				return parsed as PersistedWizard;
			}
			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Re-attach the wizard to a draft that survived a reload, then arm persistence.
	 * The draft is VERIFIED server-side first: a deleted draft (or one belonging to
	 * another tenant, which reads as 403/404) must leave the operator on the clean
	 * wizard the caller already reset to, never on a step pointed at a dead id.
	 */
	async resume(snap: PersistedWizard | null): Promise<void> {
		if (!snap) {
			this.persistArmed = true;
			return;
		}
		let project: ProjectDetailResponse | null = null;
		if (snap.projectId) {
			try {
				project = await projectsApi.get(snap.projectId);
			} catch {
				this.persistArmed = true;
				return;
			}
		}
		this.projectType = snap.projectType;
		this.title = snap.title ?? '';
		this.brief = snap.brief ?? {};
		this.showcaseMode = snap.showcaseMode === 'authored' ? 'authored' : 'generated';
		wizard.url = snap.sourceUrl ?? '';
		this.projectId = snap.projectId || null;
		this.draftProject = project;
		this.videoSources = snap.videoSources ?? [];
		if (snap.cloneFrom !== undefined) this.cloneFrom = snap.cloneFrom;
		if (snap.deliverables?.length) this.deliverables = snap.deliverables;
		else this.deliverables = defaultDeliverablesFor(this.projectType);
		if (snap.lessons?.length) this.lessons = snap.lessons;
		if (snap.sources) this.sources = snap.sources;
		if (snap.mediaDiscovery !== undefined) this.mediaDiscovery = snap.mediaDiscovery;
		if (snap.generateCritique !== undefined) this.generateCritique = snap.generateCritique;
		if (snap.generateRedesign !== undefined) this.generateRedesign = snap.generateRedesign;
		if (snap.generateVideo !== undefined) this.generateVideo = snap.generateVideo;
		if (snap.shotlist) this.shotlist = snap.shotlist;
		if (snap.panels) this.panels = snap.panels;
		if (snap.cast) this.cast = snap.cast;
		if (snap.clipRoster) this.clipRoster = snap.clipRoster;
		if (snap.createdDeliverableIds) this.createdDeliverableIds = snap.createdDeliverableIds;
		if (snap.settings) Object.assign(wizard, snap.settings);
		if (this.projectId && this.usesVideoSources) {
			// The server is the truth for what actually landed — a clip whose upload
			// was in flight when the tab reloaded either committed or did not.
			try {
				this.videoSources = (await uploads.listVideoSources(snap.projectId)).items;
			} catch {
				// Keep the snapshot list; VideoSourcesUpload re-lists on its own too.
			}
		}
		// Last: `steps` depends on the type/mode restored above. Never land past a
		// gate the restored state no longer satisfies.
		let idx = Math.max(0, Math.min(snap.stepIndex ?? 0, this.steps.length - 1));
		while (idx > 0 && !this.stepReachable(idx)) idx -= 1;
		this.stepIndex = idx;
		this.persistArmed = true;
	}

	/** Drop the recovery snapshot — the draft is finalized (or deliberately abandoned). */
	clearPersisted() {
		this.persistArmed = false;
		if (typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.removeItem(PERSIST_KEY);
		} catch {
			// Storage disabled — nothing to clear.
		}
	}

	// Restore first-visit state. MUST be called onMount (the store is a module
	// singleton, so state otherwise persists across navigations — the original
	// local $state was fresh on every component mount). Mount then calls
	// `resume()`, which either re-attaches a still-live draft (reload recovery)
	// or leaves this clean state in place.
	reset() {
		this.title = '';
		this.projectType = 'promo';
		this.brief = {};
		this.cloneFrom = '';
		this.deliverables = defaultDeliverablesFor('promo');
		this.defaultCaptionsMode = null;
		this.lessons = [{ title: '', learning_objective: '', duration_minutes: 6 }];
		this.sources = [];
		this.mediaDiscovery = false;
		this.generateCritique = true;
		this.generateRedesign = false;
		this.generateVideo = false;
		this.shotlist = [];
		this.panels = [];
		this.showAdvanced = false;
		this.isSubmitting = false;
		this.submitError = '';
		this.stepIndex = 0;
		this.projectId = null;
		this.draftProject = null;
		this.draftPending = false;
		this.draftError = '';
		// Disarmed until `resume()` decides between continuing and starting clean,
		// so this wipe cannot clobber the snapshot it is about to be measured against.
		this.persistArmed = false;
		this.createdDeliverableIds = [];
		this.showcaseMode = 'generated';
		this.clipRoster = [];
		this.cast = [];
		this.videoSources = [];
	}
}

export const createWizard = new CreateWizard();

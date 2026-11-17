import { describe, it, expect } from 'vitest';
import {
	minDurationSecondsFor,
	buildBrief,
	buildProjectRequest,
	buildFinalizePatch,
	cloneSourceNotFoundMessage,
	buildLessonChildren,
	cleanLines,
	briefHasDraftableText,
	typeBriefSpec,
	requiredBriefKeys,
	typeUsesSourceUrl,
	typeUsesMultiSource,
	typeUsesTargetUrl,
	typeIsAudit,
	typeIsScanOnlyAudit,
	sourceUrlOptional,
	userBriefKeys,
	CREATABLE_PROJECT_TYPES,
	TYPE_BRIEF,
	REQUIRES_VOICE_ID,
	type BuildInput,
	type PickType,
	type LessonDraft
} from './project-request';

// Representative brief fields per type — the keys a user types in the Brief step.
const BRIEF_FIELDS: Record<PickType, Record<string, unknown>> = {
	promo: { audience: 'developers', value_proposition: 'ship faster', call_to_action: 'Start free' },
	generic: { angle: 'explainer', audience: 'developers' },
	app_review: { review_lens: 'onboarding UX', audience: 'product managers' },
	website_review: {},
	course: { audience: 'developers', outcome: 'operate Postgres in prod' },
	// audiobook collects manuscript_ref via the upload step (not typed), plus
	// chapter/output options that ride on the brief.
	audiobook: {
		manuscript_ref: 'manuscripts/t/upload/abc.txt',
		manuscript_name: 'abc.txt',
		chapter_mode: 'auto',
		audiobook: { output_format: 'mp3' }
	},
	web_design: { description: 'A landing page for a bakery', page_type: 'landing' },
	web_design_v2: {
		description: 'An interactive landing page for a bakery',
		page_type: 'landing',
		interactivity: 'interactive'
	},
	// demo_video's target_url comes from the Source step (urlToTargetUrl), like
	// website_review; the Brief step only adds optional steering fields.
	demo_video: {},
	// showcase (generated mode): same as demo_video — target_url from the Source
	// step, no required typed brief fields. Authored-mode extras (package_url,
	// lines) are exercised in a dedicated test below.
	showcase: {},
	// action_reel's footage is uploaded per-project (video-sources) AFTER create, so
	// the Brief step collects nothing required — only the optional music-steering
	// keys music_select reads.
	action_reel: { goal: 'a punchy drone reel', tone: 'energetic' },
	// audits take only target_url (Source step); include_llm / generate_video are
	// optional toggles that ride through briefFields (exercised in a test below).
	seo_audit: {},
	cro_audit: {},
	marketing_scorecard: {}
};

function makeInput(type: PickType, overrides: Partial<BuildInput> = {}): BuildInput {
	return {
		type,
		title: 'My project',
		titleHint: 'example.com',
		briefFields: { ...BRIEF_FIELDS[type] },
		sourceUrl: type === 'course' ? '' : 'https://example.com',
		deliverables: [
			{ name: 'main', format: '16x9', captions_mode: 'none', target_duration_seconds: 45 }
		],
		voice: { provider: 'kokoro', voice_id: 'af_heart', speed: 1 },
		brand: {},
		theme: { name: 'default' },
		...overrides
	};
}

// growth_bundle has a brief spec (its workspace renders the brief form) but is
// not a PickType — not wizard-creatable — so it is excluded here.
const PICK_TYPES = Object.keys(TYPE_BRIEF).filter((t) => t !== 'growth_bundle') as PickType[];

describe('project-request — wizard payload satisfies the blueprint contract', () => {
	// THE regression guard: the built brief must carry every key the type's
	// blueprint reads. If a wizard field is renamed/dropped, this fails before merge.
	it.each(PICK_TYPES)('%s: brief keys ⊇ required blueprint reads', (type) => {
		const brief = buildBrief(makeInput(type));
		for (const key of TYPE_BRIEF[type].required) {
			expect(brief, `missing required brief key "${key}" for ${type}`).toHaveProperty(key);
			expect(brief[key], `empty required brief key "${key}" for ${type}`).toBeTruthy();
		}
	});

	it('CREATABLE_PROJECT_TYPES covers every non-dormant PickType (completeness)', () => {
		// `as const satisfies readonly PickType[]` proves each member IS a PickType,
		// but NOT that every PickType is listed — a new creatable type added to
		// ProjectType (→ forced into TYPE_BRIEF via Record<PickType>) but forgotten
		// here compiles clean yet never appears in the wizard / type chips. Lock it:
		// every PickType must be creatable EXCEPT the deliberately dormant ones.
		const DORMANT_EXCLUSIONS = new Set<PickType>(['app_review']);
		const expected = PICK_TYPES.filter((t) => !DORMANT_EXCLUSIONS.has(t));
		expect(new Set(CREATABLE_PROJECT_TYPES)).toEqual(new Set(expected));
	});

	it.each(['seo_audit', 'cro_audit', 'marketing_scorecard'] as const)(
		'%s: is creatable and has a defined brief spec (locks the deep-link crash fix)',
		(type) => {
			// Regression: /projects/new?type=seo_audit crashed because the type was in
			// PROJECT_TYPE_LABELS but excluded from TYPE_BRIEF → TYPE_BRIEF[type].required
			// was undefined → userBriefKeys threw. Now both are creatable + spec'd.
			expect(CREATABLE_PROJECT_TYPES).toContain(type);
			expect(() => userBriefKeys(type)).not.toThrow();
			expect(TYPE_BRIEF[type].required).toContain('target_url');
		}
	);

	it('promo: optional source URL → brief.source_url (consumed by site_capture), not target_url', () => {
		// promo now opts into an OPTIONAL source site (site_capture records it +
		// scrapes copy). It maps to source_url, never target_url.
		expect(typeUsesSourceUrl('promo')).toBe(true);
		expect(sourceUrlOptional('promo')).toBe(true);
		const promo = buildBrief(makeInput('promo'));
		expect(promo.source_url).toBe('https://example.com');
		expect(promo.target_url).toBeUndefined();
	});

	it('promo: empty source URL persists no source_url (optional)', () => {
		const promo = buildBrief(makeInput('promo', { sourceUrl: '' }));
		expect(promo.source_url).toBeUndefined();
	});

	it('generic: no URL is persisted (no stage consumes one — Source step is hidden)', () => {
		expect(typeUsesSourceUrl('generic')).toBe(false);
		const generic = buildBrief(makeInput('generic'));
		expect(generic.source_url).toBeUndefined();
		expect(generic.target_url).toBeUndefined();
	});

	it('app_review/website_review use the Source step (URL → target_url), required not optional', () => {
		expect(typeUsesSourceUrl('app_review')).toBe(true);
		expect(typeUsesSourceUrl('website_review')).toBe(true);
		expect(sourceUrlOptional('app_review')).toBe(false);
		expect(sourceUrlOptional('website_review')).toBe(false);
	});

	it('app_review: source URL is the inspection target (brief.target_url, not source_url)', () => {
		const brief = buildBrief(makeInput('app_review'));
		expect(brief.target_url).toBe('https://example.com');
		expect(brief.source_url).toBeUndefined();
	});

	it('demo_video: source URL is the app to demo (brief.target_url, not source_url)', () => {
		expect(typeUsesSourceUrl('demo_video')).toBe(true);
		expect(sourceUrlOptional('demo_video')).toBe(false);
		const brief = buildBrief(makeInput('demo_video'));
		expect(brief.target_url).toBe('https://example.com');
		expect(brief.source_url).toBeUndefined();
	});

	it('showcase: source URL is the app to showcase (brief.target_url, generated mode)', () => {
		expect(typeUsesTargetUrl('showcase')).toBe(true);
		expect(sourceUrlOptional('showcase')).toBe(false);
		const brief = buildBrief(makeInput('showcase'));
		expect(brief.target_url).toBe('https://example.com');
		expect(brief.source_url).toBeUndefined();
	});

	it.each(['seo_audit', 'cro_audit', 'marketing_scorecard'] as const)(
		'%s: target URL is the site to audit (brief.target_url, not source_url)',
		(type) => {
			expect(typeUsesTargetUrl(type)).toBe(true);
			expect(sourceUrlOptional(type)).toBe(false);
			const brief = buildBrief(makeInput(type));
			expect(brief.target_url).toBe('https://example.com');
			expect(brief.source_url).toBeUndefined();
		}
	);

	it.each(['seo_audit', 'cro_audit'] as const)(
		'%s: include_llm / generate_video toggles ride through briefFields',
		(type) => {
			const brief = buildBrief(
				makeInput(type, { briefFields: { include_llm: true, generate_video: true } })
			);
			expect(brief.include_llm).toBe(true);
			expect(brief.generate_video).toBe(true);
			// A scan-only audit (no toggles) leaves them absent → orchestrator defaults.
			const scanOnly = buildBrief(makeInput(type));
			expect(scanOnly.generate_video).toBeUndefined();
		}
	);

	it.each(['seo_audit', 'cro_audit', 'marketing_scorecard'] as const)(
		'%s: is an audit type (wizard treats it report-first, not video)',
		(type) => {
			expect(typeIsAudit(type)).toBe(true);
		}
	);

	it('marketing_scorecard is scan-only; seo/cro have a video variant; non-audits are neither', () => {
		expect(typeIsScanOnlyAudit('marketing_scorecard')).toBe(true);
		expect(typeIsScanOnlyAudit('seo_audit')).toBe(false);
		expect(typeIsScanOnlyAudit('cro_audit')).toBe(false);
		// A non-audit type is neither an audit nor scan-only.
		expect(typeIsAudit('promo')).toBe(false);
		expect(typeIsScanOnlyAudit('promo')).toBe(false);
	});

	it('showcase: authored package_url + lines ride through briefFields onto the brief', () => {
		// RecordingPackageSource writes package_url/lines onto the wizard brief;
		// they must survive buildBrief's spread alongside the derived target_url.
		const brief = buildBrief(
			makeInput('showcase', {
				briefFields: {
					package_url: 'https://minio.test/w2v-orchestrator/vp/pkg.zip',
					lines: [{ id: 'clip-1', text: 'Open the dashboard', seconds: 4, clip: '@clip-1' }]
				}
			})
		);
		expect(brief.target_url).toBe('https://example.com');
		expect(brief.package_url).toBe('https://minio.test/w2v-orchestrator/vp/pkg.zip');
		expect(brief.lines).toHaveLength(1);
	});

	it('showcase: authored beats are pruned + normalized by cleanLines', () => {
		const brief = buildBrief(
			makeInput('showcase', {
				briefFields: {
					package_url: 'https://minio.test/w2v-orchestrator/vp/pkg.zip',
					lines: [
						// survives: trimmed text, numeric seconds, kept clip fields
						{
							id: 'clip-1',
							text: '  Open the dashboard  ',
							seconds: 4,
							clip: ' @clip-1 ',
							clip_anchor: 'end',
							scenario_name: '',
							speaker: ''
						},
						// dropped: no narration text
						{ id: 'clip-2', text: '   ', seconds: 0 },
						// survives: missing id → falls back to clip-<idx+1>
						{ id: '', text: 'Create a project', seconds: 2 }
					]
				}
			})
		);
		expect(brief.lines).toHaveLength(2);
		const [first, second] = brief.lines!;
		expect(first.text).toBe('Open the dashboard');
		expect(first.clip).toBe('@clip-1');
		expect(first.clip_anchor).toBe('end');
		// empty optional keys are stripped, not emitted as ''
		expect(first.scenario_name).toBeUndefined();
		expect(first.speaker).toBeUndefined();
		expect(second.id).toBe('clip-3');
	});

	it('showcase: cleanLines keeps every authored AuthoredLine key + the card block', () => {
		// Regression: cleanLines rebuilt each beat from a 9-key whitelist, dropping
		// `card` (read raw by showcase_slides → no branded cards) and every per-beat
		// override the orchestrator's AuthoredLine carries.
		const card = { template: 'title', title: 'Acme', eyebrow: 'Intro' };
		const [beat] = cleanLines([
			{
				id: 'clip-1',
				text: 'Welcome',
				seconds: 3,
				card,
				locked: true,
				pin: true,
				beat_role: 'hook',
				clip_out_seconds: 7.5,
				expected_text: '  Dashboard ',
				min_seconds: 2,
				max_seconds: 6,
				vo_rate: 0.9,
				clip_anchor: 'auto',
				emphasis: [1, 3],
				doctor_note: '',
				hook_role: null,
				pronunciations: {}
			}
		]);
		expect(beat).toEqual({
			id: 'clip-1',
			text: 'Welcome',
			seconds: 3,
			card,
			locked: true,
			pin: true,
			beat_role: 'hook',
			clip_out_seconds: 7.5,
			expected_text: 'Dashboard',
			min_seconds: 2,
			max_seconds: 6,
			vo_rate: 0.9,
			clip_anchor: 'auto',
			emphasis: [1, 3]
		});
	});

	it('showcase: cleanLines drops an empty / non-object card and a bogus clip_anchor', () => {
		const lines = cleanLines([
			{ id: 'a', text: 'x', seconds: 1, card: {} },
			{
				id: 'b',
				text: 'y',
				seconds: 1,
				card: 'nope' as unknown as Record<string, unknown>,
				clip_anchor: 'middle' as 'end',
				clip_lead_seconds: 0
			}
		]);
		expect(lines[0]).not.toHaveProperty('card');
		expect(lines[1]).not.toHaveProperty('card');
		expect(lines[1]).not.toHaveProperty('clip_anchor');
		expect(lines[1]).not.toHaveProperty('clip_lead_seconds');
	});

	it('showcase: an all-empty beat editor omits brief.lines (→ auto-narrate)', () => {
		const brief = buildBrief(
			makeInput('showcase', {
				briefFields: {
					package_url: 'https://minio.test/w2v-orchestrator/vp/pkg.zip',
					lines: [
						{ id: 'clip-1', text: '', seconds: 0 },
						{ id: 'clip-2', text: '   ', seconds: 0 }
					]
				}
			})
		);
		expect(brief.lines).toBeUndefined();
		// the package still rides through — only the empty spine is dropped
		expect(brief.package_url).toBe('https://minio.test/w2v-orchestrator/vp/pkg.zip');
	});

	it('showcase: a named voice cast is serialized onto voice.cast', () => {
		const req = buildProjectRequest(
			makeInput('showcase', {
				voice: {
					provider: 'kokoro',
					voice_id: 'af_heart',
					speed: 1,
					cast: { Mark: 'am_michael', Lisa: 'af_bella' }
				}
			})
		);
		expect((req.voice as Record<string, unknown>).cast).toEqual({
			Mark: 'am_michael',
			Lisa: 'af_bella'
		});
	});

	it('showcase: a cast of >=2 roles opts the brief into dialogue', () => {
		const voice = {
			provider: 'kokoro',
			voice_id: 'af_heart',
			speed: 1,
			cast: { Mark: 'am_michael', Lisa: 'af_bella' }
		};
		expect(buildBrief(makeInput('showcase', { voice })).dialogue).toEqual({ enabled: true });
		// a single role is still single-narrator
		const solo = { ...voice, cast: { Mark: 'am_michael' } };
		expect(buildBrief(makeInput('showcase', { voice: solo })).dialogue).toBeUndefined();
		// other types never get dialogue from a cast
		expect(buildBrief(makeInput('promo', { voice })).dialogue).toBeUndefined();
		// an explicit authored opt-out wins
		const off = buildBrief(
			makeInput('showcase', { voice, briefFields: { dialogue: { enabled: false } } })
		);
		expect(off.dialogue).toEqual({ enabled: false });
	});

	it('an empty cast is omitted from voice (single-voice narration)', () => {
		const req = buildProjectRequest(
			makeInput('showcase', {
				voice: { provider: 'kokoro', voice_id: 'af_heart', speed: 1, cast: {} }
			})
		);
		expect((req.voice as Record<string, unknown>).cast).toBeUndefined();
	});

	it('promo/generic mirror deliverable duration onto target_duration_seconds', () => {
		expect(buildBrief(makeInput('promo')).target_duration_seconds).toBe(45);
		expect(buildBrief(makeInput('generic')).target_duration_seconds).toBe(45);
	});

	it('app_review mirrors deliverable duration onto duration_seconds (its own key)', () => {
		expect(buildBrief(makeInput('app_review')).duration_seconds).toBe(45);
	});

	it('website_review: source URL is the review target (brief.target_url, not source_url)', () => {
		const brief = buildBrief(makeInput('website_review'));
		expect(brief.target_url).toBe('https://example.com');
		expect(brief.source_url).toBeUndefined();
		expect(brief.duration_seconds).toBe(45);
	});

	it('website_review: writes the three output flags from the wizard toggles', () => {
		const critiqueOnly = buildBrief(makeInput('website_review', { generateCritique: true }));
		expect(critiqueOnly.generate_critique).toBe(true);
		expect(critiqueOnly.generate_redesign).toBe(false);
		expect(critiqueOnly.generate_video).toBe(false);

		const redesignOnly = buildBrief(makeInput('website_review', { generateRedesign: true }));
		expect(redesignOnly.generate_redesign).toBe(true);
		expect(redesignOnly.generate_critique).toBe(false);

		const video = buildBrief(makeInput('website_review', { generateVideo: true }));
		expect(video.generate_video).toBe(true);
	});

	it('web_design: carries the design brief (description) and never sets video flags', () => {
		const brief = buildBrief(
			makeInput('web_design', {
				briefFields: {
					description: 'A landing page for a bakery',
					page_type: 'landing',
					redesign_style: 'bold',
					target_url: 'https://acme.test'
				}
			})
		);
		expect(brief.description).toBe('A landing page for a bakery');
		expect(brief.page_type).toBe('landing');
		expect(brief.target_url).toBe('https://acme.test'); // optional reference URL
		expect(brief).not.toHaveProperty('generate_video');
	});

	it('non-opt-in types never set the output flags (absent = on in the orchestrator)', () => {
		// The flags are website_review-only; promo/etc. leave them absent so the
		// orchestrator runs their full pipeline (default-on).
		for (const type of ['promo', 'generic', 'course'] as PickType[]) {
			const brief = buildBrief(makeInput(type, { generateVideo: true, generateRedesign: true }));
			expect(brief).not.toHaveProperty('generate_critique');
			expect(brief).not.toHaveProperty('generate_redesign');
			expect(brief).not.toHaveProperty('generate_video');
		}
	});

	it.each([...REQUIRES_VOICE_ID].filter((t) => t !== 'lesson') as PickType[])(
		'%s: sends the Kokoro voice_id (the key every narrate stage reads)',
		(type) => {
			const req = buildProjectRequest(makeInput(type));
			expect((req.voice as Record<string, unknown>).voice_id).toBe('af_heart');
		}
	);

	it('course: sends a placeholder deliverable (lessons own the real ones)', () => {
		const req = buildProjectRequest(makeInput('course'));
		expect(req.deliverables).toEqual([
			{ name: 'placeholder', format: '16x9', captions_mode: 'none' }
		]);
	});

	it('non-course: forwards the user deliverables verbatim', () => {
		const req = buildProjectRequest(makeInput('promo'));
		expect(req.deliverables).toHaveLength(1);
		expect(req.deliverables[0].name).toBe('main');
	});

	it('audiobook: injects a single audio-format deliverable (editor is hidden)', () => {
		const req = buildProjectRequest(makeInput('audiobook'));
		expect(req.deliverables).toEqual([
			{ name: 'Audiobook', format: 'audio', captions_mode: 'none' }
		]);
	});

	it('audiobook: carries the manuscript ref + chapter/output options on the brief', () => {
		const brief = buildBrief(makeInput('audiobook'));
		expect(brief.manuscript_ref).toBe('manuscripts/t/upload/abc.txt');
		expect(brief.chapter_mode).toBe('auto');
		expect((brief.audiobook as { output_format?: string }).output_format).toBe('mp3');
		// No URL is persisted for audiobook (it uploads a file, not a URL).
		expect(brief.target_url).toBeUndefined();
		expect(brief.source_url).toBeUndefined();
	});
});

describe('multi-source type flags', () => {
	it('promo/generic/website_review/course run the multi-source Sources step', () => {
		expect(typeUsesMultiSource('promo')).toBe(true);
		expect(typeUsesMultiSource('generic')).toBe(true);
		expect(typeUsesMultiSource('website_review')).toBe(true);
		expect(typeUsesMultiSource('course')).toBe(true);
		expect(typeUsesMultiSource('app_review')).toBe(false);
		expect(typeUsesMultiSource('audiobook')).toBe(false);
	});

	it('website_review keeps a required target-URL step independent of multi-source', () => {
		// website_review shows BOTH steps; app_review only the target step.
		expect(typeUsesTargetUrl('website_review')).toBe(true);
		expect(typeUsesTargetUrl('app_review')).toBe(true);
		expect(typeUsesTargetUrl('promo')).toBe(false);
		expect(typeUsesTargetUrl('course')).toBe(false);
	});
});

describe('buildBrief — multi-source grounding for website_review + course', () => {
	it('website_review: target_url AND sources coexist (review target + extra grounding)', () => {
		const brief = buildBrief(
			makeInput('website_review', {
				sourceUrl: 'https://reviewme.com',
				sources: [{ kind: 'url', ref: 'https://docs.acme.com', label: 'Docs' }],
				mediaDiscovery: true
			})
		);
		expect(brief.target_url).toBe('https://reviewme.com');
		expect(brief.sources).toHaveLength(1);
		expect(brief.sources?.[0]).toMatchObject({ kind: 'url', ref: 'https://docs.acme.com' });
		// The review target is NOT mirrored into sources, and grounding sources are
		// NOT mirrored onto source_url (no site_capture here).
		expect(brief.source_url).toBeUndefined();
		expect(brief.media_discovery).toEqual({});
	});

	it('course: writes brief.sources (grounds the outline) with no URL routing', () => {
		const brief = buildBrief(
			makeInput('course', {
				sources: [{ kind: 'document', ref: 'documents/t/syllabus.pdf', label: 'Syllabus' }]
			})
		);
		expect(brief.sources).toHaveLength(1);
		expect(brief.target_url).toBeUndefined();
		expect(brief.source_url).toBeUndefined();
	});
});

describe('buildBrief — universal multi-source list (promo/generic)', () => {
	it('promo: writes brief.sources and mirrors the first URL onto source_url', () => {
		const brief = buildBrief(
			makeInput('promo', {
				sourceUrl: '',
				sources: [
					{ kind: 'url', ref: 'https://acme.com', label: 'Acme' },
					{ kind: 'document', ref: 'documents/t/book.pdf', label: 'book.pdf' },
					{ kind: 'media', ref: 'https://img/1.jpg', label: 'hero' }
				]
			})
		);
		expect(brief.sources).toHaveLength(3);
		expect(brief.sources?.[0]).toMatchObject({ kind: 'url', ref: 'https://acme.com' });
		// site_capture footage: first URL mirrored onto source_url for promo.
		expect(brief.source_url).toBe('https://acme.com');
	});

	it('generic: writes brief.sources but does NOT mirror source_url (no site_capture)', () => {
		const brief = buildBrief(
			makeInput('generic', {
				sources: [{ kind: 'url', ref: 'https://acme.com' }]
			})
		);
		expect(brief.sources).toHaveLength(1);
		expect(brief.source_url).toBeUndefined();
	});

	it('drops sources with empty refs and trims', () => {
		const brief = buildBrief(
			makeInput('promo', {
				sourceUrl: '',
				sources: [
					{ kind: 'url', ref: '  https://a.com  ' },
					{ kind: 'url', ref: '   ' }
				]
			})
		);
		expect(brief.sources).toHaveLength(1);
		expect(brief.sources?.[0].ref).toBe('https://a.com');
	});

	it('no sources → no brief.sources key', () => {
		const brief = buildBrief(makeInput('promo', { sourceUrl: '', sources: [] }));
		expect(brief.sources).toBeUndefined();
	});

	it('mediaDiscovery flag sets brief.media_discovery', () => {
		const on = buildBrief(makeInput('promo', { sourceUrl: '', mediaDiscovery: true }));
		expect(on.media_discovery).toEqual({});
		const off = buildBrief(makeInput('promo', { sourceUrl: '', mediaDiscovery: false }));
		expect(off.media_discovery).toBeUndefined();
	});
});

describe('buildLessonChildren — each lesson is a runnable child', () => {
	const lessons: LessonDraft[] = [
		{ title: 'Indexing', learning_objective: 'Use indexes well', duration_minutes: 5 },
		{ title: '', learning_objective: 'ignored — no title', duration_minutes: 5 }
	];

	it('drops untitled rows and shapes the rest for POST /children', () => {
		const children = buildLessonChildren(lessons);
		expect(children).toHaveLength(1);
		const c = children[0];
		expect(c.type).toBe('lesson');
		expect(c.title).toBe('Indexing');
		expect((c.brief as Record<string, unknown>).learning_objective).toBe('Use indexes well');
		expect((c.brief as Record<string, unknown>).duration_minutes).toBe(5);
	});

	it('gives every lesson a deliverable (run_engine skips deliverable-less children)', () => {
		const c = buildLessonChildren(lessons)[0];
		expect(c.deliverables).toHaveLength(1);
		expect(c.deliverables[0].format).toBe('16x9');
		expect(c.deliverables[0].target_duration_seconds).toBe(300);
	});

	it('omits dialogue by default (single-voice lessons)', () => {
		const c = buildLessonChildren(lessons)[0];
		expect((c.brief as Record<string, unknown>).dialogue).toBeUndefined();
	});

	it('propagates the course two-voice flag onto every child brief', () => {
		const children = buildLessonChildren(lessons, { dialogue: { enabled: true } });
		expect((children[0].brief as Record<string, unknown>).dialogue).toEqual({ enabled: true });
	});

	it('does not propagate a disabled dialogue flag', () => {
		const c = buildLessonChildren(lessons, { dialogue: { enabled: false } })[0];
		expect((c.brief as Record<string, unknown>).dialogue).toBeUndefined();
	});

	it('propagates the course sources onto every child brief (grounds lesson scripts)', () => {
		const c = buildLessonChildren(lessons, {
			sources: [
				{ kind: 'url', ref: '  https://acme.com  ', label: 'Acme' },
				{ kind: 'url', ref: '   ' }
			],
			mediaDiscovery: true
		})[0];
		const brief = c.brief as Record<string, unknown>;
		// Empty refs dropped + trimmed, just like buildBrief.
		expect(brief.sources).toEqual([{ kind: 'url', ref: 'https://acme.com', label: 'Acme' }]);
		expect(brief.media_discovery).toEqual({});
	});

	it('omits sources/media_discovery when the course has none', () => {
		const c = buildLessonChildren(lessons)[0];
		const brief = c.brief as Record<string, unknown>;
		expect(brief.sources).toBeUndefined();
		expect(brief.media_discovery).toBeUndefined();
	});

	it('propagates the course AI-video block onto every child brief', () => {
		// The block must reach the child verbatim and stay truthy: run_setup lifts
		// brief.ai_video_gen only when truthy and the stage skips on a falsy config.
		const c = buildLessonChildren(lessons, { aiVideoGen: { enabled: true } })[0];
		expect((c.brief as Record<string, unknown>).ai_video_gen).toEqual({ enabled: true });
	});

	it('omits ai_video_gen when the course has none', () => {
		const c = buildLessonChildren(lessons)[0];
		expect((c.brief as Record<string, unknown>).ai_video_gen).toBeUndefined();
	});
});

describe('buildBrief — authored shotlist (promo / website_review)', () => {
	const SHOTS = [
		{
			kind: 'url' as const,
			url: 'https://app.example.com/',
			narration: 'The dashboard on login.',
			directives: { hold_ms: 4000, viewport: 'desktop' as const, click: '', scroll_to: '  ' }
		},
		{
			kind: 'slide' as const,
			narration: 'Why teams switch.',
			slide: { template: 'bullets' as const, title: 'Why', bullets: ['Fast', '  ', 'Simple'] }
		}
	];

	it('attaches a cleaned shotlist for promo, order preserved', () => {
		const brief = buildBrief(makeInput('promo', { shotlist: SHOTS }));
		expect(brief.shotlist).toHaveLength(2);
		expect(brief.shotlist?.[0].kind).toBe('url');
		expect(brief.shotlist?.[1].kind).toBe('slide');
		// empty optional directive keys are stripped; blank bullets dropped
		const url = brief.shotlist?.[0];
		expect(url && 'directives' in url && url.directives.click).toBeUndefined();
		expect(url && 'directives' in url && url.directives.scroll_to).toBeUndefined();
		const slide = brief.shotlist?.[1];
		expect(slide && 'slide' in slide && slide.slide.bullets).toEqual(['Fast', 'Simple']);
	});

	it('coexists with the required target_url for website_review', () => {
		const brief = buildBrief(makeInput('website_review', { shotlist: SHOTS }));
		expect(brief.target_url).toBe('https://example.com');
		expect(brief.shotlist).toHaveLength(2);
	});

	it('omits brief.shotlist entirely when empty (opt-in)', () => {
		expect(buildBrief(makeInput('promo', { shotlist: [] })).shotlist).toBeUndefined();
		expect(buildBrief(makeInput('promo')).shotlist).toBeUndefined();
	});

	it('drops a URL shot without a url and a slide shot with no content', () => {
		const brief = buildBrief(
			makeInput('promo', {
				shotlist: [
					{
						kind: 'url',
						url: '   ',
						narration: 'no url',
						directives: { hold_ms: 3000, viewport: 'desktop' }
					},
					{ kind: 'slide', narration: '', slide: { template: 'title' } }
				]
			})
		);
		expect(brief.shotlist).toBeUndefined();
	});
});

describe('website_review — review checkpoints + duration floor', () => {
	it('writes pause_for_review=true by default (explicit, never inferred from absence)', () => {
		expect(buildBrief(makeInput('website_review')).pause_for_review).toBe(true);
	});

	it('writes pause_for_review=false when the operator opts out', () => {
		const brief = buildBrief(
			makeInput('website_review', { briefFields: { pause_for_review: false } })
		);
		expect(brief.pause_for_review).toBe(false);
	});

	it('does not add pause_for_review to types that do not declare the checkpoint', () => {
		expect(buildBrief(makeInput('promo'))).not.toHaveProperty('pause_for_review');
	});

	it('floors website_review at 10s and leaves other types unfloored', () => {
		expect(minDurationSecondsFor('website_review')).toBe(10);
		expect(minDurationSecondsFor('promo')).toBeNull();
	});
});

describe('clone_from_project_id on the draft-finalize PATCH (w2v_orchestrator#1116)', () => {
	const req = {
		title: 'T',
		type: 'promo',
		visibility: 'tenant',
		brief: { duration_seconds: 30 },
		brand: { color: '#000' },
		voice: { voice_id: 'af_heart' },
		theme: { name: 'dark' },
		deliverables: []
	} as unknown as Parameters<typeof buildFinalizePatch>[0];

	it('carries the clone source alongside the authored config', () => {
		expect(buildFinalizePatch({ ...req, clone_from_project_id: 'src-1' })).toEqual({
			title: 'T',
			brief: { duration_seconds: 30 },
			brand: { color: '#000' },
			voice: { voice_id: 'af_heart' },
			theme: { name: 'dark' },
			clone_from_project_id: 'src-1'
		});
	});

	it('omits the key when no clone source was picked (and never sends deliverables)', () => {
		const patch = buildFinalizePatch(req);
		expect(patch).not.toHaveProperty('clone_from_project_id');
		expect(patch).not.toHaveProperty('deliverables');
		expect(buildFinalizePatch({ ...req, clone_from_project_id: null })).not.toHaveProperty(
			'clone_from_project_id'
		);
	});
});

describe('cloneSourceNotFoundMessage', () => {
	it('names the clone select for a 404 clone_source_not_found', () => {
		const msg = cloneSourceNotFoundMessage({
			status: 404,
			details: { code: 'clone_source_not_found' }
		});
		expect(msg).toMatch(/Clone settings from/);
	});
	it('is null for any other 404 or error', () => {
		expect(cloneSourceNotFoundMessage({ status: 404, details: { code: 'nope' } })).toBeNull();
		expect(
			cloneSourceNotFoundMessage({ status: 400, details: { code: 'clone_source_not_found' } })
		).toBeNull();
		expect(cloneSourceNotFoundMessage(new Error('x'))).toBeNull();
		expect(cloneSourceNotFoundMessage(null)).toBeNull();
	});
});

describe('briefHasDraftableText — storyboard "Draft from brief" gate', () => {
	it('ignores numbers / booleans / objects (a duration alone is not draftable)', () => {
		expect(briefHasDraftableText({ target_duration_seconds: 30 })).toBe(false);
		expect(briefHasDraftableText({ duration_seconds: 120, pause_for_review: true })).toBe(false);
		expect(briefHasDraftableText({ sources: [{ kind: 'url', ref: 'x' }], audience: '   ' })).toBe(
			false
		);
		expect(briefHasDraftableText(null)).toBe(false);
		expect(briefHasDraftableText({})).toBe(false);
	});

	it('is true once any string field has text', () => {
		expect(briefHasDraftableText({ target_duration_seconds: 30, angle: 'Why X' })).toBe(true);
	});
});

describe('TYPE_BRIEF readers never throw on a non-pickable type', () => {
	it('growth_bundle has a spec (workspace of an API-created project renders)', () => {
		expect(typeBriefSpec('growth_bundle')).toEqual({ required: [] });
		const t = 'growth_bundle' as PickType;
		expect(typeIsAudit(t)).toBe(false);
		expect(userBriefKeys(t)).toEqual([]);
		expect(CREATABLE_PROJECT_TYPES).not.toContain('growth_bundle');
	});

	it('an unknown type reads as "no spec" instead of throwing', () => {
		const t = 'brand_new_type' as PickType;
		expect(typeBriefSpec(t)).toBeUndefined();
		expect(() => typeIsAudit(t)).not.toThrow();
		expect(typeIsAudit(t)).toBe(false);
		expect(typeIsScanOnlyAudit(t)).toBe(false);
		expect(typeUsesSourceUrl(t)).toBe(false);
		expect(typeUsesTargetUrl(t)).toBe(false);
		expect(sourceUrlOptional(t)).toBe(false);
		expect(requiredBriefKeys(t)).toEqual([]);
		expect(userBriefKeys(t)).toEqual([]);
		expect(minDurationSecondsFor(t)).toBeNull();
	});
});

describe('buildLessonChildren — course render settings reach each lesson', () => {
	const lessons: LessonDraft[] = [
		{ title: 'Intro', learning_objective: 'Know X', duration_minutes: 2 },
		{ title: 'Deep dive', learning_objective: 'Use X', duration_minutes: 3 }
	];

	it('copies the course resolution tier + ken_burns block onto every child brief', () => {
		const kb = { enabled: true, preset: 'zoom_in' as const };
		const children = buildLessonChildren(lessons, { resolution: '4k', kenBurns: kb });
		for (const c of children) {
			const brief = c.brief as Record<string, unknown>;
			expect(brief.resolution).toBe('4k');
			expect(brief.ken_burns).toEqual(kb);
		}
	});

	it('omits both when the course sets neither (lesson takes the default tier)', () => {
		const brief = buildLessonChildren(lessons, { resolution: '  ' })[0].brief as Record<
			string,
			unknown
		>;
		expect(brief).not.toHaveProperty('resolution');
		expect(brief).not.toHaveProperty('ken_burns');
	});
});

describe('buildBrief — output resolution tier lands on brief.resolution', () => {
	it.each(['1080p', '2k', '4k', ' 4K '])('writes the picked tier %s', (picked) => {
		const brief = buildBrief(makeInput('promo', { resolution: picked }));
		expect(brief.resolution).toBe(picked.trim().toLowerCase());
	});

	it('omits an unknown tier (720p) and an absent one', () => {
		expect(buildBrief(makeInput('promo', { resolution: '720p' }))).not.toHaveProperty('resolution');
		expect(buildBrief(makeInput('promo'))).not.toHaveProperty('resolution');
	});

	it('audiobook (audio-only) never gets a resolution', () => {
		expect(buildBrief(makeInput('audiobook', { resolution: '4k' }))).not.toHaveProperty(
			'resolution'
		);
	});

	it('the full request carries the tier on the brief, not the theme', () => {
		const req = buildProjectRequest(makeInput('generic', { resolution: '4k' }));
		expect(req.brief?.resolution).toBe('4k');
		expect(req.theme).not.toHaveProperty('resolution');
	});
});

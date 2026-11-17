import { describe, it, expect } from 'vitest';
import { resolveRenderer } from './registry';
import CutPlanTimeline from './CutPlanTimeline.svelte';
import ShotAnalysisSummary from './ShotAnalysisSummary.svelte';
import FootageProbeGrid from './FootageProbeGrid.svelte';
import SegmentSelectStrip from './SegmentSelectStrip.svelte';
import MusicSelectCard from './MusicSelectCard.svelte';
import GraphicsOverlayCards from './GraphicsOverlayCards.svelte';
import { isAuditScorecardOutput } from '$lib/utils/stage-output';
import type {
	ScriptOutput,
	NarrationOutput,
	GalleryOutput,
	AuditScorecardOutput,
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
	TextInsightOutput
} from './stage-outputs';

const id = (o: Record<string, unknown>) => resolveRenderer(o)?.id ?? null;

// Each fixture is typed to the interface it exercises (a compile-time check that
// the interface still carries the field the matcher reads), then cast to the
// registry boundary type (payloads genuinely arrive untyped). The generic helper
// keeps the fixture ↔ interface coupling honest while feeding resolveRenderer the
// Record<string, unknown> it expects.
const fixture = <T>(o: T): Record<string, unknown> => o as Record<string, unknown>;

// One representative payload per renderer id, in RENDERERS precedence order.
// Realistic enough that the FIRST correct matcher wins (e.g. audiobook-plan's
// chapters[] must not carry the artifact_url that would let narration claim it,
// and vice-versa) — see the precedence cases below.
const CASES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
	[
		'script',
		fixture<ScriptOutput>({ lines: [{ text: 'Meet your new dashboard.', speaker: 'a' }] })
	],
	[
		'narration',
		fixture<NarrationOutput>({
			clips: [{ line_id: 'L1', artifact_url: 'https://x/a.wav', seconds: 3.2 }]
		})
	],
	[
		'gallery',
		fixture<GalleryOutput>({ slides: [{ line_id: 'L1', image_url: 'https://x/s.png' }] })
	],
	[
		'audit-scorecard',
		fixture<AuditScorecardOutput>({
			grade: 'B',
			overall_score: 78,
			groups: [{ group: 'on_page', score: 90, weight: 0.22, count: 1 }]
		})
	],
	['critique', fixture<CritiqueOutput>({ findings: [{ title: 'Slow LCP', severity: 'high' }] })],
	[
		'redesign',
		fixture<RedesignOutput>({
			visuals: [{ label: 'Hero', role: 'after', image_url: 'https://x/v.png' }]
		})
	],
	[
		'cut-plan',
		fixture<CutPlanOutput>({
			shots: [
				{
					id: 'seg-1',
					source_id: 'src-a',
					video_url: 'https://x/a.mp4',
					in_seconds: 1.5,
					out_seconds: 3.5,
					seconds: 2,
					speed: 1,
					beat_index: 0,
					start_seconds: 0,
					beat_locked: true
				}
			],
			total_seconds: 2,
			bpm: 120,
			beat_grid_available: true,
			solver_stubbed: false
		})
	],
	[
		'segment-select',
		fixture<SegmentSelectOutput>({
			segments: [
				{
					id: 'seg-1',
					source_id: 'src-a',
					in_seconds: 2.0,
					out_seconds: 4.5,
					seconds: 2.5,
					score: 0.71,
					rationale: 'Widest motion in the clip.'
				}
			],
			near_duplicates_dropped: 1,
			near_duplicates_kept_for_coverage: 0,
			notes: []
		})
	],
	[
		'music-select',
		fixture<MusicSelectOutput>({
			track_id: 'trk-1',
			track_key: 'driving_synth',
			track_url: 'https://x/bed.mp3',
			duration_s: 32,
			bpm: 120,
			bpm_confidence: 0.9,
			beats: [0, 0.5, 1.0],
			downbeats: [0, 2.0],
			grid_source: 'librosa',
			meter: '4/4'
		})
	],
	[
		'graphics-design',
		fixture<GraphicsDesignOutput>({
			cards: [
				{ id: 'c1', shot_id: 'seg-1', kind: 'title', text: 'Ship it', at_seconds: 0, seconds: 3 }
			],
			cards_render_failed: false,
			notes: []
		})
	],
	[
		'storyboard',
		fixture<StoryboardOutput>({
			shots: [{ description: 'Wide establishing shot', visual_type: 'footage' }]
		})
	],
	[
		'media-discovery',
		fixture<MediaDiscoveryOutput>({
			items: [{ title: 'Clip', media_type: 'image', thumbnail_url: 'https://x/t.png' }]
		})
	],
	[
		'growth',
		fixture<GrowthOutput>({ snippets: [{ channel: 'linkedin', text: 'We shipped it.' }] })
	],
	[
		'visual-director',
		fixture<VisualDirectorOutput>({ assignments: [{ line_id: 'L1', screen_id: 'S1' }] })
	],
	[
		'shot-analysis',
		fixture<ShotAnalysisOutput>({
			sources: [
				{
					id: 'src-a',
					duration_s: 42,
					scene_boundaries: [1.2, 8.4],
					motion_timeline: [
						{ t: 0, motion: 0.1 },
						{ t: 0.25, motion: 0.4 }
					],
					motion_score: 0.72,
					overall_score: 0.81,
					error: ''
				}
			],
			notes: []
		})
	],
	[
		'footage-probe',
		fixture<FootageProbeOutput>({
			sources: [
				{
					id: 'src-a',
					filename: 'drone-pass.mp4',
					bytes: 134_217_728,
					content_type: 'video/mp4',
					preview_status: 'ready',
					duration_s: 6.006,
					fps: 23.976,
					codec: 'h264',
					width: 1920,
					height: 1080,
					preview_url: 'https://x/preview.mp4'
				}
			],
			total_duration_s: 6.006,
			notes: []
		})
	],
	[
		'source',
		fixture<SourceOutput>({
			grounding_text: 'The homepage sells a project tracker.',
			images: [{ url: 'https://x/i.png', source_ref: 'home' }]
		})
	],
	[
		'course-outline',
		fixture<CourseOutlineOutput>({
			intro_summary: 'A 3-part series.',
			sections: [{ title: 'Getting started', objective: 'Install the CLI' }]
		})
	],
	[
		'audiobook-plan',
		fixture<AudiobookPlanOutput>({
			chapters: [{ title: 'Chapter One', page_range: '1-14' }],
			chunks: [{ seconds: 42 }],
			casting: [{ speaker: 'Narrator', voice_id: 'af_heart' }]
		})
	],
	[
		'text-insight',
		fixture<TextInsightOutput>({
			pain_points: ['Slow onboarding'],
			hooks: ['Ship in a day'],
			prompts: [{ line_id: 'L1', prompt_text: 'A laptop on a desk' }]
		})
	]
];

describe('renderer registry', () => {
	it('the audit matcher agrees with isAuditScorecardOutput — no silent hero vanish', () => {
		// Regression: RunOutputPanel finds the audit stage with `isAuditStage` (grade +
		// a breakdown array) but rendered it via the registry matcher, which used to
		// ALSO require the first item to carry a string label + numeric score. A
		// `grade` + `groups: [{ score }]` payload (no `group` label) passed the former
		// and failed the latter → renderer null → hero + Download-PDF hidden with no
		// fallback. Both now share one predicate, so they can never disagree.
		const unlabelled = { grade: 'B', groups: [{ score: 70 }] };
		expect(isAuditScorecardOutput(unlabelled)).toBe(true);
		expect(id(unlabelled)).toBe('audit-scorecard');
	});

	it('resolves each known stage-output shape to its renderer', () => {
		expect(id({ lines: [{ text: 'hi' }] })).toBe('script');
		expect(id({ paragraphs: [{ text: 'hi' }] })).toBe('script');
		expect(id({ clips: [{ artifact_url: 'https://x/a.wav' }] })).toBe('narration');
		expect(id({ slides: [{ image_url: 'https://x/s.png' }] })).toBe('gallery');
		expect(id({ images: [{ artifact_url: 'https://x/i.png' }] })).toBe('gallery');
		expect(id({ motion_clips: [{ artifact_url: 'https://x/m.mp4' }] })).toBe('gallery');
		expect(id({ findings: [{ title: 'slow' }] })).toBe('critique');
		expect(
			id({ groups: [{ group: 'on_page', score: 90, weight: 0.22 }], grade: 'B', overall_score: 78 })
		).toBe('audit-scorecard');
		expect(
			id({
				subsections: [{ section: 'hero', score: 90, weight: 0.18 }],
				grade: 'A',
				overall_score: 82
			})
		).toBe('audit-scorecard');
		expect(
			id({
				dimensions: [{ dimension: 'content', score: 90, weight: 0.25 }],
				grade: 'B',
				overall_score: 78
			})
		).toBe('audit-scorecard');
		expect(id({ visuals: [{ image_url: 'https://x/v.png', role: 'after' }] })).toBe('redesign');
		// web_design_v2 assembly output: live preview / verification, no visuals.
		expect(id({ live_html_url: '/api/redesign/jobs/x/html' })).toBe('redesign');
		expect(id({ verification_report: { status: 'passed' } })).toBe('redesign');
		expect(id({ shots: [{ description: 'wide shot', visual_type: 'footage' }] })).toBe(
			'storyboard'
		);
		expect(id({ items: [{ thumbnail_url: 'https://x/t.png', media_type: 'image' }] })).toBe(
			'media-discovery'
		);
		expect(id({ snippets: [{ channel: 'linkedin', text: 'post' }] })).toBe('growth');
		expect(id({ assignments: [{ line_id: 'L1', screen_id: 'S1' }] })).toBe('visual-director');
	});

	// The regression net: every renderer id must resolve its representative,
	// interface-typed payload. Today only the audit/critique shapes are covered;
	// this proves all 14 matchers still fire after the typed-narrow conversion.
	it.each(CASES)('resolves the %s fixture to its renderer', (expected, payload) => {
		expect(id(payload)).toBe(expected);
	});

	it('covers all 20 renderer ids exactly once, in precedence order', () => {
		const ids = CASES.map(([expected]) => expected);
		expect(ids).toHaveLength(20);
		expect(new Set(ids).size).toBe(20);
	});

	// action_reel precedence. cut-plan sits immediately BEFORE storyboard because
	// both key on shots[]; the two stay disjoint by shape, and this asserts the
	// separation in BOTH directions so neither can start stealing the other.
	it('cut-plan wins for a cut plan and never claims a storyboard (precedence)', () => {
		expect(id(CASES.find(([e]) => e === 'cut-plan')![1])).toBe('cut-plan');
		// A storyboard payload has no source trim and no beat/plan scalar.
		expect(id(CASES.find(([e]) => e === 'storyboard')![1])).toBe('storyboard');
		expect(id({ shots: [{ description: 'wide', visual_type: 'footage', seconds: 3 }] })).toBe(
			'storyboard'
		);
		// A degraded plan (no bpm, no grid) is still a cut plan.
		expect(
			id({
				shots: [{ source_id: 'src-a', in_seconds: 0, out_seconds: 2, beat_locked: false }],
				solver_stubbed: true,
				beat_grid_available: false
			})
		).toBe('cut-plan');
		// total_seconds alone must NOT make a script look like a cut plan.
		expect(id({ lines: [{ text: 'hi' }], total_seconds: 30 })).toBe('script');
		// shots[] with neither a source trim nor a plan scalar belongs to nobody.
		expect(id({ shots: [{ id: 'x' }] })).toBeNull();
	});

	// ── the three action_reel gate renderers ──
	// REVERTED (any of the three `match:` bodies weakened to `() => false`) ⇒ these
	// four cases go red. Without them the entire suite stayed green while every
	// action_reel gate silently fell back to the raw-JSON wall this work exists to
	// remove — a reviewer approving a paid run off a JSON dump.
	it('resolves the segment_select / music_select / graphics_design payloads to their renderers', () => {
		const seg = CASES.find(([e]) => e === 'segment-select')![1];
		const music = CASES.find(([e]) => e === 'music-select')![1];
		const gfx = CASES.find(([e]) => e === 'graphics-design')![1];
		expect(id(seg)).toBe('segment-select');
		expect(resolveRenderer(seg)?.component).toBe(SegmentSelectStrip);
		expect(id(music)).toBe('music-select');
		expect(resolveRenderer(music)?.component).toBe(MusicSelectCard);
		expect(id(gfx)).toBe('graphics-design');
		expect(resolveRenderer(gfx)?.component).toBe(GraphicsOverlayCards);
	});

	it('segment-select does NOT claim promo html_segments (no source_id, no trim)', () => {
		// PromoHtmlSegment = {id, image_url, label}. Claiming it would print
		// "0.00→0.00s" trims and an empty coverage bar as an affirmative reading of a
		// payload that has no time dimension at all.
		expect(
			id({
				segments: [
					{ id: 'p1', image_url: 'https://x/hero.png', label: 'Hero' },
					{ id: 'p2', image_url: 'https://x/cta.png', label: 'CTA' }
				]
			})
		).toBeNull();
		// Both halves are required — a source_id with no numeric trim is not enough…
		expect(id({ segments: [{ id: 's1', source_id: 'src-a' }] })).toBeNull();
		// …and a trim with no source_id is not enough either.
		expect(id({ segments: [{ id: 's1', in_seconds: 1, out_seconds: 2 }] })).toBeNull();
	});

	it('a cut_plan payload still resolves to cut-plan, never to music-select', () => {
		// cut_plan carries the same music FACTS under different KEYS (`music_url` /
		// `music_track_id`, plus `bpm`), and sits immediately before the three gate
		// entries. If music-select ever loosened to `bpm`/`music_url`, the cut plan
		// would render as a music card and the timeline would vanish.
		expect(
			id({
				shots: [{ id: 'seg-1', source_id: 'src-a', in_seconds: 0, out_seconds: 2, beat_index: 0 }],
				bpm: 120,
				music_url: 'https://x/bed.mp3',
				music_track_id: 'trk-1',
				beat_grid_available: true
			})
		).toBe('cut-plan');
		// music-select keys on `track_id`, which cut_plan never emits.
		expect(id({ bpm: 120, music_url: 'https://x/bed.mp3' })).toBeNull();
	});

	it('footage-probe claims a probe payload and shot-analysis never does', () => {
		// The two action_reel siblings share `sources[]` in the SAME run. ProbedSource
		// carries filename/content_type/preview_status and NO measurement field;
		// AnalyzedSource carries the measurements and NO filename. Assert the
		// separation in BOTH directions — shot-analysis claiming a probe payload
		// would print "0 cuts / no motion curve", an affirmative false measurement,
		// and footage-probe claiming an analysis payload would print "not probed"
		// over real numbers.
		const probe = {
			sources: [
				{
					id: 'src-a',
					filename: 'clip.mp4',
					bytes: 1024,
					content_type: 'video/mp4',
					preview_status: 'ready',
					duration_s: 6.006,
					fps: 24,
					codec: 'h264',
					width: 1920,
					height: 1080
				}
			]
		};
		expect(id(probe)).toBe('footage-probe');
		expect(resolveRenderer(probe)?.component).toBe(FootageProbeGrid);
		// The regression that matters: a shot_analysis payload stays with its own
		// renderer even though footage-probe now reads the same array.
		const analysis = CASES.find(([e]) => e === 'shot-analysis')![1];
		expect(id(analysis)).toBe('shot-analysis');
		expect(resolveRenderer(analysis)?.component).toBe(ShotAnalysisSummary);
		// A `failed` derivative — no preview_url at all — must STILL be claimed:
		// the one payload a reviewer most needs the rich surface for.
		expect(
			id({
				sources: [{ id: 's1', filename: 'broken.mov', bytes: 12, preview_status: 'failed' }],
				notes: ['source s1 preview_status=failed']
			})
		).toBe('footage-probe');
		// filename alone is not enough (no upload descriptor beside it), and a bare
		// provider-name list is still nobody's payload.
		expect(id({ sources: [{ filename: 'clip.mp4' }] })).toBeNull();
	});

	it('shot-analysis claims sources[] measurements and not a source gallery', () => {
		expect(id(CASES.find(([e]) => e === 'shot-analysis')![1])).toBe('shot-analysis');
		// The `source` renderer's payload keys on images[]/grounding_text — disjoint.
		expect(id(CASES.find(([e]) => e === 'source')![1])).toBe('source');
		// A bare provider-name list under `sources` is not a measurement payload.
		expect(id({ sources: ['unsplash', 'pexels'] })).toBeNull();
		expect(id({ sources: [{ id: 'src-a' }] })).toBeNull();
	});

	it('audiobook-plan wins over narration for a plan payload (precedence)', () => {
		// audiobook-plan sits BEFORE narration in the table only via shape: a plan
		// carries chapters/chunks/casting but no clips[].artifact_url, so narration
		// never claims it. Assert the intended winner on the realistic shape.
		expect(id(CASES.find(([e]) => e === 'audiobook-plan')![1])).toBe('audiobook-plan');
		// And a genuine narration payload (clips[].artifact_url, no chapters) resolves
		// to narration — the two shapes stay disjoint.
		expect(id({ clips: [{ artifact_url: 'https://x/a.wav' }] })).toBe('narration');
	});

	it('does NOT claim rubric-review items (no media_type) — falls to generic', () => {
		// review output: items[] + overall_score, scored by criterion — no renderer
		// owns this shape yet, so it must drop through to the generic fallback.
		expect(id({ items: [{ criterion: 'clarity', score: 4 }], overall_score: 4 })).toBeNull();
	});

	it('returns null for unknown / empty payloads', () => {
		expect(id({ foo: 'bar' })).toBeNull();
		expect(resolveRenderer({})).toBeNull();
		expect(resolveRenderer(null)).toBeNull();
		expect(resolveRenderer(undefined)).toBeNull();
	});

	// Phase 5 — decision-provenance renderers (added alongside the 14 above).
	it('resolves a render_manifest override-ledger payload to render-manifest', () => {
		expect(
			id({ manifest: { override_ledger: [{ key: 'music.track', value: 'x', source: 'default' }] } })
		).toBe('render-manifest');
		// A manifest without a ledger array must NOT claim it.
		expect(id({ manifest: { master_seed: 1 } })).toBeNull();
	});

	it('an ANNOTATED lines[] payload resolves to script-pacing, ahead of script', () => {
		expect(id({ lines: [{ text: 'Hook line.', beat_role: 'hook' }] })).toBe('script-pacing');
		expect(id({ lines: [{ text: 'x', clip_anchor: 'start' }] })).toBe('script-pacing');
		expect(id({ lines: [{ text: 'x', doctor_note: 'tightened' }] })).toBe('script-pacing');
		expect(id({ lines: [{ text: 'x', pin_position: 0 }] })).toBe('script-pacing');
	});

	it('a PLAIN lines[].text payload (no annotations) still resolves to script — no regression', () => {
		expect(id({ lines: [{ text: 'Meet your new dashboard.', speaker: 'a' }] })).toBe('script');
		expect(id({ paragraphs: [{ text: 'A lesson paragraph.' }] })).toBe('script');
	});

	// ── LIVE payloads, copied verbatim off a paused action_reel run ──
	// The fixtures above are hand-written; these two are the exact bodies the
	// orchestrator persisted for the `shot_analysis` and `cut_plan` gate stages.
	// They exist because the renderers were unit-green and still invisible to a
	// reviewer: the gate-review route
	// (routes/projects/[pid]/runs/[id]/stages/[stage]/+page.svelte) printed the raw
	// payload instead of mounting StageOutputView. The route now renders through
	// StageOutputView; these assert the registry half of that path resolves the
	// REAL shapes, not just the idealised ones.
	it('resolves the LIVE shot_analysis gate payload to ShotAnalysisSummary', () => {
		const live = {
			notes: [],
			sources: [
				{
					id: '019ff060-8a1e-7c31-9f4c-5c1d2b3a4e5f',
					error: '',
					duration_s: 6.006,
					motion_score: 0.2796,
					overall_score: 0.356,
					mean_sharpness: 89.2,
					mean_brightness: 128.0,
					motion_timeline: [{ t: 4.805, motion: 0.328 }],
					scene_boundaries: [0, 1.201, 2.402, 3.604, 4.805]
				}
			]
		};
		expect(id(live)).toBe('shot-analysis');
		expect(resolveRenderer(live)?.component).toBe(ShotAnalysisSummary);
	});

	it('resolves the LIVE cut_plan gate payload to CutPlanTimeline', () => {
		const live = {
			shots: [
				{
					id: 'seg-1',
					source_id: '019ff060',
					seconds: 1.333,
					speed: 0.9,
					beat_locked: true,
					in_seconds: 2.0,
					out_seconds: 3.2
				}
			],
			beat_grid_available: true,
			solver_stubbed: false,
			shortfall_seconds: 0.0,
			total_seconds: 19.79,
			frame_rate: 24.0,
			notes: []
		};
		expect(id(live)).toBe('cut-plan');
		expect(resolveRenderer(live)?.component).toBe(CutPlanTimeline);
	});
});

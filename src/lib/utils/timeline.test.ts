import { describe, it, expect } from 'vitest';
import { resolveClipSpine, resolveVideoStage, activeClipAt, type Clip } from './timeline';
import type { RunDetail } from '$lib/types/runs';

function run(stages: Array<Record<string, unknown>>): RunDetail {
	return { stage_outputs: stages } as unknown as RunDetail;
}

const completed = (stage_name: string, output: Record<string, unknown>) => ({
	stage_name,
	status: 'completed',
	output
});

describe('resolveClipSpine', () => {
	it('prefers a shots[] storyboard over a lines[] script and skips the video stage', () => {
		const r = run([
			completed('promo_script', { lines: [{ id: 'l1', text: 'hi' }] }),
			completed('promo_storyboard', {
				shots: [
					{ id: 's1', seconds: 3, description: 'one', visual_type: 'footage' },
					{ id: 's2', seconds: 4, description: 'two', visual_type: 'slide' }
				]
			}),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		const spine = resolveClipSpine(r);
		expect(spine?.stageName).toBe('promo_storyboard');
		expect(spine?.key).toBe('shots');
		expect(spine?.clips.map((c) => c.id)).toEqual(['s1', 's2']);
		// Cumulative offsets.
		expect(spine?.clips[0].startSec).toBe(0);
		expect(spine?.clips[1].startSec).toBe(3);
		expect(spine?.clips[1].visualType).toBe('slide');
	});

	it('falls back to lines[] for demo_video runs (no shots stage)', () => {
		const r = run([
			completed('demo_video_gen', {
				lines: [
					{ id: 'clip-1', seconds: 5, text: 'intro' },
					{ id: 'clip-2', seconds: 6, text: 'feature' }
				]
			}),
			completed('demo_video_compile', { artifact_url: 'http://x/v.mp4' })
		]);
		const spine = resolveClipSpine(r);
		expect(spine?.stageName).toBe('demo_video_gen');
		expect(spine?.key).toBe('lines');
		expect(spine?.clips.map((c) => c.description)).toEqual(['intro', 'feature']);
		// On a lines[] spine the line's own text IS the narration.
		expect(spine?.clips.map((c) => c.narration)).toEqual(['intro', 'feature']);
	});

	it('reads the spoken line off a shot spine (narration, not description)', () => {
		const r = run([
			completed('promo_storyboard', {
				shots: [
					{ id: 's1', seconds: 3, description: 'wide shot of the app', narration: 'Ship faster.' }
				]
			}),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		const spine = resolveClipSpine(r);
		expect(spine?.clips[0].description).toBe('wide shot of the app');
		expect(spine?.clips[0].narration).toBe('Ship faster.');
	});

	it('returns null when there is no clip timeline', () => {
		const r = run([completed('audiobook_stitch', { combined: { artifact_url: 'a.mp3' } })]);
		expect(resolveClipSpine(r)).toBeNull();
	});

	// ── clip_spine_stage: the authoritative spine, immune to stage_outputs order ──
	// On live run 01a08f79-ab79-7359-9656-3238c07e19ff (demo_video_v1) FOUR stages
	// carry an identical lines[] of the same ids; only `demo_video_gen` is a legal
	// reorder spine server-side, and the orchestrator's list_for_run has no
	// ORDER BY — so shape-guessing POSTs a 422 stage 3 times out of 4.
	const fourLineStages = () => {
		const lines = [
			{ id: 'clip-1', seconds: 5, text: 'one' },
			{ id: 'clip-3', seconds: 6, text: 'three' },
			{ id: 'clip-4', seconds: 4, text: 'four' },
			{ id: 'clip-5', seconds: 3, text: 'five' }
		];
		return {
			gen: completed('demo_video_gen', { lines }),
			doctor: completed('script_doctor', { lines }),
			retention: completed('retention_plan', { lines }),
			reconcile: completed('reconcile_timeline', { lines }),
			compile: completed('demo_video_compile', { artifact_url: 'http://x/v.mp4' })
		};
	};

	const spineRun = (
		stages: Array<Record<string, unknown>>,
		clip_spine_stage: string | null
	): RunDetail => ({ ...run(stages), clip_spine_stage }) as unknown as RunDetail;

	it('resolves the named clip_spine_stage when it is FIRST in stage_outputs', () => {
		const s = fourLineStages();
		const spine = resolveClipSpine(
			spineRun([s.gen, s.doctor, s.retention, s.reconcile, s.compile], 'demo_video_gen')
		);
		expect(spine?.stageName).toBe('demo_video_gen');
		expect(spine?.key).toBe('lines');
		expect(spine?.clips.map((c) => c.id)).toEqual(['clip-1', 'clip-3', 'clip-4', 'clip-5']);
		// The server NAMED this stage — this is the only case that may be reordered.
		expect(spine?.reorderable).toBe(true);
	});

	it('resolves the same clip_spine_stage when it is LAST in stage_outputs', () => {
		const s = fourLineStages();
		const spine = resolveClipSpine(
			spineRun([s.doctor, s.retention, s.reconcile, s.compile, s.gen], 'demo_video_gen')
		);
		expect(spine?.stageName).toBe('demo_video_gen');
		expect(spine?.reorderable).toBe(true);
	});

	it('resolves the same clip_spine_stage from a third, interleaved ordering', () => {
		const s = fourLineStages();
		const spine = resolveClipSpine(
			spineRun([s.reconcile, s.gen, s.compile, s.doctor, s.retention], 'demo_video_gen')
		);
		expect(spine?.stageName).toBe('demo_video_gen');
		expect(spine?.reorderable).toBe(true);
	});

	// ⚠️ REGRESSION GUARD. This test previously asserted the OPPOSITE — that a
	// `clip_spine_stage: null` returned null outright. That tightening emptied the
	// Studio timeline on 9 of the 16 blueprints in the registry (action_reel_v1,
	// audiobook_v1, cro_audit_v1, growth_bundle_v1, marketing_scorecard_v1,
	// seo_audit_v1, web_design_v1/v2, website_review_v1) — several of which render
	// a real, working timeline today — and took annotations, clip edits, soundtrack
	// save and per-clip regenerate down with it. Reorder was ALREADY 422-ing there;
	// display was not broken and must not become broken. Do not re-tighten this.
	it('still DISPLAYS clips when clip_spine_stage is null, but marks them not reorderable', () => {
		const s = fourLineStages();
		const spine = resolveClipSpine(spineRun([s.gen, s.doctor, s.compile], null));
		expect(spine).not.toBeNull();
		expect(spine?.clips.map((c) => c.id)).toEqual(['clip-1', 'clip-3', 'clip-4', 'clip-5']);
		expect(spine?.reorderable).toBe(false);
	});

	it('still DISPLAYS a shots[] spine when clip_spine_stage is null (action_reel shape)', () => {
		// `action_reel_v1` renders `cut_plan.shots[]` and has no reorderable spine.
		const spine = resolveClipSpine(
			spineRun(
				[
					completed('cut_plan', {
						shots: [
							{ id: 'sh1', seconds: 2, description: 'one' },
							{ id: 'sh2', seconds: 3, description: 'two' }
						]
					}),
					completed('action_reel_compile', { artifact_url: 'http://x/v.mp4' })
				],
				null
			)
		);
		expect(spine?.stageName).toBe('cut_plan');
		expect(spine?.key).toBe('shots');
		expect(spine?.clips.map((c) => c.id)).toEqual(['sh1', 'sh2']);
		expect(spine?.reorderable).toBe(false);
	});

	it('returns null when clip_spine_stage names a stage that is not completed', () => {
		const s = fourLineStages();
		const r = spineRun(
			[
				// Carries a FULL, valid lines[] — so only the status check can make
				// this null. With `output: null` the test would pass even with the
				// status check deleted (verified: that mutation stayed green).
				{ ...s.gen, status: 'running' },
				s.doctor,
				s.compile
			],
			'demo_video_gen'
		);
		expect(resolveClipSpine(r)).toBeNull();
	});

	it('returns null when clip_spine_stage names a stage absent from stage_outputs', () => {
		// NO heuristic fallback here: `s.doctor` carries a perfectly good lines[]
		// that the heuristic would happily return. The server NAMED a stage and it
		// did not resolve — a real inconsistency, not a legacy response.
		const s = fourLineStages();
		expect(resolveClipSpine(spineRun([s.doctor, s.compile], 'demo_video_gen'))).toBeNull();
	});

	it('returns null when the named stage completed but carries no id-bearing array', () => {
		const s = fourLineStages();
		const r = spineRun(
			[completed('demo_video_gen', { summary: 'no clips here' }), s.doctor, s.compile],
			'demo_video_gen'
		);
		expect(resolveClipSpine(r)).toBeNull();
	});

	it('falls back to the shape heuristic when clip_spine_stage is ABSENT, NOT reorderable', () => {
		// No clip_spine_stage key at all = an orchestrator predating the field —
		// a rollout-window case that self-heals once the backend ships. We cannot
		// know which stage the server would accept, so we render but never offer a
		// reorder: on this very run the heuristic picks `reconcile_timeline`, which
		// the reorder route 422s.
		const s = fourLineStages();
		const spine = resolveClipSpine(run([s.gen, s.doctor, s.retention, s.reconcile, s.compile]));
		expect(spine?.stageName).toBe('reconcile_timeline');
		expect(spine?.clips.map((c) => c.id)).toEqual(['clip-1', 'clip-3', 'clip-4', 'clip-5']);
		expect(spine?.reorderable).toBe(false);
	});

	it('ignores pending stages and elements without a string id', () => {
		const r = run([
			{ stage_name: 'promo_storyboard', status: 'pending', output: null },
			completed('storyboard_draft', { shots: [{ id: 42 }, { id: 'ok', seconds: 2 }] })
		]);
		const spine = resolveClipSpine(r);
		expect(spine?.clips.map((c) => c.id)).toEqual(['ok']);
	});
});

describe('clip thumbnails (still-index join)', () => {
	it('joins a promo shot to its ai_image_gen still by line_id, preferring it over slides', () => {
		const r = run([
			completed('promo_script', { lines: [{ id: 'l1', text: 'hi' }] }),
			completed('promo_slides', {
				slides: [{ id: 'sl1', line_id: 'l1', image_url: '/api/slide.png' }]
			}),
			completed('ai_image_gen', {
				images: [{ id: 'i1', line_id: 'l1', image_url: '/api/ai.png' }]
			}),
			completed('promo_storyboard', {
				shots: [
					{ id: 's1', line_id: 'l1', seconds: 3, description: 'one', visual_type: 'ai_image' }
				]
			}),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		const spine = resolveClipSpine(r);
		// ai_image_gen is scanned before promo_slides in stage order → wins.
		expect(spine?.clips[0].thumbnailUrl).toBe('/api/ai.png');
		expect(spine?.clips[0].posterVideoUrl).toBeNull();
	});

	it('falls back to promo_slides when the shot has no ai_image still', () => {
		const r = run([
			completed('promo_slides', {
				slides: [{ id: 'sl1', line_id: 'l1', image_url: '/api/slide.png' }]
			}),
			completed('promo_storyboard', {
				shots: [{ id: 's1', line_id: 'l1', seconds: 3, description: 'one' }]
			}),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		expect(resolveClipSpine(r)?.clips[0].thumbnailUrl).toBe('/api/slide.png');
	});

	it('uses a recorded clip video as the poster when no still exists (demo_video)', () => {
		const r = run([
			completed('demo_video_record', {
				clips: [{ id: 'r1', line_id: 'clip-1', video_url: '/api/clip1.mp4' }]
			}),
			completed('demo_video_gen', { lines: [{ id: 'clip-1', seconds: 5, text: 'intro' }] }),
			completed('demo_video_compile', { artifact_url: 'http://x/v.mp4' })
		]);
		const clip = resolveClipSpine(r)?.clips[0];
		expect(clip?.thumbnailUrl).toBeNull();
		expect(clip?.posterVideoUrl).toBe('/api/clip1.mp4');
	});

	it('positionally maps images to shots when the generic pipeline has no line_id', () => {
		const r = run([
			completed('ai_image_gen', {
				images: [
					{ id: 'i1', image_url: '/api/a.png' },
					{ id: 'i2', image_url: '/api/b.png' }
				]
			}),
			completed('storyboard_draft', {
				shots: [
					{ id: 's1', description: 'one' },
					{ id: 's2', description: 'two' }
				]
			}),
			completed('video_render', { artifact_url: 'http://x/v.mp4' })
		]);
		const clips = resolveClipSpine(r)?.clips;
		expect(clips?.[0].thumbnailUrl).toBe('/api/a.png');
		expect(clips?.[1].thumbnailUrl).toBe('/api/b.png');
	});

	it('does not positionally hand a line_id-joined still to an unmatched clip', () => {
		// A still joined to clip 'l1' must never leak into the positional pool and
		// get handed to a sibling clip that carries no clean join of its own.
		const r = run([
			completed('ai_image_gen', {
				images: [{ id: 'i1', line_id: 'l1', image_url: '/api/joined.png' }]
			}),
			completed('promo_storyboard', {
				shots: [
					{ id: 's1', line_id: 'l1', description: 'matched' },
					{ id: 's2', description: 'unmatched' } // no line_id → no clean join
				]
			}),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		const clips = resolveClipSpine(r)?.clips;
		expect(clips?.[0].thumbnailUrl).toBe('/api/joined.png');
		expect(clips?.[1].thumbnailUrl).toBeNull();
	});

	it('leaves thumbnailUrl null when no producer still is present', () => {
		const r = run([
			completed('promo_storyboard', { shots: [{ id: 's1', line_id: 'l1', description: 'one' }] }),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		expect(resolveClipSpine(r)?.clips[0].thumbnailUrl).toBeNull();
	});
});

describe('merged-edit fields on a re-stitched spine', () => {
	// `POST /api/runs/{id}/apply-edits` shallow-merges every editable clip field
	// onto the CHILD run's spine element, so these keys are really present when a
	// run has been re-stitched. Reading them is what makes the Studio inspector
	// report the run's actual state instead of the unauthored default.
	const spineWith = (shot: Record<string, unknown>) =>
		run([
			completed('promo_storyboard', { shots: [{ id: 's1', seconds: 3, ...shot }] }),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
	const clipWith = (shot: Record<string, unknown>) => resolveClipSpine(spineWith(shot))!.clips[0];

	it('surfaces a merged audio block (gain + mute)', () => {
		expect(clipWith({ audio: { gain_db: -12, mute: true } }).audio).toEqual({
			gain_db: -12,
			mute: true
		});
	});

	it('surfaces a merged speed', () => {
		expect(clipWith({ speed: 2 }).speed).toBe(2);
	});

	it('surfaces a merged transition, defaulting a missing duration to 0.5s', () => {
		expect(clipWith({ transition: { type: 'fade', duration: 1.2 } }).transition).toEqual({
			type: 'fade',
			duration: 1.2
		});
		expect(clipWith({ transition: { type: 'dissolve' } }).transition).toEqual({
			type: 'dissolve',
			duration: 0.5
		});
	});

	it('surfaces a merged color grade', () => {
		expect(clipWith({ adjust: { brightness: 0.2, preset: 'cinematic' } }).adjust).toEqual({
			brightness: 0.2,
			preset: 'cinematic'
		});
	});

	it('surfaces merged overlays, keeping text + position', () => {
		const overlays = clipWith({
			overlays: [{ text: 'Buy now', position: 'top-left', font_size: 64 }]
		}).overlays;
		expect(overlays).toEqual([{ text: 'Buy now', position: 'top-left', font_size: 64 }]);
	});

	it('surfaces a merged voiceover (audio_url + audio_seconds)', () => {
		const clip = clipWith({ audio_url: 'https://cdn/vo.mp3', audio_seconds: 12.4 });
		expect(clip.audioUrl).toBe('https://cdn/vo.mp3');
		expect(clip.audioSeconds).toBe(12.4);
	});

	it('yields the documented defaults for an unedited clip (no such keys)', () => {
		// The regression guard for a freshly-generated run: every merged-edit field
		// must stay `null` so the page falls through to 1× / cut / {} / [] / {} /
		// no voiceover. A `0` here (e.g. from `num()`) would read as authored.
		const clip = clipWith({ description: 'plain shot' });
		expect(clip.speed).toBeNull();
		expect(clip.transition).toBeNull();
		expect(clip.adjust).toBeNull();
		expect(clip.overlays).toBeNull();
		expect(clip.audio).toBeNull();
		expect(clip.audioUrl).toBeNull();
		expect(clip.audioSeconds).toBeNull();
	});

	it('falls back to the default on a malformed spine node instead of throwing', () => {
		const clip = clipWith({
			audio: 'nope',
			overlays: {},
			adjust: 7,
			transition: { type: 'teleport', duration: 1 },
			speed: 'fast',
			audio_url: 42,
			audio_seconds: 'long'
		});
		expect(clip.audio).toBeNull();
		expect(clip.overlays).toBeNull();
		expect(clip.adjust).toBeNull();
		expect(clip.transition).toBeNull();
		expect(clip.speed).toBeNull();
		expect(clip.audioUrl).toBeNull();
		expect(clip.audioSeconds).toBeNull();
	});

	it('drops junk entries inside an otherwise valid overlay list', () => {
		const clip = clipWith({ overlays: [{ position: 'top-left' }, null, 5, { text: 'keep me' }] });
		expect(clip.overlays).toEqual([{ text: 'keep me' }]);
	});

	it('rejects a non-positive speed (no frames) and an empty grade object', () => {
		expect(clipWith({ speed: 0 }).speed).toBeNull();
		expect(clipWith({ speed: -1 }).speed).toBeNull();
		expect(clipWith({ adjust: {} }).adjust).toBeNull();
		expect(clipWith({ audio: {} }).audio).toBeNull();
		expect(clipWith({ overlays: [] }).overlays).toBeNull();
	});
});

describe('resolveVideoStage', () => {
	it('finds the terminal video stage by shape', () => {
		const r = run([
			completed('promo_storyboard', { shots: [{ id: 's1' }] }),
			completed('promo_render', { artifact_url: 'http://x/v.mp4' })
		]);
		expect(resolveVideoStage(r)?.stage_name).toBe('promo_render');
	});
});

describe('activeClipAt', () => {
	const clips: Clip[] = [
		{
			id: 'a',
			lineId: null,
			index: 0,
			seconds: 3,
			startSec: 0,
			description: '',
			narration: '',
			visualType: null,
			thumbnailUrl: null,
			posterVideoUrl: null,
			isFootage: false,
			clipLeadSeconds: 0,
			clipAnchor: 'start',
			caption: '',
			fit: null,
			speed: null,
			transition: null,
			adjust: null,
			overlays: null,
			audio: null,
			audioUrl: null,
			audioSeconds: null
		},
		{
			id: 'b',
			lineId: null,
			index: 1,
			seconds: 4,
			startSec: 3,
			description: '',
			narration: '',
			visualType: null,
			thumbnailUrl: null,
			posterVideoUrl: null,
			isFootage: false,
			clipLeadSeconds: 0,
			clipAnchor: 'start',
			caption: '',
			fit: null,
			speed: null,
			transition: null,
			adjust: null,
			overlays: null,
			audio: null,
			audioUrl: null,
			audioSeconds: null
		}
	];
	it('maps a playhead time to the covering clip', () => {
		expect(activeClipAt(clips, 0)).toBe('a');
		expect(activeClipAt(clips, 2.9)).toBe('a');
		expect(activeClipAt(clips, 3)).toBe('b');
		expect(activeClipAt(clips, 100)).toBe('b'); // clamps past the end
	});
	it('falls back to the first clip when durations are unknown', () => {
		const zero = clips.map((c) => ({ ...c, seconds: 0, startSec: 0 }));
		expect(activeClipAt(zero, 10)).toBe('a');
	});
	it('returns null for an empty timeline', () => {
		expect(activeClipAt([], 1)).toBeNull();
	});
});

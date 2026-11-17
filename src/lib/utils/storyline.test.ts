import { describe, it, expect } from 'vitest';
import { buildStoryline, storylineSummary } from './storyline';
import type { RunDetail } from '$lib/types/runs';

function run(stage_outputs: unknown[]): RunDetail {
	return { stage_outputs } as unknown as RunDetail;
}
const completed = (stage_name: string, output: unknown) => ({
	stage_name,
	status: 'completed',
	output
});

describe('buildStoryline', () => {
	it('returns [] when no stage exposes a line key', () => {
		const r = run([completed('critique', { findings: [{ title: 'x', severity: 'high' }] })]);
		expect(buildStoryline(r)).toEqual([]);
	});

	it('joins script + narration + slides by line_id into ordered cards', () => {
		const r = run([
			completed('script', {
				lines: [
					{ id: 'L1', text: 'Hook line', seconds: 3, speaker: 'a' },
					{ id: 'L2', text: 'Payoff line', seconds: 4, speaker: 'b' }
				]
			}),
			completed('narrate', {
				clips: [
					{ line_id: 'L1', artifact_url: 'https://x/a1.wav', seconds: 3 },
					{ line_id: 'L2', artifact_url: 'https://x/a2.wav', seconds: 4 }
				]
			}),
			completed('slides', {
				slides: [{ line_id: 'L1', image_url: 'https://x/s1.png' }]
			}),
			completed('storyboard', {
				shots: [{ line_id: 'L1', description: 'Screen recording', visual_type: 'footage' }]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.lineId)).toEqual(['L1', 'L2']);
		expect(lines[0]).toMatchObject({
			text: 'Hook line',
			speaker: 'a',
			audioUrl: 'https://x/a1.wav',
			imageUrl: 'https://x/s1.png',
			shot: 'Screen recording',
			visualType: 'footage'
		});
		expect(lines[1].audioUrl).toBe('https://x/a2.wav');
		expect(lines[1].imageUrl).toBeUndefined();
	});

	it('skips non-completed stages', () => {
		const r = run([
			{ stage_name: 'script', status: 'running', output: { lines: [{ id: 'L1', text: 'x' }] } }
		]);
		expect(buildStoryline(r)).toEqual([]);
	});

	it('summarises layer coverage', () => {
		const r = run([
			completed('script', {
				lines: [
					{ id: 'L1', text: 'a', seconds: 2 },
					{ id: 'L2', text: 'b', seconds: 3 }
				]
			}),
			completed('narrate', { clips: [{ line_id: 'L1', artifact_url: 'https://x/a.wav' }] })
		]);
		const s = storylineSummary(buildStoryline(r));
		expect(s).toMatchObject({
			count: 2,
			totalSeconds: 5,
			withText: 2,
			withAudio: 1,
			withVisual: 0
		});
	});
});

// The producers below are not invented — every field name and every id relationship
// was read off completed runs on the live database (2026-08-07). The pipeline grew
// several key schemes over time (`line_id` vs `paragraph_id` vs plural `*_ids`, video
// under `clips[].video_url`, rendered images under `recordings[]`/`visuals[]` addressed
// by id), and the join has to speak all of them or the storyboard silently under-reports
// the visuals that were actually produced.
describe('buildStoryline — real producer shapes', () => {
	it('demo_video: record clips carry per-line video under video_url', () => {
		// demo_video_v1 run 019fdad8: narrate emits .wav under artifact_url, record emits
		// .mp4 under video_url. Both key by line_id. There is no slides stage at all.
		const r = run([
			completed('demo_video_gen', {
				lines: [
					{ id: 'clip-1', text: 'Open the dashboard', seconds: 19 },
					{ id: 'clip-3', text: 'Then export', seconds: 18 }
				]
			}),
			completed('demo_video_narrate', {
				clips: [
					{ id: 'n1', line_id: 'clip-1', seconds: 19, artifact_url: 'https://x/n1.wav' },
					{ id: 'n3', line_id: 'clip-3', seconds: 18, artifact_url: 'https://x/n3.wav' }
				]
			}),
			completed('demo_video_record', {
				clips: [
					{
						id: 'clip-1',
						line_id: 'clip-1',
						seconds: 19,
						viewport: null,
						video_url: 'https://x/c1.mp4'
					},
					{
						id: 'clip-3',
						line_id: 'clip-3',
						seconds: 18,
						viewport: null,
						video_url: 'https://x/c3.mp4'
					}
				]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.motionUrl)).toEqual(['https://x/c1.mp4', 'https://x/c3.mp4']);
		// The narration must survive the record pass — the video fills a different slot.
		expect(lines.map((l) => l.audioUrl)).toEqual(['https://x/n1.wav', 'https://x/n3.wav']);
		expect(storylineSummary(lines)).toMatchObject({ count: 2, withAudio: 2, withVisual: 2 });
	});

	it('lesson: paragraph_id narration + paragraph_ids slides + slide_id recordings', () => {
		// lesson_v1 run 019f8f19: the whole chain uses paragraph ids, and the rendered PNG
		// lives in lesson_record.recordings[] addressed by the slide's own id.
		const r = run([
			completed('lesson_script', {
				paragraphs: [
					{ id: 'P1', text: 'Hello everyone.', seconds: 16, speaker: 'a' },
					{ id: 'P2', text: 'A function is a rule.', seconds: 12, speaker: 'a' }
				]
			}),
			completed('lesson_narrate', {
				clips: [
					{ id: 'c1', paragraph_id: 'P1', seconds: 16, artifact_url: 'https://x/p1.wav' },
					{ id: 'c2', paragraph_id: 'P2', seconds: 12, artifact_url: 'https://x/p2.wav' }
				]
			}),
			completed('lesson_slides', {
				slides: [
					{
						id: 'S1',
						title: 'Hello',
						bullets: [],
						image_prompt: 'abstract',
						paragraph_ids: ['P1', 'P2']
					}
				]
			}),
			completed('lesson_record', {
				recordings: [{ id: 'r1', slide_id: 'S1', image_url: 'https://x/s1.png' }]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.audioUrl)).toEqual(['https://x/p1.wav', 'https://x/p2.wav']);
		// One slide covering two paragraphs must light up both cards.
		expect(lines.map((l) => l.imageUrl)).toEqual(['https://x/s1.png', 'https://x/s1.png']);
		expect(storylineSummary(lines)).toMatchObject({ count: 2, withAudio: 2, withVisual: 2 });
	});

	it('website_review: assignments resolve section_id through the redesign visuals', () => {
		// website_review_v1 run 019fdada: website_review_slides is a documented no-op, the
		// record stage IS the narration stage (.wav), and the visuals are addressed
		// indirectly — assignments[].section_id names a website_redesign.visuals[].id.
		const r = run([
			completed('website_review_script', {
				lines: [
					{ id: 'W1', text: "Let's look at example.com.", seconds: 5 },
					{ id: 'W2', text: 'Where do we begin?', seconds: 4 }
				]
			}),
			completed('website_review_record', {
				clips: [
					{
						id: 'a1',
						line_id: 'W1',
						seconds: 5,
						artifact_url: 'https://x/w1.wav?X-Amz-Signature=deadbeef'
					},
					{
						id: 'a2',
						line_id: 'W2',
						seconds: 4,
						artifact_url: 'https://x/w2.wav?X-Amz-Signature=deadbeef'
					}
				]
			}),
			completed('website_review_slides', { notes: [], slides: [] }),
			completed('website_review_visual_director', {
				notes: [],
				assignments: [
					{ id: 'as1', line_id: 'W1', section_id: 'redesign-section-band-01' },
					{ id: 'as2', line_id: 'W2', section_id: 'redesign-section-band-02' }
				]
			}),
			completed('website_redesign', {
				url: 'https://example.com',
				visuals: [
					{ id: 'redesign-desktop', role: 'redesign_desktop', image_url: 'https://x/desk.png' },
					{ id: 'redesign-section-band-01', role: 'band', image_url: 'https://x/band1.png' },
					{
						id: 'redesign-section-band-02',
						role: 'band',
						image_url: 'https://x/band2.png',
						video_url: 'https://x/band2.mp4'
					}
				]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.imageUrl)).toEqual(['https://x/band1.png', 'https://x/band2.png']);
		expect(lines[1].motionUrl).toBe('https://x/band2.mp4');
		// A .wav behind a presigned query string is still audio, never a visual.
		expect(lines[0].audioUrl).toBe('https://x/w1.wav?X-Amz-Signature=deadbeef');
		expect(storylineSummary(lines)).toMatchObject({ count: 2, withAudio: 2, withVisual: 2 });
	});

	it('website_review: renamed duplicate section ids (sec-2) resolve to their own still', () => {
		// orchestrator #1083: the director grounds lines on INVENTORY ids — a repeated
		// visual id is renamed `-2`, `-3` in PAGE order (the still's file-name number),
		// and the visuals list is not in page order.
		const r = run([
			completed('website_review_script', {
				lines: [
					{ id: 'W1', text: 'First feature band.', seconds: 4 },
					{ id: 'W2', text: 'Second feature band.', seconds: 4 },
					{ id: 'W3', text: 'The hero.', seconds: 4 },
					{ id: 'W4', text: 'Nowhere.', seconds: 4 }
				]
			}),
			completed('website_review_visual_director', {
				assignments: [
					{ id: 'as1', line_id: 'W1', section_id: 'sec' },
					{ id: 'as2', line_id: 'W2', section_id: 'sec-2' },
					{ id: 'as3', line_id: 'W3', section_id: 'hero' },
					{ id: 'as4', line_id: 'W4', section_id: 'sec-3' }
				]
			}),
			completed('website_redesign', {
				visuals: [
					{ id: 'redesign-desktop', role: 'redesign_desktop', image_url: 'https://x/desk.png' },
					// Listed first but later on the page: this one is `sec-2`.
					{ id: 'sec', role: 'redesign_section:features_b', image_url: 'https://x/05_b.png' },
					{ id: 'hero', role: 'redesign_section:hero', image_url: 'https://x/01_hero.png' },
					{ id: 'sec', role: 'redesign_section:features_a', image_url: 'https://x/03_a.png' }
				]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => [l.lineId, l.imageUrl])).toEqual([
			['W1', 'https://x/03_a.png'],
			['W2', 'https://x/05_b.png'],
			['W3', 'https://x/01_hero.png'],
			['W4', undefined]
		]);
		expect(lines[1].screenId).toBe('sec-2');
	});

	it('audit family: plural line_ids slides join recordings across separate stages', () => {
		const r = run([
			completed('seo_audit_script', {
				lines: [
					{ id: 'A1', text: 'Your titles are duplicated.', seconds: 6 },
					{ id: 'A2', text: 'And your H1 is missing.', seconds: 5 }
				]
			}),
			completed('seo_audit_slides', {
				slides: [{ id: 'SL1', line_ids: ['A1', 'A2'], title: 'Titles', bullets: [] }]
			}),
			completed('seo_audit_record', {
				recordings: [{ id: 'rec1', slide_id: 'SL1', image_url: 'https://x/sl1.png' }]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.imageUrl)).toEqual(['https://x/sl1.png', 'https://x/sl1.png']);
	});

	it('promo: visual_director screen_id resolves to an asset and still sets screenId', () => {
		const r = run([
			completed('promo_script', { lines: [{ id: 'L1', text: 'Hook', seconds: 4 }] }),
			completed('promo_visual_director', {
				assignments: [{ id: 'p1', line_id: 'L1', screen_id: 'screen-a' }]
			}),
			completed('ai_image_gen', {
				images: [{ id: 'screen-a', line_id: null, image_url: 'https://x/screen-a.png' }]
			})
		]);
		const [line] = buildStoryline(r);
		expect(line.screenId).toBe('screen-a');
		expect(line.imageUrl).toBe('https://x/screen-a.png');
	});

	// ---- regression pins and negative controls: these must hold before AND after ----

	it('promo: a motion_graphics clip must not displace the slide it decorates', () => {
		// promo_v1 is 334 completed runs in 30 days and is currently correct. Once
		// clips[].video_url starts filling motionUrl, motion_graphics_gen becomes a
		// competitor for the slot — and StageStoryline opens motionUrl in preference to
		// imageUrl, so losing this race would silently swap what the tile plays on every
		// promo run while the counters still read a healthy N/N. The fixture deliberately
		// lists motion_graphics_gen FIRST: precedence must come from the join's pass order,
		// never from the order stages happen to appear in.
		const r = run([
			completed('motion_graphics_gen', {
				clips: [{ id: 'm1', line_id: 'L1', template_id: 't', video_url: 'https://x/template.mp4' }]
			}),
			completed('promo_script', { lines: [{ id: 'L1', text: 'Hook', seconds: 4 }] }),
			completed('promo_slides', {
				slides: [
					{
						id: 'S1',
						line_id: 'L1',
						image_url: 'https://x/slide.png',
						motion_video_url: 'https://x/slide-motion.mp4'
					}
				]
			})
		]);
		const [line] = buildStoryline(r);
		expect(line.imageUrl).toBe('https://x/slide.png');
		expect(line.motionUrl).toBe('https://x/slide-motion.mp4');
	});

	it('site_capture clips carry no line key and must not invent lines', () => {
		const r = run([
			completed('promo_script', {
				lines: [
					{ id: 'L1', text: 'a', seconds: 2 },
					{ id: 'L2', text: 'b', seconds: 2 }
				]
			}),
			completed('site_capture', {
				clips: [
					{ id: 'cap1', video_url: 'https://x/page.mp4', seconds: 12, is_primary: true },
					{ id: 'cap2', video_url: 'https://x/page2.mp4', seconds: 8, is_primary: false }
				]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.lineId)).toEqual(['L1', 'L2']);
		expect(storylineSummary(lines)).toMatchObject({ count: 2, withVisual: 0 });
	});

	it('audiobook clips key by chapter/chunk and render no storyline at all', () => {
		const r = run([
			completed('audiobook_narrate', {
				clips: [
					{
						id: 'k1',
						chapter_id: 'ch1',
						chunk_id: 'c1',
						artifact_url: 'https://x/1.wav',
						seconds: 30
					},
					{
						id: 'k2',
						chapter_id: 'ch1',
						chunk_id: 'c2',
						artifact_url: 'https://x/2.wav',
						seconds: 28
					}
				]
			})
		]);
		expect(buildStoryline(r)).toEqual([]);
	});

	it('a motion_graphics clip with a null line_id is skipped', () => {
		const r = run([
			completed('promo_script', { lines: [{ id: 'L1', text: 'a', seconds: 2 }] }),
			completed('motion_graphics_gen', {
				clips: [{ id: 'm1', line_id: null, video_url: 'https://x/t.mp4' }]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines).toHaveLength(1);
		expect(lines[0].motionUrl).toBeUndefined();
	});

	it('an extension-less artifact_url stays audio', () => {
		const r = run([
			completed('script', { lines: [{ id: 'L1', text: 'a', seconds: 2 }] }),
			completed('narrate', { clips: [{ line_id: 'L1', artifact_url: 'https://x/opaque-blob' }] })
		]);
		const [line] = buildStoryline(r);
		expect(line.audioUrl).toBe('https://x/opaque-blob');
		expect(line.motionUrl).toBeUndefined();
	});

	it('an assignment pointing at a missing asset yields no visual and does not throw', () => {
		const r = run([
			completed('website_review_script', { lines: [{ id: 'W1', text: 'a', seconds: 2 }] }),
			completed('website_review_visual_director', {
				assignments: [{ id: 'as1', line_id: 'W1', section_id: 'redesign-section-band-99' }]
			}),
			completed('website_redesign', {
				visuals: [{ id: 'redesign-desktop', image_url: 'https://x/desk.png' }]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines[0].imageUrl).toBeUndefined();
		expect(storylineSummary(lines)).toMatchObject({ count: 1, withVisual: 0 });
	});

	it('an ai_image_gen image that carries its own line_id attaches directly', () => {
		// `images[].line_id` is nullable but often populated, and that direct path is
		// distinct from the assignment hop — without this it is unexercised.
		const r = run([
			completed('promo_script', { lines: [{ id: 'L1', text: 'Hook', seconds: 4 }] }),
			completed('ai_image_gen', {
				images: [{ id: 'img1', line_id: 'L1', image_url: 'https://x/ai.png' }]
			})
		]);
		expect(buildStoryline(r)[0].imageUrl).toBe('https://x/ai.png');
	});

	it('a motion_clips entry still attaches by line_id', () => {
		const r = run([
			completed('script', { lines: [{ id: 'L1', text: 'a', seconds: 2 }] }),
			completed('motion', { motion_clips: [{ line_id: 'L1', artifact_url: 'https://x/m.mp4' }] })
		]);
		expect(buildStoryline(r)[0].motionUrl).toBe('https://x/m.mp4');
	});

	it('a later narration stage supersedes an earlier take', () => {
		// Audio is last-write-wins on purpose: a retake or QA re-render is the
		// corrected clip. Visuals deliberately go the other way.
		const r = run([
			completed('script', { lines: [{ id: 'L1', text: 'a', seconds: 2 }] }),
			completed('narrate', { clips: [{ line_id: 'L1', artifact_url: 'https://x/take1.wav' }] }),
			completed('narrate_retake', {
				clips: [{ line_id: 'L1', artifact_url: 'https://x/take2.wav' }]
			})
		]);
		expect(buildStoryline(r)[0].audioUrl).toBe('https://x/take2.wav');
	});

	it('app_review: narrations and line-keyed visuals join like clips and slides', () => {
		const r = run([
			completed('app_review_script', {
				lines: [
					{ id: 'R1', text: 'The signup form.', seconds: 4 },
					{ id: 'R2', text: 'Then the dashboard.', seconds: 5 }
				]
			}),
			completed('app_review_record', {
				narrations: [
					{ id: 'n1', line_id: 'R1', seconds: 4, artifact_url: 'https://x/r1.wav' },
					{ id: 'n2', line_id: 'R2', seconds: 5, artifact_url: 'https://x/r2.wav' }
				],
				visuals: [
					{ id: 'v1', line_id: 'R1', kind: 'screenshot', artifact_url: 'https://x/r1.png' },
					{ id: 'v2', line_id: 'R2', kind: 'screenshot', artifact_url: 'https://x/r2.png' }
				]
			})
		]);
		expect(storylineSummary(buildStoryline(r))).toMatchObject({
			count: 2,
			withAudio: 2,
			withVisual: 2
		});
	});

	it('a video-only clip whose line_id matches no script line must not create a card', () => {
		// showcase_v1 numbers its record clips `clip-N` while the script is keyed
		// `b1-need`-style, and promo's motion_graphics_gen emits `l-001` against
		// script UUIDs — 336 such orphan refs across 81 live runs. Admitting them
		// would append bare video tiles with no text, no audio and no shot.
		const r = run([
			completed('demo_video_gen', {
				lines: [
					{ id: 'b1-need', text: 'The need', seconds: 6 },
					{ id: 'b2-meet', text: 'Meet the product', seconds: 7 }
				]
			}),
			completed('showcase_slides', {
				slides: [{ id: 'S1', line_id: 'b1-need', image_url: 'https://x/s1.png' }]
			}),
			completed('demo_video_record', {
				clips: [
					{ id: 'clip-1', line_id: 'clip-1', seconds: 0, video_url: 'https://x/clip-1.mp4' },
					{ id: 'clip-2', line_id: 'clip-2', seconds: 0, video_url: 'https://x/clip-2.mp4' }
				]
			})
		]);
		const lines = buildStoryline(r);
		expect(lines.map((l) => l.lineId)).toEqual(['b1-need', 'b2-meet']);
		expect(storylineSummary(lines)).toMatchObject({ count: 2, withVisual: 1 });
	});

	it('an empty slides[] no-op stage is inert', () => {
		const r = run([
			completed('website_review_script', { lines: [{ id: 'W1', text: 'a', seconds: 2 }] }),
			completed('website_review_slides', { notes: [], slides: [] })
		]);
		expect(buildStoryline(r)).toHaveLength(1);
	});
});

describe('captured-screen previews', () => {
	it('uses the authored screen before a director assignment and replaces the slide', () => {
		const r = run([
			completed('promo_script', { lines: [{ id: 'shot-000', text: 'Report a bottleneck' }] }),
			completed('promo_slides', { slides: [{ line_id: 'shot-000', image_url: '/fallback.png' }] }),
			completed('site_capture', {
				screens: [{ id: 'shot-000', image_url: '/screen.png', clip_url: '/reveal.mp4' }]
			})
		]);
		r.config_snapshot = {
			brief: { shotlist: [{ kind: 'url', narration: 'Report a bottleneck' }] }
		};
		expect(buildStoryline(r)[0]).toMatchObject({
			imageUrl: '/screen.png',
			motionUrl: '/reveal.mp4',
			previewSource: 'Captured screen'
		});
	});
	it('resolves an explicit screen assignment and keeps an unrelated slide intact', () => {
		const r = run([
			completed('promo_script', {
				lines: [
					{ id: 'L1', text: 'Screen' },
					{ id: 'L2', text: 'Slide' }
				]
			}),
			completed('promo_storyboard', {
				shots: [
					{ line_id: 'L1', visual_type: 'footage' },
					{ line_id: 'L2', visual_type: 'slide' }
				]
			}),
			completed('promo_slides', {
				slides: [
					{ line_id: 'L1', image_url: '/fallback.png' },
					{ line_id: 'L2', image_url: '/slide.png' }
				]
			}),
			completed('site_capture', { screens: [{ id: 'dashboard', image_url: '/screen.png' }] }),
			completed('promo_visual_director', {
				assignments: [{ line_id: 'L1', screen_id: 'dashboard' }]
			})
		]);
		expect(buildStoryline(r).map((l) => l.imageUrl)).toEqual(['/screen.png', '/slide.png']);
	});
	it('does not invent cards from orphan screenshots', () => {
		expect(
			buildStoryline(
				run([completed('site_capture', { screens: [{ id: 'orphan', image_url: '/x.png' }] })])
			)
		).toEqual([]);
	});
});

it('normalizes empty authored shots before joining their screen ids', () => {
	const r = run([
		completed('promo_script', { lines: [{ id: 'shot-000', text: 'Actual narration' }] }),
		completed('site_capture', { screens: [{ id: 'shot-000', image_url: '/correct-screen.png' }] })
	]);
	r.config_snapshot = {
		brief: {
			shotlist: [
				{ kind: 'url', narration: '' },
				{ kind: 'url', narration: 'Actual narration' }
			]
		}
	};
	expect(buildStoryline(r)[0].imageUrl).toBe('/correct-screen.png');
});

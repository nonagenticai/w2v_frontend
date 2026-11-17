import { describe, expect, it } from 'vitest';
import { blueprintStageRank, sortByStageRank, startInstant } from './stage-order';

// demo_video blueprint, declaration order + edges as in the orchestrator.
const demoVideo = new Map<string, string[]>([
	['demo_video_gen', []],
	['script_doctor', ['demo_video_gen']],
	['source_ingest', []],
	['claim_finish', ['script_doctor', 'source_ingest']],
	['retention_plan', ['claim_finish']],
	['reconcile_timeline', ['retention_plan', 'demo_video_record']],
	['voice_director', ['reconcile_timeline']],
	['demo_video_narrate', ['voice_director']],
	['demo_video_record', ['demo_video_gen']],
	['demo_video_compile', ['demo_video_narrate', 'demo_video_record']]
]);

describe('blueprintStageRank', () => {
	it('places every stage after its upstreams, earliest-declared first', () => {
		const rank = blueprintStageRank(demoVideo);
		const order = [...rank.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
		expect(order).toEqual([
			'demo_video_gen',
			'script_doctor',
			'source_ingest',
			'claim_finish',
			'retention_plan',
			'demo_video_record',
			'reconcile_timeline',
			'voice_director',
			'demo_video_narrate',
			'demo_video_compile'
		]);
	});

	it('ignores edges to stages outside the blueprint', () => {
		const rank = blueprintStageRank(
			new Map([
				['a', ['ghost']],
				['b', []]
			])
		);
		expect(rank.get('a')).toBe(0);
		expect(rank.get('b')).toBe(1);
	});

	it('degrades a cycle to declaration order instead of dropping stages', () => {
		const rank = blueprintStageRank(
			new Map([
				['a', ['b']],
				['b', ['a']],
				['c', []]
			])
		);
		expect(rank.size).toBe(3);
	});
});

describe('sortByStageRank', () => {
	it('turns the API alphabetical list into pipeline order', () => {
		const alphabetical = [...demoVideo.keys()].sort();
		const sorted = sortByStageRank(alphabetical, blueprintStageRank(demoVideo), (s) => s);
		expect(sorted[0]).toBe('demo_video_gen');
		expect(sorted.indexOf('source_ingest')).toBeLessThan(sorted.indexOf('claim_finish'));
		expect(sorted.at(-1)).toBe('demo_video_compile');
	});

	it('keeps unknown stages, after the known ones, in incoming order', () => {
		const rank = blueprintStageRank(
			new Map([
				['b', []],
				['a', ['b']]
			])
		);
		expect(sortByStageRank(['z', 'a', 'y', 'b'], rank, (s) => s)).toEqual(['b', 'a', 'z', 'y']);
	});

	it('returns the incoming order unchanged when the blueprint is unknown', () => {
		const input = ['c', 'a', 'b'];
		const out = sortByStageRank(input, new Map(), (s) => s);
		expect(out).toEqual(input);
		expect(out).not.toBe(input);
	});
});

// The PAUSED demo_video run 01a14efd-eaba-7004-aa94-0ca26327c8c4 (2026-10-18),
// exactly as GET /api/runs/{id} lists it: alphabetical, with the run's own
// started_at. source_ingest started 46µs before demo_video_gen.
const pausedRunStages: { stage_name: string; started_at: string | null }[] = [
	{ stage_name: 'claim_finish', started_at: null },
	{ stage_name: 'demo_video_compile', started_at: null },
	{ stage_name: 'demo_video_encode_master', started_at: null },
	{ stage_name: 'demo_video_footage_critique', started_at: null },
	{ stage_name: 'demo_video_footage_direction', started_at: null },
	{ stage_name: 'demo_video_gen', started_at: '2026-10-18T12:30:27.051566Z' },
	{ stage_name: 'demo_video_narrate', started_at: null },
	{ stage_name: 'demo_video_record', started_at: null },
	{ stage_name: 'final_critique', started_at: null },
	{ stage_name: 'growth_bundle', started_at: null },
	{ stage_name: 'reconcile_timeline', started_at: null },
	{ stage_name: 'render_manifest', started_at: null },
	{ stage_name: 'retention_plan', started_at: null },
	{ stage_name: 'script_doctor', started_at: null },
	{ stage_name: 'source_ingest', started_at: '2026-10-18T12:30:27.051520Z' },
	{ stage_name: 'voice_director', started_at: null }
];

// demo_video_v1 on w2v_orchestrator origin/main, declaration order + edges.
const demoVideoV1 = new Map<string, string[]>([
	['demo_video_gen', []],
	['script_doctor', ['demo_video_gen']],
	['source_ingest', []],
	['claim_finish', ['script_doctor', 'source_ingest']],
	['retention_plan', ['claim_finish']],
	['reconcile_timeline', ['retention_plan', 'demo_video_record']],
	['voice_director', ['reconcile_timeline']],
	['demo_video_narrate', ['voice_director']],
	['demo_video_record', ['demo_video_gen']],
	[
		'demo_video_footage_direction',
		['reconcile_timeline', 'demo_video_narrate', 'demo_video_record']
	],
	[
		'demo_video_compile',
		['demo_video_narrate', 'demo_video_record', 'demo_video_footage_direction']
	],
	['demo_video_footage_critique', ['demo_video_compile']],
	['demo_video_encode_master', ['demo_video_footage_critique']],
	['final_critique', ['demo_video_encode_master']],
	['growth_bundle', ['final_critique']],
	['render_manifest', ['final_critique']]
]);

const startTimes = new Map(pausedRunStages.map((s) => [s.stage_name, s.started_at]));
const runNames = pausedRunStages.map((s) => s.stage_name);
const isTopological = (order: string[], graph: Map<string, string[]>) =>
	order.every((name, i) =>
		(graph.get(name) ?? []).every((dep) => !order.includes(dep) || order.indexOf(dep) < i)
	);

describe('pipeline order for the paused demo_video run', () => {
	it('puts Source Ingest first — the root that actually started first', () => {
		const rank = blueprintStageRank(demoVideoV1, startTimes, runNames);
		const order = sortByStageRank(pausedRunStages, rank, (s) => s.stage_name).map(
			(s) => s.stage_name
		);
		expect(order.slice(0, 4)).toEqual([
			'source_ingest',
			'demo_video_gen',
			'script_doctor',
			'claim_finish'
		]);
		expect(order).toHaveLength(16);
		expect(isTopological(order, demoVideoV1)).toBe(true);
	});

	it('orders by started_at, pending last, when the blueprint is unknown (no edges)', () => {
		const rank = blueprintStageRank(new Map(), startTimes, runNames);
		const order = sortByStageRank(pausedRunStages, rank, (s) => s.stage_name).map(
			(s) => s.stage_name
		);
		expect(order.slice(0, 3)).toEqual(['source_ingest', 'demo_video_gen', 'claim_finish']);
		expect(order).toHaveLength(16);
	});

	it('ranks run stages the blueprint no longer knows by when they started', () => {
		// The blueprint changed since the run was created: only gen survives.
		const rank = blueprintStageRank(new Map([['demo_video_gen', []]]), startTimes, runNames);
		const order = sortByStageRank(pausedRunStages, rank, (s) => s.stage_name).map(
			(s) => s.stage_name
		);
		expect(order[0]).toBe('source_ingest');
		expect(order[1]).toBe('demo_video_gen');
		// Unstarted unknowns keep the incoming order after the started ones.
		expect(order.slice(2, 4)).toEqual(['claim_finish', 'demo_video_compile']);
	});

	it('never lets a start time pull a stage ahead of its upstream', () => {
		const skewed = new Map<string, string | null>([
			['script_doctor', '2026-10-18T12:00:00Z'], // bogus: earlier than its upstream
			['demo_video_gen', '2026-10-18T12:30:00Z']
		]);
		const order = [...blueprintStageRank(demoVideoV1, skewed).entries()]
			.sort((a, b) => a[1] - b[1])
			.map(([n]) => n);
		expect(order.indexOf('demo_video_gen')).toBeLessThan(order.indexOf('script_doctor'));
		expect(isTopological(order, demoVideoV1)).toBe(true);
	});
});

describe('startInstant', () => {
	it('keeps the microseconds Date.parse drops', () => {
		const ingest = startInstant('2026-10-18T12:30:27.051520Z');
		const gen = startInstant('2026-10-18T12:30:27.051566Z');
		expect(Date.parse('2026-10-18T12:30:27.051520Z')).toBe(
			Date.parse('2026-10-18T12:30:27.051566Z')
		);
		expect(ingest).toBeLessThan(gen);
	});

	it('treats absent or unparseable as not started', () => {
		expect(startInstant(null)).toBe(Number.POSITIVE_INFINITY);
		expect(startInstant(undefined)).toBe(Number.POSITIVE_INFINITY);
		expect(startInstant('not a date')).toBe(Number.POSITIVE_INFINITY);
		expect(startInstant('2026-10-18T12:30:27Z')).toBe(Date.parse('2026-10-18T12:30:27Z'));
	});
});

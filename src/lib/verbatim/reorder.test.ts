import { describe, expect, it } from 'vitest';

import { planMove, sortByPosition } from './reorder.js';

interface Row {
	id: string;
	position: number;
	created_at: string;
}

function row(id: string, position: number, created_at = '2026-07-12T00:00:00Z'): Row {
	return { id, position, created_at };
}

/** Plans are order-insensitive: compare them id-sorted. */
function norm(plan: { id: string; position: number }[]): { id: string; position: number }[] {
	return [...plan].sort((a, b) => a.id.localeCompare(b.id));
}

/** Apply a plan to a track, returning the resulting rows (same input order). */
function apply(track: Row[], plan: { id: string; position: number }[]): Row[] {
	return track.map((r) => {
		const write = plan.find((p) => p.id === r.id);
		return write ? { ...r, position: write.position } : r;
	});
}

describe('sortByPosition', () => {
	it('orders by position ascending regardless of input order', () => {
		const items = [row('c', 30), row('a', 10), row('b', 20)];
		expect(sortByPosition(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
	});

	it('breaks a position tie by created_at, then by id', () => {
		const items = [
			row('z', 0, '2026-07-12T00:00:02Z'),
			row('b', 0, '2026-07-12T00:00:01Z'),
			row('a', 0, '2026-07-12T00:00:01Z'),
			row('y', 0, '2026-07-12T00:00:00Z')
		];
		// created_at first (y < a/b < z), then id inside the a/b tie.
		expect(sortByPosition(items).map((i) => i.id)).toEqual(['y', 'a', 'b', 'z']);
	});

	it('does not mutate its input', () => {
		const items = [row('c', 30), row('a', 10), row('b', 20)];
		const before = structuredClone(items);
		const sorted = sortByPosition(items);
		expect(items).toEqual(before);
		expect(sorted).not.toBe(items);
	});
});

describe('planMove — dense track [0,1,2]', () => {
	const track = [row('a', 0), row('b', 1), row('c', 2)];

	it('move-down of the first item swaps exactly the two adjacent positions', () => {
		const plan = planMove(track, 'a', 1);
		expect(plan).toHaveLength(2);
		expect(norm(plan)).toEqual([
			{ id: 'a', position: 1 },
			{ id: 'b', position: 0 }
		]);
		// c is untouched — no third write.
		expect(plan.some((p) => p.id === 'c')).toBe(false);
	});

	it('move-up of the last item swaps exactly the two adjacent positions', () => {
		const plan = planMove(track, 'c', -1);
		expect(plan).toHaveLength(2);
		expect(norm(plan)).toEqual([
			{ id: 'b', position: 2 },
			{ id: 'c', position: 1 }
		]);
		expect(plan.some((p) => p.id === 'a')).toBe(false);
	});
});

describe('planMove — sparse track [10,20,30]', () => {
	const track = [row('a', 10), row('b', 20), row('c', 30)];

	it('reuses the existing position values instead of densifying to 0/1/2', () => {
		const plan = planMove(track, 'c', -1);
		expect(plan).toHaveLength(2);
		// Every written value is one of the track's existing positions — a plan
		// that emitted 0/1/2 here would collide with the server's unique index.
		expect(plan.every((p) => [10, 20, 30].includes(p.position))).toBe(true);

		const after = apply(track, plan);
		// The multiset of positions is preserved exactly.
		expect([...after.map((r) => r.position)].sort((x, y) => x - y)).toEqual([10, 20, 30]);
		// …and the swap actually moved c above b.
		expect(sortByPosition(after).map((r) => r.id)).toEqual(['a', 'c', 'b']);
	});

	it('move-down reuses positions too and moves the item one slot later', () => {
		const plan = planMove(track, 'a', 1);
		expect(plan.every((p) => [10, 20, 30].includes(p.position))).toBe(true);
		const after = apply(track, plan);
		expect([...after.map((r) => r.position)].sort((x, y) => x - y)).toEqual([10, 20, 30]);
		expect(sortByPosition(after).map((r) => r.id)).toEqual(['b', 'a', 'c']);
	});
});

describe('planMove — duplicate positions [0,0,1]', () => {
	const track = [row('a', 0), row('b', 0), row('c', 1)];

	it('falls back to sorted indices when the swap partners share a position', () => {
		// a and b both sit at 0, so a plain swap would write nothing.
		const plan = planMove(track, 'a', 1);
		expect(plan.length).toBeGreaterThan(0);

		// Only genuinely-changed entries come back — never a no-op write.
		for (const write of plan) {
			const current = track.find((r) => r.id === write.id);
			expect(current).toBeDefined();
			expect(write.position).not.toBe(current?.position);
		}

		const after = apply(track, plan);
		// The degenerate tie is resolved: positions are the distinct sorted indices.
		expect([...after.map((r) => r.position)].sort((x, y) => x - y)).toEqual([0, 1, 2]);
	});

	it('still does a plain swap when the two partners differ (c up past b)', () => {
		// b=0, c=1 are distinct → the normal swap path, not the fallback.
		const plan = planMove(track, 'c', -1);
		expect(norm(plan)).toEqual([
			{ id: 'b', position: 1 },
			{ id: 'c', position: 0 }
		]);
	});
});

describe('planMove — no-ops', () => {
	const track = [row('a', 0), row('b', 1), row('c', 2)];

	it('returns [] for a move-up at the first index', () => {
		expect(planMove(track, 'a', -1)).toEqual([]);
	});

	it('returns [] for a move-down at the last index', () => {
		expect(planMove(track, 'c', 1)).toEqual([]);
	});

	it('returns [] when the itemId is not in the track', () => {
		expect(planMove(track, 'not-here', 1)).toEqual([]);
		expect(planMove(track, 'not-here', -1)).toEqual([]);
	});

	it('returns [] for a single-item track in both directions', () => {
		const solo = [row('only', 7)];
		expect(planMove(solo, 'only', -1)).toEqual([]);
		expect(planMove(solo, 'only', 1)).toEqual([]);
	});
});

describe('planMove — input order independence', () => {
	it('produces the identical plan for the same track shuffled', () => {
		const ordered = [row('a', 10), row('b', 20), row('c', 30)];
		const shuffled = [ordered[2], ordered[0], ordered[1]];
		expect(norm(planMove(shuffled, 'c', -1))).toEqual(norm(planMove(ordered, 'c', -1)));
		expect(norm(planMove(shuffled, 'a', 1))).toEqual(norm(planMove(ordered, 'a', 1)));
	});

	it('honours edge no-ops from the sorted order, not the array order', () => {
		// 'a' is first by position but LAST in the array — a move-up is still a no-op,
		// and a move-down of 'c' (last by position, first in the array) is too.
		const shuffled = [row('c', 30), row('b', 20), row('a', 10)];
		expect(planMove(shuffled, 'a', -1)).toEqual([]);
		expect(planMove(shuffled, 'c', 1)).toEqual([]);
	});
});

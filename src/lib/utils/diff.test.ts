import { describe, expect, it } from 'vitest';
import { diffByStableId, wordDiff } from './diff.js';

describe('diffByStableId', () => {
	it('marks unchanged when both sides equal', () => {
		const r = diffByStableId([{ id: 'a', text: 'x' }], [{ id: 'a', text: 'x' }]);
		expect(r).toEqual([
			{ kind: 'unchanged', id: 'a', left: { id: 'a', text: 'x' }, right: { id: 'a', text: 'x' } }
		]);
	});

	it('marks added when only on right', () => {
		const r = diffByStableId([], [{ id: 'a', text: 'x' }]);
		expect(r).toEqual([{ kind: 'added', id: 'a', right: { id: 'a', text: 'x' } }]);
	});

	it('marks removed when only on left, after right entries', () => {
		const r = diffByStableId(
			[
				{ id: 'gone', text: 'x' },
				{ id: 'a', text: 'kept' }
			],
			[{ id: 'a', text: 'kept' }]
		);
		expect(r.map((c) => c.kind)).toEqual(['unchanged', 'removed']);
		expect(r[1]?.id).toBe('gone');
	});

	it('marks modified when same id, different content', () => {
		const r = diffByStableId([{ id: 'a', text: 'old' }], [{ id: 'a', text: 'new' }]);
		expect(r[0]?.kind).toBe('modified');
	});

	it('preserves the right-list display order for added/unchanged/modified', () => {
		const r = diffByStableId(
			[
				{ id: 'b', text: 'b' },
				{ id: 'a', text: 'a' }
			],
			[
				{ id: 'a', text: 'a' },
				{ id: 'c', text: 'c' },
				{ id: 'b', text: 'NEW_B' }
			]
		);
		expect(r.map((c) => `${c.kind}:${c.id}`)).toEqual(['unchanged:a', 'added:c', 'modified:b']);
	});
});

describe('wordDiff', () => {
	it('returns added + removed parts for word-level changes', () => {
		const parts = wordDiff('the quick brown fox', 'the slow brown fox');
		const adds = parts.filter((p) => p.added).map((p) => p.value.trim());
		const removes = parts.filter((p) => p.removed).map((p) => p.value.trim());
		expect(adds).toContain('slow');
		expect(removes).toContain('quick');
	});
});

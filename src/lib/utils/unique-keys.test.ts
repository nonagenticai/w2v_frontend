import { describe, it, expect } from 'vitest';
import { withUniqueKeys } from './unique-keys';

describe('withUniqueKeys', () => {
	it('passes distinct keys through untouched so DOM reuse is preserved', () => {
		const rows = withUniqueKeys([{ n: 1 }, { n: 2 }, { n: 3 }], (x) => x.n);
		expect(rows.map((r) => r.key)).toEqual(['1', '2', '3']);
	});

	it('is stable: the same input yields the same keys on every call', () => {
		const items = [{ n: 1 }, { n: 1 }, { n: 2 }];
		const a = withUniqueKeys(items, (x) => x.n).map((r) => r.key);
		const b = withUniqueKeys(items, (x) => x.n).map((r) => r.key);
		expect(a).toEqual(b);
	});

	it('disambiguates repeats instead of colliding', () => {
		const rows = withUniqueKeys([{ n: 1 }, { n: 1 }, { n: 1 }], (x) => x.n);
		expect(rows.map((r) => r.key)).toEqual(['1', '1#2', '1#3']);
		expect(new Set(rows.map((r) => r.key)).size).toBe(3);
	});

	it('falls back to position when the key field is absent — the live blank-page case', () => {
		// 18 final_critique chapters, none carrying a `sequence`.
		const chapters = Array.from({ length: 18 }, (_, i) => ({ start: i, title: `Chapter ${i}` }));
		const rows = withUniqueKeys(chapters, (c) => (c as { sequence?: number }).sequence);
		expect(new Set(rows.map((r) => r.key)).size).toBe(18);
	});

	it('treats null, undefined and empty string as absent', () => {
		const rows = withUniqueKeys([{ k: null }, { k: undefined }, { k: '' }], (x) => x.k);
		expect(rows.map((r) => r.key)).toEqual(['@0', '@1', '@2']);
	});

	it('does not confuse a positional fallback with a real key of the same text', () => {
		// A real key of "@1" must not silently merge with the fallback for index 1.
		const rows = withUniqueKeys([{ k: '@1' }, { k: null }], (x) => x.k);
		expect(new Set(rows.map((r) => r.key)).size).toBe(2);
	});

	it('preserves item identity and original index', () => {
		const a = { n: 1 };
		const b = { n: 1 };
		const rows = withUniqueKeys([a, b], (x) => x.n);
		expect(rows[0].item).toBe(a);
		expect(rows[1].item).toBe(b);
		expect(rows.map((r) => r.index)).toEqual([0, 1]);
	});
});

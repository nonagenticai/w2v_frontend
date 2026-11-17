import { describe, it, expect } from 'vitest';
import { gradeTone } from './grade';

describe('gradeTone', () => {
	it('maps A-family grades (incl. +/-) to success', () => {
		expect(gradeTone('A')).toBe('success');
		expect(gradeTone('A+')).toBe('success');
		expect(gradeTone('A-')).toBe('success');
		expect(gradeTone('a')).toBe('success'); // case-insensitive first letter
	});

	it('maps B/C-family grades (incl. +/-) to warning — the +/- regression', () => {
		// The previous inline logic matched A with startsWith but B/C with exact
		// equality, so B+/B-/C+/C- fell through to danger. Lock the fix.
		for (const g of ['B', 'B+', 'B-', 'C', 'C+', 'C-']) {
			expect(gradeTone(g)).toBe('warning');
		}
	});

	it('maps D/E/F and empty/nullish to danger', () => {
		expect(gradeTone('D')).toBe('danger');
		expect(gradeTone('F')).toBe('danger');
		expect(gradeTone('')).toBe('danger');
		expect(gradeTone(undefined)).toBe('danger');
		expect(gradeTone(null)).toBe('danger');
	});
});

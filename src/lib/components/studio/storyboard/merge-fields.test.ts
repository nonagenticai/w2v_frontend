import { describe, it, expect } from 'vitest';
import { conflictingFields, isFieldMergeable } from './merge-fields.js';
import type { DiffEntry } from '$lib/types';

// The server hands the allowlist down on the diff (`mergeable_fields`). These are the content
// columns the orchestrator will apply field-by-field; everything else fences to a whole row.
const MERGEABLE = ['vo_text', 'dialogue', 'action_description'];

function conflict(over: Partial<DiffEntry> = {}): DiffEntry {
	return {
		key: 'clip-1',
		kind: 'conflict',
		shot_key: 'clip-1',
		base: { vo_text: 'a', dialogue: 'x' },
		main: { vo_text: 'ours', dialogue: 'x' },
		branch: { vo_text: 'theirs', dialogue: 'x' },
		changed_fields: ['vo_text'],
		main_changed_fields: ['vo_text'],
		...over
	};
}

describe('merge-fields', () => {
	it('conflictingFields is the raw intersection of branch- and main-changed fields', () => {
		expect(
			conflictingFields(
				conflict({ changed_fields: ['vo_text', 'dialogue'], main_changed_fields: ['dialogue'] })
			)
		).toEqual(['dialogue']);
	});

	it('conflictingFields narrows to the server allowlist when one is passed', () => {
		// `scene` is not on the allowlist → dropped from the per-field offer, `vo_text` stays.
		expect(
			conflictingFields(
				conflict({
					changed_fields: ['vo_text', 'scene'],
					main_changed_fields: ['vo_text', 'scene']
				}),
				MERGEABLE
			)
		).toEqual(['vo_text']);
	});

	it('is field-mergeable when every conflicting field is on the allowlist', () => {
		expect(
			isFieldMergeable(
				conflict({
					changed_fields: ['vo_text', 'dialogue'],
					main_changed_fields: ['vo_text', 'dialogue']
				}),
				MERGEABLE
			)
		).toBe(true);
	});

	it('fences an UNKNOWN field: a column absent from the allowlist is NOT per-field mergeable', () => {
		// `duration_seconds` is not a lineage key, but the server did not opt it into the allowlist,
		// so the client default-fences it to a whole-row verdict rather than drifting looser.
		expect(
			isFieldMergeable(
				conflict({
					changed_fields: ['duration_seconds'],
					main_changed_fields: ['duration_seconds']
				}),
				MERGEABLE
			)
		).toBe(false);
	});

	it('fences everything when the allowlist is empty (e.g. diff not yet loaded)', () => {
		expect(
			isFieldMergeable(
				conflict({ changed_fields: ['vo_text'], main_changed_fields: ['vo_text'] }),
				[]
			)
		).toBe(false);
	});

	it('is NOT field-mergeable when a conflicting field is fenced (lineage)', () => {
		expect(
			isFieldMergeable(
				conflict({ changed_fields: ['scene'], main_changed_fields: ['scene'] }),
				MERGEABLE
			)
		).toBe(false);
	});

	it('is NOT field-mergeable when main made a main-only fenced edit (shot_key/position/lineage)', () => {
		// Content conflict on vo_text, but main also renamed shot_key alone → whole-row only.
		expect(
			isFieldMergeable(
				conflict({ changed_fields: ['vo_text'], main_changed_fields: ['vo_text', 'shot_key'] }),
				MERGEABLE
			)
		).toBe(false);
	});

	it('is NOT field-mergeable for a delete-vs-edit conflict (branch side absent)', () => {
		expect(
			isFieldMergeable(
				conflict({ branch: null, changed_fields: [], main_changed_fields: ['vo_text'] }),
				MERGEABLE
			)
		).toBe(false);
	});

	it('is NOT field-mergeable for a disjoint conflict (empty intersection)', () => {
		expect(
			isFieldMergeable(
				conflict({ changed_fields: ['vo_text'], main_changed_fields: ['dialogue'] }),
				MERGEABLE
			)
		).toBe(false);
	});
});

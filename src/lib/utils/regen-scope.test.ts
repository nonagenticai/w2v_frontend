import { describe, expect, it } from 'vitest';
import { deriveScope } from './regen-scope.js';
import type { AnnotationResponse } from '$lib/types';

const ann = (id: string, target: string | null): AnnotationResponse => ({
	id,
	stage_output_id: 'so-1',
	element_id: target,
	text: '',
	status: 'open',
	applied_in_run_id: null,
	created_at: '2026-05-08T00:00:00Z',
	updated_at: '2026-05-08T00:00:00Z'
});

describe('deriveScope', () => {
	it('returns null when nothing is selected', () => {
		expect(deriveScope([])).toBeNull();
	});

	it('element scope when every selected note targets the same element', () => {
		const r = deriveScope([ann('1', 'scene_3'), ann('2', 'scene_3')]);
		expect(r).toEqual({
			kind: 'element',
			elementId: 'scene_3',
			annotationIds: ['1', '2']
		});
	});

	it('stage scope when selected notes target different elements', () => {
		const r = deriveScope([ann('1', 'scene_3'), ann('2', 'scene_4')]);
		expect(r).toEqual({ kind: 'stage', annotationIds: ['1', '2'] });
	});

	it('stage scope when any selected note is stage-pinned', () => {
		const r = deriveScope([ann('1', 'scene_3'), ann('2', null)]);
		expect(r).toEqual({ kind: 'stage', annotationIds: ['1', '2'] });
	});

	it('stage scope when ALL selected notes are stage-pinned', () => {
		const r = deriveScope([ann('1', null), ann('2', null)]);
		expect(r).toEqual({ kind: 'stage', annotationIds: ['1', '2'] });
	});

	it('element scope works for a single selected element-pinned note', () => {
		const r = deriveScope([ann('1', 'scene_3')]);
		expect(r).toEqual({ kind: 'element', elementId: 'scene_3', annotationIds: ['1'] });
	});
});

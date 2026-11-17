import { describe, it, expect } from 'vitest';
import {
	sectionsFor,
	resolveSection,
	blueprintStagesFor,
	homeTestId,
	type WorkspaceSection
} from './workspace-sections';
import type { ProjectDetailResponse } from '$lib/types';

const NOW = '2026-06-11T00:00:00Z';

function makeProject(over: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		id: 'p1',
		tenant_id: 't',
		owner_subject_id: 's',
		visibility: 'tenant',
		title: 'P',
		type: 'promo',
		brief: {},
		brand: {},
		voice: {},
		theme: {},
		status: 'drafting',
		deliverables: [],
		children: [],
		created_at: NOW,
		updated_at: NOW,
		...over
	} as ProjectDetailResponse;
}

describe('sectionsFor', () => {
	it('non-course projects expose Deliverables (not Lessons) as the first section', () => {
		const sections = sectionsFor(
			makeProject({ deliverables: [{ id: 'd1' }, { id: 'd2' }] as never })
		);
		expect(sections.map((s) => s.id)).toEqual([
			'deliverables',
			'brief',
			'verbatim',
			'outputs',
			'history'
		]);
		expect(sections[0].count).toBe(2);
	});

	it('courses swap Deliverables for Lessons with the child count', () => {
		const sections = sectionsFor(
			makeProject({ type: 'course', children: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] as never })
		);
		expect(sections.map((s) => s.id)).toEqual(['lessons', 'brief', 'outputs', 'history']);
		expect(sections[0].label).toBe('Lessons');
		expect(sections[0].count).toBe(3);
	});

	it('hides Verbatim for types whose pipelines never read it', () => {
		for (const type of ['web_design', 'web_design_v2', 'course'] as const) {
			const ids = sectionsFor(makeProject({ type })).map((s) => s.id);
			expect(ids, type).not.toContain('verbatim');
		}
		for (const type of ['promo', 'generic', 'demo_video', 'lesson'] as const) {
			const ids = sectionsFor(makeProject({ type })).map((s) => s.id);
			expect(ids, type).toContain('verbatim');
		}
	});
});

describe('resolveSection', () => {
	const sections: WorkspaceSection[] = sectionsFor(makeProject());
	const courseSections = sectionsFor(makeProject({ type: 'course' }));

	it('returns the requested section when valid', () => {
		expect(resolveSection('brief', sections)).toBe('brief');
		expect(resolveSection('verbatim', sections)).toBe('verbatim');
	});

	it('falls back to the default (first) section for missing/unknown values', () => {
		expect(resolveSection(null, sections)).toBe('deliverables');
		expect(resolveSection('bogus', sections)).toBe('deliverables');
	});

	it('collapses a deliverables↔lessons mismatch to the default for the project type', () => {
		// A course link carrying ?section=deliverables resolves to lessons.
		expect(resolveSection('deliverables', courseSections)).toBe('lessons');
		// A non-course link carrying ?section=lessons resolves to deliverables.
		expect(resolveSection('lessons', sections)).toBe('deliverables');
	});
});

describe('blueprintStagesFor', () => {
	it('uses the live /api/blueprints list for every type, including course/lesson/app_review', () => {
		const live = ['promo_analyze', 'promo_script'];
		expect(blueprintStagesFor(makeProject({ type: 'promo' }), live)).toEqual(live);
		expect(blueprintStagesFor(makeProject({ type: 'generic' }), live)).toEqual(live);

		// course/lesson/app_review no longer override with a frozen list — the
		// API is the single source of truth (a course promote that grows the BE
		// blueprint must show in the preview, not drift behind a hard-coded copy).
		const courseLive = [
			'course_outline',
			'source_ingest',
			'course_compile_lessons',
			'course_stitch'
		];
		expect(blueprintStagesFor(makeProject({ type: 'course' }), courseLive)).toEqual(courseLive);
		expect(blueprintStagesFor(makeProject({ type: 'lesson' }), live)).toEqual(live);
		expect(blueprintStagesFor(makeProject({ type: 'app_review' }), live)).toEqual(live);
	});

	it('returns an empty list (preview hidden) when the API has no stages for the type', () => {
		expect(blueprintStagesFor(makeProject({ type: 'course' }), [])).toEqual([]);
	});
});

describe('homeTestId', () => {
	it('maps types to the legacy e2e home testids', () => {
		expect(homeTestId('course')).toBe('course-home');
		expect(homeTestId('lesson')).toBe('lesson-home');
		expect(homeTestId('app_review')).toBe('app-review-home');
		expect(homeTestId('promo')).toBe('promo-home');
		// generic / website_review / audiobook fall through to promo-home
		expect(homeTestId('generic')).toBe('promo-home');
		expect(homeTestId('website_review')).toBe('promo-home');
	});
});

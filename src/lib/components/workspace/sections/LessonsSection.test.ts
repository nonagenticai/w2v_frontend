import { describe, it, expect, vi, beforeEach } from 'vitest';

// The section reads the blueprint-fetch outcome off `page.data` (published by
// src/routes/projects/[pid]/+page.ts), so the rune is stubbed with a settable
// `data` object.
const h = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

vi.mock('$app/state', () => ({
	page: {
		get data() {
			return h.data;
		},
		get url() {
			return new URL('http://localhost/projects/p1');
		}
	}
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/stores/projects.svelte.js', () => ({
	addChild: vi.fn(),
	reorderChildren: vi.fn()
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

import { render } from '@testing-library/svelte';
import LessonsSection from './LessonsSection.svelte';
import type { ProjectDetailResponse } from '$lib/types';

const NOW = '2026-08-06T00:00:00Z';

function courseProject(): ProjectDetailResponse {
	return {
		id: 'p1',
		tenant_id: 't',
		owner_subject_id: 's',
		visibility: 'tenant',
		title: 'A course',
		type: 'course',
		brief: {},
		brand: {},
		voice: {},
		theme: {},
		status: 'drafting',
		deliverables: [],
		children: [],
		created_at: NOW,
		updated_at: NOW
	} as unknown as ProjectDetailResponse;
}

beforeEach(() => {
	h.data = {};
});

/**
 * `stages` is `[]` for BOTH "no blueprint is published" and "GET /api/blueprints
 * failed", and the empty-state copy asserts the first one as fact. Live, a 500
 * on the blueprints endpoint told the user their course had no published
 * blueprint — a statement about the product, drawn from a dead request.
 */
describe('LessonsSection blueprint-stage preview', () => {
	it('lists the stages when the blueprint loaded', () => {
		const { getAllByTestId, queryByTestId } = render(LessonsSection, {
			props: { project: courseProject(), stages: ['course_plan', 'course_compile_lessons'] }
		});
		expect(getAllByTestId('stage-row')).toHaveLength(2);
		expect(queryByTestId('stages-empty-state')).toBeNull();
		expect(queryByTestId('stages-unavailable')).toBeNull();
	});

	it('says no blueprint is published only when the fetch SUCCEEDED and was empty', () => {
		h.data = { blueprintsError: null };
		const { getByTestId, queryByTestId } = render(LessonsSection, {
			props: { project: courseProject(), stages: [] }
		});
		expect(getByTestId('stages-empty-state')).toBeInTheDocument();
		expect(queryByTestId('stages-unavailable')).toBeNull();
	});

	it('reports the blueprint as UNAVAILABLE — not unpublished — when the fetch failed', () => {
		h.data = { blueprintsError: new Error('Internal Server Error') };
		const { getByTestId, queryByTestId } = render(LessonsSection, {
			props: { project: courseProject(), stages: [] }
		});
		// The regression guard is the SECOND assertion: an error state that also
		// left the "No course blueprint is published" sentence on screen would
		// still mislead a reader.
		expect(getByTestId('stages-unavailable')).toBeInTheDocument();
		expect(getByTestId('error-state')).toHaveAttribute('role', 'alert');
		expect(queryByTestId('stages-empty-state')).toBeNull();
	});

	it('surfaces the underlying error message rather than a generic apology', () => {
		h.data = { blueprintsError: new Error('blueprints 503') };
		const { getByTestId } = render(LessonsSection, {
			props: { project: courseProject(), stages: [] }
		});
		expect(getByTestId('error-state-message')).toHaveTextContent('blueprints 503');
	});

	it('does not crash when $app/state carries no page data at all', () => {
		// ProjectWorkspace.test.ts stubs `$app/state` with only `url`; the section
		// must degrade to the empty state, not throw during render.
		h.data = undefined as unknown as Record<string, unknown>;
		const { getByTestId } = render(LessonsSection, {
			props: { project: courseProject(), stages: [] }
		});
		expect(getByTestId('stages-empty-state')).toBeInTheDocument();
	});
});

describe('LessonsSection — course run', () => {
	function withLesson(): ProjectDetailResponse {
		const p = courseProject() as unknown as Record<string, unknown>;
		p.deliverables = [{ id: 'cd1', name: 'Course', status: 'idle' }];
		p.children = [{ id: 'l1', title: 'Lesson 1', type: 'lesson', status: 'drafting', position: 0 }];
		return p as unknown as ProjectDetailResponse;
	}

	it('offers a course-level Start control once the course has lessons', () => {
		const { getByTestId } = render(LessonsSection, { props: { project: withLesson() } });
		const slot = getByTestId('start-course-run');
		expect(slot.textContent).toMatch(/start course run/i);
	});

	it('explains that lessons are needed instead of offering a run that would be skipped', () => {
		const p = withLesson() as unknown as Record<string, unknown>;
		p.children = [];
		const { getByTestId, queryByTestId } = render(LessonsSection, {
			props: { project: p as unknown as ProjectDetailResponse }
		});
		expect(getByTestId('course-run-needs-lessons')).toBeInTheDocument();
		expect(queryByTestId('start-course-run')).toBeNull();
	});

	it('labels the lesson-row action "Open", not "Start" (it only navigates)', () => {
		const { getByTestId } = render(LessonsSection, { props: { project: withLesson() } });
		const list = getByTestId('course-run').nextElementSibling as HTMLElement;
		expect(list.textContent).toMatch(/Open/);
		expect(list.textContent).not.toMatch(/\bStart\b/);
	});
});

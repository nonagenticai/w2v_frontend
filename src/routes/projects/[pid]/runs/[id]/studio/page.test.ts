import { describe, it, expect, vi, beforeEach } from 'vitest';

const runsGet = vi.fn();
const annotationsList = vi.fn();
const getProjectOne = vi.fn();
const loadProjectOne = vi.fn();

vi.mock('$lib/api', async (importActual) => {
	const actual = await importActual<typeof import('$lib/api')>();
	return {
		ApiError: actual.ApiError,
		runs: { get: (...a: unknown[]) => runsGet(...a) },
		annotations: { list: (...a: unknown[]) => annotationsList(...a) }
	};
});

vi.mock('$lib/stores/projects.svelte.js', () => ({
	getOne: (...a: unknown[]) => getProjectOne(...a),
	loadOne: (...a: unknown[]) => loadProjectOne(...a)
}));

import { load } from './+page';

const PARAMS = { pid: 'p1', id: 'r1' };

// A run whose completed script stage carries a `lines[]` spine, so
// `resolveClipSpine` is non-null and the loader actually fetches annotations.
const RUN_WITH_SPINE = {
	deliverable_id: 'd1',
	stage_outputs: [
		{ stage_name: 'seo_audit_script', status: 'completed', output: { lines: [{ id: 'l1' }] } }
	]
};

beforeEach(() => {
	vi.clearAllMocks();
	getProjectOne.mockReturnValue({ id: 'p1', deliverables: [{ id: 'd1' }] });
	runsGet.mockResolvedValue(RUN_WITH_SPINE);
});

/**
 * An audit narrated-video (seo_audit/cro_audit with generate_video) produces a
 * clip spine but no visual annotations; that stage's response returns
 * `annotations: null`, which must not reach the timeline's `[...annotations]`
 * spread (it would throw `TypeError: ... is not iterable`). The loader coerces
 * it to `[]` to keep its declared `AnnotationResponse[]` contract.
 */
describe('studio loader — annotations null-safety', () => {
	it('coerces a null annotations response to an empty array', async () => {
		annotationsList.mockResolvedValue({ annotations: null, total: 0 });
		const data = await load({ params: PARAMS } as never);
		expect(data.annotations).toEqual([]);
		expect(() => [...data.annotations]).not.toThrow();
	});

	it('passes a real annotations array through unchanged', async () => {
		const anns = [{ id: 'a1' }, { id: 'a2' }];
		annotationsList.mockResolvedValue({ annotations: anns, total: 2 });
		const data = await load({ params: PARAMS } as never);
		expect(data.annotations).toEqual(anns);
	});

	it('returns [] without fetching when the run has no clip spine', async () => {
		runsGet.mockResolvedValue({ deliverable_id: 'd1', stage_outputs: [] });
		const data = await load({ params: PARAMS } as never);
		expect(data.annotations).toEqual([]);
		expect(annotationsList).not.toHaveBeenCalled();
	});
});

/**
 * ...but "we could not fetch them" must NOT arrive at the inspector looking the
 * same as "there are none". The old `.catch(() => [])` lost every feedback
 * marker silently, and the inspector then told the reviewer to add a note for
 * notes that already existed. `annotationsError` is the sibling key that keeps
 * `annotations` degrading safely while the failure stays visible.
 */
describe('studio loader — a failed annotations fetch is not an empty one', () => {
	it('still returns [] so the page renders, but reports the error', async () => {
		const boom = new Error('annotations 500');
		annotationsList.mockRejectedValue(boom);
		const data = await load({ params: PARAMS } as never);
		expect(data.annotations).toEqual([]);
		expect(data.annotationsError).toBe(boom);
	});

	it('reports a null error when the fetch genuinely returned nothing', async () => {
		annotationsList.mockResolvedValue({ annotations: [], total: 0 });
		const data = await load({ params: PARAMS } as never);
		expect(data.annotations).toEqual([]);
		expect(data.annotationsError).toBeNull();
	});

	it('reports a null error when there is no clip spine to fetch for', async () => {
		runsGet.mockResolvedValue({ deliverable_id: 'd1', stage_outputs: [] });
		const data = await load({ params: PARAMS } as never);
		expect(data.annotationsError).toBeNull();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * END-TO-END WITHIN THE ROUTE: the real `load()` output fed to the real
 * `+page.svelte`.
 *
 * The unit tests that render `AnnotationsPanel` directly cannot see the defect
 * this file exists for. The rail used to be gated `{#if data.annotations.total
 * === 0}` → "No annotations yet." — and `settle` hands back exactly
 * `{annotations: [], total: 0}` on a failed fetch, so the panel never MOUNTED on
 * the one condition it was taught to report. Every affordance inside it was
 * unreachable and the original lie rendered verbatim.
 *
 * Testing the panel in isolation proves the panel; only rendering the page
 * proves the user sees it.
 */
const annotationsList = vi.fn();
const verbatimListProject = vi.fn();
const runsGet = vi.fn();
const draftsList = vi.fn();
const getProjectOne = vi.fn();

vi.mock('$lib/api', async (importActual) => {
	const actual = await importActual<typeof import('$lib/api')>();
	return {
		ApiError: actual.ApiError,
		runs: { get: (...a: unknown[]) => runsGet(...a), regenerate: vi.fn() },
		drafts: { list: (...a: unknown[]) => draftsList(...a) },
		annotations: { list: (...a: unknown[]) => annotationsList(...a) },
		verbatim: { listProject: (...a: unknown[]) => verbatimListProject(...a) }
	};
});
vi.mock('$lib/stores/projects.svelte.js', () => ({
	getOne: (...a: unknown[]) => getProjectOne(...a),
	loadOne: vi.fn()
}));
vi.mock('$lib/stores/verbatim.svelte.js', () => ({ setProjectSnapshot: vi.fn() }));
vi.mock('$lib/stores/elements.svelte.js', () => ({ restamp: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

// `page.data` is the loader's own return value at runtime, so the stub is fed
// the real `load()` output rather than a hand-written object.
const h = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({
	page: {
		get data() {
			return h.data;
		}
	}
}));

import { render } from '@testing-library/svelte';
import { load } from './+page';
import Page from './+page.svelte';

const PARAMS = { pid: 'p1', id: 'r1', stage: 'storyline' };

async function renderStagePage() {
	const data = await load({ params: PARAMS } as never);
	h.data = data as unknown as Record<string, unknown>;
	return render(Page, { props: { data } });
}

beforeEach(() => {
	vi.clearAllMocks();
	h.data = {};
	getProjectOne.mockReturnValue({ id: 'p1', title: 'P', deliverables: [{ id: 'd1' }] });
	runsGet.mockResolvedValue({
		id: 'r1',
		deliverable_id: 'd1',
		stage_outputs: [{ stage_name: 'storyline', status: 'completed', output: { a: 1 } }]
	});
	draftsList.mockResolvedValue({ job_id: 'r1', stage_name: 'storyline', drafts: [] });
	annotationsList.mockResolvedValue({ annotations: [], total: 0 });
});

describe('stage editor annotations rail', () => {
	it('mounts the panel and reports the failure when the annotations fetch died', async () => {
		annotationsList.mockRejectedValue(new Error('annotations 500'));
		const { queryByText, getByTestId } = await renderStagePage();

		// The headline regression: the empty-branch copy must be GONE. A rail that
		// renders an error state but keeps this sentence misleads exactly as before.
		expect(queryByText('No annotations yet.')).toBeNull();
		expect(getByTestId('annotations-unavailable')).toBeInTheDocument();
		expect(getByTestId('error-state')).toHaveAttribute('role', 'alert');
	});

	it('still says "No annotations yet." when the stage genuinely has none', async () => {
		const { getByText, queryByTestId } = await renderStagePage();
		expect(getByText('No annotations yet.')).toBeInTheDocument();
		expect(queryByTestId('annotations-unavailable')).toBeNull();
	});

	it('renders the notes themselves when the fetch succeeded with items', async () => {
		annotationsList.mockResolvedValue({
			annotations: [
				{
					id: 'a1',
					stage_output_id: 'so-storyline',
					element_id: null,
					text: 'PUNCHIER_OPENING',
					status: 'open',
					applied_in_run_id: null,
					created_at: '2026-08-06T00:00:00Z',
					updated_at: '2026-08-06T00:00:00Z'
				}
			],
			total: 1
		});
		const { getByText, queryByText, queryByTestId } = await renderStagePage();
		expect(getByText('PUNCHIER_OPENING')).toBeInTheDocument();
		expect(queryByText('No annotations yet.')).toBeNull();
		expect(queryByTestId('annotations-unavailable')).toBeNull();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '$lib/api';

const runsGet = vi.fn();
const runsResume = vi.fn();
const runsRegenerate = vi.fn();
const runsPatchElement = vi.fn();
const draftsList = vi.fn();
const annotationsList = vi.fn();
const verbatimListProject = vi.fn();
const getProjectOne = vi.fn();
const loadProjectOne = vi.fn();

// Keep ApiError real so notFoundOr503's `instanceof` check works; stub the rest.
vi.mock('$lib/api', async (importActual) => {
	const actual = await importActual<typeof import('$lib/api')>();
	return {
		ApiError: actual.ApiError,
		runs: {
			get: (...a: unknown[]) => runsGet(...a),
			resume: (...a: unknown[]) => runsResume(...a),
			regenerate: (...a: unknown[]) => runsRegenerate(...a),
			restartPlan: vi.fn().mockResolvedValue({
				run_id: 'r1',
				mode: 'partial',
				full_reasons: [],
				changed_inputs: [],
				stages: []
			}),
			stages: { patchElement: (...a: unknown[]) => runsPatchElement(...a) }
		},
		drafts: { list: (...a: unknown[]) => draftsList(...a) },
		annotations: { list: (...a: unknown[]) => annotationsList(...a) },
		verbatim: { listProject: (...a: unknown[]) => verbatimListProject(...a) }
	};
});

vi.mock('$lib/stores/projects.svelte.js', () => ({
	getOne: (...a: unknown[]) => getProjectOne(...a),
	loadOne: (...a: unknown[]) => loadProjectOne(...a)
}));

const seedVerbatimProject = vi.fn();
vi.mock('$lib/stores/verbatim.svelte.js', () => ({
	setProjectSnapshot: (...a: unknown[]) => seedVerbatimProject(...a)
}));

vi.mock('$lib/stores/elements.svelte.js', () => ({ restamp: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const goto = vi.fn();
const invalidateAll = vi.fn().mockResolvedValue(undefined);
vi.mock('$app/navigation', () => ({
	goto: (...a: unknown[]) => goto(...a),
	invalidateAll: (...a: unknown[]) => invalidateAll(...a)
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

// `page.data` is the loader's own return value at runtime.
const h = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({
	page: {
		get data() {
			return h.data;
		}
	}
}));

import { render, fireEvent } from '@testing-library/svelte';
import { load } from './+page';
import Page from './+page.svelte';

const PARAMS = { pid: 'p1', id: 'r1', stage: 'storyline' };

beforeEach(() => {
	vi.clearAllMocks();
	// Project resolves from cache; one deliverable the run can belong to.
	getProjectOne.mockReturnValue({ id: 'p1', deliverables: [{ id: 'd1' }] });
	draftsList.mockResolvedValue({ job_id: 'r1', stage_name: 'storyline', drafts: [] });
	annotationsList.mockResolvedValue({ annotations: [], total: 0 });
});

/**
 * The stage editor loader is on the same run-monitor surface as the run page;
 * it must not mislabel a transient backend fault as "Run not found" (the #214
 * fix, previously only on the parent loader).
 */
describe('stage editor loader — error faithfulness', () => {
	it('maps a transient 5xx on the run to a retryable 503, not a 404', async () => {
		runsGet.mockRejectedValue(new ApiError(503, 'Unavailable', 'down'));
		await expect(load({ params: PARAMS } as never)).rejects.toMatchObject({ status: 503 });
	});

	it('maps a 500 on the run to a 503, not a 404', async () => {
		runsGet.mockRejectedValue(new ApiError(500, 'Server Error', 'boom'));
		await expect(load({ params: PARAMS } as never)).rejects.toMatchObject({ status: 503 });
	});

	it('still 404s when the run is genuinely missing', async () => {
		runsGet.mockRejectedValue(new ApiError(404, 'Not Found', 'gone'));
		await expect(load({ params: PARAMS } as never)).rejects.toMatchObject({ status: 404 });
	});

	it('still 404s when the requested stage is absent from the run', async () => {
		runsGet.mockResolvedValue({ deliverable_id: 'd1', stage_outputs: [{ stage_name: 'other' }] });
		await expect(load({ params: { ...PARAMS, stage: 'missing' } } as never)).rejects.toMatchObject({
			status: 404
		});
	});
});

/**
 * The rail's secondary fetches (annotations, project verbatim) must keep
 * degrading to an empty list — a note rail must not 500 the editor — WITHOUT
 * that empty list becoming a claim. "No notes" for a failed fetch is how a
 * tester concludes their note was never saved.
 */
describe('stage editor loader — failed side fetches are distinguishable from empty', () => {
	beforeEach(() => {
		runsGet.mockResolvedValue({
			deliverable_id: 'd1',
			stage_outputs: [{ stage_name: 'storyline' }, { stage_name: 'slide_deck' }]
		});
	});

	it('returns an empty annotation list AND the error when annotations fail', async () => {
		const boom = new ApiError(500, 'Server Error', 'boom');
		annotationsList.mockRejectedValue(boom);
		const data = await load({ params: PARAMS } as never);
		expect(data.annotations).toEqual({ annotations: [], total: 0 });
		expect(data.annotationsError).toBe(boom);
	});

	it('reports a null annotations error on a genuinely empty stage', async () => {
		const data = await load({ params: PARAMS } as never);
		expect(data.annotationsError).toBeNull();
	});

	// Until 2026-09 this file exercised the 404/redirect paths and the
	// verbatim/annotations rejections, but NEVER a drafts rejection — `drafts.list`
	// was the one sibling still on `.catch(() => ({ ...drafts: [] }))`, so a 500
	// on `GET /api/runs/{id}/stages/{stage}/drafts` was indistinguishable from a
	// deliverable with no prior runs and nothing in this suite could see it.
	it('returns an empty draft list AND the error when the ancestor chain fails', async () => {
		const boom = new ApiError(500, 'Server Error', 'boom');
		draftsList.mockRejectedValue(boom);
		const data = await load({ params: PARAMS } as never);
		expect(data.draftList).toEqual({ job_id: 'r1', stage_name: 'storyline', drafts: [] });
		expect(data.draftListError).toBe(boom);
	});

	it('reports a null draft-list error when the deliverable genuinely has no prior runs', async () => {
		const data = await load({ params: PARAMS } as never);
		expect(data.draftList.drafts).toEqual([]);
		expect(data.draftListError).toBeNull();
	});

	it('does not 500 the editor when the ancestor chain fails', async () => {
		draftsList.mockRejectedValue(new ApiError(503, 'Unavailable', 'down'));
		await expect(load({ params: PARAMS } as never)).resolves.toBeTruthy();
	});

	it('returns an empty verbatim overlay AND the error when verbatim fails', async () => {
		const boom = new ApiError(503, 'Unavailable', 'down');
		verbatimListProject.mockRejectedValue(boom);
		const data = await load({ params: { ...PARAMS, stage: 'slide_deck' } } as never);
		expect(data.verbatimProject).toEqual({ items: [], total: 0 });
		expect(data.verbatimError).toBe(boom);
	});

	it('does NOT seed the shared verbatim store from a failed fetch', async () => {
		// setProjectSnapshot writes into the project-scoped store that the
		// workspace's VerbatimSection gates its fetch-on-mount against. Seeding the
		// empty FALLBACK would make that section skip its own load and render "no
		// verbatim items" — this page's failure lying on a different page.
		verbatimListProject.mockRejectedValue(new ApiError(503, 'Unavailable', 'down'));
		await load({ params: { ...PARAMS, stage: 'slide_deck' } } as never);
		expect(seedVerbatimProject).not.toHaveBeenCalled();
	});

	it('DOES seed the store on a successful verbatim fetch', async () => {
		const snapshot = { items: [{ id: 'v1' }], total: 1 };
		verbatimListProject.mockResolvedValue(snapshot);
		await load({ params: { ...PARAMS, stage: 'slide_deck' } } as never);
		expect(seedVerbatimProject).toHaveBeenCalledWith('p1', snapshot);
	});

	it('reports a null verbatim error for a non-consumer stage (never fetched)', async () => {
		const data = await load({ params: PARAMS } as never);
		expect(verbatimListProject).not.toHaveBeenCalled();
		expect(data.verbatimError).toBeNull();
	});
});

/**
 * THE REVIEW GATE ITSELF.
 *
 * This page is where a paused run waits for a human. Before 2026-08 it could not
 * end that pause: `runs.resume` existed only on the run page and the gate offered
 * a raw-JSON "Restamp element" textarea, so the reviewer who followed the pause
 * banner in had to navigate back out to find the verb. These tests render the real
 * `load()` output into the real `+page.svelte` — the controls' PRESENCE and their
 * DISABLED conditions are the product requirement, and neither is visible from a
 * loader test.
 */
describe('stage gate — approve / regenerate controls', () => {
	function runFixture(over: Record<string, unknown> = {}) {
		return {
			id: 'r1',
			deliverable_id: 'd1',
			status: 'paused',
			current_stage: 'segment_select',
			pause_after_stages: ['segment_select', 'cut_plan'],
			stage_outputs: [
				{ stage_name: 'segment_select', status: 'completed', output: { a: 1 } },
				{ stage_name: 'cut_plan', status: 'pending', output: null }
			],
			...over
		};
	}

	async function renderGate(stage = 'segment_select') {
		const data = await load({ params: { ...PARAMS, stage } } as never);
		h.data = data as unknown as Record<string, unknown>;
		return render(Page, { props: { data } });
	}

	// Inferred from `renderGate`, NOT written as `ReturnType<typeof render>`.
	// `render` is generic, so naming its ReturnType pins one instantiation
	// (`SvelteComponent | Component<any, any, string>`) that the concrete
	// `Component<$$ComponentProps>` this page produces is not assignable to —
	// svelte-check, which is the CI gate here, rejects it with an
	// index-signature error about `container`. Letting the helper follow the
	// factory keeps the two in step for free.
	type Gate = Awaited<ReturnType<typeof renderGate>>;

	const approveBtn = (r: Gate) => r.getByRole('button', { name: /Approve & continue/ });

	beforeEach(() => {
		h.data = {};
		getProjectOne.mockReturnValue({ id: 'p1', title: 'P', deliverables: [{ id: 'd1' }] });
		draftsList.mockResolvedValue({ job_id: 'r1', stage_name: 'segment_select', drafts: [] });
		annotationsList.mockResolvedValue({ annotations: [], total: 0 });
		runsGet.mockResolvedValue(runFixture());
		runsResume.mockResolvedValue(undefined);
		runsRegenerate.mockResolvedValue({ id: 'r2' });
	});

	it("shows THIS stage's tokens (summed over its calls), not the run total", async () => {
		runsGet.mockResolvedValue(
			runFixture({
				usage_total: {
					input_tokens: 9000,
					output_tokens: 900,
					cost_usd: 0,
					cost_status: 'ok',
					by_stage: [
						{
							stage_name: 'segment_select',
							model: 'local-llm',
							provider: 'vllm',
							input_tokens: 1000,
							output_tokens: 200,
							cost_usd: 0
						},
						{
							stage_name: 'segment_select',
							model: 'local-llm',
							provider: 'vllm',
							input_tokens: 500,
							output_tokens: 100,
							cost_usd: 0
						},
						{
							stage_name: 'cut_plan',
							model: 'local-llm',
							provider: 'vllm',
							input_tokens: 7500,
							output_tokens: 600,
							cost_usd: 0
						}
					]
				}
			})
		);
		const r = await renderGate();
		expect(r.getByTestId('stage-tokens-total')).toHaveTextContent('1.8K tokens');
		expect(r.getByTestId('stage-tokens-input')).toHaveTextContent('1.5K in');
		expect(r.getByTestId('stage-tokens-output')).toHaveTextContent('300 out');
		expect(r.getByTestId('stage-tokens-note')).toHaveTextContent(
			'Local model (local-llm) — no charge'
		);
	});

	it('renders no token line for a stage that made no model calls', async () => {
		const r = await renderGate();
		expect(r.queryByTestId('stage-tokens')).toBeNull();
	});

	it('approves by resuming the run, then navigates to the monitor', async () => {
		// REVERTED ⇒ the gate is a dead end again: the reviewer can see the output
		// but cannot let the pipeline continue without leaving the page. That is the
		// original requirement ("I want to review each part of the process").
		const r = await renderGate();
		await fireEvent.click(approveBtn(r));
		expect(runsResume).toHaveBeenCalledWith('r1');
		expect(runsRegenerate).not.toHaveBeenCalled();
		// Refresh first, then leave — otherwise the run page paints the stale paused
		// snapshot it was last loaded with.
		expect(invalidateAll).toHaveBeenCalled();
		expect(goto).toHaveBeenCalledWith('/projects/p1/runs/r1');
	});

	it('DISABLES approve when the run is paused at a different stage', async () => {
		// REVERTED ⇒ cross-gate approval. `resume` takes no stage argument, so the
		// backend would continue from ITS pause point — approving a gate the reviewer
		// never looked at (or 409ing when the run is not paused at all).
		const r = await renderGate('cut_plan');
		expect(approveBtn(r)).toBeDisabled();
		expect(r.getByTestId('paused-elsewhere')).toHaveTextContent('Segment Select');
	});

	it('never fires resume for the wrong gate even if the click lands', async () => {
		const r = await renderGate('cut_plan');
		await fireEvent.click(approveBtn(r));
		expect(runsResume).not.toHaveBeenCalled();
	});

	it('DISABLES approve when the run is not paused at all', async () => {
		runsGet.mockResolvedValue(runFixture({ status: 'running', current_stage: 'cut_plan' }));
		const r = await renderGate();
		expect(approveBtn(r)).toBeDisabled();
		expect(r.getByTestId('not-paused')).toBeInTheDocument();
	});

	it('regenerates FROM this stage and navigates to the RETURNED sibling id', async () => {
		// REVERTED ⇒ either the whole run re-runs from the top (re-billing every
		// completed stage) or the reviewer is parked on the old run id, which will
		// never move again.
		const r = await renderGate();
		// Regenerating a stage spawns a PAID run, so it is confirmed rather than
		// one-click. Click through the dialog; what this test guards -- the
		// from_stage scope and the returned sibling id -- is unchanged behind it.
		await fireEvent.click(r.getByRole('button', { name: /Rerun from here/ }));
		await fireEvent.click(await r.findByRole('button', { name: 'Start rerun' }));
		expect(runsRegenerate).toHaveBeenCalledWith('r1', { from_stage: 'segment_select' });
		expect(goto).toHaveBeenCalledWith('/projects/p1/runs/r2');
	});

	it('DISABLES regenerate for a stage that has not completed', async () => {
		const r = await renderGate('cut_plan');
		expect(r.getByRole('button', { name: /Rerun from here/ })).toBeDisabled();
	});

	it('names the stage in human words, not the raw slug', async () => {
		// REVERTED ⇒ the heading reads `segment_select`. `data.stage` stays the URL
		// and testid identity; only the DISPLAY is mapped.
		const r = await renderGate();
		expect(r.getByRole('heading', { level: 1 })).toHaveTextContent('Segment Select');
		expect(r.queryByText('segment_select')).toBeNull();
	});

	it('keeps restamp available, demoted below the output', async () => {
		const r = await renderGate();
		expect(r.getByTestId('advanced-restamp')).toBeInTheDocument();
	});

	// A failed drafts fetch is NOT "this is the first run".
	//
	// REVERTED (back to `.catch(() => ({ ...drafts: [] }))`, or to a
	// `ancestors.length > 0`-first gate) ⇒ the whole "Prior runs of this
	// deliverable" card disappears on a transport blip, with no error, no empty
	// state and no retry. The reviewer reads that as a first run and re-runs a
	// deliverable that already has ancestors — a paid mistake.
	it('surfaces a failed ancestor-chain fetch instead of rendering "no prior runs"', async () => {
		draftsList.mockRejectedValue(new ApiError(500, 'Server Error', 'boom'));
		const r = await renderGate();
		expect(r.getByTestId('prior-runs-unavailable')).toBeInTheDocument();
		expect(r.getByRole('alert')).toHaveTextContent(/could not be loaded|boom/i);
	});

	it('renders NO prior-runs error when the chain is genuinely empty', async () => {
		const r = await renderGate();
		expect(r.queryByTestId('prior-runs-unavailable')).toBeNull();
	});

	it('lists the ancestors when the chain loads', async () => {
		draftsList.mockResolvedValue({
			job_id: 'r1',
			stage_name: 'segment_select',
			drafts: [{ id: 'aaaaaaaa-1111', status: 'completed' }]
		});
		const r = await renderGate();
		expect(r.queryByTestId('prior-runs-unavailable')).toBeNull();
		expect(r.getByText('Prior runs of this deliverable')).toBeInTheDocument();
	});

	// A run pauses ONLY after a stage in `pause_after_stages`. A completed stage
	// that is not in that set can never be the pause point.
	//
	// REVERTED (trusting a completed `current_stage` without the membership test)
	// ⇒ Approve goes live on a NON-GATE page. A blueprint wave runs its independent
	// stages concurrently, so `current_stage` can name a no-dep leaf that completed
	// while the checkpoint that tripped the pause was a sibling — and `resume` takes
	// no stage argument, so the click continues the run past a gate the reviewer
	// never opened, on a paid run.
	it('DISABLES approve on a completed stage that is NOT a declared checkpoint', async () => {
		runsGet.mockResolvedValue(
			runFixture({
				current_stage: 'shot_analysis',
				pause_after_stages: ['segment_select'],
				stage_outputs: [
					{
						stage_name: 'segment_select',
						status: 'completed',
						completed_at: '2026-08-15T10:00:00Z',
						output: { a: 1 }
					},
					{
						stage_name: 'shot_analysis',
						status: 'completed',
						completed_at: '2026-08-15T10:00:05Z',
						output: { b: 2 }
					}
				]
			})
		);
		const r = await renderGate('shot_analysis');
		expect(approveBtn(r)).toBeDisabled();
		// …and it points at the gate that IS open, rather than claiming this one is.
		expect(r.getByTestId('paused-elsewhere')).toHaveTextContent('Segment Select');
	});

	it('still ENABLES approve on the declared checkpoint of that same run', async () => {
		// The other half of the fence: narrowing to declared gates must not make the
		// real gate unapprovable, which would be its own dead end.
		runsGet.mockResolvedValue(
			runFixture({
				current_stage: 'shot_analysis',
				pause_after_stages: ['segment_select'],
				stage_outputs: [
					{
						stage_name: 'segment_select',
						status: 'completed',
						completed_at: '2026-08-15T10:00:00Z',
						output: { a: 1 }
					},
					{
						stage_name: 'shot_analysis',
						status: 'completed',
						completed_at: '2026-08-15T10:00:05Z',
						output: { b: 2 }
					}
				]
			})
		);
		const r = await renderGate('segment_select');
		expect(approveBtn(r)).toBeEnabled();
	});

	// `pause_after_stages` is USER-ORDERED — CheckpointPicker appends in CLICK order
	// and the backend consumes it as a `set` — so its array position carries no
	// information about execution.
	//
	// REVERTED (`consumedGates.at(-1)` on the raw array) ⇒ for a user who ticked
	// cut_plan first, the fallback names `segment_select` while the run is really
	// waiting at `cut_plan`: Approve enabled on the already-read gate and disabled
	// on the open one.
	// `cut_plan` was ticked FIRST but completed LAST — the two orders disagree, which
	// is the whole point of the fixture. Split across two cases on purpose: both
	// renders share one document.body, so a single case would make `getByRole`
	// ambiguous rather than assert anything.
	const CLICK_ORDERED = {
		current_stage: 'graphics_design', // a leaf that SKIPPED — untrustworthy
		pause_after_stages: ['cut_plan', 'segment_select'],
		stage_outputs: [
			{
				stage_name: 'segment_select',
				status: 'completed',
				completed_at: '2026-08-15T10:00:00Z',
				output: { a: 1 }
			},
			{
				stage_name: 'cut_plan',
				status: 'completed',
				completed_at: '2026-08-15T10:05:00Z',
				output: { b: 2 }
			},
			{ stage_name: 'graphics_design', status: 'skipped', completed_at: null, output: null }
		]
	};

	it('ENABLES approve on the LAST-COMPLETED checkpoint, not the last one clicked', async () => {
		runsGet.mockResolvedValue(runFixture(CLICK_ORDERED));
		const r = await renderGate('cut_plan');
		expect(approveBtn(r)).toBeEnabled();
	});

	it('DISABLES approve on the earlier checkpoint the user happened to click last', async () => {
		runsGet.mockResolvedValue(runFixture(CLICK_ORDERED));
		const r = await renderGate('segment_select');
		expect(approveBtn(r)).toBeDisabled();
		expect(r.getByTestId('paused-elsewhere')).toHaveTextContent('Cut Plan');
	});

	// REVERTED (guessing from array position when the evidence is missing) ⇒ a
	// coin-flip Approve. A disabled button costs a click; approving the wrong gate
	// continues a paid run past a checkpoint nobody reviewed.
	// A paused run whose snapshot holds NO completed checkpoint used to render a
	// disabled Approve under "Run is paused — nothing to approve here": a
	// contradiction with no way out. It must explain and link back to the monitor.
	it('explains and links back when the run is paused but no checkpoint resolves', async () => {
		runsGet.mockResolvedValue(
			runFixture({
				current_stage: 'cut_plan',
				pause_after_stages: [],
				stage_outputs: [
					{ stage_name: 'cut_plan', status: 'completed', completed_at: null, output: { b: 2 } }
				]
			})
		);
		const r = await renderGate('cut_plan');
		expect(approveBtn(r)).toBeDisabled();
		const why = r.getByTestId('pause-point-unknown');
		expect(why).toHaveTextContent("can't tell which gate");
		expect(why.querySelector('a')?.getAttribute('href')).toBe('/projects/p1/runs/r1');
		expect(r.queryByTestId('not-paused')).toBeNull();
	});

	it('DISABLES approve and says why when the evidence cannot name one gate', async () => {
		runsGet.mockResolvedValue(
			runFixture({
				current_stage: 'graphics_design',
				pause_after_stages: ['cut_plan', 'segment_select'],
				stage_outputs: [
					// Two consumed gates, NEITHER carrying a completion timestamp.
					{
						stage_name: 'segment_select',
						status: 'completed',
						completed_at: null,
						output: { a: 1 }
					},
					{ stage_name: 'cut_plan', status: 'completed', completed_at: null, output: { b: 2 } },
					{ stage_name: 'graphics_design', status: 'skipped', completed_at: null, output: null }
				]
			})
		);
		const r = await renderGate('cut_plan');
		expect(approveBtn(r)).toBeDisabled();
		expect(r.getByTestId('pause-point-unknown')).toHaveTextContent('does not say which checkpoint');
		// And it must NOT be reported as "nothing to approve" — the run IS paused.
		expect(r.queryByTestId('not-paused')).toBeNull();
	});
});

// People cancel a run to fix something, then restart it. A finished step's text is
// editable here on a cancelled run; the edit is kept by Restart and only the steps
// that build on it run again. A run the pipeline is still executing is not editable.
describe('stage page — edit a finished step before restarting', () => {
	function runWith(status: string) {
		return {
			id: 'r1',
			deliverable_id: 'd1',
			status,
			current_stage: null,
			pause_after_stages: [],
			stage_outputs: [
				{
					stage_name: 'promo_script',
					status: 'completed',
					output: { lines: [{ id: 'L1', text: 'Old opening', seconds: 3 }] },
					element_paths: ['lines'],
					edited_at: null
				}
			]
		};
	}

	async function renderStage(status: string) {
		runsGet.mockResolvedValue(runWith(status));
		const data = await load({ params: { ...PARAMS, stage: 'promo_script' } } as never);
		h.data = data as unknown as Record<string, unknown>;
		return render(Page, { props: { data } });
	}

	beforeEach(() => {
		h.data = {};
		getProjectOne.mockReturnValue({ id: 'p1', title: 'P', deliverables: [{ id: 'd1' }] });
		draftsList.mockResolvedValue({ job_id: 'r1', stage_name: 'promo_script', drafts: [] });
		annotationsList.mockResolvedValue({ annotations: [], total: 0 });
		runsPatchElement.mockResolvedValue({});
	});

	it('saves only the changed text on a CANCELLED run and says how to restart', async () => {
		const r = await renderStage('cancelled');
		expect(r.getByTestId('stage-edit-hint').textContent).toMatch(/press Restart/);
		const box = r.getByDisplayValue('Old opening') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'A sharper opening' } });
		await fireEvent.click(r.getByRole('button', { name: 'Save' }));
		await vi.waitFor(() =>
			expect(runsPatchElement).toHaveBeenCalledWith('r1', 'promo_script', 'L1', {
				patch: { text: 'A sharper opening' }
			})
		);
		await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
	});

	it('shows the server refusal in its own words', async () => {
		runsPatchElement.mockRejectedValue(
			new ApiError(409, 'Conflict', 'cannot edit a running run; pause it or wait for it to finish')
		);
		const r = await renderStage('cancelled');
		await fireEvent.input(r.getByDisplayValue('Old opening'), { target: { value: 'x' } });
		await fireEvent.click(r.getByRole('button', { name: 'Save' }));
		expect(await r.findByRole('alert')).toHaveTextContent(
			'cannot edit a running run; pause it or wait for it to finish'
		);
	});

	it('does not offer editing while the run is still executing, and says why', async () => {
		const r = await renderStage('running');
		expect(r.getByTestId('stage-element-editor-blocked').textContent).toMatch(/still running/);
		expect(r.getByRole('button', { name: 'Save' })).toBeDisabled();
		expect((r.getByDisplayValue('Old opening') as HTMLTextAreaElement).disabled).toBe(true);
	});
});

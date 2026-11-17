import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import StageIOInspector from './StageIOInspector.svelte';
import type { StageExecutionResponse } from '$lib/types';
import type { StageOutputResponse, RunUsageTotal } from '$lib/types/runs';

function execStage(
	stage_name: string,
	status: StageExecutionResponse['status'] = 'completed',
	duration_seconds: number | null = 1.2
): StageExecutionResponse {
	return {
		stage_name,
		status,
		service_name: '',
		service_job_id: null,
		duration_seconds,
		retry_count: 0,
		error: null
	};
}

function out(stage_name: string, output: Record<string, unknown>): StageOutputResponse {
	return {
		id: `id-${stage_name}`,
		run_id: 'run-1',
		stage_name,
		status: 'completed',
		output,
		error: null,
		started_at: null,
		completed_at: null
	} as StageOutputResponse;
}

const emptyUsage: RunUsageTotal = {
	input_tokens: 0,
	output_tokens: 0,
	cost_usd: 0,
	cost_status: 'ok',
	cost_settled: true,
	by_stage: []
};

describe('StageIOInspector', () => {
	it('renders one stage-card per stage with the e2e contract attributes', () => {
		const { container } = render(StageIOInspector, {
			stages: [execStage('promo_analyze'), execStage('promo_script', 'running', null)],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map()
		});
		const cards = container.querySelectorAll('[data-testid="stage-card"]');
		expect(cards.length).toBe(2);
		expect(cards[0].getAttribute('data-stage')).toBe('promo_analyze');
		expect(cards[0].getAttribute('data-status')).toBe('completed');
		expect(cards[1].getAttribute('data-status')).toBe('running');
	});

	it('shows upstream depends_on outputs as inputs when expanded', () => {
		const { getByText, getAllByText } = render(StageIOInspector, {
			stages: [execStage('promo_analyze'), execStage('promo_script')],
			outputs: [
				out('promo_analyze', { pain_points: [{ text: 'slow' }] }),
				out('promo_script', { lines: [{ text: 'Hi' }], total_seconds: 5 })
			],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map([
				['promo_analyze', ['source_ingest']],
				['promo_script', ['promo_analyze', 'site_capture']]
			]),
			expandedStage: 'promo_script'
		});
		// Inputs block names the upstream stages. promo_analyze appears both as its
		// own card header and as an input row of promo_script → at least one.
		expect(getAllByText('Promo Analyze').length).toBeGreaterThan(0);
		// site_capture is not in the run's stages, so this only appears as the
		// dependency row — proving the lineage list is rendered.
		expect(getByText('Site Capture')).toBeTruthy();
		// Output block rendered the script via the rich ScriptDialogue renderer
		// (the line text appears as a transcript bubble, not a generic list header).
		expect(getByText('Hi')).toBeTruthy();
	});

	it('shows the run config "Run inputs" block for a root stage (no depends_on)', () => {
		const { getByText } = render(StageIOInspector, {
			stages: [execStage('source_ingest')],
			outputs: [out('source_ingest', { pages: 3 })],
			config: { brief: { target_url: 'https://acme.test' } },
			usage: emptyUsage,
			dependsOn: new Map([['source_ingest', []]]),
			expandedStage: 'source_ingest'
		});
		expect(getByText(/Run inputs/)).toBeTruthy();
		// the brief slice is rendered through StageOutputView
		expect(getByText('brief')).toBeTruthy();
	});

	it('hides skipped stages behind a count, keeping only ran stages visible', () => {
		// A critique-only website_review: critique completes, everything else is
		// skipped. The run-view must show just the critique, not ten skipped cards.
		const { container, getByTestId, queryByTestId } = render(StageIOInspector, {
			stages: [
				execStage('website_critique', 'completed'),
				execStage('website_redesign', 'skipped', null),
				execStage('website_review_script', 'skipped', null),
				execStage('site_capture', 'skipped', null)
			],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map()
		});
		// Only the non-skipped stage card is visible by default.
		const cards = container.querySelectorAll('[data-testid="stage-card"]');
		expect(cards.length).toBe(1);
		expect(cards[0].getAttribute('data-stage')).toBe('website_critique');
		// The skipped stages are tucked behind a count affordance.
		const toggle = getByTestId('skipped-stages-toggle');
		expect(toggle.textContent).toContain('3 stages skipped (not requested)');
		// Collapsed by default — the skipped list isn't mounted yet.
		expect(queryByTestId('skipped-stages-list')).toBeNull();
	});

	it('expands the skipped section on demand and badges them "Skipped" (not "Cancelled")', async () => {
		const { getByTestId, queryByText } = render(StageIOInspector, {
			stages: [
				execStage('website_critique', 'completed'),
				execStage('website_redesign', 'skipped', null)
			],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map()
		});
		await fireEvent.click(getByTestId('skipped-stages-toggle'));
		const list = getByTestId('skipped-stages-list');
		const skippedCard = list.querySelector('[data-testid="stage-card"]');
		expect(skippedCard?.getAttribute('data-stage')).toBe('website_redesign');
		// The badge reads "Skipped" — the old code mislabeled it "Cancelled".
		expect(list.textContent).toContain('Skipped');
		expect(queryByText('Cancelled')).toBeNull();
	});

	it('uses singular "stage" in the count when exactly one stage is skipped', () => {
		const { getByTestId } = render(StageIOInspector, {
			stages: [
				execStage('website_critique', 'completed'),
				execStage('site_capture', 'skipped', null)
			],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map()
		});
		expect(getByTestId('skipped-stages-toggle').textContent).toContain(
			'1 stage skipped (not requested)'
		);
	});

	it('opens the skipped section when deep-linking to a skipped dependency', async () => {
		// A visible stage whose depends_on includes a SKIPPED upstream stage: its
		// Inputs "View" link must reveal the (otherwise hidden) skipped card, not
		// silently no-op.
		const { getByText, getByTestId, queryByTestId } = render(StageIOInspector, {
			stages: [
				execStage('website_review_script', 'completed'),
				execStage('redesign', 'skipped', null)
			],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map([['website_review_script', ['redesign']]]),
			expandedStage: 'website_review_script'
		});
		// Skipped section starts collapsed.
		expect(queryByTestId('skipped-stages-list')).toBeNull();
		// Click the dependency's "View" deep-link in the expanded stage's Inputs.
		await fireEvent.click(getByText('View'));
		const list = getByTestId('skipped-stages-list');
		expect(list.querySelector('[data-stage="redesign"]')).not.toBeNull();
	});

	it('renders no skipped affordance when nothing was skipped', () => {
		const { queryByTestId } = render(StageIOInspector, {
			stages: [execStage('promo_analyze'), execStage('promo_script', 'running', null)],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map()
		});
		expect(queryByTestId('skipped-stages')).toBeNull();
	});

	it('explains a cancelled stage (with its reason) instead of "Not started yet."', () => {
		// Orchestrator PR #706 sweeps stages stranded by a hard-failed run to
		// 'cancelled'. The old `:else if s.status !== 'failed'` fallback rendered
		// "Not started yet." and dropped `error` on the floor.
		const cancelled = execStage('promo_render', 'cancelled', null);
		cancelled.error = 'run failed at promo_script';
		const { getByTestId, queryByText } = render(StageIOInspector, {
			stages: [execStage('promo_script', 'failed'), cancelled],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_render'
		});
		const body = getByTestId('stage-output-cancelled');
		expect(body.textContent).toContain('never ran');
		expect(body.textContent).toContain('run failed at promo_script');
		expect(queryByText('Not started yet.')).toBeNull();
	});

	it('badges a cancelled stage "Cancelled" and keeps it visible in the main list', () => {
		const { container } = render(StageIOInspector, {
			stages: [execStage('promo_script', 'failed'), execStage('promo_render', 'cancelled', null)],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map()
		});
		const cards = container.querySelectorAll('[data-testid="stage-card"]');
		expect(cards.length).toBe(2);
		expect(cards[1].getAttribute('data-status')).toBe('cancelled');
		expect(cards[1].textContent).toContain('Cancelled');
	});

	it('offers "Rerun from here" on a cancelled stage — it never executed', () => {
		const { getByText } = render(StageIOInspector, {
			stages: [execStage('promo_render', 'cancelled', null)],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_render',
			pipelineStatus: 'failed',
			onrerun: () => {}
		});
		expect(getByText('Rerun from here')).toBeTruthy();
	});

	// George 2026-10-27: every part of a project can be rerun, even when it finished.
	it('offers "Rerun from here" and "Edit & rerun" on a step of a COMPLETED run', () => {
		const { getByText } = render(StageIOInspector, {
			stages: [execStage('promo_script', 'completed', null)],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_script',
			pipelineStatus: 'completed',
			onrerun: () => {},
			oneditor: () => {}
		});
		expect(getByText('Rerun from here')).toBeTruthy();
		expect(getByText('Edit & rerun')).toBeTruthy();
	});

	it('does not offer "Rerun from here" while the run is executing (the server would refuse)', () => {
		const { queryByText } = render(StageIOInspector, {
			stages: [execStage('promo_script', 'completed', null)],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_script',
			pipelineStatus: 'running',
			onrerun: () => {}
		});
		expect(queryByText('Rerun from here')).toBeNull();
	});

	it('says a completed stage\'s output could not be LOADED instead of "No output recorded."', () => {
		// A 401/403/5xx on the lazy output fetch must not be rendered as "this
		// stage produced nothing" — that is the same lie the whole live-output
		// store exists to stop telling.
		const { getByTestId, queryByText } = render(StageIOInspector, {
			stages: [execStage('promo_script')],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_script',
			outputError: () => 'not your tenant'
		});
		expect(getByTestId('stage-output-load-error').textContent).toContain('not your tenant');
		expect(queryByText('No output recorded.')).toBeNull();
	});

	it('renders the output normally when there is no load error', () => {
		const { getByText, queryByTestId } = render(StageIOInspector, {
			stages: [execStage('promo_script')],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_script',
			outputError: () => null
		});
		expect(getByText('No output recorded.')).toBeTruthy();
		expect(queryByTestId('stage-output-load-error')).toBeNull();
	});

	it('surfaces per-stage model/token/cost meta from usage.by_stage', () => {
		const { getByText } = render(StageIOInspector, {
			stages: [execStage('promo_script')],
			outputs: [out('promo_script', { lines: [{ text: 'Hi' }] })],
			config: {},
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cost_usd: 0.0021,
				cost_status: 'ok',
				cost_settled: true,
				by_stage: [
					{
						stage_name: 'promo_script',
						model: 'deepseek',
						provider: 'inference_router',
						input_tokens: 100,
						output_tokens: 50,
						cost_usd: 0.0021
					}
				]
			},
			dependsOn: new Map()
		});
		expect(getByText(/deepseek/)).toBeTruthy();
		expect(getByText(/150 tok/)).toBeTruthy();
	});

	it('attributes a stage to the tenant connection version vs the platform path', () => {
		const { getAllByTestId } = render(StageIOInspector, {
			stages: [execStage('promo_script'), execStage('promo_narrate')],
			outputs: [],
			config: {},
			usage: {
				input_tokens: 150,
				output_tokens: 0,
				cost_usd: 0.003,
				cost_status: 'ok',
				cost_settled: true,
				by_stage: [
					{
						stage_name: 'promo_script',
						model: 'gpt-x',
						provider: 'openai',
						input_tokens: 100,
						output_tokens: 50,
						cost_usd: 0.002,
						connection_id: '11111111-1111-4111-8111-111111111111',
						connection_version: 3
					},
					{
						stage_name: 'promo_narrate',
						model: 'kokoro',
						provider: 'tts',
						input_tokens: 0,
						output_tokens: 0,
						cost_usd: 0.001,
						connection_id: null,
						connection_version: null
					}
				]
			},
			dependsOn: new Map()
		});
		const cards = getAllByTestId('stage-card');
		const script = cards.find((c) => c.getAttribute('data-stage') === 'promo_script')!;
		const narrate = cards.find((c) => c.getAttribute('data-stage') === 'promo_narrate')!;
		expect(script.textContent).toContain('tenant connection v3');
		expect(script.textContent).not.toContain('platform');
		expect(narrate.textContent).toContain('platform');
		expect(narrate.textContent).not.toContain('tenant connection');
	});

	it('sums every usage row of a stage instead of keeping only the last one', () => {
		const { getAllByTestId } = render(StageIOInspector, {
			stages: [execStage('promo_script')],
			outputs: [],
			config: {},
			usage: {
				input_tokens: 130,
				output_tokens: 20,
				cost_usd: 0.003,
				cost_status: 'ok',
				cost_settled: true,
				by_stage: [
					{
						stage_name: 'promo_script',
						model: 'gpt-x',
						provider: 'openai',
						input_tokens: 100,
						output_tokens: 20,
						cost_usd: 0.002,
						connection_id: '11111111-1111-4111-8111-111111111111',
						connection_version: 2
					},
					{
						stage_name: 'promo_script',
						model: 'deepseek',
						provider: 'inference_router',
						input_tokens: 30,
						output_tokens: 0,
						cost_usd: 0.001
					}
				]
			},
			dependsOn: new Map()
		});
		const text = getAllByTestId('stage-card')[0].textContent ?? '';
		expect(text).toContain('150 tok');
		expect(text).toContain('$0.0030');
		expect(text).toContain('gpt-x');
		expect(text).toContain('deepseek');
		expect(text).toContain('tenant connection v2');
		expect(text).toContain('platform');
	});

	it('does not crash on a run whose cost is unavailable (cost_usd null)', () => {
		const { getAllByTestId } = render(StageIOInspector, {
			stages: [execStage('promo_script')],
			outputs: [],
			config: {},
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				cost_usd: null,
				cost_status: 'unavailable',
				cost_settled: false,
				cost_unavailable_reason: 'billing_credential_missing',
				by_stage: []
			},
			dependsOn: new Map()
		});
		expect(getAllByTestId('stage-card')).toHaveLength(1);
	});
});

describe('StageIOInspector — disclosure semantics', () => {
	it('exposes each stage toggle by its stage name with aria-expanded state', () => {
		const { getByRole } = render(StageIOInspector, {
			stages: [execStage('promo_analyze'), execStage('promo_script')],
			outputs: [],
			config: {},
			usage: emptyUsage,
			dependsOn: new Map(),
			expandedStage: 'promo_script'
		});
		const analyze = getByRole('button', { name: /Promo Analyze/ });
		expect(analyze.getAttribute('aria-expanded')).toBe('false');
		const script = getByRole('button', { name: /Promo Script/ });
		expect(script.getAttribute('aria-expanded')).toBe('true');
	});
});

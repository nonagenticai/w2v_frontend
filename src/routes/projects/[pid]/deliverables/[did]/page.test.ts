import { describe, it, expect, vi, beforeEach } from 'vitest';

const listForProjectMock = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('$lib/api', () => ({
	runs: {
		listForProject: (...a: unknown[]) => listForProjectMock(...a),
		start: vi.fn()
	},
	ApiError: class ApiError extends Error {}
}));

import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';
import type { RunSummary } from '$lib/types/runs';

beforeEach(() => {
	vi.clearAllMocks();
});

function makeRun(over: Partial<RunSummary> = {}): RunSummary {
	return {
		id: 'r1',
		project_id: 'p1',
		deliverable_id: 'd1',
		parent_run_id: null,
		blueprint_id: 'website_review_v1',
		status: 'completed',
		current_stage: null,
		started_at: '2026-06-12T10:00:00Z',
		completed_at: '2026-06-12T10:05:00Z',
		created_at: '2026-06-12T10:00:00Z',
		...over
	} as unknown as RunSummary;
}

function makeData() {
	return {
		project: { id: 'p1', title: 'Proj' },
		deliverable: { id: 'd1', name: 'Review video' }
	} as never;
}

describe('deliverable detail — runs list', () => {
	it("lists this deliverable's runs linking to the run-view, excluding other deliverables", async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r2', deliverable_id: 'd1', status: 'completed' }),
			makeRun({ id: 'rX', deliverable_id: 'd2', status: 'completed' })
		]);
		render(Page, { data: makeData() });
		await tick();
		await tick();

		const rows = await screen.findAllByTestId('deliverable-run-row');
		expect(rows).toHaveLength(1);
		expect(listForProjectMock).toHaveBeenCalledWith('p1');
		expect(rows[0].getAttribute('href')).toBe('/projects/p1/runs/r2');
		expect(within(rows[0]).getByText(/website_review_v1/)).toBeTruthy();
	});

	it('shows the empty state when the deliverable has no runs', async () => {
		listForProjectMock.mockResolvedValue([makeRun({ deliverable_id: 'd2' })]);
		render(Page, { data: makeData() });
		await tick();
		await tick();

		expect(await screen.findByText('No runs yet')).toBeTruthy();
		expect(screen.queryByTestId('deliverable-run-row')).toBeNull();
	});

	it("shows a run's token totals, and nothing for a run that never reported usage", async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r1', input_tokens: 7463, output_tokens: 1407 }),
			makeRun({ id: 'r2', input_tokens: 0, output_tokens: 0 })
		]);
		render(Page, { data: makeData() });
		await tick();
		await tick();

		const rows = await screen.findAllByTestId('deliverable-run-row');
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByTestId('deliverable-run-tokens-total').textContent).toBe(
			'8.9K tokens'
		);
		expect(within(rows[0]).getByTestId('deliverable-run-tokens-input').textContent).toBe('7.5K in');
		expect(within(rows[0]).getByTestId('deliverable-run-tokens-output').textContent).toBe(
			'1.4K out'
		);
		// Cost is unknown on the list — never claim "no charge".
		expect(within(rows[0]).queryByTestId('deliverable-run-tokens-note')).toBeNull();
		expect(within(rows[1]).queryByTestId('deliverable-run-tokens')).toBeNull();
	});
});

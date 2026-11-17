import { describe, it, expect, vi, beforeEach } from 'vitest';

const listForProjectMock = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/api', () => ({
	runs: { listForProject: (...a: unknown[]) => listForProjectMock(...a) }
}));

import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import OutputsSection from './OutputsSection.svelte';
import type { ProjectDetailResponse } from '$lib/types';
import type { RunSummary } from '$lib/types/runs';

beforeEach(() => {
	vi.clearAllMocks();
});

function makeProject(over: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		id: 'p1',
		type: 'generic',
		title: 'Proj',
		status: 'drafting',
		deliverables: [
			{ id: 'd1', name: 'Hero', format: '16x9', captions_mode: 'none', status: 'idle' },
			{ id: 'd2', name: 'Teaser', format: '16x9', captions_mode: 'none', status: 'idle' }
		],
		children: [],
		...over
	} as unknown as ProjectDetailResponse;
}

function makeRun(over: Partial<RunSummary> = {}): RunSummary {
	return {
		id: 'r1',
		project_id: 'p1',
		deliverable_id: 'd1',
		parent_run_id: null,
		blueprint_id: 'generic_v1',
		status: 'completed',
		current_stage: null,
		started_at: '2026-06-12T10:00:00Z',
		completed_at: '2026-06-12T10:05:00Z',
		created_at: '2026-06-12T10:00:00Z',
		...over
	} as unknown as RunSummary;
}

describe('OutputsSection', () => {
	it('shows one card per deliverable with a completed run, linking to the run-view', async () => {
		// d1 has a completed run (plus an older one); d2 only failed → excluded.
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r3', deliverable_id: 'd1', status: 'completed' }),
			makeRun({ id: 'r2', deliverable_id: 'd1', status: 'completed' }),
			makeRun({ id: 'r1', deliverable_id: 'd2', status: 'failed' })
		]);
		render(OutputsSection, { project: makeProject() });
		await tick();
		await tick();

		const rows = await screen.findAllByTestId('output-row');
		expect(rows).toHaveLength(1);
		expect(listForProjectMock).toHaveBeenCalledWith('p1', { limit: 200 });
		// Newest completed run for d1 wins, link points at the run-view.
		expect(rows[0].getAttribute('href')).toBe('/projects/p1/runs/r3');
		expect(within(rows[0]).getByText('Hero')).toBeTruthy();
		// d2 (only a failed run) is not surfaced as an output.
		expect(screen.queryByText('Teaser')).toBeNull();
	});

	it('shows the empty state when no run has completed', async () => {
		listForProjectMock.mockResolvedValue([makeRun({ status: 'failed' })]);
		render(OutputsSection, { project: makeProject() });
		await tick();
		await tick();

		expect(await screen.findByText('No outputs yet')).toBeTruthy();
		expect(screen.queryByTestId('output-row')).toBeNull();
	});

	it('uses audit-appropriate copy + card meta for an audit project (no video/captions)', async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r3', deliverable_id: 'd1', status: 'completed', blueprint_id: 'seo_audit_v1' })
		]);
		render(OutputsSection, {
			project: makeProject({
				type: 'seo_audit',
				deliverables: [
					{ id: 'd1', name: 'SEO audit', format: '16x9', captions_mode: 'none', status: 'idle' }
				]
			} as unknown as Partial<ProjectDetailResponse>)
		});
		await tick();
		await tick();

		const rows = await screen.findAllByTestId('output-row');
		expect(rows).toHaveLength(1);
		// The video-centric subtitle + "16:9 · none captions" meta must NOT appear.
		expect(screen.queryByText(/publish to YouTube/i)).toBeNull();
		expect(screen.queryByText(/captions/i)).toBeNull();
		expect(within(rows[0]).getByText('SEO scorecard')).toBeTruthy();
	});

	it('labels a marketing_scorecard project a "Marketing scorecard" (descriptor-driven)', async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({
				id: 'r3',
				deliverable_id: 'd1',
				status: 'completed',
				blueprint_id: 'marketing_scorecard_v1'
			})
		]);
		render(OutputsSection, {
			project: makeProject({
				type: 'marketing_scorecard',
				deliverables: [
					{ id: 'd1', name: 'Brand audit', format: '16x9', captions_mode: 'none', status: 'idle' }
				]
			} as unknown as Partial<ProjectDetailResponse>)
		});
		await tick();
		await tick();

		const rows = await screen.findAllByTestId('output-row');
		expect(within(rows[0]).getByText('Marketing scorecard')).toBeTruthy();
		expect(screen.queryByText(/publish to YouTube/i)).toBeNull();
	});

	it('renders an error state with a working retry', async () => {
		listForProjectMock.mockRejectedValueOnce(new Error('boom'));
		render(OutputsSection, { project: makeProject() });
		await tick();
		await tick();

		expect(await screen.findByTestId('error-state')).toBeTruthy();

		listForProjectMock.mockResolvedValueOnce([makeRun()]);
		await fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
		await tick();
		await tick();

		expect(await screen.findByTestId('output-row')).toBeTruthy();
		expect(listForProjectMock).toHaveBeenCalledTimes(2);
	});
});

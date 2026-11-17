import { describe, it, expect, vi, beforeEach } from 'vitest';

const listForProjectMock = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/api', () => ({
	runs: { listForProject: (...a: unknown[]) => listForProjectMock(...a) }
}));

import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import RunHistorySection from './RunHistorySection.svelte';
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
			{ id: 'd1', name: 'Hero', format: '16x9', captions_mode: 'none', status: 'pending' }
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

describe('RunHistorySection', () => {
	it('lists runs newest-first with status, deliverable name and a link to the run', async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r2', status: 'failed' }),
			makeRun({ id: 'r1', status: 'completed' })
		]);
		render(RunHistorySection, { project: makeProject() });
		await tick();
		await tick();

		const rows = await screen.findAllByTestId('run-history-row');
		expect(rows).toHaveLength(2);
		expect(listForProjectMock).toHaveBeenCalledWith(
			'p1',
			expect.objectContaining({ limit: 50, offset: 0 })
		);
		// Deliverable name resolved from project.deliverables
		expect(within(rows[0]).getByText('Hero')).toBeTruthy();
		// Status badge bound to each run's status
		expect(within(rows[0]).getByTestId('run-status-badge').getAttribute('data-status')).toBe(
			'failed'
		);
		expect(rows[0].getAttribute('href')).toBe('/projects/p1/runs/r2');
	});

	it('shows an empty state when the project has no runs', async () => {
		listForProjectMock.mockResolvedValue([]);
		render(RunHistorySection, { project: makeProject() });
		await tick();
		await tick();

		expect(await screen.findByText('No runs yet')).toBeTruthy();
		expect(screen.queryByTestId('run-history-row')).toBeNull();
	});

	it('renders an error state with a working retry', async () => {
		listForProjectMock.mockRejectedValueOnce(new Error('boom'));
		render(RunHistorySection, { project: makeProject() });
		await tick();
		await tick();

		expect(await screen.findByTestId('error-state')).toBeTruthy();

		listForProjectMock.mockResolvedValueOnce([makeRun()]);
		await fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
		await tick();
		await tick();

		expect(await screen.findByTestId('run-history-row')).toBeTruthy();
		expect(listForProjectMock).toHaveBeenCalledTimes(2);
	});

	it('says "showing N of M" from X-Total-Count and offers load-more until all are loaded', async () => {
		const page1 = Array.from({ length: 50 }, (_, i) => makeRun({ id: `a${i}` }));
		listForProjectMock.mockImplementationOnce(
			async (_pid: string, p: { onTotal?: (n: number | null) => void }) => {
				p.onTotal?.(52);
				return page1;
			}
		);
		render(RunHistorySection, { project: makeProject() });
		const footer = await screen.findByTestId('run-history-footer');
		expect(footer.textContent).toContain('Showing 50 of 52 runs.');

		listForProjectMock.mockImplementationOnce(
			async (_pid: string, p: { onTotal?: (n: number | null) => void }) => {
				p.onTotal?.(52);
				return [makeRun({ id: 'b1' }), makeRun({ id: 'b2' })];
			}
		);
		await fireEvent.click(screen.getByRole('button', { name: /load more/i }));
		await tick();
		await tick();
		expect(screen.getByTestId('run-history-footer').textContent).toContain(
			'Showing 52 of 52 runs.'
		);
		expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
	});

	it('a short page with a larger total still offers load-more (total, not page size, decides)', async () => {
		listForProjectMock.mockImplementationOnce(
			async (_pid: string, p: { onTotal?: (n: number | null) => void }) => {
				p.onTotal?.(3);
				return [makeRun({ id: 'x1' })];
			}
		);
		render(RunHistorySection, { project: makeProject() });
		const footer = await screen.findByTestId('run-history-footer');
		expect(footer.textContent).toContain('Showing 1 of 3 runs.');
		expect(screen.getByRole('button', { name: /load more/i })).toBeTruthy();
	});
});

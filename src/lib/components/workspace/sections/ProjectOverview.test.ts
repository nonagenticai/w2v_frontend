import { describe, it, expect, vi, beforeEach } from 'vitest';

const listForProjectMock = vi.fn();
const getRunMock = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/api', () => ({
	runs: {
		listForProject: (...a: unknown[]) => listForProjectMock(...a),
		get: (...a: unknown[]) => getRunMock(...a)
	}
}));
// The latest-output card renders RunOutputPanel, whose media helpers import the
// api client, which pulls keycloak at module init. Keep the import offline.
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));

import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import ProjectOverview from './ProjectOverview.svelte';
import type { ProjectDetailResponse } from '$lib/types';
import type { RunSummary } from '$lib/types/runs';

beforeEach(() => {
	vi.clearAllMocks();
	getRunMock.mockReset();
	getRunMock.mockReturnValue(new Promise(() => {}));
});

function makeProject(over: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		id: 'p1',
		type: 'promo',
		title: 'Proj',
		status: 'producing',
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
		blueprint_id: 'promo_v1',
		status: 'completed',
		created_at: '2026-06-12T10:00:00Z',
		updated_at: '2026-06-12T10:05:00Z',
		...over
	} as unknown as RunSummary;
}

describe('ProjectOverview', () => {
	it('renders the overview strip with type + deliverable count', async () => {
		listForProjectMock.mockResolvedValue([]);
		render(ProjectOverview, { project: makeProject() });
		await tick();
		expect(screen.getByTestId('project-overview')).toBeTruthy();
		expect(screen.getByText('Deliverables')).toBeTruthy();
	});

	it('links last run + latest output once runs load', async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r2', status: 'running' }),
			makeRun({ id: 'r1', status: 'completed' })
		]);
		render(ProjectOverview, { project: makeProject() });
		await tick();
		await tick();

		const lastRun = await screen.findByTestId('overview-last-run');
		// newest-first → r2 is the last run
		expect(lastRun.getAttribute('href')).toBe('/projects/p1/runs/r2');
		// latest completed → r1
		expect(screen.getByTestId('overview-latest-output').getAttribute('href')).toBe(
			'/projects/p1/runs/r1'
		);
	});

	// --- the three states that used to render identically -----------------------
	// Before the split, a pending fetch and a FAILED fetch were indistinguishable
	// from "this project has zero runs": the catch coerced the error to `[]`, so
	// the strip confidently claimed 0 runs / no last run about a 500. These three
	// tests are the ones that can tell those states apart.

	it('shows skeletons — and never a run count — while the run history is in flight', async () => {
		// A promise that never settles is the whole point: it pins the component
		// in the loading state so the assertion cannot pass by racing.
		listForProjectMock.mockReturnValue(new Promise(() => {}));
		render(ProjectOverview, { project: makeProject() });
		await tick();

		expect(screen.getByTestId('overview-runs-loading')).toBeTruthy();
		expect(screen.getByTestId('overview-last-run-loading')).toBeTruthy();
		// The lie this guards: "0 runs" while nothing has come back yet.
		expect(screen.queryByTestId('overview-no-runs')).toBeNull();
		expect(screen.queryByText('No runs yet')).toBeNull();
	});

	it('says Unavailable (not 0) when the run history fetch fails, and recovers on retry', async () => {
		listForProjectMock.mockRejectedValue(new Error('boom'));
		render(ProjectOverview, { project: makeProject() });

		expect(await screen.findByTestId('overview-runs-error')).toBeTruthy();
		expect(screen.getByTestId('overview-last-run-error')).toBeTruthy();
		// The regression this exists for.
		expect(screen.queryByTestId('overview-no-runs')).toBeNull();
		expect(listForProjectMock).toHaveBeenCalledTimes(1);

		// Retry must re-issue the call, not merely clear the message.
		listForProjectMock.mockResolvedValue([makeRun({ id: 'r7' })]);
		const retry = within(screen.getByTestId('overview-runs-retry-btn')).getByRole('button');
		await fireEvent.click(retry);

		expect(await screen.findByTestId('overview-last-run')).toBeTruthy();
		expect(listForProjectMock).toHaveBeenCalledTimes(2);
		expect(screen.queryByTestId('overview-runs-error')).toBeNull();
	});

	it('renders a literal 0 and "No runs yet" for a project that has genuinely never run', async () => {
		listForProjectMock.mockResolvedValue([]);
		render(ProjectOverview, { project: makeProject() });

		const zero = await screen.findByTestId('overview-no-runs');
		// An em dash here would be the old ambiguous rendering.
		expect(zero.textContent?.trim()).toBe('0');
		expect(screen.getByText('No runs yet')).toBeTruthy();
		expect(screen.queryByTestId('overview-runs-error')).toBeNull();
	});

	it('shows Lessons label for a course project', async () => {
		listForProjectMock.mockResolvedValue([]);
		render(ProjectOverview, {
			project: makeProject({ type: 'course', children: [{ id: 'l1' }] as never })
		});
		await tick();
		expect(screen.getByText('Lessons')).toBeTruthy();
	});

	// The project page used to offer only a "View latest output" text link; the
	// deliverable itself was two clicks and a scroll away (run 01a17e6f).
	it('shows the latest finished video on the project page, with downloads', async () => {
		listForProjectMock.mockResolvedValue([
			makeRun({ id: 'r1', status: 'completed', completed_at: '2026-10-27T18:16:52Z' })
		]);
		getRunMock.mockResolvedValue({
			...makeRun({ id: 'r1', status: 'completed' }),
			stage_outputs: [
				{
					id: 'so-1',
					run_id: 'r1',
					stage_name: 'promo_render',
					status: 'completed',
					output: { artifact_url: '/api/runs/r1/artifact/v/final.mp4', duration_seconds: 58.7 },
					error: null,
					started_at: null,
					completed_at: null,
					degraded: false
				}
			]
		});
		render(ProjectOverview, { project: makeProject({ title: 'Acme launch' }) });
		await screen.findByTestId('run-output-panel');
		expect(getRunMock).toHaveBeenCalledWith('r1');
		expect(screen.getByRole('heading', { name: 'Promo video' })).toBeTruthy();
		expect(screen.getByTestId('run-mp4-download').getAttribute('download')).toBe('acme-launch.mp4');
		expect(screen.getByText('0:59')).toBeTruthy();
	});

	it('falls back to the run link when the latest output cannot be loaded', async () => {
		listForProjectMock.mockResolvedValue([makeRun({ id: 'r1', status: 'completed' })]);
		getRunMock.mockRejectedValue(new Error('boom'));
		render(ProjectOverview, { project: makeProject() });
		expect(await screen.findByTestId('latest-output-error')).toBeTruthy();
		expect(screen.getByTestId('overview-latest-output').getAttribute('href')).toBe(
			'/projects/p1/runs/r1'
		);
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The checkpoints leg of this loader is the one that can turn a READ failure
// into a WRITE. `+page.svelte` decides whether the picker is editable purely
// from `checkpointsError`, so if the loader stops emitting it the whole guard
// goes inert with the component tests still green. That is what this file pins.

const checkpointsGet = vi.fn();
const runsGet = vi.fn();
const verbatimListProject = vi.fn();
const blueprintsList = vi.fn();

vi.mock('$lib/api', () => ({
	runs: {
		get: (...a: unknown[]) => runsGet(...a),
		checkpoints: { get: (...a: unknown[]) => checkpointsGet(...a) }
	},
	verbatim: { listProject: (...a: unknown[]) => verbatimListProject(...a) },
	blueprints: { list: (...a: unknown[]) => blueprintsList(...a) },
	ApiError: class ApiError extends Error {
		status: number;
		detail: string;
		constructor(status: number, _statusText: string, detail: string) {
			super(detail);
			this.status = status;
			this.detail = detail;
		}
	}
}));

vi.mock('$lib/stores/projects.svelte.js', () => ({
	loadOne: vi.fn(),
	getOne: () => ({
		id: 'proj-1',
		title: 'My Project',
		type: 'generic',
		// Empty deliverables keeps the ownership cross-check from redirecting:
		// the guard only fires when the project HAS deliverables and none match.
		deliverables: []
	})
}));

import { load } from './+page';

beforeEach(() => {
	vi.clearAllMocks();
	runsGet.mockResolvedValue({ id: 'run-1', deliverable_id: 'del-1', status: 'running' });
	verbatimListProject.mockResolvedValue({ items: [], total: 0 });
	blueprintsList.mockResolvedValue([]);
});

const run = () => load({ params: { pid: 'proj-1', id: 'run-1' } } as never);

describe('projects/[pid]/runs/[id] +page.ts — checkpoints leg', () => {
	it('reports a FAILED checkpoints read instead of passing off the empty fallback as real', async () => {
		checkpointsGet.mockRejectedValue(new Error('boom 500'));

		const res = await run();

		// The page still renders — a side panel must not 500 the run monitor.
		expect(res.checkpoints.pause_after_stages).toEqual([]);
		// …but the emptiness is marked as UNMEASURED. Without this the picker
		// offers a destructive edit against a baseline nobody read.
		expect(res.checkpointsError).toBeTruthy();
	});

	it('leaves checkpointsError null when the read SUCCEEDS and the run has gates', async () => {
		checkpointsGet.mockResolvedValue({
			run_id: 'run-1',
			pause_after_stages: ['script_draft']
		});

		const res = await run();

		expect(res.checkpoints.pause_after_stages).toEqual(['script_draft']);
		expect(res.checkpointsError).toBeNull();
	});

	// A SUCCESSFUL read that legitimately returns no gates must be
	// distinguishable from a failed one — otherwise the guard above would just
	// disable the picker for every autopilot run.
	it('leaves checkpointsError null when the read SUCCEEDS and returns none', async () => {
		checkpointsGet.mockResolvedValue({ run_id: 'run-1', pause_after_stages: [] });

		const res = await run();

		expect(res.checkpoints.pause_after_stages).toEqual([]);
		expect(res.checkpointsError).toBeNull();
	});
});

describe('projects/[pid]/runs/[id] +page.ts — lineage blueprint', () => {
	it("takes depends_on from the run's own blueprint_id over the project-type match", async () => {
		checkpointsGet.mockResolvedValue({ run_id: 'run-1', pause_after_stages: [] });
		runsGet.mockResolvedValue({
			id: 'run-1',
			deliverable_id: 'del-1',
			status: 'paused',
			blueprint_id: 'generic_v2'
		});
		blueprintsList.mockResolvedValue([
			{ id: 'generic_v1', project_type: 'generic', stages: [{ name: 'old', depends_on: [] }] },
			{
				id: 'generic_v2',
				project_type: 'generic',
				stages: [
					{ name: 'a', depends_on: [] },
					{ name: 'b', depends_on: ['a'] }
				]
			}
		]);

		const res = await run();

		expect([...res.dependsOn.keys()]).toEqual(['a', 'b']);
	});

	it('falls back to the project-type match when no blueprint has the run id', async () => {
		checkpointsGet.mockResolvedValue({ run_id: 'run-1', pause_after_stages: [] });
		runsGet.mockResolvedValue({
			id: 'run-1',
			deliverable_id: 'del-1',
			status: 'paused',
			blueprint_id: 'retired_v0'
		});
		blueprintsList.mockResolvedValue([
			{ id: 'generic_v1', project_type: 'generic', stages: [{ name: 'x', depends_on: [] }] }
		]);

		const res = await run();

		expect([...res.dependsOn.keys()]).toEqual(['x']);
	});
});

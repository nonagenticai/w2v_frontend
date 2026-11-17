import { describe, it, expect, vi, beforeEach } from 'vitest';

const resume = vi.fn();
const regenerate = vi.fn();

vi.mock('$lib/api', () => ({
	runs: {
		resume: (...a: unknown[]) => resume(...a),
		regenerate: (...a: unknown[]) => regenerate(...a)
	}
}));

import { restartKind, restartLabel, performRestart } from './run-restart';

beforeEach(() => {
	vi.clearAllMocks();
	resume.mockResolvedValue(undefined);
	regenerate.mockResolvedValue({ id: 'sibling-run' });
});

/**
 * WHAT BREAKS IF REVERTED: the Resume-vs-Restart distinction collapses. If
 * `paused` ever routes to `regenerate`, approving a checkpoint DISCARDS every
 * completed stage the reviewer already paid for and starts a fresh sibling run —
 * the single most expensive wrong click in the product. If the LABEL stops
 * tracking the branch, the button lies about which of the two it will do.
 */
describe('restartKind / restartLabel', () => {
	it('resumes a paused run in place — never regenerates it', () => {
		expect(restartKind('paused')).toBe('resume');
		expect(restartLabel('paused')).toBe('Resume');
	});

	it('regenerates a failed run into a fresh sibling', () => {
		expect(restartKind('failed')).toBe('regenerate');
		expect(restartLabel('failed')).toBe('Restart');
	});

	it('regenerates a cancelled run into a fresh sibling', () => {
		expect(restartKind('cancelled')).toBe('regenerate');
		expect(restartLabel('cancelled')).toBe('Restart');
	});

	it('reruns a completed run as a new version, and says "Rerun"', () => {
		expect(restartKind('completed')).toBe('regenerate');
		expect(restartLabel('completed')).toBe('Rerun');
	});
});

describe('performRestart', () => {
	it('calls resume with NO body for a paused run and keeps the same run id', async () => {
		const out = await performRestart({ runId: 'r1', status: 'paused' });
		expect(resume).toHaveBeenCalledWith('r1');
		// A stage/checkpoint argument here would mean the FE picks the resume point;
		// it does not — the backend resumes from its own recorded pause.
		expect(resume.mock.calls[0]).toHaveLength(1);
		expect(regenerate).not.toHaveBeenCalled();
		expect(out).toEqual({ kind: 'resumed' });
	});

	it('returns the NEW sibling id when a dead run regenerates', async () => {
		const out = await performRestart({ runId: 'r1', status: 'failed' });
		expect(regenerate).toHaveBeenCalledWith('r1', {});
		expect(resume).not.toHaveBeenCalled();
		// Dropping this id navigates the reviewer back to the dead run, which will
		// never move again.
		expect(out).toEqual({ kind: 'regenerated', id: 'sibling-run' });
	});

	it('propagates the failure instead of reporting a restart that never happened', async () => {
		resume.mockRejectedValue(new Error('409 conflict'));
		await expect(performRestart({ runId: 'r1', status: 'paused' })).rejects.toThrow('409 conflict');
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
	class ApiError extends Error {
		status: number;
		detail: string;
		constructor(status: number, detail = '') {
			super(`${status}: ${detail}`);
			this.status = status;
			this.detail = detail;
		}
	}
	return { ApiError, listForProject: vi.fn(), cancel: vi.fn() };
});

vi.mock('$lib/api', () => ({
	ApiError: h.ApiError,
	runs: {
		listForProject: (...a: unknown[]) => h.listForProject(...a),
		cancel: (...a: unknown[]) => h.cancel(...a)
	}
}));

import {
	runEndLabel,
	canCancelRun,
	canEditCheckpoints,
	canRestartRun,
	canRerunFromStep,
	canResumeRun,
	cancelRuns,
	failureMessage,
	listActiveRuns,
	redactRunError,
	RUN_LIST_MAX_PAGE,
	resolveFailedStage,
	runNotResumable,
	upstreamAuthFailure,
	upstreamAuthFailureFromRun
} from './run-actions';

beforeEach(() => {
	h.listForProject.mockReset();
	h.cancel.mockReset();
});

describe('run action guards', () => {
	it('offers Cancel on a PAUSED run (the backend accepts it)', () => {
		expect(canCancelRun('paused')).toBe(true);
		expect(canCancelRun('running')).toBe(true);
		expect(canCancelRun('pending')).toBe(true);
	});

	it('never offers Cancel on a finished run', () => {
		for (const s of ['completed', 'failed', 'cancelled']) expect(canCancelRun(s)).toBe(false);
	});

	it('offers Resume ONLY on a paused run — never on a failed one (204 no-op)', () => {
		expect(canResumeRun('paused')).toBe(true);
		for (const s of ['failed', 'cancelled', 'completed', 'running', 'pending']) {
			expect(canResumeRun(s)).toBe(false);
		}
	});

	it('offers Restart on every stopped run — completed too — never on a paused or live one', () => {
		for (const s of ['failed', 'cancelled', 'completed']) {
			expect(canRestartRun(s)).toBe(true);
		}
		for (const s of ['paused', 'running', 'pending']) {
			expect(canRestartRun(s)).toBe(false);
		}
	});

	it('offers "Rerun from here" on any run the pipeline is not executing', () => {
		for (const s of ['failed', 'cancelled', 'completed', 'paused']) {
			expect(canRerunFromStep(s)).toBe(true);
		}
		for (const s of ['running', 'pending', '', null, undefined]) {
			expect(canRerunFromStep(s)).toBe(false);
		}
	});

	it('makes checkpoints read-only on terminal runs (PATCH 409s there)', () => {
		for (const s of ['completed', 'failed', 'cancelled']) expect(canEditCheckpoints(s)).toBe(false);
		for (const s of ['pending', 'running', 'paused']) expect(canEditCheckpoints(s)).toBe(true);
	});
});

describe('failureMessage', () => {
	it.each([
		['external', /service .* unavailable/i],
		['our_defect', /on our side/i],
		['customer_input', /project settings/i],
		['unknown', /The run failed/],
		[null, /The run failed/]
	])('maps failure_class %s to a human title', (cls, title) => {
		expect(failureMessage(cls, null).title).toMatch(title);
	});

	it('names the failed stage with the given labeller', () => {
		const msg = failureMessage('external', 'music_select', () => 'Music selection');
		expect(msg.body).toContain('“Music selection”');
	});

	it('never echoes the raw exception text', () => {
		const msg = failureMessage('external', 'music_select');
		expect(msg.title + msg.body).not.toMatch(/Error|http/);
	});
});

describe('redactRunError', () => {
	it('replaces internal service URLs', () => {
		const raw =
			"StageRetriesExhaustedError: stage 'x': TransientUpstreamError: upstream 500 from http://worker-management.w2v:8100/api/workers/a/message: boom";
		const out = redactRunError(raw);
		expect(out).not.toContain('svc.cluster.local');
		expect(out).toContain('[internal service]');
		expect(out).toContain('boom');
	});

	it('is empty for no error', () => {
		expect(redactRunError(null)).toBe('');
	});
});

describe('listActiveRuns / cancelRuns', () => {
	it('pages through every run and keeps pending/running/paused only', async () => {
		const full = Array.from({ length: RUN_LIST_MAX_PAGE }, (_, i) => ({
			id: `c${i}`,
			status: 'completed'
		}));
		h.listForProject.mockResolvedValueOnce(full).mockResolvedValueOnce([
			{ id: 'r1', status: 'running' },
			{ id: 'p1', status: 'paused' },
			{ id: 'f1', status: 'failed' }
		]);
		const active = await listActiveRuns('proj');
		expect(active.map((r) => r.id)).toEqual(['r1', 'p1']);
		expect(h.listForProject).toHaveBeenNthCalledWith(2, 'proj', {
			limit: RUN_LIST_MAX_PAGE,
			offset: RUN_LIST_MAX_PAGE
		});
	});

	it('treats a 409 (already finished) as cancelled and reports real failures', async () => {
		h.cancel
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new h.ApiError(409, 'already finished'))
			.mockRejectedValueOnce(new h.ApiError(500, 'boom'));
		expect(await cancelRuns(['a', 'b', 'c'])).toEqual(['c']);
	});
});

describe('upstream_auth scope mapping (w2v_orchestrator#1116)', () => {
	it('scope=tenant → the tenant’s own key; points at the Providers page', () => {
		const f = upstreamAuthFailure({ code: 'upstream_auth', scope: 'tenant', message: 'x' });
		expect(f?.scope).toBe('tenant');
		expect(f?.title).toBe('Your provider key was rejected');
		expect(f?.body).toMatch(/Providers page/);
	});

	it('scope=platform → our service configuration; contact support', () => {
		const f = upstreamAuthFailure({ code: 'upstream_auth', scope: 'platform' });
		expect(f?.scope).toBe('platform');
		expect(f?.title).toBe('Service configuration problem');
		expect(f?.body).toMatch(/contact support/);
		expect(f?.body).not.toMatch(/Providers page/);
	});

	it('a missing / unknown scope reads as platform, never as "fix your key"', () => {
		expect(upstreamAuthFailure({ code: 'upstream_auth' })?.scope).toBe('platform');
		expect(upstreamAuthFailure({ code: 'upstream_auth', scope: null })?.scope).toBe('platform');
		expect(upstreamAuthFailure({ code: 'upstream_auth', scope: 'weird' })?.scope).toBe('platform');
	});

	it('ignores other codes and non-objects', () => {
		expect(upstreamAuthFailure({ code: 'byo_provider_required', scope: null })).toBeNull();
		expect(upstreamAuthFailure(null)).toBeNull();
		expect(upstreamAuthFailure('upstream_auth')).toBeNull();
	});

	it('reads failure_detail off a run object', () => {
		expect(
			upstreamAuthFailureFromRun({
				failure_detail: { code: 'upstream_auth', scope: 'tenant', message: 'x' }
			})?.scope
		).toBe('tenant');
		expect(upstreamAuthFailureFromRun({ failure_detail: null })).toBeNull();
		expect(upstreamAuthFailureFromRun(null)).toBeNull();
	});
});

describe('resume 409 run_not_resumable', () => {
	const conflict = (details: Record<string, unknown> | undefined, status = 409) =>
		Object.assign(new h.ApiError(status, 'conflict'), { details });

	it('recognises the structured 409 and carries the server status + message', () => {
		const r = runNotResumable(
			conflict({
				code: 'run_not_resumable',
				status: 'completed',
				message: 'The run is no longer paused; reload to see its current state.'
			})
		);
		expect(r).toEqual({
			status: 'completed',
			message: 'The run is no longer paused; reload to see its current state.'
		});
	});

	it('falls back to a status-based message when the server sends none', () => {
		expect(runNotResumable(conflict({ code: 'run_not_resumable', status: 'failed' }))).toEqual({
			status: 'failed',
			message: 'This run is now failed and can no longer be resumed.'
		});
		expect(runNotResumable(conflict({ code: 'run_not_resumable' }))?.status).toBeNull();
	});

	it('is null for other 409s, other statuses and non-errors', () => {
		expect(runNotResumable(conflict({ code: 'something_else' }))).toBeNull();
		expect(runNotResumable(conflict(undefined))).toBeNull();
		expect(runNotResumable(conflict({ code: 'run_not_resumable' }, 500))).toBeNull();
		expect(runNotResumable(new Error('nope'))).toBeNull();
		expect(runNotResumable(null)).toBeNull();
	});
});

describe('resolveFailedStage', () => {
	it('prefers the server’s failed_stage over the client guess', () => {
		expect(resolveFailedStage({ failed_stage: 'narrate' }, 'record')).toBe('narrate');
	});
	it('falls back to the guess when the server omits it or sends null/empty', () => {
		expect(resolveFailedStage({}, 'record')).toBe('record');
		expect(resolveFailedStage({ failed_stage: null }, 'record')).toBe('record');
		expect(resolveFailedStage({ failed_stage: '' }, 'record')).toBe('record');
		expect(resolveFailedStage(null, null)).toBeNull();
	});
});

describe('runEndLabel', () => {
	const t = '2026-10-18T10:00:00Z';
	it('names a failed run Failed, not Completed', () => {
		expect(runEndLabel('failed', t)).toBe('Failed');
	});
	it('names a cancelled run Cancelled', () => {
		expect(runEndLabel('cancelled', t)).toBe('Cancelled');
	});
	it('names a completed run Completed', () => {
		expect(runEndLabel('completed', t)).toBe('Completed');
	});
	it('says Started while there is no end timestamp', () => {
		expect(runEndLabel('running', null)).toBe('Started');
		expect(runEndLabel('paused', undefined)).toBe('Started');
	});
	it('does not claim success for an unknown status with an end time', () => {
		expect(runEndLabel('weird', t)).toBe('Ended');
	});
});

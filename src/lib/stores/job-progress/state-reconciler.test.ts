import { describe, it, expect } from 'vitest';
import {
	StateReconciler,
	isStageStatus,
	isStageDone,
	progressFromStages
} from './state-reconciler.js';
import type { StageState, RunWsMessage } from './types.js';
import type { RunStatusLite } from '$lib/types/runs';

// Orchestrator PR #706 added 'cancelled' to the stage-status enum: stages left
// pending/running when a run hard-fails are swept to a terminal 'cancelled'.
// Before this fix the reconciler's allow-list silently coerced it to 'pending',
// so a cancelled stage rendered as a forever-spinning Pending row and progress
// never reached 100%.

function stage(name: string, status: StageState['status']): StageState {
	return { name, status, durationMs: null, artifactPrefix: null, subStep: null };
}

// `status: 'cancelled'` is not in the generated StageStatusLite union yet — the
// openapi package pin + `bun run codegen` land separately. The cast keeps the
// fixture honest about the WIRE shape the BE already sends today, and stays
// valid once the generated union widens.
function lite(
	stages: Array<{ stage_name: string; status: string }>,
	runStatus: RunStatusLite['status'] = 'failed'
): RunStatusLite {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		status: runStatus,
		current_stage: null,
		error: null,
		stage_outputs: stages.map((s) => ({ ...s, started_at: null, completed_at: null }))
	} as unknown as RunStatusLite;
}

describe('isStageStatus', () => {
	it('accepts every wire stage status including cancelled', () => {
		for (const s of ['pending', 'running', 'completed', 'failed', 'skipped', 'cancelled']) {
			expect(isStageStatus(s)).toBe(true);
		}
	});

	it('still rejects an unknown status', () => {
		expect(isStageStatus('teleported')).toBe(false);
	});
});

describe('progress accounting', () => {
	it('counts completed / skipped / cancelled as done', () => {
		expect(isStageDone('completed')).toBe(true);
		expect(isStageDone('skipped')).toBe(true);
		expect(isStageDone('cancelled')).toBe(true);
		expect(isStageDone('pending')).toBe(false);
		expect(isStageDone('running')).toBe(false);
		// A failed stage is terminal but NOT progress — the run didn't get there.
		expect(isStageDone('failed')).toBe(false);
	});

	it('reaches 100% when the tail of the run was cancelled', () => {
		expect(
			progressFromStages([
				stage('a', 'completed'),
				stage('b', 'skipped'),
				stage('c', 'cancelled'),
				stage('d', 'cancelled')
			])
		).toBe(1);
	});
});

describe('StateReconciler.mergePollingData — cancelled', () => {
	it('keeps a polled cancelled status instead of coercing it to pending', () => {
		const r = new StateReconciler();
		const merged = r.mergePollingData(
			[stage('a', 'completed'), stage('b', 'running')],
			lite([
				{ stage_name: 'a', status: 'completed' },
				{ stage_name: 'b', status: 'cancelled' }
			]),
			false,
			0
		);
		expect(merged.stages.map((s) => s.status)).toEqual(['completed', 'cancelled']);
		expect(merged.progress).toBe(1);
	});

	it('advances running → cancelled even while the live stream is authoritative', () => {
		// This is what STATUS_RANK.cancelled buys: with no rank the monotonic
		// guard would score cancelled 0 and keep the stale 'running'.
		const r = new StateReconciler();
		const merged = r.mergePollingData(
			[stage('a', 'running')],
			lite([{ stage_name: 'a', status: 'cancelled' }]),
			true,
			Date.now()
		);
		expect(merged.stages[0].status).toBe('cancelled');
	});

	it('does not regress a cancelled stage back to pending on a later poll', () => {
		const r = new StateReconciler();
		const merged = r.mergePollingData(
			[stage('a', 'cancelled')],
			lite([{ stage_name: 'a', status: 'pending' }]),
			true,
			Date.now()
		);
		expect(merged.stages[0].status).toBe('cancelled');
	});
});

// Replaced, not deleted: the PROPERTY this asserted — a reconnect brings a
// cancelled stage to a terminal badge — is still real. It now arrives as the
// `stage_started` + terminal events the catch-up snapshot actually replays
// (runs/events.py::_build_run_event_snapshot), instead of a `state_sync`
// envelope no orchestrator has ever emitted.
describe('StateReconciler.applyWsEvent — reconnect catch-up replay', () => {
	it('brings a running + pending pair to their terminal badges on replay', () => {
		const r = new StateReconciler();
		const rid = '00000000-0000-0000-0000-000000000001';
		let next = r.applyWsEvent([stage('a', 'running'), stage('b', 'pending')], {
			event: 'stage_completed',
			run_id: rid,
			stage_name: 'a'
		});
		next = r.applyWsEvent(next, { event: 'stage_cancelled', run_id: rid, stage_name: 'b' });
		expect(next.map((s) => s.status)).toEqual(['completed', 'cancelled']);
	});
});

// The orchestrator emits `stage_skipped` live (dag_executor._run_stage) and
// `stage_cancelled` on the reconnect catch-up snapshot (runs/events.py
// `_stage_terminal_event`). Both are NAMED SSE events. Neither reached this
// switch, so a skipped/cancelled stage's badge stayed running/pending until the
// 30s safety-net poll — and on reconnect the replayed event was dropped again.
describe('StateReconciler.applyWsEvent — stage_skipped / stage_cancelled', () => {
	it('moves a running stage to skipped and keeps the reason out of the badge', () => {
		const r = new StateReconciler();
		const msg: RunWsMessage = {
			event: 'stage_skipped',
			run_id: '00000000-0000-0000-0000-000000000001',
			stage_name: 'b',
			reason: 'upstream produced no footage'
		};
		const next = r.applyWsEvent([stage('a', 'completed'), stage('b', 'running')], msg);
		expect(next.map((s) => s.status)).toEqual(['completed', 'skipped']);
	});

	it('moves a pending stage to cancelled', () => {
		const r = new StateReconciler();
		const msg: RunWsMessage = {
			event: 'stage_cancelled',
			run_id: '00000000-0000-0000-0000-000000000001',
			stage_name: 'b'
		};
		const next = r.applyWsEvent([stage('a', 'failed'), stage('b', 'pending')], msg);
		expect(next.map((s) => s.status)).toEqual(['failed', 'cancelled']);
	});

	it('clears subStep when a stage is skipped mid-flight', () => {
		const r = new StateReconciler();
		const running = { ...stage('b', 'running'), subStep: 'scraping page 3' };
		const next = r.applyWsEvent([running], {
			event: 'stage_skipped',
			run_id: '00000000-0000-0000-0000-000000000001',
			stage_name: 'b',
			reason: 'gate closed'
		});
		expect(next[0].status).toBe('skipped');
		expect(next[0].subStep).toBeNull();
	});
});

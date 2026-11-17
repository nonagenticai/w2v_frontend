import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import type { RestartPlanReason, RestartPlanResponse } from '$lib/api/runs';
import { describeReason, inputLabel, restartPlanErrorMessage, summarizePlan } from './restart-plan';

const r = (code: string, extra: Partial<RestartPlanReason> = {}): RestartPlanReason => ({
	code,
	message: `server says ${code}`,
	stage: null,
	inputs: [],
	...extra
});

describe('describeReason', () => {
	it('names the step a re-run builds on with its label, not its key', () => {
		expect(describeReason(r('upstream_rerun', { stage: 'promo_script' }))).toContain('“');
		expect(describeReason(r('upstream_rerun', { stage: 'promo_script' }))).not.toContain(
			'promo_script'
		);
	});

	it('names changed settings in words, never as snapshot keys', () => {
		const text = describeReason(r('input_changed', { inputs: ['verbatim_items', 'voice'] }));
		expect(text).toBe('It uses the must-say lines and the voice, which you changed.');
	});

	it('words live inputs (uploaded footage) like any other setting', () => {
		expect(describeReason(r('live_input_changed', { inputs: ['video_sources'] }))).toBe(
			'It uses the uploaded footage, which changed.'
		);
	});

	it('says a cancelled step starts over', () => {
		expect(describeReason(r('cancelled'))).toMatch(/cancelled, so it starts over/);
	});

	it('falls back to the server message for a code it does not know', () => {
		expect(describeReason(r('brand_new_code'))).toBe('server says brand_new_code');
	});

	it('covers every code the server can send', () => {
		const codes = [
			'cancelled',
			'failed',
			'not_run',
			'skipped',
			'missing_output',
			'input_changed',
			'inputs_unrecorded',
			'reads_everything',
			'live_input_changed',
			'feedback',
			'chosen',
			'upstream_rerun',
			'upstream_edited',
			'edit_replaced',
			'unchanged',
			'edit_kept',
			'not_plannable',
			'not_resumable',
			'nothing_changed',
			'all_steps_finished',
			'nothing_reusable'
		];
		for (const code of codes) {
			expect(describeReason(r(code)), code).not.toBe(`server says ${code}`);
		}
	});
});

describe('inputLabel', () => {
	it('humanizes an unknown key instead of showing it raw', () => {
		expect(inputLabel('retention_weights')).toBe('retention weights');
	});
});

function plan(over: Partial<RestartPlanResponse>): RestartPlanResponse {
	return {
		run_id: 'r1',
		mode: 'partial',
		full_reasons: [],
		changed_inputs: [],
		stages: [],
		...over
	};
}

describe('summarizePlan', () => {
	it('splits a partial plan into kept and re-run, in pipeline order', () => {
		const s = summarizePlan(
			plan({
				stages: [
					{ stage_name: 'a', action: 'reuse', reasons: [r('unchanged')], edited: false },
					{ stage_name: 'b', action: 'rerun', reasons: [r('cancelled')], edited: false },
					{ stage_name: 'c', action: 'reuse', reasons: [r('edit_kept')], edited: true }
				]
			})
		);
		expect(s.reused.map((x) => x.stage_name)).toEqual(['a', 'c']);
		expect(s.rerun.map((x) => x.stage_name)).toEqual(['b']);
		expect(s.headline).toBe('2 finished steps are kept; 1 step runs again.');
	});

	it('explains a full re-run with its reason', () => {
		const s = summarizePlan(
			plan({
				mode: 'full',
				full_reasons: [r('nothing_changed')],
				stages: [
					{ stage_name: 'a', action: 'rerun', reasons: [r('nothing_changed')], edited: false }
				]
			})
		);
		expect(s.reused).toEqual([]);
		expect(s.headline).toMatch(/Nothing changed since this run finished/);
	});
});

describe('restartPlanErrorMessage', () => {
	it("shows the server's own message from a structured 409", () => {
		const err = new ApiError(409, 'Conflict', '[object]', undefined, undefined, null, {
			detail: {
				code: 'restart_plan_unavailable',
				message: 'A paused run continues where it stopped.'
			}
		});
		expect(restartPlanErrorMessage(err)).toBe('A paused run continues where it stopped.');
	});

	it('falls back to the detail string, never a bare status', () => {
		const err = new ApiError(500, 'Internal Server Error', 'database unavailable');
		expect(restartPlanErrorMessage(err)).toBe('database unavailable');
	});
});

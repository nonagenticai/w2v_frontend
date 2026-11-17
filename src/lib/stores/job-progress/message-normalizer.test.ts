import { describe, it, expect } from 'vitest';
import { normalizeRunMessage, RUN_EVENTS } from './message-normalizer.js';

describe('normalizeRunMessage', () => {
	it('passes through stage events', () => {
		const msg = normalizeRunMessage({
			event: 'stage_started',
			run_id: 'r1',
			stage_name: 'crawl'
		});
		expect(msg).not.toBeNull();
		expect(msg?.event).toBe('stage_started');
		expect(msg?.run_id).toBe('r1');
		expect(msg?.stage_name).toBe('crawl');
	});

	it('passes through every v3 run lifecycle event', () => {
		for (const event of [
			'run_started',
			'run_paused',
			'run_completed',
			'run_failed',
			'run_cancelled',
			'stage_started',
			'stage_completed',
			'stage_failed',
			'stage_skipped',
			'stage_cancelled'
		]) {
			const msg = normalizeRunMessage({ event, run_id: 'r1' });
			expect(msg, `event=${event} should not be dropped`).not.toBeNull();
			expect(msg?.event).toBe(event);
		}
	});

	it('drops messages with unknown event names', () => {
		expect(normalizeRunMessage({ event: 'nonsense', run_id: 'r1' })).toBeNull();
	});

	it('drops messages missing run_id', () => {
		expect(normalizeRunMessage({ event: 'stage_started' })).toBeNull();
	});

	it('drops v1 pipeline events that have no v3 equivalent', () => {
		// The v1 channel emitted these on the pipeline socket; they must not
		// be reintroduced silently — surface as "unknown" so tests + monitoring
		// flag the wire-shape drift.
		for (const event of [
			'pipeline_started',
			'pipeline_completed',
			'pipeline_failed',
			'pipeline_cancelled',
			'annotation_created',
			'verbatim_item_placed',
			'lesson_completed',
			'project_completed'
		]) {
			expect(normalizeRunMessage({ event, run_id: 'r1' })).toBeNull();
		}
	});

	it('keeps RUN_EVENTS aligned with the v3 RunEventName union', () => {
		const expected = [
			'run_started',
			'run_paused',
			'run_completed',
			'run_failed',
			'run_cancelled',
			'stage_started',
			'stage_completed',
			'stage_failed',
			'stage_skipped',
			'stage_cancelled'
		];
		for (const event of expected) {
			expect(RUN_EVENTS.has(event), `missing ${event} in RUN_EVENTS`).toBe(true);
		}
	});

	it('hoists `data` payload onto the top level', () => {
		const msg = normalizeRunMessage({
			event: 'stage_completed',
			run_id: 'r1',
			data: { stage_name: 'crawl', duration_seconds: 12.5 }
		});
		expect(msg?.stage_name).toBe('crawl');
		expect(msg?.duration_seconds).toBe(12.5);
	});
});

// `stage_skipped` / `stage_cancelled` are in the orchestrator's RunEventName
// union (src/api/schemas/_shared.py) and are published both live and on the
// reconnect catch-up snapshot. They were missing from RUN_EVENTS, so the
// normalizer dropped them before the reconciler could move the badge.
describe('normalizeRunMessage — terminal stage events', () => {
	it('passes through stage_skipped and carries the reason', () => {
		const msg = normalizeRunMessage({
			event: 'stage_skipped',
			run_id: 'r1',
			stage_name: 'demo_video_gen',
			reason: 'no footage captured'
		});
		expect(msg).not.toBeNull();
		expect(msg?.event).toBe('stage_skipped');
		expect(msg?.stage_name).toBe('demo_video_gen');
		expect(msg?.reason).toBe('no footage captured');
	});

	it('passes through stage_cancelled', () => {
		const msg = normalizeRunMessage({
			event: 'stage_cancelled',
			run_id: 'r1',
			stage_name: 'encode_master'
		});
		expect(msg).not.toBeNull();
		expect(msg?.event).toBe('stage_cancelled');
	});

	it('keeps RUN_EVENTS aligned with the orchestrator RunEventName union', () => {
		// Mirrors src/api/schemas/_shared.py::RunEventName exactly.
		for (const event of [
			'stage_started',
			'stage_completed',
			'stage_failed',
			'stage_skipped',
			'stage_cancelled',
			'run_started',
			'run_paused',
			'run_completed',
			'run_failed',
			'run_cancelled'
		]) {
			expect(RUN_EVENTS.has(event), `missing ${event} in RUN_EVENTS`).toBe(true);
		}
	});
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { JobProgressState } from './job-progress-state.svelte.js';
import type { RunDetail } from '$lib/types/runs';

const RUN_ID = '00000000-0000-0000-0000-000000000042';

type Listener = (event: MessageEvent<string>) => void;

// Combines the two existing FakeEventSource shapes in this directory:
// - sse-transport.test.ts contributes the static readyState constants +
//   settable onopen/onmessage/onerror + close() that SseTransport drives.
// - run-events.test.ts contributes the listeners map + dispatch() helper for
//   the named events (run_started/stage_started/run_completed/run_failed) that
//   attachHandlers() registers via addEventListener.
class FakeEventSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static lastInstance: FakeEventSource | null = null;

	readyState = FakeEventSource.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((e: MessageEvent<string>) => void) | null = null;
	onerror: (() => void) | null = null;
	listeners: Record<string, Listener[]> = {};

	constructor(public url: string) {
		FakeEventSource.lastInstance = this;
	}

	addEventListener(name: string, listener: Listener): void {
		(this.listeners[name] ??= []).push(listener);
	}

	close(): void {
		this.readyState = FakeEventSource.CLOSED;
	}

	/** JSON-stringify the payload into { data } and invoke each named listener. */
	dispatch(name: string, data: unknown): void {
		const event = { data: JSON.stringify(data) } as MessageEvent<string>;
		for (const listener of this.listeners[name] ?? []) listener(event);
	}
}

describe('JobProgressState — live running → terminal SSE transition', () => {
	const original = globalThis.EventSource;

	beforeEach(() => {
		FakeEventSource.lastInstance = null;
		// @ts-expect-error — swap in the fake for the duration of the test.
		globalThis.EventSource = FakeEventSource;
	});

	afterEach(() => {
		globalThis.EventSource = original;
	});

	// Flat wire payloads modelled on message-normalizer.test.ts, which shows the
	// normalizer accepts `{ event, run_id, ...extras }` at the top level (see the
	// "passes through stage events" + "passes through every v3 run lifecycle
	// event" cases). merged.event must be in RUN_EVENTS and run_id must be a
	// string equal to the transport's runId.
	it('run_started/stage_started → running (non-terminal), run_completed → completed (terminal, disconnected)', async () => {
		const jp = new JobProgressState(RUN_ID);
		jp.connect();

		const es = FakeEventSource.lastInstance!;
		es.onopen?.(); // establish the connection (fires onConnect)

		es.dispatch('run_started', { event: 'run_started', run_id: RUN_ID });
		es.dispatch('stage_started', {
			event: 'stage_started',
			run_id: RUN_ID,
			stage_name: 'brief_intake'
		});

		// Non-terminal events go through scheduler.request() (rAF-coalesced), so
		// the status change lands on the next frame, not synchronously.
		await vi.waitFor(() => {
			expect(jp.jobStatus).toBe('running');
		});
		expect(jp.isTerminal).toBe(false);

		// Terminal event: handleWsMessage → scheduler.flushNow() applies it (and
		// any buffered non-terminal events) synchronously — no waitFor needed.
		es.dispatch('run_completed', { event: 'run_completed', run_id: RUN_ID });
		expect(jp.jobStatus).toBe('completed');
		expect(jp.isTerminal).toBe(true);

		// run_completed → applyWsMessage calls this.disconnect() → sseTransport
		// closes the EventSource, so the fake's readyState is CLOSED.
		expect(es.readyState).toBe(FakeEventSource.CLOSED);

		jp.disconnect(); // cleanup: kill any lingering timers
	});

	// Regression: `stage_started` is what otherwise moves currentStage, and a
	// blueprint wave starts its independent stages CONCURRENTLY — so the last
	// stage_started before a pause can be a sibling that then SKIPPED. The BE now
	// names the checkpoint that tripped the gate on run_paused; adopt it, or the
	// pause banner + stage-editor link point at a stage that never ran until the
	// next safety-net poll (up to 30s).
	it('run_paused adopts the checkpoint it names, over the last stage_started', async () => {
		const jp = new JobProgressState(RUN_ID);
		jp.connect();

		const es = FakeEventSource.lastInstance!;
		es.onopen?.();

		es.dispatch('run_started', { event: 'run_started', run_id: RUN_ID });
		es.dispatch('stage_started', {
			event: 'stage_started',
			run_id: RUN_ID,
			stage_name: 'demo_video_gen'
		});
		// The no-dep leaf of the same wave starts LAST and later skips.
		es.dispatch('stage_started', {
			event: 'stage_started',
			run_id: RUN_ID,
			stage_name: 'source_ingest'
		});
		await vi.waitFor(() => {
			expect(jp.currentStage).toBe('source_ingest');
		});

		es.dispatch('run_paused', {
			event: 'run_paused',
			run_id: RUN_ID,
			stage_name: 'demo_video_gen'
		});
		await vi.waitFor(() => {
			expect(jp.jobStatus).toBe('paused');
			expect(jp.currentStage).toBe('demo_video_gen');
		});

		jp.disconnect();
	});

	it('run_failed → failed (terminal) with error set', async () => {
		const jp = new JobProgressState(RUN_ID);
		jp.connect();

		const es = FakeEventSource.lastInstance!;
		es.onopen?.();

		es.dispatch('run_started', { event: 'run_started', run_id: RUN_ID });
		await vi.waitFor(() => {
			expect(jp.jobStatus).toBe('running');
		});
		expect(jp.isTerminal).toBe(false);

		// run_failed carries `error` at the top level; the normalizer passes it
		// through and applyWsMessage assigns it to this.error.
		es.dispatch('run_failed', {
			event: 'run_failed',
			run_id: RUN_ID,
			error: 'httpx.ConnectError: http://webscraper.w2v:9100/scrape refused'
		});
		expect(jp.jobStatus).toBe('failed');
		expect(jp.isTerminal).toBe(true);
		expect(jp.error).toBeTruthy();
		// The person-facing log line is the failure_class explanation, never the
		// raw exception text with its internal URL / exception class name.
		const failedLine = jp.logs.find((l) => l.message.startsWith('Run failed'));
		expect(failedLine?.message).toBe('Run failed: The run failed');
		expect(jp.logs.some((l) => /svc\.cluster|ConnectError/.test(l.message))).toBe(false);
		expect(es.readyState).toBe(FakeEventSource.CLOSED);

		jp.disconnect();
	});
});

describe('JobProgressState.hydrateFromDetail — cancelled stages (orchestrator PR #706)', () => {
	// `status: 'cancelled'` on a stage output is not in the generated
	// StageOutputResponse union yet (openapi pin + `bun run codegen` land
	// separately), hence the cast. The BE already sends it.
	function detail(stageStatuses: Array<[string, string]>): RunDetail {
		return {
			id: RUN_ID,
			project_id: '00000000-0000-0000-0000-000000000002',
			deliverable_id: '00000000-0000-0000-0000-000000000003',
			parent_run_id: null,
			blueprint_id: 'promo',
			status: 'failed',
			current_stage: null,
			started_at: null,
			completed_at: null,
			created_at: '2026-07-29T00:00:00Z',
			config_snapshot: {},
			pause_after_stages: [],
			error: 'stage crashed',
			stage_outputs: stageStatuses.map(([stage_name, status], i) => ({
				id: `0000000${i}-0000-0000-0000-000000000000`,
				run_id: RUN_ID,
				stage_name,
				status,
				output: null,
				error: status === 'cancelled' ? 'run failed before this stage ran' : null,
				started_at: null,
				completed_at: null,
				degraded: false
			})),
			usage_total: { input_tokens: 0, output_tokens: 0, cost_usd: 0, by_stage: [] },
			degraded: false
		} as unknown as RunDetail;
	}

	it('keeps cancelled instead of coercing it to a forever-spinning pending', () => {
		const jp = new JobProgressState(RUN_ID);
		jp.hydrateFromDetail(
			detail([
				['brief_intake', 'completed'],
				['promo_script', 'cancelled']
			])
		);
		expect(jp.stages.map((s) => s.status)).toEqual(['completed', 'cancelled']);
	});

	it('counts cancelled stages as done so progress is not pinned below 100%', () => {
		const jp = new JobProgressState(RUN_ID);
		jp.hydrateFromDetail(
			detail([
				['brief_intake', 'completed'],
				['promo_script', 'cancelled'],
				['promo_render', 'cancelled']
			])
		);
		expect(jp.progress).toBe(1);
		expect(jp.progressPercent).toBe(100);
	});
});

// End-to-end over the real transport → normalizer → reconciler chain for the
// two NAMED SSE events the orchestrator publishes but the FE never subscribed
// to. `stage_skipped` is live (dag_executor._run_stage); `stage_cancelled`
// arrives on the reconnect catch-up snapshot (runs/events.py). Dropping them
// left the badge on running/pending until the 30s safety-net poll, and the skip
// REASON — the only place the run explains itself — never reached the log.
describe('JobProgressState — named stage_skipped / stage_cancelled events', () => {
	const original = globalThis.EventSource;

	function detail(stageStatuses: Array<[string, string]>): RunDetail {
		return {
			id: RUN_ID,
			project_id: '00000000-0000-0000-0000-000000000002',
			deliverable_id: '00000000-0000-0000-0000-000000000003',
			parent_run_id: null,
			blueprint_id: 'promo',
			status: 'running',
			current_stage: null,
			started_at: null,
			completed_at: null,
			created_at: '2026-07-29T00:00:00Z',
			config_snapshot: {},
			pause_after_stages: [],
			error: null,
			stage_outputs: stageStatuses.map(([stage_name, status], i) => ({
				id: `0000000${i}-0000-0000-0000-000000000000`,
				run_id: RUN_ID,
				stage_name,
				status,
				output: null,
				error: null,
				started_at: null,
				completed_at: null,
				degraded: false
			})),
			usage_total: { input_tokens: 0, output_tokens: 0, cost_usd: 0, by_stage: [] },
			degraded: false
		} as unknown as RunDetail;
	}

	beforeEach(() => {
		FakeEventSource.lastInstance = null;
		// @ts-expect-error — swap in the fake for the duration of the test.
		globalThis.EventSource = FakeEventSource;
	});

	afterEach(() => {
		globalThis.EventSource = original;
	});

	it('stage_skipped moves the badge off running and logs the reason', async () => {
		const jp = new JobProgressState(RUN_ID);
		jp.hydrateFromDetail(
			detail([
				['brief_intake', 'completed'],
				['demo_video_gen', 'running']
			])
		);
		jp.connect();
		const es = FakeEventSource.lastInstance!;
		es.onopen?.();

		es.dispatch('stage_skipped', {
			event: 'stage_skipped',
			run_id: RUN_ID,
			stage_name: 'demo_video_gen',
			reason: 'no footage captured'
		});

		await vi.waitFor(() => {
			expect(jp.stages.map((s) => s.status)).toEqual(['completed', 'skipped']);
		});
		// The reason is the only explanation the run gives for the skip.
		await vi.waitFor(() => {
			expect(jp.logs.some((l) => l.message.includes('no footage captured'))).toBe(true);
		});

		jp.disconnect();
	});

	// Only `Date` is faked: the catch-up window is measured from stream open, and
	// the rAF/setTimeout flush scheduler must keep running for real.
	function useClock() {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-14T10:00:00Z'));
	}
	const pastCatchUpWindow = () => vi.setSystemTime(Date.now() + 5_000);
	const ev = (event: string, stage_name?: string, extra: Record<string, unknown> = {}) => ({
		event,
		run_id: RUN_ID,
		...(stage_name ? { stage_name } : {}),
		...extra
	});
	/** Simulate a dropped stream the browser re-opens (fires onReconnect). */
	function reconnect(es: FakeEventSource) {
		es.onerror?.();
		es.onopen?.();
	}

	// Auditor repro: stages DO re-run inside one run (pause mid-stage → resume
	// re-runs it and re-publishes `run_started`; dag_executor timeout-resume). A
	// permanent (event, stage) ledger logged only the FIRST "started"/"Run paused".
	it('logs every live transition when a stage re-runs across pause/resume', async () => {
		useClock();
		try {
			const jp = new JobProgressState(RUN_ID);
			jp.hydrateFromDetail(
				detail([
					['brief_intake', 'completed'],
					['demo_video_gen', 'pending']
				])
			);
			jp.connect();
			const es = FakeEventSource.lastInstance!;
			es.onopen?.();
			pastCatchUpWindow();

			for (const e of [
				ev('stage_started', 'demo_video_gen'),
				ev('run_paused', 'demo_video_gen'),
				ev('run_started'),
				ev('stage_started', 'demo_video_gen'),
				ev('run_paused', 'demo_video_gen')
			]) {
				es.dispatch(e.event, e);
			}

			await vi.waitFor(() =>
				expect(jp.logs.map((l) => l.message).filter((m) => !m.startsWith('SSE'))).toEqual([
					'Stage "brief_intake" completed',
					'Stage "demo_video_gen" started',
					'Run paused',
					'Run started',
					'Stage "demo_video_gen" started',
					'Run paused'
				])
			);
			jp.disconnect();
		} finally {
			vi.useRealTimers();
		}
	});

	// User log 16:58:35: after an SSE reconnect the Activity Log showed "Run
	// started" and every stage event again, all stamped the reconnect second. A
	// server WITHOUT the `replay` marker: the snapshot burst right after the
	// re-open must not duplicate what is already in the log.
	it('does not re-log an unmarked catch-up snapshot replayed on reconnect', async () => {
		useClock();
		try {
			const jp = new JobProgressState(RUN_ID);
			jp.hydrateFromDetail(
				detail([
					['brief_intake', 'completed'],
					['demo_video_gen', 'running'],
					['encode_master', 'pending']
				])
			);
			jp.connect();
			const es = FakeEventSource.lastInstance!;
			es.onopen?.();
			// First connect replays history the loader already showed.
			for (const e of [
				ev('run_started'),
				ev('stage_started', 'brief_intake'),
				ev('stage_completed', 'brief_intake'),
				ev('stage_started', 'demo_video_gen')
			]) {
				es.dispatch(e.event, e);
			}
			pastCatchUpWindow();
			// Live progress, including a pause/resume re-run of encode_master.
			for (const e of [
				ev('stage_completed', 'demo_video_gen'),
				ev('stage_started', 'encode_master'),
				ev('run_paused', 'encode_master'),
				ev('run_started'),
				ev('stage_started', 'encode_master')
			]) {
				es.dispatch(e.event, e);
			}
			await vi.waitFor(() =>
				expect(jp.stages.map((s) => s.status)).toEqual(['completed', 'completed', 'running'])
			);
			const before = jp.logs.map((l) => l.message).filter((m) => !m.startsWith('SSE'));
			expect(before).toEqual([
				'Stage "brief_intake" completed',
				'Stage "demo_video_gen" running...',
				'Stage "demo_video_gen" completed',
				'Stage "encode_master" started',
				'Run paused',
				'Run started',
				'Stage "encode_master" started'
			]);

			// Reconnect: the server replays the whole run again, unmarked.
			reconnect(es);
			for (const e of [
				ev('run_started'),
				ev('stage_started', 'brief_intake'),
				ev('stage_completed', 'brief_intake'),
				ev('stage_started', 'demo_video_gen'),
				ev('stage_completed', 'demo_video_gen'),
				ev('stage_started', 'encode_master')
			]) {
				es.dispatch(e.event, e);
			}
			await new Promise((r) => setTimeout(r, 50));
			expect(jp.logs.map((l) => l.message).filter((m) => !m.startsWith('SSE'))).toEqual(before);

			// A later LIVE repeat is still announced.
			pastCatchUpWindow();
			const again = ev('run_paused', 'encode_master');
			es.dispatch(again.event, again);
			await vi.waitFor(() =>
				expect(jp.logs.filter((l) => l.message === 'Run paused')).toHaveLength(2)
			);
			jp.disconnect();
		} finally {
			vi.useRealTimers();
		}
	});

	// Orchestrator marks catch-up snapshot frames `replay: true`. They restate
	// state and must never be announced — even for a fact the client has not seen
	// (a stage that completed while the stream was down). Live frames after it log,
	// including ones inside the would-be catch-up window.
	it('applies replay-marked snapshot frames without logging them', async () => {
		useClock();
		try {
			const jp = new JobProgressState(RUN_ID);
			jp.hydrateFromDetail(
				detail([
					['brief_intake', 'completed'],
					['demo_video_gen', 'running']
				])
			);
			jp.connect();
			const es = FakeEventSource.lastInstance!;
			es.onopen?.();
			pastCatchUpWindow();
			reconnect(es);
			const before = jp.logs.map((l) => l.message);

			for (const e of [
				ev('run_started', undefined, { replay: true }),
				ev('stage_started', 'brief_intake', { replay: true }),
				ev('stage_completed', 'brief_intake', { replay: true }),
				ev('stage_started', 'demo_video_gen', { replay: true }),
				ev('stage_completed', 'demo_video_gen', { replay: true })
			]) {
				es.dispatch(e.event, e);
			}
			// State applied from the replay.
			await vi.waitFor(() =>
				expect(jp.stages.map((s) => s.status)).toEqual(['completed', 'completed'])
			);
			expect(jp.logs.map((l) => l.message)).toEqual(before);

			// Still inside the window: a live (unmarked) repeat IS announced, because
			// this server marks its snapshot frames itself.
			const live = ev('stage_started', 'demo_video_gen');
			es.dispatch(live.event, live);
			await vi.waitFor(() =>
				expect(jp.logs.map((l) => l.message)).toContain('Stage "demo_video_gen" started')
			);
			jp.disconnect();
		} finally {
			vi.useRealTimers();
		}
	});

	it('stage_cancelled moves a pending badge to cancelled', async () => {
		const jp = new JobProgressState(RUN_ID);
		jp.hydrateFromDetail(
			detail([
				['brief_intake', 'completed'],
				['encode_master', 'pending']
			])
		);
		jp.connect();
		const es = FakeEventSource.lastInstance!;
		es.onopen?.();

		es.dispatch('stage_cancelled', {
			event: 'stage_cancelled',
			run_id: RUN_ID,
			stage_name: 'encode_master'
		});

		await vi.waitFor(() => {
			expect(jp.stages.map((s) => s.status)).toEqual(['completed', 'cancelled']);
		});

		jp.disconnect();
	});
});

describe('JobProgressState.hydrateFromDetail — run-failed log time', () => {
	function failedDetail(runCompletedAt: string | null): RunDetail {
		return {
			id: RUN_ID,
			project_id: '00000000-0000-0000-0000-000000000002',
			deliverable_id: '00000000-0000-0000-0000-000000000003',
			parent_run_id: null,
			blueprint_id: 'marketing_scorecard',
			status: 'failed',
			current_stage: 'scan',
			started_at: '2026-10-18T14:27:30Z',
			completed_at: runCompletedAt,
			created_at: '2026-10-18T14:27:30Z',
			config_snapshot: {},
			pause_after_stages: [],
			error: 'retries exhausted',
			stage_outputs: [
				{
					id: '00000001-0000-0000-0000-000000000000',
					run_id: RUN_ID,
					stage_name: 'scan',
					status: 'failed',
					output: null,
					error: 'ReadTimeout',
					started_at: '2026-10-18T14:27:31Z',
					completed_at: '2026-10-18T14:28:33Z',
					degraded: false
				}
			],
			usage_total: { input_tokens: 0, output_tokens: 0, cost_usd: 0, by_stage: [] },
			degraded: false
		} as unknown as RunDetail;
	}

	function runFailedTime(jp: JobProgressState): string | undefined {
		return jp.logs.find((l) => l.message.startsWith('Run failed'))?.timestamp;
	}

	it("stamps 'Run failed' with the run's completed_at", () => {
		const jp = new JobProgressState(RUN_ID);
		jp.hydrateFromDetail(failedDetail('2026-10-18T14:28:34Z'));
		expect(runFailedTime(jp)).toBe('2026-10-18T14:28:34Z');
	});

	it('falls back to the latest stage end, never the creation time', () => {
		const jp = new JobProgressState(RUN_ID);
		jp.hydrateFromDetail(failedDetail(null));
		expect(runFailedTime(jp)).toBe('2026-10-18T14:28:33Z');
	});
});

// Run 01a17e6f (2026-10-27): the run completed, the Activity Log said "Run
// completed successfully", and the badge still read "Running · 81% · Promo
// Render" with every transport torn down. The 30s safety-net poll had buffered a
// "running" snapshot (a hidden tab runs no animation frames, so nothing flushed
// it) and the terminal flush applied that STALE snapshot after `run_completed`.
describe('JobProgressState — terminal latch', () => {
	const original = globalThis.EventSource;

	beforeEach(() => {
		FakeEventSource.lastInstance = null;
		// @ts-expect-error — swap in the fake for the duration of the test.
		globalThis.EventSource = FakeEventSource;
	});

	afterEach(() => {
		globalThis.EventSource = original;
	});

	const stage = (name: string, status: string) => ({
		stage_name: name,
		status,
		started_at: null,
		completed_at: null
	});

	it('a poll snapshot buffered before run_completed cannot roll the run back to running', () => {
		const jp = new JobProgressState(RUN_ID);
		jp.connect();
		const es = FakeEventSource.lastInstance!;
		es.onopen?.();

		// The buffered (never-flushed) safety-net poll: promo_render still running.
		(jp as unknown as { handlePollData: (d: unknown) => void }).handlePollData({
			id: RUN_ID,
			status: 'running',
			current_stage: 'promo_render',
			error: null,
			stage_outputs: [stage('promo_script', 'completed'), stage('promo_render', 'running')]
		});
		es.dispatch('run_completed', { event: 'run_completed', run_id: RUN_ID });

		expect(jp.jobStatus).toBe('completed');
		expect(jp.isTerminal).toBe(true);
		expect(jp.progressPercent).toBe(100);
		jp.disconnect();
	});

	it('a late non-terminal live event after completion is ignored', () => {
		const jp = new JobProgressState(RUN_ID);
		jp.connect();
		const es = FakeEventSource.lastInstance!;
		es.onopen?.();
		es.dispatch('run_completed', { event: 'run_completed', run_id: RUN_ID });
		(jp as unknown as { applyWsMessage: (m: unknown) => void }).applyWsMessage({
			event: 'stage_started',
			run_id: RUN_ID,
			stage_name: 'promo_render'
		});
		expect(jp.jobStatus).toBe('completed');
		jp.disconnect();
	});

	it('a terminal poll snapshot still applies', () => {
		const jp = new JobProgressState(RUN_ID);
		(jp as unknown as { applyPollData: (d: unknown) => void }).applyPollData({
			id: RUN_ID,
			status: 'completed',
			current_stage: null,
			error: null,
			stage_outputs: [stage('promo_render', 'completed')]
		});
		expect(jp.jobStatus).toBe('completed');
	});

	it('resync() re-opens a dropped live run and is a no-op on a terminal one', () => {
		const done = new JobProgressState(RUN_ID);
		done.jobStatus = 'completed';
		done.resync();
		expect(FakeEventSource.lastInstance).toBeNull();

		const live = new JobProgressState(RUN_ID);
		live.jobStatus = 'running';
		live.resync();
		expect(FakeEventSource.lastInstance).not.toBeNull();
		live.disconnect();
	});
});

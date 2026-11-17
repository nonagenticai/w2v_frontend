import { describe, it, expect, vi, beforeEach } from 'vitest';

// The run page navigates via goto(resolve(...)) and does a one-shot
// invalidateAll() when the run first reaches a terminal state. Mock those
// edges; resolve is identity so hrefs stay assertable. Keep the real
// JobProgressState — for terminal runs it never opens a transport (connect()
// is guarded to running/pending), so no network is attempted.
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

// The page transitively imports the $lib/api client (via RunOutputPanel's
// video components), which pulls keycloak at module init. Stub it so import
// stays offline. Same reason as RunOutputPanel.test.ts.
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));

// A running/pending run calls JobProgressState.connect(), which opens an SSE
// stream + a polling timer. Neuter both transports so the running-state test
// exercises the real class + the real reveal guard without any network/timers.
//
// The SSE double is a CAPTURING stub: it stays inert (no EventSource, no
// connection) but records the store's onMessage callback into a hoisted holder
// so a test can drive the real message pipeline (handleWsMessage → jobStatus)
// by firing normalized RunWsMessages, then assert the rendered badge flips.
// The 4 load-time tests never fire it, so they keep their inert behaviour.
//
// It also records the run id of every transport CONSTRUCTED. That count is the
// loop proof for the run-scope `$effect.pre`: a store is only rebuilt when the
// run id changes, so an effect that re-triggered itself would show up here as
// an unbounded list instead of exactly one entry per run.
const sseHolder = vi.hoisted(() => ({
	onMessage: null as null | ((m: unknown) => void),
	constructedFor: [] as string[]
}));
vi.mock('$lib/stores/job-progress/sse-transport.svelte.js', () => ({
	SseTransport: class {
		connectionStatus = 'disconnected';
		lastEventTime = 0;
		constructor(runId: string, onMessage: (m: unknown) => void) {
			sseHolder.onMessage = onMessage;
			sseHolder.constructedFor.push(runId);
		}
		connect() {}
		disconnect() {}
	}
}));
const pollHolder = vi.hoisted(() => ({ pollNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/stores/job-progress/polling-transport.svelte.js', () => ({
	PollingTransport: class {
		start() {}
		stop() {}
		pollNow() {
			return pollHolder.pollNow();
		}
	}
}));

// The verbatim store's project read is the ONE network call the live-placement
// refetch makes. Keep the real store (other tests render VerbatimPanel off it)
// and swap only `loadProject` for a controllable deferred, so a test can hold
// one read open and land a second carrier stage while it is in flight.
const verbatimHolder = vi.hoisted(() => ({ loadProject: vi.fn() }));
vi.mock('$lib/stores/verbatim.svelte.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/stores/verbatim.svelte.js')>();
	return { ...actual, loadProject: verbatimHolder.loadProject };
});

// The BYO notice links to the tenant_admin-only Providers page, or tells a member
// who to ask. Keep the real auth store; make only the role check controllable.
const authHolder = vi.hoisted(() => ({ tenantAdmin: true }));
vi.mock('$lib/stores/auth.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/stores/auth.svelte')>();
	return { ...actual, isTenantAdmin: () => authHolder.tenantAdmin };
});

import { render, screen, fireEvent } from '@testing-library/svelte';
import { invalidateAll } from '$app/navigation';
import { normalizeRunMessage } from '$lib/stores/job-progress/message-normalizer.js';
import { runs } from '$lib/api';
import { getToasts, removeToast } from '$lib/stores/toast.svelte.js';
import Page from './+page.svelte';

const invalidateAllMock = vi.mocked(invalidateAll);

type Status = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

function stageOutput(stage_name: string, status: string, error: string | null = null) {
	return {
		id: `so-${stage_name}`,
		run_id: 'run-1',
		stage_name,
		status,
		output: status === 'completed' ? { note: 'ok' } : null,
		error,
		started_at: '2026-07-15T10:00:00Z',
		completed_at: status === 'completed' ? '2026-07-15T10:00:05Z' : null,
		degraded: false
	};
}

// The checkpoints PATCH is the write this page can make on the user's behalf.
// Keep the real store (the page also seeds/reads it) and swap only `patch`, so
// a test can assert whether a WRITE was issued — the property that matters when
// the READ failed.
const checkpointsHolder = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('$lib/stores/checkpoints.svelte.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/stores/checkpoints.svelte.js')>();
	return { ...actual, patch: checkpointsHolder.patch };
});

function makeData(
	status: Status,
	opts: {
		error?: string | null;
		pauseAfterStages?: string[];
		checkpointsError?: unknown;
		usageTotal?: Record<string, unknown>;
		failureDetail?: unknown;
		failureClass?: string | null;
	} = {}
) {
	const terminal = status === 'completed' || status === 'failed';
	const stageStatuses =
		status === 'completed'
			? ['completed', 'completed', 'completed']
			: status === 'failed'
				? ['completed', 'failed', 'pending']
				: ['completed', 'running', 'pending'];
	return {
		project: {
			id: 'proj-1',
			title: 'My Project',
			type: 'generic',
			brief: { source_url: 'https://example.com/src' },
			deliverables: [{ id: 'del-1' }],
			degraded: false
		},
		run: {
			id: 'run-1',
			project_id: 'proj-1',
			deliverable_id: 'del-1',
			parent_run_id: null,
			blueprint_id: 'bp-1',
			status,
			// A paused fixture is a review-checkpoint pause unless a test says otherwise.
			pause_reason: status === 'paused' ? 'checkpoint' : null,
			current_stage: status === 'running' ? 'script_draft' : null,
			started_at: '2026-07-15T10:00:00Z',
			completed_at: terminal ? '2026-07-15T10:05:00Z' : null,
			created_at: '2026-07-15T09:59:00Z',
			config_snapshot: {},
			pause_after_stages: [],
			error: opts.error ?? null,
			failure_detail: opts.failureDetail ?? null,
			failure_class: opts.failureClass ?? null,
			stage_outputs: [
				stageOutput('brief_intake', stageStatuses[0]),
				stageOutput('script_draft', stageStatuses[1], opts.error ?? null),
				stageOutput('video_render', stageStatuses[2])
			],
			usage_total: opts.usageTotal ?? {
				cost_usd: 0.1234,
				cost_status: 'ok',
				input_tokens: 100,
				output_tokens: 50,
				by_stage: []
			},
			degraded: false
		},
		checkpoints: {
			run_id: 'run-1',
			pause_after_stages: opts.pauseAfterStages ?? []
		},
		checkpointsError: opts.checkpointsError ?? null,
		verbatimProject: { items: [], total: 0 },
		dependsOn: new Map<string, string[]>()
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	// The toast store is module state: start every test with none.
	for (const t of getToasts()) removeToast(t.id);
	// Drop any onMessage captured by a prior test's running-state render so the
	// live-transition test only ever fires into its own store instance.
	sseHolder.onMessage = null;
	sseHolder.constructedFor.length = 0;
	verbatimHolder.loadProject.mockReset();
	verbatimHolder.loadProject.mockResolvedValue({ items: [], total: 0 });
});

// What `GET /runs/{id}/restart-plan` answers for these runs: one finished step kept,
// the step the run stopped in re-run.
const PLAN = {
	run_id: 'run-1',
	mode: 'partial',
	full_reasons: [],
	changed_inputs: [],
	stages: [
		{
			stage_name: 'script_draft',
			action: 'reuse',
			reasons: [{ code: 'unchanged', message: '', stage: null, inputs: [] }],
			edited: false
		},
		{
			stage_name: 'storyboard_draft',
			action: 'rerun',
			reasons: [{ code: 'cancelled', message: '', stage: null, inputs: [] }],
			edited: false
		}
	]
};

describe('projects/[pid]/runs/[id] — run viewer', () => {
	it('titles the tab with the project and workflow type, not the source hostname', async () => {
		render(Page, { props: { data: makeData('completed') } });
		await vi.waitFor(() => expect(document.title).toBe('My Project · Generic run - Studio'));
		expect(document.title).not.toContain('example.com');
	});

	it('renders the run cost figure when cost_status is ok', async () => {
		render(Page, { props: { data: makeData('completed') } });
		const cost = await screen.findByTestId('run-cost');
		expect(cost.textContent?.trim()).toBe('$0.1234');
		expect(cost.getAttribute('title')).toBe('150 tokens');
	});

	it('shows the token figures next to cost, and says a $0 local-model run is not unmetered', async () => {
		// Run 01a15193-b4bc… (marketing_scorecard, 2026-10-19): real usage on the
		// local model, metered at $0. The page used to show only "Cost $0.0000".
		render(Page, {
			props: {
				data: makeData('completed', {
					usageTotal: {
						cost_usd: 0,
						cost_status: 'ok',
						cost_unavailable_reason: null,
						input_tokens: 7463,
						output_tokens: 1407,
						by_stage: [
							{
								stage_name: 'script_draft',
								model: 'local-llm',
								provider: 'vllm',
								input_tokens: 7463,
								output_tokens: 1407,
								cost_usd: 0
							}
						]
					}
				})
			}
		});
		expect((await screen.findByTestId('run-cost')).textContent?.trim()).toBe('$0.0000');
		expect(screen.getByTestId('run-tokens-total').textContent).toBe('8.9K tokens');
		expect(screen.getByTestId('run-tokens-input').textContent).toBe('7.5K in');
		expect(screen.getByTestId('run-tokens-output').textContent).toBe('1.4K out');
		expect(screen.getByTestId('run-tokens-note').textContent).toBe(
			'Local model (local-llm) — no charge'
		);
	});

	it('renders an unavailable run cost (cost_usd null) as "Cost unavailable", never $0', async () => {
		render(Page, {
			props: {
				data: makeData('completed', {
					usageTotal: {
						cost_usd: null,
						cost_status: 'unavailable',
						cost_unavailable_reason: 'billing_credential_missing',
						input_tokens: 100,
						output_tokens: 50,
						by_stage: []
					}
				})
			}
		});
		const cost = await screen.findByTestId('run-cost');
		expect(cost.textContent?.trim()).toBe('Cost unavailable');
		expect(cost.textContent).not.toContain('$');
		expect(cost.getAttribute('title')).toMatch(/no billing credential/);
	});

	it('renders a completed run from the frozen loader snapshot without a live reveal refetch', async () => {
		render(Page, { props: { data: makeData('completed') } });

		// The status badge mirrors the (live) job status, which hydrates from the
		// loader snapshot — completed at load.
		const badge = await screen.findByTestId('run-status-badge');
		expect(badge.getAttribute('data-status')).toBe('completed');

		// The one-shot terminal reveal is SKIPPED when the run was already terminal
		// at load (data is fresh then) — re-adding a refetch here is the exact
		// churn the CLAUDE.md warns against.
		expect(invalidateAllMock).not.toHaveBeenCalled();
	});

	it('renders every blueprint stage as a stage-card carrying its live status', async () => {
		render(Page, { props: { data: makeData('completed') } });

		const cards = await screen.findAllByTestId('stage-card');
		expect(cards.map((c) => c.getAttribute('data-stage'))).toEqual([
			'brief_intake',
			'script_draft',
			'video_render'
		]);
		expect(cards.every((c) => c.getAttribute('data-status') === 'completed')).toBe(true);
	});

	it('surfaces the pipeline error and a Restart affordance on a failed run', async () => {
		render(Page, { props: { data: makeData('failed', { error: 'render exploded' }) } });

		const badge = await screen.findByTestId('run-status-badge');
		expect(badge.getAttribute('data-status')).toBe('failed');
		expect(await screen.findByText('render exploded')).toBeTruthy();
		// failed runs are restartable (regenerate a sibling).
		expect(screen.getByRole('button', { name: /Restart/ })).toBeTruthy();
	});

	it('labels the affordance Resume — not Restart — on a PAUSED run', async () => {
		// A paused run resumes in place (runs.resume) and keeps every completed
		// stage. "Restart" reads as "throw away the recording you just paid for",
		// which is exactly the wrong signal at a review checkpoint.
		render(Page, { props: { data: makeData('paused') } });

		expect(await screen.findByRole('button', { name: /Resume/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull();
	});

	it('does not refetch while a run is still live (non-terminal reveal guard)', async () => {
		render(Page, { props: { data: makeData('running') } });

		const badge = await screen.findByTestId('run-status-badge');
		expect(badge.getAttribute('data-status')).toBe('running');
		// isTerminal is false at load → the one-shot reveal must not fire yet.
		expect(invalidateAllMock).not.toHaveBeenCalled();
	});

	it('flips the status badge running→completed on a live SSE terminal event', async () => {
		render(Page, { props: { data: makeData('running') } });

		// Rendering a running run runs jp.connect() → constructs our SSE double,
		// which captures the store's real handleWsMessage callback.
		const badge = await screen.findByTestId('run-status-badge');
		expect(badge.getAttribute('data-status')).toBe('running');
		expect(sseHolder.onMessage).not.toBeNull();

		// Drive the REAL message pipeline: normalize the wire payloads exactly as
		// the transport would, then hand them to the captured onMessage. run_id
		// must equal makeData's 'run-1' or handleWsMessage never sees them.
		sseHolder.onMessage!(normalizeRunMessage({ event: 'run_started', run_id: 'run-1' }));
		sseHolder.onMessage!(normalizeRunMessage({ event: 'run_completed', run_id: 'run-1' }));

		// Terminal events flush synchronously in the store, but the DOM re-render
		// is async — wait for the badge attribute to reflect the new live status.
		await vi.waitFor(() =>
			expect(screen.getByTestId('run-status-badge').getAttribute('data-status')).toBe('completed')
		);

		// The one-shot terminal reveal ($effect → invalidateAll) fires exactly once
		// on the running→terminal transition (load-time status was 'running', so
		// the guard started false).
		expect(invalidateAllMock).toHaveBeenCalledTimes(1);
	});

	it('flips the status badge running→failed on a live SSE run_failed event', async () => {
		render(Page, { props: { data: makeData('running') } });

		const badge = await screen.findByTestId('run-status-badge');
		expect(badge.getAttribute('data-status')).toBe('running');
		expect(sseHolder.onMessage).not.toBeNull();

		sseHolder.onMessage!(normalizeRunMessage({ event: 'run_started', run_id: 'run-1' }));
		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'run_failed', run_id: 'run-1', error: 'render exploded' })
		);

		await vi.waitFor(() =>
			expect(screen.getByTestId('run-status-badge').getAttribute('data-status')).toBe('failed')
		);
		// running→failed is also a terminal transition → single reveal refetch.
		expect(invalidateAllMock).toHaveBeenCalledTimes(1);
	});

	it('flips an individual stage-card data-status when a mid-pipeline stage event arrives', async () => {
		render(Page, { props: { data: makeData('running') } });

		// jp.connect() constructed the capturing SSE double and captured onMessage.
		expect(sseHolder.onMessage).not.toBeNull();

		// makeData('running') hydrates jobProgress.stages to
		// brief_intake=completed, script_draft=running, video_render=pending —
		// each rendered as a top-level stage-card whose data-status is bound to
		// the LIVE store (jobProgress.stages → detailStages → StageIOInspector).
		const findCard = (stage: string) =>
			screen.getAllByTestId('stage-card').find((c) => c.getAttribute('data-stage') === stage);

		const cards = await screen.findAllByTestId('stage-card');
		const scriptCard = cards.find((c) => c.getAttribute('data-stage') === 'script_draft');
		expect(scriptCard).toBeTruthy();
		expect(scriptCard!.getAttribute('data-status')).toBe('running');

		// A mid-pipeline (non-terminal) stage_completed for script_draft. run_id
		// must equal makeData's 'run-1' or handleWsMessage never sees it. The
		// reconciler matches by stage_name and sets that stage's status to
		// 'completed' only — no run-status change, no reveal refetch.
		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'stage_completed', run_id: 'run-1', stage_name: 'script_draft' })
		);

		// stage_* events are rAF-coalesced (not synchronous) → re-query inside
		// waitFor since the card nodes are recreated on re-render.
		await vi.waitFor(() =>
			expect(findCard('script_draft')?.getAttribute('data-status')).toBe('completed')
		);

		// Only the matched stage flipped: the untouched cards keep their statuses.
		expect(findCard('brief_intake')?.getAttribute('data-status')).toBe('completed');
		expect(findCard('video_render')?.getAttribute('data-status')).toBe('pending');
		// A per-stage completion is non-terminal → the one-shot reveal never fires.
		expect(invalidateAllMock).not.toHaveBeenCalled();
	});

	it('flips a pending stage-card to running on a live stage_started event', async () => {
		render(Page, { props: { data: makeData('running') } });
		expect(sseHolder.onMessage).not.toBeNull();

		const findCard = (stage: string) =>
			screen.getAllByTestId('stage-card').find((c) => c.getAttribute('data-stage') === stage);

		const cards = await screen.findAllByTestId('stage-card');
		const renderCard = cards.find((c) => c.getAttribute('data-stage') === 'video_render');
		expect(renderCard).toBeTruthy();
		expect(renderCard!.getAttribute('data-status')).toBe('pending');

		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'stage_started', run_id: 'run-1', stage_name: 'video_render' })
		);

		await vi.waitFor(() =>
			expect(findCard('video_render')?.getAttribute('data-status')).toBe('running')
		);
		expect(invalidateAllMock).not.toHaveBeenCalled();
	});
});

describe('projects/[pid]/runs/[id] — a running run says what it is DOING', () => {
	// These runs take 8-50 minutes. `current_stage` was hydrated from the API and
	// kept current over the live transport, but its only two consumers were both
	// gated on `jobStatus === 'paused'` -- so a RUNNING run rendered a bare
	// percentage and nothing else above the fold.
	it('names the current stage beside the percentage while running', async () => {
		render(Page, { props: { data: makeData('running') } });
		const label = await screen.findByTestId('running-stage');
		expect(label.textContent?.trim()).toBe('Script Draft');
	});

	it('follows the live transport to the next stage', async () => {
		render(Page, { props: { data: makeData('running') } });
		expect(sseHolder.onMessage).not.toBeNull();
		await screen.findByTestId('running-stage');

		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'stage_started', run_id: 'run-1', stage_name: 'video_render' })
		);

		await vi.waitFor(() =>
			expect(screen.getByTestId('running-stage').textContent?.trim()).toBe('Video Render')
		);
	});

	it('says nothing once the run is no longer running', async () => {
		// A terminal run that STILL carries a current_stage -- the field is not
		// cleared on completion. Without this the assertion would pass on
		// current_stage being null and prove nothing about the status guard.
		const data = makeData('completed') as { run: { current_stage: string | null } };
		data.run.current_stage = 'video_render';
		render(Page, { props: { data: data as never } });
		await vi.waitFor(() => expect(screen.queryByTestId('running-stage')).toBeNull());
	});
});

describe('projects/[pid]/runs/[id] — pause banner names the reviewable stage', () => {
	// Regression: a demo_video run paused at its `demo_video_gen` checkpoint, but
	// `current_stage` still held `source_ingest` — a no-dep leaf that started in
	// the same concurrent wave and then SKIPPED. The banner said "Paused after
	// Source Ingest" and [Open editor] linked to that skipped stage's (empty)
	// editor, sending the reviewer to a stage that never ran.
	function pausedData(currentStage: string | null) {
		return {
			project: {
				id: 'proj-1',
				title: 'My Project',
				type: 'demo_video',
				brief: { target_url: 'https://example.com/app' },
				deliverables: [{ id: 'del-1' }],
				degraded: false
			},
			run: {
				id: 'run-1',
				project_id: 'proj-1',
				deliverable_id: 'del-1',
				parent_run_id: null,
				blueprint_id: 'demo_video_v1',
				status: 'paused',
				pause_reason: 'checkpoint',
				current_stage: currentStage,
				started_at: '2026-07-15T10:00:00Z',
				completed_at: null,
				created_at: '2026-07-15T09:59:00Z',
				config_snapshot: {},
				pause_after_stages: ['demo_video_gen'],
				error: null,
				stage_outputs: [
					stageOutput('source_ingest', 'skipped'),
					stageOutput('demo_video_gen', 'completed'),
					stageOutput('script_doctor', 'pending')
				],
				usage_total: { cost_usd: 0.1, input_tokens: 10, output_tokens: 5 },
				degraded: false
			},
			checkpoints: { run_id: 'run-1', pause_after_stages: ['demo_video_gen'] },
			verbatimProject: { items: [], total: 0 },
			dependsOn: new Map<string, string[]>()
		} as never;
	}

	it('names the completed checkpoint, not the skipped first stage left in current_stage', async () => {
		render(Page, { props: { data: pausedData('source_ingest') } });

		expect(await screen.findByText(/Needs review: demo video gen/i)).toBeTruthy();
		expect(screen.queryByText(/Needs review: source ingest/i)).toBeNull();

		const editorLink = screen.getByRole('link', { name: /Open editor/i });
		expect(editorLink.getAttribute('href')).toBe(
			'/projects/proj-1/runs/run-1/stages/demo_video_gen'
		);
	});

	it('keeps banner text and editor href on the SAME stage when current_stage is correct', async () => {
		render(Page, { props: { data: pausedData('demo_video_gen') } });

		expect(await screen.findByText(/Needs review: demo video gen/i)).toBeTruthy();
		expect(screen.getByRole('link', { name: /Open editor/i }).getAttribute('href')).toBe(
			'/projects/proj-1/runs/run-1/stages/demo_video_gen'
		);
	});

	it('offers no stage editor at all when no checkpoint actually completed', async () => {
		// Nothing reviewable → the banner must stay hidden rather than fall back
		// to a stage that never ran.
		const data = pausedData('source_ingest') as unknown as {
			run: { stage_outputs: Array<{ stage_name: string; status: string }> };
		};
		data.run.stage_outputs = data.run.stage_outputs.map((s) =>
			s.stage_name === 'demo_video_gen' ? { ...s, status: 'pending' } : s
		);
		render(Page, { props: { data: data as never } });

		await screen.findAllByTestId('stage-card');
		expect(screen.queryByText(/Needs review:/i)).toBeNull();
	});
});

describe('projects/[pid]/runs/[id] — review gate on the monitor', () => {
	// website_review pauses at its redesign + script gates. The outputs panels are
	// bound to the loader snapshot, which only refreshed on TERMINAL — so a run
	// that paused while the page was open showed the banner over outputs frozen at
	// page load, and the reviewer could not see what they were approving.
	function runningGateData() {
		const d = makeData('running', { pauseAfterStages: ['script_draft'] }) as unknown as {
			run: { pause_after_stages: string[] };
		};
		d.run.pause_after_stages = ['script_draft'];
		return d as never;
	}

	it('refetches the loader ONCE when a live run enters paused', async () => {
		render(Page, { props: { data: runningGateData() } });
		await screen.findByTestId('run-status-badge');
		expect(invalidateAllMock).not.toHaveBeenCalled();

		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'stage_completed', run_id: 'run-1', stage_name: 'script_draft' })
		);
		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'run_paused', run_id: 'run-1', stage_name: 'script_draft' })
		);

		await vi.waitFor(() =>
			expect(screen.getByTestId('run-status-badge').getAttribute('data-status')).toBe('paused')
		);
		await vi.waitFor(() => expect(invalidateAllMock).toHaveBeenCalledTimes(1));
		// The review panel names the gate straight away, even before the refetch lands.
		expect(screen.getByTestId('pause-review').getAttribute('data-stage')).toBe('script_draft');
	});

	it('shows the paused stage output with a working Approve beside the banner', async () => {
		const resume = vi.spyOn(runs, 'resume').mockResolvedValue(undefined as never);
		const d = makeData('paused') as unknown as {
			run: {
				current_stage: string | null;
				pause_after_stages: string[];
				stage_outputs: Array<{ stage_name: string; status: string; output: unknown }>;
			};
		};
		d.run.current_stage = 'brief_intake';
		d.run.pause_after_stages = ['brief_intake'];
		d.run.stage_outputs[0].output = { headline: 'Redesigned hero copy under review' };
		render(Page, { props: { data: d as never } });

		const panel = await screen.findByTestId('pause-review');
		expect(panel.getAttribute('data-stage')).toBe('brief_intake');
		expect(screen.getByTestId('pause-review-output').textContent).toContain(
			'Redesigned hero copy under review'
		);
		// Loaded paused ⇒ the snapshot is already fresh; no refetch.
		expect(invalidateAllMock).not.toHaveBeenCalled();

		await fireEvent.click(
			Array.from(panel.querySelectorAll('button')).find((b) => /Approve/.test(b.textContent ?? ''))!
		);
		await vi.waitFor(() => expect(resume).toHaveBeenCalledWith('run-1'));
		resume.mockRestore();
	});

	// REGRESSION (run 01a1770d, 2026-10-26/27): the run paused at its storyboard gate
	// and waited 29h; a paused run never times out, and the banner gave no hint how
	// long it had been holding the run, so it was cancelled as "stuck". The banner
	// must say since when it has been waiting.
	it('says since when the paused run has been waiting for review', async () => {
		const d = makeData('paused') as unknown as {
			run: {
				current_stage: string | null;
				pause_after_stages: string[];
				paused_at?: string | null;
			};
		};
		d.run.current_stage = 'brief_intake';
		d.run.pause_after_stages = ['brief_intake'];
		d.run.paused_at = new Date(Date.now() - 29 * 3600 * 1000).toISOString();
		render(Page, { props: { data: d as never } });

		const since = await screen.findByTestId('pause-waiting-since');
		expect(since.textContent).toContain('Needs review since');
		expect(since.textContent).toContain('(1d ago)');
	});

	it('shows no waiting-since line when the orchestrator sent no paused_at', async () => {
		const d = makeData('paused') as unknown as {
			run: { current_stage: string | null; pause_after_stages: string[] };
		};
		d.run.current_stage = 'brief_intake';
		d.run.pause_after_stages = ['brief_intake'];
		render(Page, { props: { data: d as never } });

		await screen.findByTestId('pause-review');
		expect(screen.queryByTestId('pause-waiting-since')).toBeNull();
	});

	// A run someone PAUSED (POST /runs/{id}/pause) is not waiting at a review gate:
	// no "Needs review" banner, no review panel, no review toast — just "Paused".
	it('a manual pause shows Paused, never the review prompt', async () => {
		const d = makeData('paused') as unknown as {
			run: {
				current_stage: string | null;
				pause_after_stages: string[];
				paused_at?: string | null;
				pause_reason?: string | null;
			};
		};
		d.run.current_stage = 'brief_intake';
		d.run.pause_after_stages = ['brief_intake'];
		d.run.paused_at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		d.run.pause_reason = 'manual';
		render(Page, { props: { data: d as never } });

		const banner = await screen.findByTestId('manual-pause-banner');
		expect(banner.textContent).toContain('Paused since');
		expect(banner.textContent).not.toMatch(/review/i);
		expect(screen.queryByTestId('pause-review')).toBeNull();
		expect(screen.queryByText(/Needs review/i)).toBeNull();
		// …and no "Needs review" toast for it either.
		expect(getToasts().some((t) => /review/i.test(`${t.title} ${t.description ?? ''}`))).toBe(
			false
		);
	});

	it('a checkpoint pause does raise the Needs review toast (control for the test above)', async () => {
		const d = makeData('paused') as unknown as {
			run: { current_stage: string | null; pause_after_stages: string[] };
		};
		d.run.current_stage = 'brief_intake';
		d.run.pause_after_stages = ['brief_intake'];
		render(Page, { props: { data: d as never } });
		await screen.findByTestId('pause-review');
		await vi.waitFor(() => expect(getToasts().some((t) => t.title === 'Needs review')).toBe(true));
	});

	// The "(Xm ago)" must keep moving while the reviewer has the page open; a fixed
	// render-time clock would freeze it and fail here. It must also sit OUTSIDE the
	// banner's live region, or a screen reader re-reads it every tick.
	it('the waiting line ticks and is not inside a live region', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
		vi.setSystemTime(new Date('2026-10-27T12:10:00Z'));
		try {
			const d = makeData('paused') as unknown as {
				run: { current_stage: string | null; pause_after_stages: string[]; paused_at?: string };
			};
			d.run.current_stage = 'brief_intake';
			d.run.pause_after_stages = ['brief_intake'];
			d.run.paused_at = '2026-10-27T12:05:00Z';
			render(Page, { props: { data: d as never } });

			const since = await screen.findByTestId('pause-waiting-since');
			expect(since.textContent).toContain('(5m ago)');
			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(since.textContent).toContain('(15m ago)');
			expect(since.closest('[aria-live]')).toBeNull();
			expect(since.closest('[role="status"]')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('projects/[pid]/runs/[id] — warnings before completion', () => {
	function pausedWithDegradedStage() {
		const d = makeData('paused') as unknown as {
			run: {
				current_stage: string | null;
				pause_after_stages: string[];
				stage_outputs: Array<Record<string, unknown>>;
			};
		};
		d.run.current_stage = 'brief_intake';
		d.run.pause_after_stages = ['brief_intake'];
		d.run.stage_outputs[0] = {
			...d.run.stage_outputs[0],
			degraded: true,
			degradation_codes: ['captions_missing'],
			output: {
				degradations: [{ code: 'captions_missing', detail: 'no caption track' }],
				advisories: [{ code: 'duration_unmeasured', detail: 'length is an estimate' }]
			}
		};
		return d as never;
	}

	it('lists stage warnings on a PAUSED run, not only once completed', async () => {
		render(Page, { props: { data: pausedWithDegradedStage() } });
		const panel = await screen.findByTestId('run-warnings');
		expect(panel.textContent).toContain('no caption track');
		expect(panel.textContent).toMatch(/so far/);
		expect(panel.textContent).not.toMatch(/Completed with/);
	});

	it('renders advisories as a separate Notes list, never as warnings', async () => {
		render(Page, { props: { data: pausedWithDegradedStage() } });
		const notes = await screen.findByTestId('run-advisories');
		expect(notes.textContent).toContain('length is an estimate');
		expect(screen.getByTestId('run-warnings').textContent).not.toContain('length is an estimate');
	});
});

describe('projects/[pid]/runs/[id] — live verbatim placement refetch', () => {
	// Placement is only learnable by re-reading `…/verbatim-items?run_id=`, and
	// each carrier stage should trigger at most one such read. The bug: the
	// "already refetched" bookkeeping was written BEFORE the in-flight bail, so a
	// carrier stage that landed DURING an open read was recorded as refetched
	// having never been read — and the de-dup guard then blocked it forever, so
	// its placement stayed "pending" for the rest of the run.
	//
	// Two carrier stages in the blueprint so a test can wait on the SECOND card
	// flipping to 'completed'. That flip is the only honest proof the rAF-coalesced
	// message batch has actually been APPLIED — i.e. that the second stage's
	// refetch really was attempted while the first read was still open. Waiting on
	// the request count instead passes vacuously before the flush ever runs.
	function carrierData() {
		return {
			project: {
				id: 'proj-1',
				title: 'My Project',
				type: 'generic',
				brief: {},
				deliverables: [{ id: 'del-1' }],
				degraded: false
			},
			run: {
				id: 'run-1',
				project_id: 'proj-1',
				deliverable_id: 'del-1',
				parent_run_id: null,
				blueprint_id: 'bp-1',
				status: 'running',
				current_stage: 'script_draft',
				started_at: '2026-07-15T10:00:00Z',
				completed_at: null,
				created_at: '2026-07-15T09:59:00Z',
				config_snapshot: {},
				pause_after_stages: [],
				error: null,
				stage_outputs: [
					stageOutput('script_draft', 'running'),
					stageOutput('script_doctor', 'pending'),
					stageOutput('video_render', 'pending')
				],
				usage_total: { cost_usd: 0.1, input_tokens: 10, output_tokens: 5 },
				degraded: false
			},
			checkpoints: { run_id: 'run-1', pause_after_stages: [] },
			verbatimProject: { items: [], total: 0 },
			dependsOn: new Map<string, string[]>()
		} as never;
	}

	const findCard = (stage: string) =>
		screen.getAllByTestId('stage-card').find((c) => c.getAttribute('data-stage') === stage);

	function completed(stage: string) {
		sseHolder.onMessage!(
			normalizeRunMessage({ event: 'stage_completed', run_id: 'run-1', stage_name: stage })
		);
	}

	it('re-reads placement for a carrier stage that landed while an earlier read was in flight', async () => {
		// Hold the first read open so the second carrier stage genuinely overlaps it.
		const resolvers: Array<() => void> = [];
		verbatimHolder.loadProject.mockImplementation(
			() =>
				new Promise<void>((res) => {
					resolvers.push(() => res());
				})
		);

		render(Page, { props: { data: carrierData() } });
		await screen.findAllByTestId('stage-card');
		expect(sseHolder.onMessage).not.toBeNull();

		completed('script_draft');
		await vi.waitFor(() =>
			expect(findCard('script_draft')?.getAttribute('data-status')).toBe('completed')
		);
		expect(verbatimHolder.loadProject).toHaveBeenCalledTimes(1);

		// script_doctor completes while that read is still open. The open read was
		// ISSUED before this stage's output existed, so it cannot carry this
		// stage's placement — suppressing the request is fine, forgetting the
		// stage is not.
		completed('script_doctor');
		await vi.waitFor(() =>
			expect(findCard('script_doctor')?.getAttribute('data-status')).toBe('completed')
		);
		expect(verbatimHolder.loadProject).toHaveBeenCalledTimes(1);

		resolvers[0]();

		// Once the first read settles, the suppressed stage must actually be read.
		await vi.waitFor(() => expect(verbatimHolder.loadProject).toHaveBeenCalledTimes(2));
	});

	it('fires at most one read per carrier stage across an SSE replay', async () => {
		// An SSE reconnect replays the full event history. Neither the de-dup
		// guard nor the trailing re-read may turn that replay into a request loop.
		render(Page, { props: { data: carrierData() } });
		await screen.findAllByTestId('stage-card');

		for (let i = 0; i < 3; i++) completed('script_draft');
		await vi.waitFor(() =>
			expect(findCard('script_draft')?.getAttribute('data-status')).toBe('completed')
		);
		for (let i = 0; i < 3; i++) completed('script_draft');
		await new Promise((r) => setTimeout(r, 30));
		expect(verbatimHolder.loadProject).toHaveBeenCalledTimes(1);
	});

	it('ignores non-carrier stage completions entirely', async () => {
		render(Page, { props: { data: carrierData() } });
		await screen.findAllByTestId('stage-card');

		completed('video_render');
		await vi.waitFor(() =>
			expect(findCard('video_render')?.getAttribute('data-status')).toBe('completed')
		);
		expect(verbatimHolder.loadProject).not.toHaveBeenCalled();
	});
});

describe('projects/[pid]/runs/[id] — same-route navigation re-scopes run state', () => {
	// REGRESSION. This page navigates to a SIBLING RUN itself: `handleRestart`
	// (failed/cancelled → regenerate) and `handleRerunConfirm` both
	// `goto(/projects/{pid}/runs/{newId})`. That is a same-route navigation, so
	// SvelteKit REUSES the component — no remount, no re-initialisation of
	// anything captured in a top-level `untrack`.
	//
	// The page re-scoped exactly one of its run-scoped stores (`liveOutputs`).
	// `jobProgress`, `refreshedOnTerminal`, the checkpoint seed / `pauseAfter`
	// and the verbatim seed were all captured once. The visible failure: open a
	// FAILED run A → Regenerate → land on run B, which renders A's failed stage
	// set forever, has NO live stream (A was terminal so `connect()` never ran),
	// never fires its one-shot terminal `invalidateAll()` (the guard was already
	// `true` from A), and PATCHes A's `pause_after_stages` when you save
	// checkpoints.
	//
	// `rerender({ data })` is exactly the reuse SvelteKit performs: new props,
	// same component instance.
	function runData(
		runId: string,
		status: Status,
		opts: { stages?: Array<[string, string]>; pauseAfter?: string[] } = {}
	) {
		const stages = opts.stages ?? [
			['brief_intake', 'completed'],
			['script_draft', 'failed'],
			['video_render', 'pending']
		];
		return {
			project: {
				id: 'proj-1',
				title: 'My Project',
				type: 'generic',
				brief: {},
				deliverables: [{ id: 'del-1' }],
				degraded: false
			},
			run: {
				id: runId,
				project_id: 'proj-1',
				deliverable_id: 'del-1',
				parent_run_id: null,
				blueprint_id: 'bp-1',
				status,
				current_stage: null,
				started_at: '2026-07-15T10:00:00Z',
				completed_at: null,
				created_at: '2026-07-15T09:59:00Z',
				config_snapshot: {},
				pause_after_stages: opts.pauseAfter ?? [],
				error: null,
				stage_outputs: stages.map(([name, st]) => ({ ...stageOutput(name, st), run_id: runId })),
				usage_total: { cost_usd: 0.1, input_tokens: 10, output_tokens: 5 },
				degraded: false
			},
			checkpoints: { run_id: runId, pause_after_stages: opts.pauseAfter ?? [] },
			verbatimProject: { items: [], total: 0 },
			dependsOn: new Map<string, string[]>()
		} as never;
	}

	const stageNames = () =>
		screen.getAllByTestId('stage-card').map((c) => c.getAttribute('data-stage'));

	it('rebinds jobProgress to run B — B streams live instead of rendering A frozen', async () => {
		const { rerender } = render(Page, { props: { data: runData('run-A', 'failed') } });
		await screen.findAllByTestId('stage-card');
		expect(stageNames()).toEqual(['brief_intake', 'script_draft', 'video_render']);
		expect(screen.getByTestId('run-status-badge').getAttribute('data-status')).toBe('failed');
		// A was terminal at load → no transport was ever opened for it.
		expect(sseHolder.constructedFor).toEqual([]);

		// Regenerate → goto(/runs/run-B). Same component, new props.
		await rerender({
			data: runData('run-B', 'running', {
				stages: [
					['ingest', 'completed'],
					['edit', 'running'],
					['publish', 'pending']
				]
			})
		});

		// (a) B's own stage set, not A's.
		await vi.waitFor(() => expect(stageNames()).toEqual(['ingest', 'edit', 'publish']));
		expect(screen.getByTestId('run-status-badge').getAttribute('data-status')).toBe('running');

		// (b) B is actually STREAMING: a transport was opened, and it was opened
		// for run-B. Exactly one — the loop proof for the run-scope effect.
		expect(sseHolder.constructedFor).toEqual(['run-B']);
		expect(sseHolder.onMessage).not.toBeNull();

		// (c) The store answers to run-B's ids. `handleWsMessage` drops any event
		// whose run_id is not the store's own, so a badge flip here is only
		// possible if the store was rebuilt with runId 'run-B'.
		sseHolder.onMessage!(normalizeRunMessage({ event: 'run_completed', run_id: 'run-B' }));
		await vi.waitFor(() =>
			expect(screen.getByTestId('run-status-badge').getAttribute('data-status')).toBe('completed')
		);

		// (d) The one-shot terminal reveal fires for B. Carried over from the
		// FAILED run A, the guard was already `true` and B's outputs never filled.
		expect(invalidateAllMock).toHaveBeenCalledTimes(1);
	});

	it('re-seeds the checkpoint picker from run B — saving on B cannot submit A’s stages', async () => {
		const { rerender } = render(Page, {
			props: { data: runData('run-A', 'failed', { pauseAfter: ['script_draft'] }) }
		});
		await screen.findAllByTestId('stage-card');
		expect(await screen.findByText('1 selected')).toBeTruthy();

		await rerender({ data: runData('run-B', 'running', { pauseAfter: [] }) });

		// `pauseAfter` is what `applyCheckpoints` PATCHes; stale, run B's save
		// submits run A's checkpoint list.
		await vi.waitFor(() => expect(screen.getByText('Autopilot — no checkpoints')).toBeTruthy());
		expect(screen.queryByText('1 selected')).toBeNull();
	});

	it('does not re-scope (or loop) when the props change but the run id does not', async () => {
		const { rerender } = render(Page, { props: { data: runData('run-A', 'running') } });
		await screen.findAllByTestId('stage-card');
		expect(sseHolder.constructedFor).toEqual(['run-A']);

		// Same run id, a changed field. The guard must make this a no-op: a
		// rebuild here would drop the open stream and replay it, and an effect
		// that wrote state it also reads would never settle.
		await rerender({ data: runData('run-A', 'running', { pauseAfter: ['script_draft'] }) });
		await new Promise((r) => setTimeout(r, 50));

		expect(sseHolder.constructedFor).toEqual(['run-A']);
		expect(invalidateAllMock).not.toHaveBeenCalled();
	});
});

// A FAILED checkpoints GET degrades to `pause_after_stages: []`. That empty list
// is not a measurement, and this panel does not merely display it — the picker
// PATCHes a full REPLACEMENT built from it. So the failure mode is not a cosmetic
// wrong label: one toggle against an unknown baseline DELETES every gate the user
// was never shown. These tests pin "a read failure must never become a write".
describe('projects/[pid]/runs/[id] — checkpoints read failure', () => {
	beforeEach(() => {
		checkpointsHolder.patch.mockReset();
		checkpointsHolder.patch.mockResolvedValue({ run_id: 'run-1', pause_after_stages: [] });
	});

	it('does not claim "Autopilot" when the checkpoints read failed', async () => {
		render(Page, {
			props: {
				data: makeData('running', {
					// what the loader's fallback produces on a failed GET
					pauseAfterStages: [],
					checkpointsError: new Error('500 checkpoints unavailable')
				})
			}
		});

		await screen.findAllByTestId('stage-card');

		// "Autopilot — no checkpoints" is a confident product claim about a
		// request that never answered. It must not be reachable here.
		expect(screen.queryByText('Autopilot — no checkpoints')).toBeNull();
		expect(screen.getByTestId('checkpoints-unknown')).toBeTruthy();
		expect(screen.getByTestId('checkpoints-read-failed')).toBeTruthy();
	});

	it('cannot PATCH checkpoints while the read is unresolved', async () => {
		render(Page, {
			props: {
				data: makeData('running', {
					pauseAfterStages: [],
					checkpointsError: new Error('500 checkpoints unavailable')
				})
			}
		});

		await screen.findAllByTestId('stage-card');

		const stageToggles = screen.getAllByRole('button', { pressed: false });
		expect(stageToggles.length).toBeGreaterThan(0);

		// Click FIRST, and assert the write FIRST. Asserting `disabled` before the
		// click would make the mutation die on the attribute and never demonstrate
		// the thing that actually loses data — the PATCH.
		await fireEvent.click(stageToggles[0]);
		await new Promise((r) => setTimeout(r, 20));

		// THE property. A PATCH here would send `[thatOneStage]` as the run's WHOLE
		// checkpoint list, deleting every real gate we failed to read.
		expect(checkpointsHolder.patch).not.toHaveBeenCalled();

		// …and the affordance is disabled, so the user is told rather than silently
		// ignored.
		for (const b of stageToggles) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
		}
	});

	// CONTROL. Without this, the two tests above would also pass on a panel that
	// is simply always disabled — which would be a different bug, not a fix. A
	// SUCCESSFUL read returning an empty list is the case that legitimately says
	// "Autopilot" and must stay fully editable.
	it('still edits normally when the checkpoints read SUCCEEDED and returned none', async () => {
		render(Page, {
			props: { data: makeData('running', { pauseAfterStages: [], checkpointsError: null }) }
		});

		await screen.findAllByTestId('stage-card');

		expect(screen.getByText('Autopilot — no checkpoints')).toBeTruthy();
		expect(screen.queryByTestId('checkpoints-read-failed')).toBeNull();

		const stageToggles = screen.getAllByRole('button', { pressed: false });
		expect(stageToggles.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);

		await fireEvent.click(stageToggles[0]);
		await vi.waitFor(() => expect(checkpointsHolder.patch).toHaveBeenCalledTimes(1));
	});
});

describe('projects/[pid]/runs/[id] — byo_provider_required failure (w2v_orchestrator#1106)', () => {
	const RAW = 'stage tts_narrate failed: SlotNotConfiguredError(tts)';
	const BYO_TTS = {
		code: 'byo_provider_required',
		modality: 'tts',
		message: 'Configure your own TTS provider to continue'
	};

	beforeEach(() => {
		authHolder.tenantAdmin = true;
	});

	it('replaces the generic Pipeline Error with the BYO message and a provider-settings link', async () => {
		render(Page, {
			props: { data: makeData('failed', { error: RAW, failureDetail: BYO_TTS }) }
		});
		const notice = await screen.findByTestId('byo-provider-required');
		expect(notice.textContent).toContain('Configure your own TTS provider to continue');
		const link = screen.getByTestId('byo-provider-settings-link');
		expect(link.getAttribute('href')).toBe('/providers?missing=tts#provider-slot-tts');
		// The generic failure block — heading AND raw error text — is not shown.
		expect(screen.queryByText('Pipeline Error')).toBeNull();
		expect(screen.queryByText(RAW)).toBeNull();
	});

	it('shows the server sentence and links every slot it named (#1150)', async () => {
		render(Page, {
			props: {
				data: makeData('failed', {
					error: RAW,
					failureDetail: {
						...BYO_TTS,
						modality: 'image',
						slots: 'image',
						message: 'Configure your own image provider to continue'
					}
				})
			}
		});
		const msg = await screen.findByTestId('byo-provider-required-message');
		expect(msg.textContent?.trim()).toBe('Configure your own image provider to continue');
		expect(screen.getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=image#provider-slot-image'
		);
	});

	it('a member gets who-to-ask text instead of a link that would 403', async () => {
		authHolder.tenantAdmin = false;
		render(Page, {
			props: { data: makeData('failed', { error: RAW, failureDetail: BYO_TTS }) }
		});
		await screen.findByTestId('byo-provider-required');
		expect(screen.queryByTestId('byo-provider-settings-link')).toBeNull();
		expect(screen.getByTestId('byo-provider-ask-admin')).toBeTruthy();
	});

	it('any other failure (failure_detail null) keeps the generic failure card', async () => {
		render(Page, { props: { data: makeData('failed', { error: RAW }) } });
		const card = await screen.findByTestId('run-failure');
		expect(card.textContent).toContain('The run failed');
		// The raw text is kept, but only under the collapsed technical details.
		expect(screen.getByTestId('run-failure-details').textContent).toContain(RAW);
		expect(screen.queryByTestId('byo-provider-required')).toBeNull();
	});
});

// Spend-safety + honesty guards on the run header (ui-review 2026-10-17).
describe('projects/[pid]/runs/[id] — run actions', () => {
	it('offers Cancel on a PAUSED run (the backend allows it)', async () => {
		render(Page, { props: { data: makeData('paused') } });
		expect(await screen.findByRole('button', { name: /^Cancel$/ })).toBeTruthy();
	});

	it('never offers Resume on a FAILED run (resume there is a no-op)', async () => {
		render(Page, { props: { data: makeData('failed', { error: 'x' }) } });
		await screen.findByTestId('run-status-badge');
		expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
		expect(screen.getByRole('button', { name: /Restart/ })).toBeTruthy();
	});

	it('Restart re-reads the status and asks before spawning a paid run', async () => {
		const getStatus = vi
			.spyOn(runs, 'getStatus')
			.mockResolvedValue({ id: 'run-1', status: 'failed', current_stage: null } as never);
		const restartPlan = vi.spyOn(runs, 'restartPlan').mockResolvedValue(PLAN as never);
		const regenerate = vi.spyOn(runs, 'regenerate').mockResolvedValue({ id: 'run-2' } as never);
		render(Page, { props: { data: makeData('failed', { error: 'x' }) } });

		await fireEvent.click(await screen.findByRole('button', { name: /Restart/ }));
		await vi.waitFor(() => expect(getStatus).toHaveBeenCalledWith('run-1'));
		// Nothing billed yet — a confirmation is showing.
		expect(regenerate).not.toHaveBeenCalled();
		const confirm = await screen.findByRole('button', { name: /Restart run/ });
		await fireEvent.click(confirm);
		await vi.waitFor(() => expect(regenerate).toHaveBeenCalledWith('run-1', {}));
		getStatus.mockRestore();
		restartPlan.mockRestore();
		regenerate.mockRestore();
	});

	it('Restart of a CANCELLED run previews which finished steps are kept before confirming', async () => {
		const getStatus = vi
			.spyOn(runs, 'getStatus')
			.mockResolvedValue({ id: 'run-1', status: 'cancelled', current_stage: null } as never);
		const restartPlan = vi.spyOn(runs, 'restartPlan').mockResolvedValue(PLAN as never);
		const regenerate = vi.spyOn(runs, 'regenerate').mockResolvedValue({ id: 'run-2' } as never);
		render(Page, { props: { data: makeData('cancelled') } });

		// How to fix-then-restart is said up front, not discovered.
		expect(await screen.findByTestId('restart-edit-hint')).toBeInTheDocument();
		await fireEvent.click(await screen.findByRole('button', { name: /Restart/ }));
		await vi.waitFor(() => expect(restartPlan).toHaveBeenCalledWith('run-1'));
		const headline = await screen.findByTestId('restart-plan-headline');
		expect(headline.textContent).toContain('1 finished step is kept; 1 step runs again.');
		expect(screen.getByTestId('restart-plan-rerun').textContent).toContain(
			'cancelled, so it starts over'
		);
		expect(regenerate).not.toHaveBeenCalled();
		getStatus.mockRestore();
		restartPlan.mockRestore();
		regenerate.mockRestore();
	});

	it('Restart refused 402 byo_provider_required → the notice with ?missing= link, no toast-only dead end', async () => {
		const getStatus = vi
			.spyOn(runs, 'getStatus')
			.mockResolvedValue({ id: 'run-1', status: 'failed', current_stage: null } as never);
		const byo = {
			code: 'byo_provider_required',
			modality: 'llm',
			slots: 'llm,tts,image',
			message: 'Configure your own LLM, TTS and image providers to continue'
		};
		const restartPlan = vi.spyOn(runs, 'restartPlan').mockResolvedValue(PLAN as never);
		const regenerate = vi
			.spyOn(runs, 'regenerate')
			.mockRejectedValue(Object.assign(new Error('402'), { status: 402, details: byo }));
		authHolder.tenantAdmin = true;
		render(Page, { props: { data: makeData('failed', { error: 'x' }) } });

		await fireEvent.click(await screen.findByRole('button', { name: /Restart/ }));
		await fireEvent.click(await screen.findByRole('button', { name: /Restart run/ }));
		await vi.waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
		const msg = await screen.findByTestId('byo-provider-required-message');
		expect(msg.textContent?.trim()).toBe(
			'Configure your own LLM, TTS and image providers to continue'
		);
		expect(screen.getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=llm,tts,image#provider-slot-llm'
		);
		// The confirmation closed — the user is not left staring at "Restart run".
		expect(screen.queryByRole('button', { name: /Restart run/ })).toBeNull();
		getStatus.mockRestore();
		restartPlan.mockRestore();
		regenerate.mockRestore();
	});

	it('Resume on a run that has since failed does NOT call resume', async () => {
		const getStatus = vi
			.spyOn(runs, 'getStatus')
			.mockResolvedValue({ id: 'run-1', status: 'failed', current_stage: null } as never);
		const resume = vi.spyOn(runs, 'resume').mockResolvedValue(undefined as never);
		render(Page, { props: { data: makeData('paused') } });

		const buttons = await screen.findAllByRole('button', { name: /Resume/ });
		await fireEvent.click(buttons[0]);
		await vi.waitFor(() => expect(getStatus).toHaveBeenCalled());
		expect(resume).not.toHaveBeenCalled();
		getStatus.mockRestore();
		resume.mockRestore();
	});

	it('maps failure_class to a human message and hides internal URLs', async () => {
		const raw =
			'StageRetriesExhaustedError: TransientUpstreamError: upstream 500 from http://worker-management.w2v:8100/api/workers/x/message: boom';
		render(Page, {
			props: { data: makeData('failed', { error: raw, failureClass: 'external' }) }
		});
		const card = await screen.findByTestId('run-failure');
		expect(card.textContent).toMatch(/service the pipeline depends on was unavailable/i);
		expect(card.textContent).not.toContain('svc.cluster.local');
	});

	it('makes the checkpoint panel read-only on a finished run', async () => {
		render(Page, { props: { data: makeData('completed') } });
		expect(await screen.findByTestId('checkpoints-read-only')).toBeTruthy();
	});
});

// Run 01a17e6f (2026-10-27): "the console says completed but the UI says running"
// and "Cost $0.0000" on a run that was still going.
describe('projects/[pid]/runs/[id] — terminal truth + cost + output placement', () => {
	function withVideo(data: ReturnType<typeof makeData>) {
		const d = data as unknown as {
			run: { stage_outputs: { output: unknown }[] };
		};
		d.run.stage_outputs[2].output = { artifact_url: '/api/runs/run-1/artifact/v/final.mp4' };
		return data;
	}

	it('says the cost is still being calculated while the run is live, never $0', async () => {
		render(Page, {
			props: {
				data: makeData('running', {
					usageTotal: {
						cost_usd: 0,
						cost_status: 'ok',
						input_tokens: 0,
						output_tokens: 0,
						by_stage: []
					}
				})
			}
		});
		const cost = await screen.findByTestId('run-cost');
		expect(cost.textContent?.trim()).toBe('Calculating…');
		expect(cost.getAttribute('title')).toBe('The cost is final once the run finishes.');
	});

	it('adopts a terminal status from a re-read of the run even if the live view missed it', async () => {
		const { rerender } = render(Page, { props: { data: makeData('running') } });
		expect((await screen.findByTestId('run-status-badge')).dataset.status).toBe('running');
		await rerender({ data: makeData('completed') });
		await vi.waitFor(() =>
			expect(screen.getByTestId('run-status-badge').dataset.status).toBe('completed')
		);
		expect(screen.queryByText('Calculating…')).toBeNull();
	});

	it('puts the finished deliverable above the run setup panels once completed', async () => {
		render(Page, { props: { data: withVideo(makeData('completed')) } });
		const output = await screen.findByTestId('run-output-panel');
		const checkpoints = await screen.findByTestId('checkpoints-read-only');
		expect(
			output.compareDocumentPosition(checkpoints) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(screen.getByTestId('run-mp4-download').getAttribute('download')).toBe('my-project.mp4');
	});

	const unsettled = (status: Status, cost = 0, rows: unknown[] = []) =>
		makeData(status, {
			usageTotal: {
				cost_usd: cost,
				cost_status: 'ok',
				cost_settled: false,
				input_tokens: 0,
				output_tokens: 0,
				by_stage: rows
			}
		});
	const row = {
		stage_name: 'script_draft',
		model: 'm',
		provider: 'p',
		input_tokens: 1,
		output_tokens: 1,
		cost_usd: 0.01
	};

	it.each(['completed', 'failed', 'cancelled'] as const)(
		'keeps re-reading a %s run until its cost is settled, on a bounded interval',
		async (status) => {
			vi.useFakeTimers();
			try {
				render(Page, { props: { data: unsettled(status) } });
				// Loaded finished-but-unsettled: says so plainly, no "$0.0000", and a
				// follow-up is armed.
				expect(screen.getByTestId('run-cost').textContent?.trim()).toBe('Still being confirmed');
				await vi.advanceTimersByTimeAsync(35_000);
				expect(invalidateAllMock).toHaveBeenCalledTimes(1);
				await vi.advanceTimersByTimeAsync(70_000);
				expect(invalidateAllMock).toHaveBeenCalledTimes(2);
				// The interval is capped at 2 minutes from here on.
				await vi.advanceTimersByTimeAsync(120_000);
				expect(invalidateAllMock).toHaveBeenCalledTimes(3);
				await vi.advanceTimersByTimeAsync(120_000);
				expect(invalidateAllMock).toHaveBeenCalledTimes(4);
				// It does NOT give up: a cancelled run stays provisional for the video
				// compiler's whole render ceiling (up to ~1h), and a read that lost the
				// per-run reconciliation lock is still-unsettled, not an error. An hour
				// in, the page is still asking and still saying so in plain words.
				for (let i = 0; i < 12; i += 1) await vi.advanceTimersByTimeAsync(120_000);
				expect(invalidateAllMock.mock.calls.length).toBeGreaterThan(10);
				expect(screen.getByTestId('run-cost').textContent?.trim()).toBe('Still being confirmed');
			} finally {
				vi.useRealTimers();
			}
		}
	);

	it('shows the final figure, and stops re-reading, once the cost is settled', async () => {
		vi.useFakeTimers();
		try {
			const { rerender } = render(Page, { props: { data: unsettled('completed', 0.01, [row]) } });
			expect(screen.getByTestId('run-cost').textContent?.trim()).toBe('Still being confirmed');
			await rerender({
				data: makeData('completed', {
					usageTotal: {
						cost_usd: 0.0453,
						cost_status: 'ok',
						cost_settled: true,
						input_tokens: 2,
						output_tokens: 2,
						by_stage: [row]
					}
				})
			});
			// The armed re-read is CANCELLED on settle — the page stops reading.
			await vi.advanceTimersByTimeAsync(3_600_000);
			expect(screen.getByTestId('run-cost').textContent?.trim()).toBe('$0.0453');
			expect(invalidateAllMock).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('starts the cost backoff over for a different run on the same page', async () => {
		vi.useFakeTimers();
		try {
			const { rerender } = render(Page, { props: { data: unsettled('completed') } });
			await vi.advanceTimersByTimeAsync(35_000 + 70_000);
			expect(invalidateAllMock).toHaveBeenCalledTimes(2);
			// Restart/regenerate navigates /runs/run-1 → /runs/run-2 on THIS component.
			const next = unsettled('completed') as unknown as {
				run: { id: string };
				checkpoints: { run_id: string };
			};
			next.run.id = 'run-2';
			next.checkpoints.run_id = 'run-2';
			await rerender({ data: next as never });
			// Back to the FIRST step (35s), not run-1's third (140s).
			await vi.advanceTimersByTimeAsync(35_000);
			expect(invalidateAllMock).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it('a paused run shows the cost so far, never an endless "Calculating…"', async () => {
		const { unmount } = render(Page, { props: { data: unsettled('paused') } });
		expect((await screen.findByTestId('run-cost')).textContent?.trim()).toBe('Not priced yet');
		unmount();
		render(Page, { props: { data: unsettled('paused', 0.02, [row]) } });
		expect((await screen.findByTestId('run-cost')).textContent?.trim()).toBe('$0.0200 so far');
	});

	it('re-checks the server when the tab becomes visible again or the network returns', async () => {
		render(Page, { props: { data: makeData('running') } });
		pollHolder.pollNow.mockClear();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(pollHolder.pollNow).not.toHaveBeenCalled();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(pollHolder.pollNow).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new Event('online'));
		expect(pollHolder.pollNow).toHaveBeenCalledTimes(2);
	});

	it('does not poll a finished run when the tab becomes visible', async () => {
		render(Page, { props: { data: makeData('completed') } });
		pollHolder.pollNow.mockClear();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('online'));
		expect(pollHolder.pollNow).not.toHaveBeenCalled();
	});
});

describe('projects/[pid]/runs/[id] — a site sign-in failure links to its fix', () => {
	it('names the site and links the Brief page and the failed step', async () => {
		const data = makeData('failed', {
			error: 'SiteCaptureLoginError: …',
			failureClass: 'customer_input',
			failureDetail: {
				code: 'site_login_failed',
				site: 'app.example.com',
				reason: 'the sign-in page did not accept the saved login',
				message: 'prose'
			}
		}) as unknown as { run: Record<string, unknown> };
		data.run.failed_stage = 'script_draft';
		render(Page, { props: { data: data as never } });

		const failure = await screen.findByTestId('run-failure');
		expect(failure.textContent).toContain('Couldn’t sign in to app.example.com');
		expect(failure.textContent).toContain('The sign-in page did not accept the saved login.');
		const brief = screen.getByTestId('site-login-brief-link') as HTMLAnchorElement;
		expect(brief.getAttribute('href')).toBe('/projects/proj-1?section=brief');
		const rerun = screen.getByTestId('site-login-rerun-link') as HTMLAnchorElement;
		expect(rerun.getAttribute('href')).toBe('/projects/proj-1/runs/run-1/stages/script_draft');
	});

	it('shows no sign-in links for any other failure', async () => {
		render(Page, { props: { data: makeData('failed', { error: 'render exploded' }) } });
		await screen.findByTestId('run-failure');
		expect(screen.queryByTestId('site-login-brief-link')).toBeNull();
	});
});

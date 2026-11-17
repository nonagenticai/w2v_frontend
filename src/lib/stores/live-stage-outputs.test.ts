import { describe, it, expect, vi } from 'vitest';
import { LiveStageOutputs } from './live-stage-outputs.svelte';
import { ApiError } from '$lib/api/client';
import type { StageOutputResponse } from '$lib/types/runs';

function row(
	stage_name: string,
	status: StageOutputResponse['status'],
	output: Record<string, unknown> | null = null
): StageOutputResponse {
	return {
		run_id: 'run-1',
		stage_name,
		status,
		output,
		error: null,
		started_at: null,
		completed_at: null
	} as unknown as StageOutputResponse;
}

const never = () => false;
const hasOutput = (base: StageOutputResponse[]) => (n: string) =>
	base.find((r) => r.stage_name === n)?.output != null;
/** `statusOf` for a run whose stages are all finished. */
const done = () => 'completed';
/** A mutable `statusOf`, so a test can flip a stage running → completed. */
function statuses(initial: Record<string, string>) {
	const map = { ...initial };
	const statusOf = (n: string) => map[n] ?? 'pending';
	return { statusOf, set: (n: string, s: string) => (map[n] = s) };
}
const notFound = () => new ApiError(404, 'Not Found', 'stage output not found');

describe('LiveStageOutputs', () => {
	it('returns the SAME array reference until something is fetched', async () => {
		const base = [row('demo_video_gen', 'completed'), row('script_doctor', 'running')];
		const store = new LiveStageOutputs('run-1', vi.fn());

		// Identity, not deep equality: the inspector's per-stage memo depends on it.
		expect(store.merge(base)).toBe(base);
	});

	it('reveals a completed stage output that the snapshot lacks', async () => {
		const base = [row('script_doctor', 'completed', null)];
		const fetcher = vi.fn().mockResolvedValue(row('script_doctor', 'completed', { lines: [1, 2] }));
		const store = new LiveStageOutputs('run-1', fetcher);

		await store.ensure(['script_doctor'], hasOutput(base), done);

		const merged = store.merge(base);
		expect(merged).not.toBe(base);
		expect(merged[0].output).toEqual({ lines: [1, 2] });
		expect(fetcher).toHaveBeenCalledExactlyOnceWith('run-1', 'script_doctor');
	});

	it('does not refetch what the snapshot already carries', async () => {
		const base = [row('script_doctor', 'completed', { lines: [1] })];
		const fetcher = vi.fn();
		const store = new LiveStageOutputs('run-1', fetcher);

		await store.ensure(['script_doctor'], hasOutput(base), done);

		expect(fetcher).not.toHaveBeenCalled();
		// Nothing fetched ⇒ identity preserved ⇒ no needless re-render.
		expect(store.merge(base)).toBe(base);
	});

	it('attempts each stage at most once per status, including concurrently', async () => {
		const fetcher = vi.fn().mockResolvedValue(row('retention_plan', 'completed', { score: 4 }));
		const store = new LiveStageOutputs('run-1', fetcher);

		// Concurrent + repeat calls: the attempt key is marked before the await, so
		// a reviewer toggling a card open/closed cannot fan out duplicate requests.
		await Promise.all([
			store.ensure(['retention_plan'], never, done),
			store.ensure(['retention_plan'], never, done)
		]);
		await store.ensure(['retention_plan'], never, done);

		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('never re-fetches a payload read at a TERMINAL status', async () => {
		// Terminal output cannot change, so an open card must not go back to the
		// network on every live event.
		const fetcher = vi.fn().mockResolvedValue(row('retention_plan', 'completed', { score: 4 }));
		const store = new LiveStageOutputs('run-1', fetcher);
		const st = statuses({ retention_plan: 'completed' });

		await store.ensure(['retention_plan'], never, st.statusOf);
		await store.ensure(['retention_plan'], never, st.statusOf);
		st.set('retention_plan', 'failed');
		await store.ensure(['retention_plan'], never, st.statusOf);

		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('re-fetches a PARTIAL payload read while the stage was still running', async () => {
		// `record_progress` writes a partial output blob mid-run. Caching that as
		// final is the same poisoning as caching a null: the card would show the
		// half-written blob for the rest of the run.
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(row('web_design', 'running', { steps: 1 }))
			.mockResolvedValueOnce(row('web_design', 'completed', { steps: 7, done: true }));
		const store = new LiveStageOutputs('run-1', fetcher);
		const st = statuses({ web_design: 'running' });

		await store.ensure(['web_design'], never, st.statusOf);
		expect(store.merge([row('web_design', 'running')])[0].output).toEqual({ steps: 1 });

		st.set('web_design', 'completed');
		await store.ensure(['web_design'], never, st.statusOf);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(store.merge([row('web_design', 'completed')])[0].output).toEqual({
			steps: 7,
			done: true
		});
	});

	it('a 200-with-null while running still reveals the output once it lands', async () => {
		// THE production shape, and the one the first cut of this store got wrong.
		// The output row is upserted `pending` at run setup, so the endpoint never
		// 404s for a real stage — it answers 200 with `output: null`. Caching that
		// null made a finished stage read "No output recorded." for the whole run.
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(row('seo_audit_record', 'running', null))
			.mockResolvedValueOnce(row('seo_audit_record', 'completed', { artifact_url: 'x' }));
		const store = new LiveStageOutputs('run-1', fetcher);
		const st = statuses({ seo_audit_record: 'running' });

		await store.ensure(['seo_audit_record'], never, st.statusOf);
		expect(store.merge([row('seo_audit_record', 'running')])[0].output).toBeNull();

		st.set('seo_audit_record', 'completed');
		await store.ensure(['seo_audit_record'], never, st.statusOf);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(store.merge([row('seo_audit_record', 'completed')])[0].output).toEqual({
			artifact_url: 'x'
		});
	});

	it('survives a 404 and RETRIES once the stage reaches a new status', async () => {
		// The live bug: a reviewer expands a card while the stage is still running,
		// the output row does not exist yet, and the old per-stage guard remembered
		// that 404 forever — so the card read "No output recorded." for the rest of
		// the run even after the stage completed.
		const base = [row('claim_finish', 'running', null)];
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce(row('claim_finish', 'completed', { ok: true }));
		const store = new LiveStageOutputs('run-1', fetcher);
		const st = statuses({ claim_finish: 'running' });

		await expect(store.ensure(['claim_finish'], never, st.statusOf)).resolves.toBeUndefined();
		// A 404 records nothing — no output, no error, and no disturbance.
		expect(store.merge(base)).toBe(base);
		expect(store.errorFor('claim_finish')).toBeNull();
		// Repeat at the SAME status is still deduplicated.
		await store.ensure(['claim_finish'], never, st.statusOf);
		expect(fetcher).toHaveBeenCalledTimes(1);

		st.set('claim_finish', 'completed');
		await store.ensure(['claim_finish'], never, st.statusOf);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(store.merge([row('claim_finish', 'completed', null)])[0].output).toEqual({ ok: true });
	});

	it('retries a 404 taken at a TERMINAL status, which has no next status to wait for', async () => {
		// A reviewer expands a card the instant `stage_completed` lands, before the
		// output row is readable. `statusOf` is ALREADY terminal, so the "the next
		// status earns a fresh attempt" escape hatch that rescues the mid-run 404
		// can never fire — there is no next status. The attempt key stayed in
		// `#attempted` forever and the card asserted "No output recorded." for the
		// rest of the session; collapse/re-expand did not retry, only a reload did.
		const base = [row('claim_finish', 'completed', null)];
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce(row('claim_finish', 'completed', { ok: true }));
		const store = new LiveStageOutputs('run-1', fetcher);

		await expect(store.ensure(['claim_finish'], never, done)).resolves.toBeUndefined();
		// The card must not silently assert "No output recorded." — a 404 for a
		// stage that is FINISHED is anomalous (the row is upserted at run setup,
		// so a real stage answers 200/null, never 404). Say so, as the 5xx path does.
		expect(store.errorFor('claim_finish')).not.toBeNull();

		// Collapsing and re-expanding the card re-runs `ensure` at the same
		// terminal status. That must go back to the network.
		await store.ensure(['claim_finish'], never, done);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(store.merge(base)[0].output).toEqual({ ok: true });
		// A success clears the transient failure.
		expect(store.errorFor('claim_finish')).toBeNull();
	});

	it('bounds the terminal-404 retry instead of re-asking forever', async () => {
		// The `#attempted` guard exists to stop an unbounded retry. Freeing the key
		// on a terminal 404 must not reintroduce it: a stage whose row is genuinely
		// absent settles after a small fixed number of attempts.
		const fetcher = vi.fn().mockRejectedValue(notFound());
		const store = new LiveStageOutputs('run-1', fetcher);

		for (let i = 0; i < 10; i++) await store.ensure(['claim_finish'], never, done);

		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(store.errorFor('claim_finish')).not.toBeNull();
	});

	it('records a non-404 failure as an error instead of "no output"', async () => {
		const fetcher = vi.fn().mockRejectedValue(new ApiError(403, 'Forbidden', 'not your tenant'));
		const store = new LiveStageOutputs('run-1', fetcher);
		const base = [row('claim_finish', 'completed', null)];

		await expect(store.ensure(['claim_finish'], never, done)).resolves.toBeUndefined();

		expect(store.errorFor('claim_finish')).toBe('not your tenant');
		// A failed fetch must not fabricate an output nor disturb the snapshot.
		expect(store.merge(base)).toBe(base);
		expect(store.loadedStages).toEqual([]);
	});

	it('clears a recorded error when a later attempt succeeds', async () => {
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable', 'upstream down'))
			.mockResolvedValueOnce(row('claim_finish', 'completed', { ok: true }));
		const store = new LiveStageOutputs('run-1', fetcher);
		const st = statuses({ claim_finish: 'running' });

		await store.ensure(['claim_finish'], never, st.statusOf);
		expect(store.errorFor('claim_finish')).toBe('upstream down');

		st.set('claim_finish', 'completed');
		await store.ensure(['claim_finish'], never, st.statusOf);

		expect(store.errorFor('claim_finish')).toBeNull();
	});

	it('reset() drops everything so a new run cannot inherit the old one', async () => {
		const fetcher = vi.fn().mockResolvedValue(row('script_doctor', 'completed', { from: 'run-1' }));
		const store = new LiveStageOutputs('run-1', fetcher);
		await store.ensure(['script_doctor'], never, done);
		expect(store.loadedStages).toEqual(['script_doctor']);

		store.reset('run-2');

		expect(store.runId).toBe('run-2');
		expect(store.loadedStages).toEqual([]);
		// Identity restored ⇒ run B's rows are untouched by run A's payload.
		const baseB = [row('script_doctor', 'completed', null)];
		expect(store.merge(baseB)).toBe(baseB);
		// ...and the fetch is re-issued against the NEW run id.
		await store.ensure(['script_doctor'], never, done);
		expect(fetcher).toHaveBeenLastCalledWith('run-2', 'script_doctor');

		// Same id ⇒ no-op: it is called on every render pass.
		store.reset('run-2');
		expect(store.loadedStages).toEqual(['script_doctor']);
	});

	it('fetches upstream deps too, so inputs stop reading "not produced yet"', async () => {
		const fetcher = vi
			.fn()
			.mockImplementation((_r: string, s: string) =>
				Promise.resolve(row(s, 'completed', { from: s }))
			);
		const store = new LiveStageOutputs('run-1', fetcher);

		await store.ensure(['retention_plan', 'demo_video_gen', 'script_doctor'], never, done);

		expect(store.loadedStages.sort()).toEqual([
			'demo_video_gen',
			'retention_plan',
			'script_doctor'
		]);
	});

	it('keeps a genuinely null output null instead of looping', async () => {
		const base = [row('growth_bundle', 'completed', null)];
		const fetcher = vi.fn().mockResolvedValue(row('growth_bundle', 'completed', null));
		const store = new LiveStageOutputs('run-1', fetcher);

		await store.ensure(['growth_bundle'], hasOutput(base), done);
		const merged = store.merge(base);

		expect(merged[0].output).toBeNull();
		await store.ensure(['growth_bundle'], hasOutput(base), done);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('ignores empty stage names', async () => {
		const fetcher = vi.fn();
		const store = new LiveStageOutputs('run-1', fetcher);
		await store.ensure(['', ...[]], never, done);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

it('replaces a partial loader payload with the final fetched output', async () => {
	const base = [row('site_capture', 'running', { screens: [] })];
	const fetcher = vi
		.fn()
		.mockResolvedValue(
			row('site_capture', 'completed', { screens: [{ id: 'shot-000', image_url: '/screen.png' }] })
		);
	const store = new LiveStageOutputs('run-1', fetcher);
	await store.ensure(['site_capture'], never, done);
	expect(store.merge(base)[0].output).toEqual({
		screens: [{ id: 'shot-000', image_url: '/screen.png' }]
	});
});

it('discards a late fetch from a run that the user has left', async () => {
	let resolve!: (value: StageOutputResponse) => void;
	const fetcher = vi.fn(
		() =>
			new Promise<StageOutputResponse>((r) => {
				resolve = r;
			})
	);
	const store = new LiveStageOutputs('run-1', fetcher);
	const pending = store.ensure(['site_capture'], never, done);
	store.reset('run-2');
	resolve(row('site_capture', 'completed', { screens: [{ id: 'old-run' }] }));
	await pending;
	expect(store.loadedStages).toEqual([]);
});

it('bounds output fetches across overlapping requests', async () => {
	let active = 0;
	let peak = 0;
	const fetcher = vi.fn(async (_runId: string, stage: string) => {
		active++;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 1));
		active--;
		return row(stage, 'completed', { ready: true });
	});
	const store = new LiveStageOutputs('run-1', fetcher);
	await Promise.all([
		store.ensure(['one', 'two', 'three'], never, done),
		store.ensure(['four', 'five'], never, done)
	]);
	expect(peak).toBe(2);
	expect(store.loadedStages).toHaveLength(5);
});

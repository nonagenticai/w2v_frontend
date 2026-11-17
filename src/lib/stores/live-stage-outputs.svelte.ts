import { SvelteMap } from 'svelte/reactivity';
import { runs } from '$lib/api/runs';
import { ApiError } from '$lib/api/client';
import type { StageOutputResponse } from '$lib/types/runs';

/**
 * Lazily fetched stage outputs for a run page whose snapshot is stale.
 *
 * ## Why this exists
 *
 * The run page binds stage OUTPUTS to `data.run`, the SvelteKit loader snapshot
 * taken at page load, and refetches it exactly once — when the run first reaches
 * a terminal state. The live poll (`RunStatusLite`) deliberately
 * "omits ... every stage `output` blob" (see the server schema docstring), so it
 * can move a stage's status to `completed` but can never fill its output.
 *
 * The visible consequence: mid-run, a reviewer expands a stage that just went
 * green and reads **"No output recorded."**, and every downstream stage reports
 * that input as **"not produced yet"** — while the row is sitting in the
 * database. A full page reload renders it correctly. That reads as a failed
 * stage, which is the worst possible lie to tell a tester mid-demo.
 *
 * ## Why not just refetch the run
 *
 * That was tried and removed. Calling `invalidateAll()` on every stage
 * completion re-fetched the multi-MB run detail and re-rendered the whole
 * storyboard/inspector every few seconds, which froze the resource-constrained
 * CI browser ~60s into a run and hung the post-promote E2E. The page carries an
 * explicit note not to reintroduce it.
 *
 * This store fetches individual outputs without reloading the run. The
 * storyboard also uses it for completed carriers in bounded batches. `StageIOInspector` renders the
 * output (and the upstream-input summaries) only inside its `{#if expanded}`
 * branch, so the stale text is unreadable until a human opens a card. We fetch
 * exactly then, for exactly that stage and its declared upstream deps, one small
 * request each, at most once per (stage, status) — so a card opened while its
 * stage was still `running` gets exactly one more attempt when the stage
 * finishes, and never more. A run that nobody clicks issues zero extra requests,
 * so the failure mode that killed the old approach cannot recur.
 *
 * It needs no backend change: `GET /runs/{id}/stages/{stage}/output` already
 * exists and is already wired as `runs.stages.output`.
 */
export type StageOutputPayload = Record<string, unknown> | null;

/**
 * Statuses after which a stage's output can never change again.
 *
 * Load-bearing: a payload read at any OTHER status is provisional. The endpoint
 * answers 200 with `output: null` for a stage that has not written its row yet
 * (the row is upserted `pending` at run setup, so it never 404s for a real
 * stage), and a few stages call `record_progress` to write a PARTIAL blob while
 * they run. Only a terminal read may be cached as final.
 */
const TERMINAL_STAGE_STATUSES: ReadonlySet<string> = new Set([
	'completed',
	'failed',
	'skipped',
	'cancelled'
]);

/**
 * How many times a 404 taken at a TERMINAL status may be re-attempted.
 *
 * A terminal stage has no next status, so the per-(stage, status) attempt key
 * is never freed by a transition — see the 404 branch in `ensure`. This bounds
 * the retry that frees it manually, keeping the guard's anti-loop property.
 */
const MAX_TERMINAL_MISSES = 3;

type OutputFetcher = (runId: string, stageName: string) => Promise<StageOutputResponse>;

export class LiveStageOutputs {
	// Reactive: a resolved fetch must re-render the open card.
	readonly #byStage = new SvelteMap<string, StageOutputPayload>();
	// Reactive for the same reason: a load FAILURE is rendered state — the card
	// must say "could not be loaded" instead of asserting "No output recorded."
	readonly #errors = new SvelteMap<string, string>();
	// Non-reactive on purpose — an attempt is bookkeeping, not rendered state.
	// A SvelteSet would make merely *starting* a fetch invalidate every derivation
	// that reads this store, which is the re-render churn the whole design avoids.
	//
	// Keyed `${stage}@${status-at-attempt}`, NOT by stage alone. A reviewer who
	// expands a card while its stage is still `running` gets a 404 (no output row
	// exists yet); keying by stage alone remembered that forever, so the card
	// still read "No output recorded." after the stage completed 40s later — the
	// exact bug this store exists to fix, reachable by the most natural tester
	// action there is. Statuses are a small finite set and a resolved fetch is
	// recorded in `#byStage` (never re-fetched), so this cannot loop.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- deliberate: attempts must not be reactive.
	readonly #attempted = new Set<string>();
	// Stages whose payload was read at a terminal status, so it can never change
	// again. Non-reactive for the same reason as `#attempted`: bookkeeping, not
	// rendered state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- deliberate: bookkeeping must not be reactive.
	readonly #final = new Set<string>();
	// Terminal-status 404s taken per attempt key, so freeing that key (below) is a
	// BOUNDED retry and not a reintroduction of the unbounded loop `#attempted`
	// exists to prevent. Non-reactive for the same reason as `#attempted`.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- deliberate: bookkeeping must not be reactive.
	readonly #terminalMisses = new Map<string, number>();
	#activeFetches = 0;
	readonly #fetchWaiters: Array<() => void> = [];
	#runId: string;
	readonly #fetch: OutputFetcher;

	constructor(runId: string, fetcher: OutputFetcher = runs.stages.output) {
		this.#runId = runId;
		this.#fetch = fetcher;
	}

	async #fetchBounded(runId: string, name: string): Promise<StageOutputResponse> {
		if (this.#activeFetches >= 2)
			await new Promise<void>((resolve) => this.#fetchWaiters.push(resolve));
		else this.#activeFetches++;
		try {
			return await this.#fetch(runId, name);
		} finally {
			const next = this.#fetchWaiters.shift();
			if (next) next();
			else this.#activeFetches--;
		}
	}

	/** Stages resolved so far. Test/diagnostic seam. */
	get loadedStages(): string[] {
		return [...this.#byStage.keys()];
	}

	/** The run this store's payloads belong to. */
	get runId(): string {
		return this.#runId;
	}

	/**
	 * Why a stage's output could not be loaded, or null.
	 *
	 * A MID-RUN 404 does not land here: it means "not produced yet", which is an
	 * expected outcome and is retried once the stage's status changes. A 404 at a
	 * TERMINAL status does, because the stage is finished and no further status
	 * change is coming — the card must not pass that off as "No output recorded."
	 */
	errorFor(stageName: string): string | null {
		return this.#errors.get(stageName) ?? null;
	}

	/**
	 * Re-scope to a different run, discarding everything fetched for the old one.
	 *
	 * SvelteKit reuses the run page component across `/runs/A` → `/runs/B`, so
	 * without this the store kept run A's `#runId` and `merge` — keyed only on
	 * `stage_name` — pasted A's payloads onto B's rows. A no-op when the id is
	 * unchanged, so it is safe to call on every render pass.
	 */
	reset(runId: string): void {
		if (runId === this.#runId) return;
		this.#runId = runId;
		this.#byStage.clear();
		this.#errors.clear();
		this.#attempted.clear();
		this.#final.clear();
		this.#terminalMisses.clear();
	}

	/**
	 * Overlay everything fetched onto the loader snapshot.
	 *
	 * Returns the SAME array reference until something has actually been
	 * fetched. That identity guarantee is load-bearing: the inspector memoises
	 * per-stage objects to avoid re-rendering ~15 cards on every live event, and
	 * handing it a fresh array each tick would defeat exactly the optimisation
	 * that keeps long promo/website runs responsive.
	 */
	merge(base: StageOutputResponse[]): StageOutputResponse[] {
		if (this.#byStage.size === 0) return base;
		return base.map((row) => {
			// `has` — not `get() ?? row.output` — so a stage that genuinely produced
			// a null output is not re-fetched into looking unproduced forever.
			if (!this.#byStage.has(row.stage_name)) return row;
			const fetched = this.#byStage.get(row.stage_name) ?? null;
			// A terminal snapshot wins; a running snapshot may carry partial output.
			// Preserve the row identity once its payload is final:
			// and preserving identity keeps the memoised card from re-rendering.
			if (row.output != null && TERMINAL_STAGE_STATUSES.has(row.status)) return row;
			return { ...row, output: fetched } as StageOutputResponse;
		});
	}

	/**
	 * Fetch outputs for `names` that the snapshot cannot supply.
	 *
	 * `snapshotHasOutput` decides what is already known, so the store never
	 * duplicates a payload the loader already delivered (notably after the
	 * one-shot terminal refetch, when every output is present and this becomes a
	 * no-op). `statusOf` supplies each stage's CURRENT status: an attempt is
	 * remembered per (stage, status), so expanding a card mid-run costs one
	 * request while the stage is `running` and exactly one more once it reaches
	 * `completed`. Concurrent and repeat calls at the SAME status are still
	 * deduplicated — the key is marked before awaiting — and a stage whose fetch
	 * RESOLVED is never fetched again at any status.
	 *
	 * Never rejects. A 404 means the output row does not exist yet: nothing is
	 * recorded, and the next status change re-attempts. Any other failure (401,
	 * 403, 5xx, network) is recorded via `errorFor`, so the card can say the
	 * output could not be loaded rather than assert it was never produced.
	 */
	async ensure(
		names: Iterable<string>,
		snapshotHasOutput: (stageName: string) => boolean,
		statusOf: (stageName: string) => string
	): Promise<void> {
		const requestRunId = this.#runId;
		const wanted: string[] = [];
		for (const name of names) {
			if (!name) continue;
			// Only a payload fetched at a TERMINAL status is final. A payload read
			// mid-run can still change: `record_progress` writes a PARTIAL output
			// blob while some stages run, and a stage that has not written its row
			// yet answers 200 with `output: null`. Treating either as final is
			// exactly the poisoning this store exists to prevent.
			if (this.#final.has(name)) continue;
			const key = `${name}@${statusOf(name)}`;
			if (this.#attempted.has(key)) continue;
			if (snapshotHasOutput(name)) continue;
			this.#attempted.add(key);
			wanted.push(name);
		}
		if (wanted.length === 0) return;

		await Promise.all(
			wanted.map(async (name) => {
				const requestStatus = statusOf(name);
				try {
					const res = await this.#fetchBounded(requestRunId, name);
					if (this.#runId !== requestRunId) return;
					if (this.#final.has(name) && !TERMINAL_STAGE_STATUSES.has(requestStatus)) return;
					const payload = (res.output ?? null) as StageOutputPayload;
					// A later success clears an earlier transient failure.
					this.#errors.delete(name);
					if (payload === null) {
						// "Not produced yet" — record NOTHING, so the next status earns a
						// fresh attempt. Caching this null is what made the previous
						// implementation report a finished stage as "No output recorded."
						return;
					}
					this.#byStage.set(name, payload);
					if (TERMINAL_STAGE_STATUSES.has(requestStatus)) this.#final.add(name);
				} catch (err) {
					if (this.#runId !== requestRunId) return;
					if (err instanceof ApiError && err.status === 404) {
						const status = statusOf(name);
						if (!TERMINAL_STAGE_STATUSES.has(status)) {
							// Expected mid-run: the stage has not written its output row yet.
							// Recorded as nothing at all, so the attempt key for the NEXT
							// status is free and the card fills in when the stage lands.
							return;
						}
						// TERMINAL status ⇒ there is no next status, so the escape hatch
						// above can never fire. This is the card expanded the instant
						// `stage_completed` lands, before the row is readable: recording
						// nothing stranded it on "No output recorded." for the rest of the
						// session, and collapse/re-expand did not retry because the attempt
						// key was already spent. Free that key for a few more tries — each
						// driven by a re-expand or a status change, never a poll — and, like
						// the 5xx path, say the output could not be read instead of
						// asserting it was never produced. A 404 here is anomalous anyway:
						// the row is upserted at run setup, so a real stage answers 200.
						const key = `${name}@${status}`;
						const misses = (this.#terminalMisses.get(key) ?? 0) + 1;
						this.#terminalMisses.set(key, misses);
						const exhausted = misses >= MAX_TERMINAL_MISSES;
						if (!exhausted) this.#attempted.delete(key);
						this.#errors.set(
							name,
							exhausted
								? 'No output row was found for this finished stage.'
								: 'The output is not readable yet — reopen this stage to retry.'
						);
						return;
					}
					this.#errors.set(
						name,
						err instanceof ApiError
							? err.detail || `${err.status} ${err.statusText}`
							: err instanceof Error
								? err.message
								: 'Unknown error'
					);
				}
			})
		);
	}
}

import { randomId } from '$lib/utils/random-id.js';
import { ApiError } from './client.js';

/**
 * Issue a child-run-spawning POST so that a LOST RESPONSE cannot orphan the run.
 *
 * Every Studio save (reorder / apply-edits / regenerate / re-narrate) is a
 * CREATE: the orchestrator inserts a `runs` row and dispatches it before it
 * writes the response. If the response never makes it back to the browser — a
 * reset connection, a proxy/tunnel respawn, our own 30s deadline firing — the
 * child run exists and is rendering, but the tab throws into the caller's
 * `catch`, shows "Could not …", and stays on the parent. The user's work is
 * gone from their point of view while the cluster bills it.
 *
 * That is the exact shape observed in the nightly Studio specs: the DB shows the
 * child `runs` row created within a second of the click (0.15s / 0.54s), and the
 * page never left the parent's `…/studio` URL inside a 30s window — with kubectl
 * port-forward stream resets in the same second in every one of those jobs. More
 * time was never the missing ingredient; a second chance at the RESPONSE was.
 *
 * Re-sending a create is only safe if the server can tell the retry apart from a
 * new request. It can: the orchestrator always registers
 * `w2v_common`'s `IdempotencyMiddleware` (`w2v_orchestrator` `src/config.py`
 * `_wire_idempotency` sets `idempotency.enabled = True` unconditionally), which
 * caches `(status, headers, body)` per `tenant|method|path|query|key|body` for
 * 24h and replays the original 2xx verbatim. So we mint ONE key per logical save
 * and re-send it — a retry either replays the child that already exists, or (if
 * the first attempt never reached the pod) creates it for the first time. Never
 * two.
 *
 * Only a failure that produced NO HTTP STATUS is retried. An `ApiError` means the
 * server reached a verdict and returned it — a 422 "run is still rendering" is an
 * answer, not a lost response, and re-sending it just burns another round trip.
 * This is the same discriminator `uploads.ts` `isRetryablePartError` uses.
 */

/** Attempts at the spawn, including the first. */
export const SPAWN_MAX_ATTEMPTS = 3;

/**
 * Backoff before the attempt at index+1, in ms.
 *
 * The first retry is IMMEDIATE on purpose: a reset connection is already dead, so
 * waiting buys nothing and the user is staring at a spinner. The second waits long
 * enough for a proxy/tunnel to have been respawned (the pf supervisor's own budget
 * is ~1s + settle).
 */
export const SPAWN_RETRY_BACKOFF_MS = [0, 1_500];

/**
 * Did this failure leave the outcome UNKNOWN to the client?
 *
 * `ApiError` carries an HTTP status: the request reached the server and the server
 * answered. Anything else (a `TypeError: Failed to fetch`, an `AbortError` from our
 * own deadline, a severed stream) means no status was ever received.
 */
function isLostResponse(err: unknown): boolean {
	return !(err instanceof ApiError);
}

const sleep = (ms: number): Promise<void> =>
	ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * Run `attempt` until it yields a child run, retrying ONLY on a lost response and
 * always under the SAME `Idempotency-Key`.
 *
 * @param attempt receives the idempotency key to attach to the POST. It must be
 *   attached on every attempt — that header is the entire reason this is safe.
 */
export async function spawnChildRun<T>(
	attempt: (idempotencyKey: string) => Promise<T>
): Promise<T> {
	// One key per logical save, STABLE across retries (same shape as the project
	// create in `routes/projects/new/+page.svelte`). A fresh key per attempt would
	// make every retry a brand-new create — the duplicate this exists to prevent.
	// NOT `crypto.randomUUID()`: that is secure-context-only and `undefined` on the
	// plain-http origin the in-cluster E2E harness serves, where it threw HERE —
	// before `attempt` ran, so no POST was ever issued. See `randomId`.
	const idempotencyKey = randomId();

	let lastError: unknown;
	for (let i = 0; i < SPAWN_MAX_ATTEMPTS; i++) {
		try {
			return await attempt(idempotencyKey);
		} catch (err) {
			if (!isLostResponse(err)) throw err;
			lastError = err;
			if (i < SPAWN_MAX_ATTEMPTS - 1) await sleep(SPAWN_RETRY_BACKOFF_MS[i] ?? 0);
		}
	}
	throw lastError;
}

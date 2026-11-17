import { ApiError } from '$lib/api';
import { error } from '@sveltejs/kit';

/**
 * Map a failed fetch of a primary resource to a status-faithful SvelteKit error.
 * A genuine 404 → "not found"; 401 → sign in again; 403 → no permission;
 * anything else (5xx / network) is NOT a missing
 * resource — render a retryable 503 rather than mislabelling a transient backend
 * fault as gone. (Live, a transient `GET /api/runs/{id}` 503/500 was masked as
 * "Run not found", implying the run had vanished.)
 *
 * Shared by the run-monitor loaders (the run page + the stage editor child) so a
 * blip in one surfaces consistently as "temporarily unavailable" rather than a
 * false 404.
 */
export function notFoundOr503(e: unknown, label: string): never {
	if (e instanceof ApiError && e.status === 404) {
		throw error(404, `${label} not found`);
	}
	// 401/403 are NOT transient: retrying never fixes an expired session or a
	// missing permission, so "please retry" would loop the user forever.
	if (e instanceof ApiError && e.status === 401) {
		throw error(
			401,
			`Your session has expired — sign in again to view this ${label.toLowerCase()}.`
		);
	}
	if (e instanceof ApiError && e.status === 403) {
		throw error(
			403,
			`You don't have permission to view this ${label.toLowerCase()}. Ask a workspace admin for access.`
		);
	}
	throw error(503, `${label} temporarily unavailable — please retry`);
}

/**
 * Settle a SECONDARY resource without letting its failure masquerade as
 * emptiness.
 *
 * The pattern this replaces is `await thing().catch(() => empty)`: the page
 * still renders (correct — a side rail must not 500 the whole screen) but the
 * caller can no longer tell "the backend said there is nothing" from "we never
 * found out". Downstream that becomes a confident product statement — "no
 * notes", "no verbatim items", "no course blueprint is published" — about a
 * request that failed.
 *
 * `settle` keeps the graceful degradation and adds the missing bit:
 *
 *   const { data, error } = await settle(annotationsApi.list(id, stage), empty);
 *   return { annotations: data, annotationsError: error };
 *
 * DELIBERATELY NOT a discriminated union (`{ok:true}|{ok:false}`) and
 * deliberately not null-for-failure. `data` is ALWAYS the safe value, so every
 * existing consumer of the loader key compiles and behaves unchanged; loaders
 * gain a sibling `…Error` key that only the surfaces which grew an error state
 * read. That is what makes this fix landable one surface at a time instead of a
 * breaking change across every call site and test at once.
 *
 * `error` is `null` on success and ALWAYS TRUTHY on failure. That is stronger
 * than "non-null" and the difference is load-bearing: every consumer tests it
 * with `if (error)` / `{#if annotationsError}`, so a rejection carrying ANY
 * falsy value — `0`, `''`, `false`, `NaN`, as well as `null`/`undefined` — would
 * otherwise settle as a silent success and reinstate the exact bug this helper
 * exists to remove. `??` is not sufficient here; only `||` is.
 */
export async function settle<T>(p: Promise<T>, fallback: T): Promise<{ data: T; error: unknown }> {
	try {
		return { data: await p, error: null };
	} catch (e) {
		return { data: fallback, error: e || rejectionOf(e) };
	}
}

/** Stand-in for a promise that rejected with a falsy value, preserving what it
 *  actually threw so the surfaced message is still diagnosable. */
function rejectionOf(e: unknown): Error {
	return new Error(`Request failed (rejected with ${typeof e === 'string' ? '""' : String(e)})`);
}

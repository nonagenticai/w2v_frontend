import { describe, it, expect } from 'vitest';
import { ApiError } from '$lib/api';
import { notFoundOr503, settle } from './load-errors';

/**
 * The run-monitor loaders must not mislabel a transient backend fault as a
 * missing resource. A genuine 404 → 404 "not found"; any other error (5xx /
 * network) → a retryable 503, so the page shows "temporarily unavailable"
 * instead of "Run not found" (which falsely implies the resource is gone). Live
 * regression: a transient `GET /api/runs/{id}` 503/500 rendered the 404 "Run not
 * found" page on both the run page and the stage editor.
 */
describe('notFoundOr503', () => {
	function caught(fn: () => never): { status: number; message: string } {
		try {
			fn();
		} catch (e) {
			const err = e as { status: number; body?: { message?: string } };
			return { status: err.status, message: err.body?.message ?? '' };
		}
		throw new Error('expected notFoundOr503 to throw');
	}

	it('maps a genuine 404 to a 404 not-found', () => {
		const out = caught(() => notFoundOr503(new ApiError(404, 'Not Found', 'gone'), 'Run'));
		expect(out.status).toBe(404);
		expect(out.message).toContain('not found');
	});

	it('maps a 503 to a retryable 503 (not a 404)', () => {
		const out = caught(() => notFoundOr503(new ApiError(503, 'Unavailable', 'down'), 'Run'));
		expect(out.status).toBe(503);
		expect(out.message).toContain('temporarily unavailable');
	});

	it('maps a 500 to a 503, not a 404', () => {
		const out = caught(() => notFoundOr503(new ApiError(500, 'Server Error', 'boom'), 'Run'));
		expect(out.status).toBe(503);
	});

	it('maps a 401 to a sign-in message, never "please retry"', () => {
		const out = caught(() => notFoundOr503(new ApiError(401, 'Unauthorized', 'expired'), 'Run'));
		expect(out.status).toBe(401);
		expect(out.message).toMatch(/sign in/i);
		expect(out.message).not.toMatch(/retry/i);
	});

	it('maps a 403 to a permission message, never "please retry"', () => {
		const out = caught(() => notFoundOr503(new ApiError(403, 'Forbidden', 'nope'), 'Project'));
		expect(out.status).toBe(403);
		expect(out.message).toMatch(/permission/i);
		expect(out.message).not.toMatch(/retry/i);
	});

	it('maps a non-ApiError (network failure) to a 503', () => {
		const out = caught(() => notFoundOr503(new TypeError('Failed to fetch'), 'Project'));
		expect(out.status).toBe(503);
		expect(out.message).toContain('Project');
	});
});

/**
 * `settle` exists so a loader can degrade gracefully WITHOUT the page then
 * stating the degradation as a fact ("no notes", "no blueprint is published").
 * The contract that makes it safe to adopt one call site at a time: `data` is
 * always the safe value, and `error` is a sound failure test.
 */
describe('settle', () => {
	it('returns the resolved value with a null error', async () => {
		const out = await settle(Promise.resolve([1, 2]), []);
		expect(out.data).toEqual([1, 2]);
		expect(out.error).toBeNull();
	});

	it('returns the fallback AND the error when the promise rejects', async () => {
		const boom = new ApiError(500, 'Server Error', 'boom');
		const out = await settle(Promise.reject(boom), { annotations: [], total: 0 });
		// The old `.catch(() => empty)` produced exactly this `data` and nothing
		// else — which is why a 500 rendered as "no notes".
		expect(out.data).toEqual({ annotations: [], total: 0 });
		expect(out.error).toBe(boom);
	});

	// `not.toBeNull()` was the WRONG assertion here and let `e ?? …` through: 0
	// and '' are not null, so a rejection carrying them passed while every
	// consumer's `if (error)` / `{#if annotationsError}` read it as success. The
	// contract is TRUTHINESS, and each falsy value gets its own case.
	it.each([
		['undefined', undefined],
		['null', null],
		['0', 0],
		['empty string', ''],
		['false', false],
		['NaN', Number.NaN]
	])('reports a rejection carrying %s as a truthy error', async (_label, thrown) => {
		const out = await settle(Promise.reject(thrown), 'fallback');
		expect(out.data).toBe('fallback');
		expect(out.error).toBeTruthy();
		// And it stays diagnosable — the surfaced message names what was thrown.
		expect(String((out.error as Error).message)).toContain('Request failed');
	});

	it('does not swallow the fallback when the value itself is falsy', async () => {
		const out = await settle(Promise.resolve(0), -1);
		expect(out.data).toBe(0);
		expect(out.error).toBeNull();
	});
});

import { describe, it, expect, vi } from 'vitest';
import { ApiError } from './client.js';
import { spawnChildRun, SPAWN_MAX_ATTEMPTS } from './spawn-child-run.js';

/**
 * The failure this guards is NOT "the server was slow". The orchestrator DB shows
 * the child `runs` row created 0.15s / 0.54s after the Studio save click, and the
 * page still sitting on the parent 30s later — with kubectl port-forward stream
 * resets in the same second. The response was lost in transit, the create had
 * already happened, and the tab told the user it failed.
 */
describe('spawnChildRun — a lost response must not orphan a child run', () => {
	it('retries a transport failure and returns the replayed child', async () => {
		const attempt = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce({ id: 'child-1' });

		await expect(spawnChildRun(attempt)).resolves.toEqual({ id: 'child-1' });
		expect(attempt).toHaveBeenCalledTimes(2);
	});

	it('re-sends the SAME idempotency key on every attempt', async () => {
		// This is the entire reason retrying a CREATE is safe: the orchestrator's
		// IdempotencyMiddleware replays the original 2xx for a repeated key. A fresh
		// key per attempt would spawn a second run instead.
		const attempt = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockRejectedValueOnce(new Error('request_timeout'))
			.mockResolvedValueOnce({ id: 'child-1' });

		await spawnChildRun(attempt);

		const keys = attempt.mock.calls.map((c) => c[0]);
		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(1);
		expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('mints a DIFFERENT key for a different save', async () => {
		const attempt = vi.fn().mockResolvedValue({ id: 'child' });
		await spawnChildRun(attempt);
		await spawnChildRun(attempt);
		expect(attempt.mock.calls[0][0]).not.toBe(attempt.mock.calls[1][0]);
	});

	it('does NOT retry an answered request (a 422 is a verdict, not a lost response)', async () => {
		const attempt = vi
			.fn()
			.mockRejectedValue(new ApiError(422, 'Unprocessable', 'still rendering'));

		await expect(spawnChildRun(attempt)).rejects.toBeInstanceOf(ApiError);
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	it('gives up after the attempt ceiling and rethrows the last transport error', async () => {
		const boom = new TypeError('Failed to fetch');
		const attempt = vi.fn().mockRejectedValue(boom);

		await expect(spawnChildRun(attempt)).rejects.toBe(boom);
		expect(attempt).toHaveBeenCalledTimes(SPAWN_MAX_ATTEMPTS);
	});
});

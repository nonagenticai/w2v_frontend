import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

const { readyMock } = vi.hoisted(() => ({ readyMock: vi.fn() }));
vi.mock('$lib/api/health.js', () => ({
	health: { ready: readyMock }
}));

import { ApiError } from '$lib/api/client.js';
import { getHealthStatus, markBackendDown, recheckHealth } from './health.svelte.js';

describe('health store', () => {
	beforeEach(() => {
		readyMock.mockReset();
	});

	it('markBackendDown flips status to "down"', () => {
		markBackendDown();
		expect(getHealthStatus()).toBe('down');
	});

	it('returns "healthy" when readyz resolves (200 = DB + Redis reachable)', async () => {
		readyMock.mockResolvedValueOnce({ status: 'ready' });
		const next = await recheckHealth();
		expect(next).toBe('healthy');
		expect(getHealthStatus()).toBe('healthy');
	});

	it('maps a 503 (deps/proxy unavailable) to "degraded"', async () => {
		readyMock.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable', 'db unhealthy'));
		const next = await recheckHealth();
		expect(next).toBe('degraded');
		expect(getHealthStatus()).toBe('degraded');
	});

	it('maps a network/other failure to "down"', async () => {
		readyMock.mockRejectedValueOnce(new Error('NetworkError'));
		expect(await recheckHealth()).toBe('down');
		expect(getHealthStatus()).toBe('down');
	});

	it('maps a non-503 ApiError (e.g. 500) to "down"', async () => {
		readyMock.mockRejectedValueOnce(new ApiError(500, 'Internal Server Error', 'boom'));
		expect(await recheckHealth()).toBe('down');
	});
});

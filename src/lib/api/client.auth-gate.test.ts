import { beforeEach, describe, expect, it, vi } from 'vitest';

// First-paint race regression: a +page.ts load that fires while initAuth() is
// still running must AWAIT auth-ready before fetching, otherwise it sends no
// Authorization header and the orchestrator 401s. The only exception is the
// bootstrap /auth/me call (bootstrapGet), which runs *inside* initAuth and
// must skip the gate to avoid awaiting its own in-flight promise (deadlock).

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn(async () => 'tok')
}));

const { ensureAuthReadyMock } = vi.hoisted(() => ({ ensureAuthReadyMock: vi.fn() }));
vi.mock('$lib/stores/auth.svelte.js', () => ({
	ensureAuthReady: ensureAuthReadyMock
}));

import { api, bootstrapGet } from './client.js';

describe('request() auth-ready gate', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
		ensureAuthReadyMock.mockReset();
	});

	it('api.get awaits ensureAuthReady BEFORE fetching', async () => {
		let releaseAuth: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseAuth = resolve;
		});
		ensureAuthReadyMock.mockReturnValueOnce(gate);

		const pending = api.get('/projects');
		// Flush microtasks: the request is suspended on the still-pending gate,
		// so fetch must NOT have fired yet.
		await Promise.resolve();
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();

		releaseAuth();
		await pending;
		expect(ensureAuthReadyMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('bootstrapGet skips the gate (no deadlock for the in-init /auth/me call)', async () => {
		// A gate that never resolves — bootstrapGet must not await it.
		ensureAuthReadyMock.mockReturnValueOnce(new Promise<void>(() => {}));
		await bootstrapGet('/auth/me');
		expect(ensureAuthReadyMock).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

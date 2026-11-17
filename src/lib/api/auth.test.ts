import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn(),
	ensureAuthReady: vi.fn()
}));

import { auth } from './auth.js';
import { ApiError } from './client.js';

describe('auth.me() error contract', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	it('returns the user on 200', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ sub: 'u1', name: 'U' })
		});
		const user = await auth.me();
		expect(user?.sub).toBe('u1');
	});

	it('returns null on a real 401 (logged out)', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ detail: 'unauthorized' }),
			text: async () => 'unauthorized'
		});
		await expect(auth.me()).resolves.toBeNull();
	});

	it('RE-THROWS on 5xx so the caller can show a backend-down screen', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 503,
			statusText: 'Service Unavailable',
			json: async () => ({ detail: 'down' }),
			text: async () => 'down'
		});
		// Must NOT resolve to null — that would render an empty logged-in shell.
		await expect(auth.me()).rejects.toBeInstanceOf(ApiError);
	});

	it('RE-THROWS on a network failure (fetch rejects)', async () => {
		fetchMock.mockRejectedValue(new TypeError('network down'));
		await expect(auth.me()).rejects.toBeTruthy();
	});
});

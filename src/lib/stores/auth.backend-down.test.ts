import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const { meMock, markBackendDownMock } = vi.hoisted(() => ({
	meMock: vi.fn(),
	markBackendDownMock: vi.fn()
}));

vi.mock('$lib/api/auth.js', () => ({ auth: { me: meMock } }));
vi.mock('$lib/api/client.js', async () => {
	const actual: typeof import('$lib/api/client.js') = await vi.importActual('$lib/api/client.js');
	return {
		...actual,
		setLicenseToken: vi.fn(),
		setAuthToken: vi.fn(),
		clearAuthToken: vi.fn(),
		setDefaultHeader: vi.fn()
	};
});
// The leaf state module, matching auth.svelte.ts's import. auth must NOT import
// health.svelte.js — that would close an import cycle.
vi.mock('$lib/stores/health-state.svelte.js', () => ({
	markBackendDown: markBackendDownMock
}));
// fetchUser announces a queued tenant-refusal toast before it asks /auth/me
// (auth.svelte.ts `announcePendingRefusal`). That module constructs its store at
// module scope and the constructor writes the active tenant back into
// `$lib/api/client.ts` — whose `activeTenantId` is then read in its temporal dead
// zone, because this file replaces client.js with an ASYNC mock. The resulting
// ReferenceError is not an ApiError, so fetchUser (correctly) classifies it as
// "backend down" and the three "does NOT mark down" cases below fail.
//
// It only reproduced when this file ran in a worker that had not already warmed
// the module graph, which is why it passed in the full suite and failed alone.
// The switcher is unrelated to what these tests assert, so stub it out: that
// removes the path by construction instead of depending on evaluation order.
vi.mock('$lib/stores/tenant-switcher.svelte.js', () => ({
	tenantSwitcher: {
		consumeRefusedNotice: () => false,
		dropRefused: () => false,
		reconcile: () => false
	},
	REFUSED_TENANT_NOTICE: { title: '', description: '' }
}));
vi.mock('$lib/services/keycloak.js', () => ({
	getToken: () => 'fake-jwt',
	getUserInfo: () => null,
	initKeycloak: vi.fn(async () => true),
	isAuthenticated: () => true,
	isBypassed: () => false,
	keycloak: { onAuthLogout: undefined, onAuthRefreshSuccess: undefined },
	logout: vi.fn()
}));

// Stub fetch so syncAuthCookies() (called in fetchUser's finally) doesn't error.
beforeEach(() => {
	meMock.mockReset();
	markBackendDownMock.mockReset();
	(globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () => ({
		ok: true
	})) as unknown as typeof fetch;
});

import { ApiError } from '$lib/api/client.js';
import { fetchUser } from './auth.svelte.js';

describe('fetchUser BE-down propagation', () => {
	it('marks backend down when /auth/me returns 502 (ApiError 5xx)', async () => {
		meMock.mockRejectedValueOnce(new ApiError(502, 'Bad Gateway', 'upstream'));
		await fetchUser();
		expect(markBackendDownMock).toHaveBeenCalledTimes(1);
	});

	it('marks backend down when /auth/me throws a non-ApiError (network failure)', async () => {
		meMock.mockRejectedValueOnce(new Error('NetworkError'));
		await fetchUser();
		expect(markBackendDownMock).toHaveBeenCalledTimes(1);
	});

	it('does NOT mark backend down for a 401 (auth missing, not outage)', async () => {
		meMock.mockRejectedValueOnce(new ApiError(401, 'Unauthorized', 'missing token'));
		await fetchUser();
		expect(markBackendDownMock).not.toHaveBeenCalled();
	});

	it('does NOT mark backend down for a 403 (authz denied, not outage)', async () => {
		meMock.mockRejectedValueOnce(new ApiError(403, 'Forbidden', 'denied'));
		await fetchUser();
		expect(markBackendDownMock).not.toHaveBeenCalled();
	});

	it('does NOT mark backend down on success', async () => {
		meMock.mockResolvedValueOnce({
			sub: 'u',
			email: null,
			name: 'u',
			preferred_username: 'u',
			roles: [],
			license_token: null
		});
		await fetchUser();
		expect(markBackendDownMock).not.toHaveBeenCalled();
	});
});

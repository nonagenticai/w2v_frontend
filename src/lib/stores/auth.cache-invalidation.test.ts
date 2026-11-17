// Regression test for cross-user cache leak: clearUser() must invalidate
// every per-user store and clear the license token, otherwise the next
// session inherits the previous user's data.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const {
	invalidateProjectsMock,
	invalidateDraftsMock,
	invalidateVerbatimMock,
	invalidateElementsMock,
	invalidateAnnotationsMock,
	invalidateCheckpointsMock,
	clearLicenseTokenMock,
	resetWizardMock,
	kcLogoutMock
} = vi.hoisted(() => ({
	invalidateProjectsMock: vi.fn(),
	invalidateDraftsMock: vi.fn(),
	invalidateVerbatimMock: vi.fn(),
	invalidateElementsMock: vi.fn(),
	invalidateAnnotationsMock: vi.fn(),
	invalidateCheckpointsMock: vi.fn(),
	clearLicenseTokenMock: vi.fn(),
	resetWizardMock: vi.fn(),
	kcLogoutMock: vi.fn(async () => undefined)
}));

vi.mock('$lib/api/auth.js', () => ({ auth: { me: vi.fn(async () => null) } }));
vi.mock('$lib/api/client.js', async () => {
	const actual: typeof import('$lib/api/client.js') = await vi.importActual('$lib/api/client.js');
	return {
		...actual,
		setLicenseToken: vi.fn(),
		clearLicenseToken: clearLicenseTokenMock,
		setAuthToken: vi.fn(),
		clearAuthToken: vi.fn(),
		setDefaultHeader: vi.fn()
	};
});
vi.mock('$lib/stores/health.svelte.js', () => ({ markBackendDown: vi.fn() }));
vi.mock('$lib/stores/projects.svelte.js', () => ({ invalidate: invalidateProjectsMock }));
vi.mock('$lib/stores/drafts.svelte.js', () => ({ invalidate: invalidateDraftsMock }));
vi.mock('$lib/stores/verbatim.svelte.js', () => ({ invalidateAll: invalidateVerbatimMock }));
vi.mock('$lib/stores/elements.svelte.js', () => ({ invalidate: invalidateElementsMock }));
vi.mock('$lib/stores/annotations.svelte.js', () => ({ invalidate: invalidateAnnotationsMock }));
vi.mock('$lib/stores/checkpoints.svelte.js', () => ({ invalidate: invalidateCheckpointsMock }));
vi.mock('$lib/stores/wizard.svelte.js', () => ({ wizard: { resetWizard: resetWizardMock } }));
vi.mock('$lib/services/keycloak.js', () => ({
	getToken: () => undefined,
	getUserInfo: () => null,
	initKeycloak: vi.fn(async () => false),
	isAuthenticated: () => false,
	isBypassed: () => false,
	keycloak: { onAuthLogout: undefined, onAuthRefreshSuccess: undefined },
	logout: kcLogoutMock
}));

beforeEach(() => {
	invalidateProjectsMock.mockClear();
	invalidateDraftsMock.mockClear();
	invalidateVerbatimMock.mockClear();
	invalidateElementsMock.mockClear();
	invalidateAnnotationsMock.mockClear();
	invalidateCheckpointsMock.mockClear();
	clearLicenseTokenMock.mockClear();
	resetWizardMock.mockClear();
	kcLogoutMock.mockClear();
	(globalThis as { fetch?: typeof fetch }).fetch = vi.fn(async () => ({
		ok: true
	})) as unknown as typeof fetch;
});

import { clearUser } from './auth.svelte.js';

describe('clearUser flushes every per-user store', () => {
	it('calls invalidate on projects, drafts, verbatim, elements, annotations, checkpoints', async () => {
		await clearUser();
		expect(invalidateProjectsMock).toHaveBeenCalledTimes(1);
		expect(invalidateDraftsMock).toHaveBeenCalledTimes(1);
		expect(invalidateVerbatimMock).toHaveBeenCalledTimes(1);
		expect(invalidateElementsMock).toHaveBeenCalledTimes(1);
		expect(invalidateAnnotationsMock).toHaveBeenCalledTimes(1);
		expect(invalidateCheckpointsMock).toHaveBeenCalledTimes(1);
	});

	it('clears the license token so the next session does not inherit X-Tenant-Id', async () => {
		await clearUser();
		expect(clearLicenseTokenMock).toHaveBeenCalledTimes(1);
	});

	it('resets the wizard form state', async () => {
		await clearUser();
		expect(resetWizardMock).toHaveBeenCalledTimes(1);
	});

	it('still triggers Keycloak logout', async () => {
		await clearUser();
		expect(kcLogoutMock).toHaveBeenCalledTimes(1);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spy on the API-client header setter the store mirrors into. Mocking the whole
// client module also keeps the store test off the keycloak/auth import chain.
// `vi.hoisted` is required because the store's singleton calls setActiveTenantId
// at IMPORT time (its constructor hydrates the header) — a plain const would be
// in the TDZ when the hoisted mock factory runs before the import.
const { setActiveTenantIdMock } = vi.hoisted(() => ({ setActiveTenantIdMock: vi.fn() }));
vi.mock('$lib/api/client.js', () => ({
	setActiveTenantId: (id: string | null) => setActiveTenantIdMock(id)
}));

import { tenantSwitcher } from './tenant-switcher.svelte.js';

// happy-dom's Storage is not reliably writable; install a Map-backed mock.
function installLocalStorageMock(): void {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	});
}

describe('tenant-switcher store', () => {
	beforeEach(() => {
		installLocalStorageMock();
		setActiveTenantIdMock.mockClear();
		tenantSwitcher.setActive(null); // clean slate
		setActiveTenantIdMock.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('setActive(id) updates state, persists, and mirrors onto the client header', () => {
		tenantSwitcher.setActive('tenant-b');
		expect(tenantSwitcher.activeTenantId).toBe('tenant-b');
		expect(localStorage.getItem('w2v_active_tenant')).toBe('tenant-b');
		expect(setActiveTenantIdMock).toHaveBeenCalledWith('tenant-b');
	});

	it('setActive(null) clears state, removes the persisted key, and clears the header', () => {
		tenantSwitcher.setActive('tenant-b');
		setActiveTenantIdMock.mockClear();
		tenantSwitcher.setActive(null);
		expect(tenantSwitcher.activeTenantId).toBeNull();
		expect(localStorage.getItem('w2v_active_tenant')).toBeNull();
		expect(setActiveTenantIdMock).toHaveBeenCalledWith(null);
	});

	it('reconcile() drops an active tenant the caller is not a member of', () => {
		tenantSwitcher.setActive('tenant-stale');
		setActiveTenantIdMock.mockClear();
		expect(tenantSwitcher.reconcile(['tenant-a', 'tenant-b'])).toBe(true);
		expect(tenantSwitcher.activeTenantId).toBeNull();
		expect(localStorage.getItem('w2v_active_tenant')).toBeNull();
		expect(setActiveTenantIdMock).toHaveBeenCalledWith(null);
	});

	it('reconcile() keeps a membership tenant and is a no-op with nothing active', () => {
		tenantSwitcher.setActive('tenant-b');
		expect(tenantSwitcher.reconcile(['tenant-a', 'tenant-b'])).toBe(false);
		expect(tenantSwitcher.activeTenantId).toBe('tenant-b');
		tenantSwitcher.setActive(null);
		expect(tenantSwitcher.reconcile([])).toBe(false);
	});
	it('dropRefused clears the refused active tenant (no role exemption) and only that one', () => {
		tenantSwitcher.setActive('tenant-dead');
		expect(tenantSwitcher.dropRefused('tenant-other')).toBe(false);
		expect(tenantSwitcher.activeTenantId).toBe('tenant-dead');
		expect(tenantSwitcher.dropRefused('tenant-dead')).toBe(true);
		expect(tenantSwitcher.activeTenantId).toBeNull();
		expect(localStorage.getItem('w2v_active_tenant')).toBeNull();
		expect(tenantSwitcher.dropRefused('tenant-dead')).toBe(false);
	});

	it('the refused-tenant notice survives a reload exactly once', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});
		expect(tenantSwitcher.consumeRefusedNotice()).toBe(false);
		tenantSwitcher.flagRefusedNotice();
		expect(tenantSwitcher.consumeRefusedNotice()).toBe(true);
		expect(tenantSwitcher.consumeRefusedNotice()).toBe(false);
	});
});

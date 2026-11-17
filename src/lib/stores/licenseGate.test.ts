// Unit tests for the authoritative license gate store (ported from fr).
//
// We test the class directly (not the singleton) so each test gets a fresh
// instance. The api client is stubbed so handleForbidden()'s background load()
// never hits the network.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }));
vi.mock('$lib/api/client', () => ({ api: { get: apiGetMock } }));

import { LicenseGate, type LicenseStatusResponse } from './licenseGate.svelte';

function resp(over: Partial<LicenseStatusResponse>): LicenseStatusResponse {
	return {
		appKey: 'w2v',
		gateEnabled: true,
		hasLicense: true,
		state: 'active',
		expiresAt: null,
		daysRemaining: null,
		planCode: null,
		...over
	};
}

describe('LicenseGate derivations', () => {
	let gate: LicenseGate;
	beforeEach(() => {
		gate = new LicenseGate();
		apiGetMock.mockReset();
		apiGetMock.mockResolvedValue(resp({ state: 'active' }));
	});

	it('active ⇒ not blocked, not expiring', () => {
		gate.status = resp({ state: 'active' });
		expect(gate.isBlocked).toBe(false);
		expect(gate.isExpiringSoon).toBe(false);
	});

	it('expiring_soon ⇒ banner, not blocked', () => {
		gate.status = resp({
			state: 'expiring_soon',
			daysRemaining: 5,
			expiresAt: '2026-07-01T00:00:00Z'
		});
		expect(gate.isExpiringSoon).toBe(true);
		expect(gate.isBlocked).toBe(false);
		expect(gate.statusMessage).toContain('5 days');
	});

	it.each(['expired', 'revoked', 'none', 'not_onboarded'] as const)('%s ⇒ blocked', (state) => {
		gate.status = resp({ state, hasLicense: false });
		expect(gate.isBlocked).toBe(true);
	});

	it('expired ⇒ message mentions expiry', () => {
		gate.status = resp({ state: 'expired', hasLicense: false, expiresAt: '2026-06-01T00:00:00Z' });
		expect(gate.isBlocked).toBe(true);
		expect(gate.statusMessage.toLowerCase()).toContain('expired');
	});

	it('not_onboarded ⇒ blocked with the contact-your-administrator copy', () => {
		gate.status = resp({ state: 'not_onboarded', hasLicense: false });
		expect(gate.isBlocked).toBe(true);
		expect(gate.statusMessage).toBe(
			"This workspace isn't set up for Studio yet — contact your administrator."
		);
	});

	it('load() reporting not_onboarded keeps a forced block (it is not an entitled state)', async () => {
		gate.forcedBlocked = true;
		apiGetMock.mockResolvedValue(resp({ state: 'not_onboarded', hasLicense: false }));
		await gate.load();
		expect(gate.forcedBlocked).toBe(true);
		expect(gate.isBlocked).toBe(true);
	});

	it('unknown (transient upstream error) ⇒ NOT blocked', () => {
		gate.status = resp({ state: 'unknown', hasLicense: false });
		expect(gate.isBlocked).toBe(false);
	});

	it('handleForbidden() blocks immediately (before any poll resolves)', () => {
		gate.status = resp({ state: 'active' });
		expect(gate.isBlocked).toBe(false);
		gate.handleForbidden();
		expect(gate.forcedBlocked).toBe(true);
		expect(gate.isBlocked).toBe(true);
	});

	it('load() clears a stale forced-block when status reports entitled', async () => {
		gate.forcedBlocked = true;
		apiGetMock.mockResolvedValue(resp({ state: 'active' }));
		await gate.load();
		expect(gate.forcedBlocked).toBe(false);
		expect(gate.state).toBe('active');
	});

	it('load() never throws on a network error', async () => {
		apiGetMock.mockRejectedValue(new Error('boom'));
		await expect(gate.load()).resolves.toBeUndefined();
	});
});

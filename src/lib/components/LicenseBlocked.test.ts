import { describe, it, expect, vi, beforeEach } from 'vitest';

// The block screen for a workspace that is not onboarded to w2v must not offer a
// licence renewal (there is nothing to buy) — only the administrator message and
// Log out. Purchasable states keep the Renew CTA.

const { gateState } = vi.hoisted(() => ({
	gateState: { state: 'expired' as string, statusMessage: '' }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/services/keycloak', () => ({ logout: vi.fn() }));
vi.mock('$lib/stores/licenseGate.svelte', () => ({
	licenseGate: gateState,
	LICENSE_RENEW_URL: '/license-upgrade'
}));

import { render, screen } from '@testing-library/svelte';
import LicenseBlocked from './LicenseBlocked.svelte';

describe('LicenseBlocked', () => {
	beforeEach(() => {
		gateState.state = 'expired';
		gateState.statusMessage = 'Your license has expired.';
	});

	it('not_onboarded: administrator copy, Log out only, no Renew', () => {
		gateState.state = 'not_onboarded';
		gateState.statusMessage =
			"This workspace isn't set up for Studio yet — contact your administrator.";
		render(LicenseBlocked);
		expect(screen.getByRole('heading', { name: 'Workspace not set up' })).toBeTruthy();
		expect(
			screen.getByText("This workspace isn't set up for Studio yet — contact your administrator.")
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: /renew/i })).toBeNull();
		expect(screen.queryByText(/renew to restore access/i)).toBeNull();
		expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
	});

	it('expired: keeps the Renew CTA', () => {
		render(LicenseBlocked);
		expect(screen.getByRole('heading', { name: 'License expired' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Renew license' })).toBeTruthy();
	});
});

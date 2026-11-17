import { describe, it, expect, vi, beforeEach } from 'vitest';

const { limitsGet } = vi.hoisted(() => ({ limitsGet: vi.fn() }));
vi.mock('$lib/api/tenant-limits.js', async () => {
	const actual: typeof import('$lib/api/tenant-limits.js') = await vi.importActual(
		'$lib/api/tenant-limits.js'
	);
	return { ...actual, tenantLimits: { get: limitsGet } };
});

import { render, screen } from '@testing-library/svelte';
import Card from './TenantLimitsCard.svelte';

const LIMITS = [
	{
		key: 'licence.quota_monthly',
		source: 'licence',
		value: null,
		unit: 'requests per month',
		enforced: false,
		note: 'Not enforced: w2v never checks it before starting a run.'
	},
	{
		key: 'provider.byo_required',
		source: 'provider_policy',
		value: ['tts'],
		unit: 'slots',
		enforced: true,
		enforced_at: 'run start (slot pinning) and slot resolution',
		note: 'Slots this tenant must configure itself.'
	},
	{
		key: 'provider.test_rate_limit',
		source: 'provider_policy',
		value: 0,
		unit: 'live provider tests per 60s',
		enforced: false,
		enforced_at: null,
		note: 'Disabled by the operator (limit 0).'
	}
];

beforeEach(() => vi.clearAllMocks());

describe('TenantLimitsCard', () => {
	it('labels each limit with the enforced flag the API returns — never implies a cap that is not enforced', async () => {
		limitsGet.mockResolvedValue({
			tenant_id: 't',
			licence_lookup: 'ok',
			plan_code: 'starter',
			limits: LIMITS
		});
		render(Card);
		const rows = await screen.findAllByTestId('tenant-limit-row');
		expect(rows).toHaveLength(3);
		const flags = screen
			.getAllByTestId('tenant-limit-enforced')
			.map((el) => [el.closest('li')?.dataset.key, el.dataset.enforced, el.textContent?.trim()]);
		expect(flags).toEqual([
			['licence.quota_monthly', 'false', 'Not enforced'],
			['provider.byo_required', 'true', 'Enforced'],
			['provider.test_rate_limit', 'false', 'Not enforced']
		]);
		expect(rows[0].textContent).toContain('Not set'); // null value
		expect(rows[1].textContent).toContain('tts');
		expect(rows[1].textContent).toContain('Enforced at: run start');
		expect(rows[2].textContent).not.toContain('Enforced at');
		expect(screen.getByTestId('tenant-limits-licence').textContent).toContain('starter');
		// Read-only: nothing to edit.
		expect(document.querySelector('input, select, textarea')).toBeNull();
	});

	it('says when the licence plan could not be read', async () => {
		limitsGet.mockResolvedValue({
			tenant_id: 't',
			licence_lookup: 'unavailable',
			limits: LIMITS
		});
		render(Card);
		expect(await screen.findByTestId('tenant-limits-licence')).toHaveTextContent(
			'licence limits are unknown'
		);
		const rows = screen.getAllByTestId('tenant-limit-row');
		expect(rows[0].textContent).toContain('Unknown'); // the licence row, value null
		expect(rows[0].textContent).not.toContain('Not set');
	});
});

import { describe, it, expect } from 'vitest';
import {
	COST_UNAVAILABLE_LABEL,
	costUnavailableReasonText,
	formatCost,
	usageAttribution
} from './cost';

describe('formatCost', () => {
	it('formats a known cost with the requested precision', () => {
		expect(formatCost(1.5)).toEqual({ text: '$1.5000', unavailable: false, title: undefined });
		expect(formatCost(1.5, 'ok', null, { digits: 2 }).text).toBe('$1.50');
	});

	it('renders a genuine zero as $0 when the status is ok', () => {
		expect(formatCost(0, 'ok').text).toBe('$0.0000');
	});

	it("renders status 'unavailable' as Cost unavailable with the reason as title", () => {
		const d = formatCost(null, 'unavailable', 'billing_credential_missing');
		expect(d.text).toBe(COST_UNAVAILABLE_LABEL);
		expect(d.unavailable).toBe(true);
		expect(d.title).toMatch(/no billing credential/);
	});

	it("never renders a figure when status is 'unavailable', even if one is present", () => {
		const d = formatCost(0, 'unavailable', 'billing_credential_missing');
		expect(d.text).toBe(COST_UNAVAILABLE_LABEL);
		expect(d.text).not.toContain('$');
	});

	it('treats a null/undefined/NaN figure as unknown, not zero, and does not throw', () => {
		for (const v of [null, undefined, Number.NaN]) {
			const d = formatCost(v as number | null | undefined);
			expect(d.text).toBe(COST_UNAVAILABLE_LABEL);
			expect(d.title).toBe('No cost figure was reported.');
		}
	});

	it('appends a lower bound to the tooltip when given', () => {
		const d = formatCost(null, 'unavailable', 'billing_credential_missing', { lowerBound: 2 });
		expect(d.title).toContain('at least $2.0000');
	});
});

describe('costUnavailableReasonText', () => {
	it('maps known codes and shows unknown codes verbatim', () => {
		expect(costUnavailableReasonText('billing_credential_missing')).toMatch(
			/no billing credential/
		);
		expect(costUnavailableReasonText('something_new')).toContain('something_new');
		expect(costUnavailableReasonText(null)).toBe('The cost could not be read from billing.');
	});
});

describe('usageAttribution', () => {
	it('names the tenant connection version when both fields are set', () => {
		expect(usageAttribution({ connection_id: 'c-1', connection_version: 4 })).toBe(
			'tenant connection v4'
		);
	});

	it('is platform when the connection fields are null, absent, or half-set', () => {
		expect(usageAttribution({ connection_id: null, connection_version: null })).toBe('platform');
		expect(usageAttribution({})).toBe('platform');
		expect(usageAttribution({ connection_id: 'c-1', connection_version: null })).toBe('platform');
	});
});

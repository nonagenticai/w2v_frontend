import { describe, it, expect, vi, beforeEach } from 'vitest';

const usageMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: { usage: (...a: unknown[]) => usageMock(...a) }
}));
const { limitsGet } = vi.hoisted(() => ({ limitsGet: vi.fn() }));
vi.mock('$lib/api/tenant-limits.js', async () => {
	const actual: typeof import('$lib/api/tenant-limits.js') = await vi.importActual(
		'$lib/api/tenant-limits.js'
	);
	return { ...actual, tenantLimits: { get: limitsGet } };
});

import { render, screen, fireEvent, within } from '@testing-library/svelte';
import Page from './+page.svelte';

const FULL = {
	tenant_id: 'tenant-1',
	cost_status: 'ok',
	totals: {
		run_count: 3,
		project_count: 2,
		input_tokens: 300,
		output_tokens: 150,
		cost_usd: 5.5
	},
	by_type: [
		{ type: 'course', run_count: 1, cost_usd: 3.0, input_tokens: 200, output_tokens: 100 },
		{ type: 'promo', run_count: 2, cost_usd: 2.5, input_tokens: 100, output_tokens: 50 }
	],
	by_stage: [
		{ stage_name: 'script', call_count: 2, cost_usd: 5.0, input_tokens: 300, output_tokens: 150 },
		{ stage_name: 'narrate', call_count: 1, cost_usd: 0.5, input_tokens: 0, output_tokens: 0 }
	],
	by_model: [
		{
			model: 'gpt',
			provider: 'openai',
			call_count: 2,
			cost_usd: 5.0,
			input_tokens: 300,
			output_tokens: 150
		},
		{ model: null, provider: null, call_count: 1, cost_usd: 0.5, input_tokens: 0, output_tokens: 0 }
	],
	time_series: [
		{ bucket: '2026-06-13', cost_usd: 1.5, input_tokens: 10, output_tokens: 5 },
		{ bucket: '2026-06-15', cost_usd: 4.0, input_tokens: 290, output_tokens: 145 }
	]
};

beforeEach(() => {
	vi.clearAllMocks();
	limitsGet.mockResolvedValue({
		tenant_id: 'tenant-1',
		licence_lookup: 'ok',
		plan_code: 'pro',
		limits: [
			{
				key: 'licence.quota_monthly',
				source: 'licence',
				value: 1000,
				unit: 'requests per month',
				enforced: false,
				note: 'Not enforced: w2v never checks it before starting a run.'
			}
		]
	});
});

describe('(tenant)/usage page — P6 per-user / per-slot breakdowns + limits', () => {
	it('renders by-user (incl. removed + unattributed) and by-slot rows, and the limits card', async () => {
		usageMock.mockResolvedValue({
			...FULL,
			by_user: [
				{
					subject_id: 'u-1',
					email: 'ann@example.com',
					member_status: 'active',
					label: 'ann@example.com',
					call_count: 2,
					cost_usd: 4.0,
					input_tokens: 200,
					output_tokens: 100
				},
				{
					subject_id: 'u-2',
					email: 'bob@example.com',
					member_status: 'removed',
					label: 'bob@example.com',
					call_count: 1,
					cost_usd: 1.0,
					input_tokens: 100,
					output_tokens: 50
				},
				{
					subject_id: null,
					label: 'unattributed',
					call_count: 1,
					cost_usd: 0.5,
					input_tokens: 0,
					output_tokens: 0
				}
			],
			by_slot: [
				{
					slot: 'tts',
					funding: 'tenant_byo',
					call_count: 3,
					cost_usd: 0.2,
					input_tokens: 0,
					output_tokens: 0,
					units: { chars: 1200 }
				},
				{
					slot: 'platform',
					funding: 'unattributed',
					call_count: 4,
					cost_usd: 5.3,
					input_tokens: 300,
					output_tokens: 150,
					units: {}
				}
			]
		});
		render(Page);

		const byUser = await screen.findByTestId('usage-by-user');
		expect(within(byUser).getAllByTestId('usage-by-user-row')).toHaveLength(3);
		expect(byUser.textContent).toContain('ann@example.com');
		expect(byUser.textContent).toContain('(removed member)');
		expect(byUser.textContent).toContain('unattributed');
		expect(byUser.textContent).toContain('$4.0000');

		const bySlot = screen.getByTestId('usage-by-slot');
		expect(bySlot.textContent).toContain('tts');
		expect(bySlot.textContent).toContain('Your provider');
		expect(bySlot.textContent).toContain('1,200 chars');

		const limits = await screen.findByTestId('tenant-limits');
		expect(limits.textContent).toContain('Monthly request quota');
		expect(limits.textContent).toContain('Not enforced');
	});

	it('an orchestrator without the P6 keys shows empty breakdowns, not a crash', async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);
		expect(await screen.findByTestId('usage-by-user-empty')).toBeTruthy();
		expect(screen.getByTestId('usage-by-slot-empty')).toBeTruthy();
	});

	it('a limits failure does not hide usage', async () => {
		usageMock.mockResolvedValue(FULL);
		limitsGet.mockRejectedValue(new Error('licences down'));
		render(Page);
		expect(await screen.findByTestId('usage-totals')).toBeTruthy();
		expect(await screen.findByText("Couldn't load limits")).toBeTruthy();
	});
});

describe('(tenant)/usage page', () => {
	it('renders totals + the three breakdown tables once /admin/usage resolves', async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);

		const totals = await screen.findByTestId('usage-totals');
		expect(totals.textContent).toContain('2'); // projects
		expect(totals.textContent).toContain('3'); // runs
		expect(totals.textContent).toContain('$5.5000'); // total cost

		const byType = screen.getByTestId('usage-by-type');
		expect(byType.textContent).toContain('course');
		expect(byType.textContent).toContain('promo');
		expect(byType.textContent).toContain('$3.0000');

		const byStage = screen.getByTestId('usage-by-stage');
		expect(byStage.textContent).toContain('script');
		expect(byStage.textContent).toContain('narrate');

		const byModel = screen.getByTestId('usage-by-model');
		expect(byModel.textContent).toContain('gpt');
		expect(byModel.textContent).toContain('—'); // null model fallback

		// Cost-over-time chart renders one bar per bucket.
		const series = screen.getByTestId('usage-timeseries');
		expect(series.querySelectorAll('[data-testid="usage-bar"]').length).toBe(2);
		expect(series.textContent).toContain('2026-06-13'); // first label
		expect(series.textContent).toContain('2026-06-15'); // last label
		// The caption states the window is page-wide (not chart-only).
		expect(screen.getByText(/applies to every figure on this page/)).toBeTruthy();
		// The page-wide window selector lives in the header.
		expect(screen.getByTestId('usage-window')).toBeTruthy();
		// Mounts with the bounded defaults: daily, last 30 days.
		expect(usageMock).toHaveBeenCalledTimes(1);
		expect(usageMock).toHaveBeenCalledWith({ bucket: 'day', windowDays: 30 });
	});

	it('renders an unavailable total as "Cost unavailable" (reason in title) plus a partial-figures notice', async () => {
		usageMock.mockResolvedValue({
			...FULL,
			cost_status: 'unavailable',
			cost_unavailable_reason: 'billing_credential_missing'
		});
		render(Page);

		const totals = await screen.findByTestId('usage-totals');
		expect(totals.textContent).toContain('Cost unavailable');
		expect(totals.textContent).not.toContain('$5.5000');
		const dd = Array.from(totals.querySelectorAll('dd')).find((d) =>
			d.textContent?.includes('Cost unavailable')
		)!;
		expect(dd.getAttribute('title')).toMatch(/no billing credential/);
		const notice = screen.getByTestId('usage-cost-unavailable');
		expect(notice.textContent).toMatch(/incomplete/);
	});

	it('shows no unavailable notice when the cost status is ok', async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);
		await screen.findByTestId('usage-totals');
		expect(screen.queryByTestId('usage-cost-unavailable')).toBeNull();
	});

	it('refetches with the new window when the window selector changes', async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);
		await screen.findByTestId('usage-timeseries');

		const windowSelect = within(screen.getByTestId('usage-window')).getByRole('combobox');
		await fireEvent.change(windowSelect, { target: { value: '7' } });
		await vi.waitFor(() =>
			expect(usageMock).toHaveBeenCalledWith({ bucket: 'day', windowDays: 7 })
		);
	});

	it("maps 'All time' (empty value) to windowDays null", async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);
		await screen.findByTestId('usage-timeseries');

		// First change off the default goes straight to All time (value '').
		const windowSelect = within(screen.getByTestId('usage-window')).getByRole('combobox');
		await fireEvent.change(windowSelect, { target: { value: '' } });
		await vi.waitFor(() =>
			expect(usageMock).toHaveBeenCalledWith({ bucket: 'day', windowDays: null })
		);
	});

	it('refetches with the new bucket when the bucket selector changes', async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);
		await screen.findByTestId('usage-timeseries');

		const bucketSelect = within(screen.getByTestId('usage-bucket')).getByRole('combobox');
		await fireEvent.change(bucketSelect, { target: { value: 'month' } });
		await vi.waitFor(() =>
			expect(usageMock).toHaveBeenCalledWith({ bucket: 'month', windowDays: 30 })
		);
	});

	it('shows the empty state when the tenant has no runs', async () => {
		usageMock.mockResolvedValue({
			tenant_id: 'tenant-1',
			totals: {
				run_count: 0,
				project_count: 0,
				input_tokens: 0,
				output_tokens: 0,
				cost_usd: 0
			},
			by_type: [],
			by_stage: [],
			by_model: [],
			time_series: []
		});
		render(Page);

		const empty = await screen.findByText('No usage recorded yet');
		expect(empty).toBeTruthy();
		expect(screen.queryByTestId('usage-totals')).toBeNull();
		expect(screen.getByRole('link', { name: 'New project' }).getAttribute('href')).toBe(
			'/projects/new'
		);
	});

	it('shows an error state when /admin/usage fails', async () => {
		usageMock.mockRejectedValue(new Error('boom'));
		render(Page);

		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load usage");
	});

	// REGRESSION: `onRetry={loadUsage}` handed the click's MouseEvent straight
	// into `loadUsage`'s first positional param (`b = bucket`), which then went
	// out as the `bucket` query param. Retry re-issued a DIFFERENT, broken
	// request; the failed one was never retried.
	it('Retry re-issues the request with the ORIGINAL bucket, not a MouseEvent', async () => {
		usageMock.mockRejectedValue(new Error('boom'));
		render(Page);
		await screen.findByTestId('error-state');

		usageMock.mockClear();
		usageMock.mockResolvedValue(FULL);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() => expect(usageMock).toHaveBeenCalledTimes(1));
		// Deep-equal: a MouseEvent in `bucket` fails this outright.
		expect(usageMock).toHaveBeenCalledWith({ bucket: 'day', windowDays: 30 });
		const arg = usageMock.mock.calls[0][0] as { bucket: unknown };
		expect(typeof arg.bucket).toBe('string');
		await screen.findByTestId('usage-totals');
	});

	it('Retry preserves a non-default window selected before the failure', async () => {
		usageMock.mockResolvedValue(FULL);
		render(Page);
		await screen.findByTestId('usage-timeseries');

		usageMock.mockRejectedValue(new Error('boom'));
		const windowSelect = within(screen.getByTestId('usage-window')).getByRole('combobox');
		await fireEvent.change(windowSelect, { target: { value: '7' } });
		await screen.findByTestId('error-state');

		usageMock.mockClear();
		usageMock.mockResolvedValue(FULL);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() =>
			expect(usageMock).toHaveBeenCalledWith({ bucket: 'day', windowDays: 7 })
		);
	});
});

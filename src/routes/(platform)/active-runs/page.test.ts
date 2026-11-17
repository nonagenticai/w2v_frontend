import { describe, it, expect, vi, beforeEach } from 'vitest';

const runsMock = vi.fn();

vi.mock('$lib/api', () => ({
	admin: {
		runs: (...a: unknown[]) => runsMock(...a)
	}
}));

import { render, screen, fireEvent } from '@testing-library/svelte';
import Page from './+page.svelte';

const item = (over: Record<string, unknown> = {}) => ({
	run_id: 'run-1',
	tenant_id: 'tenant-aaa',
	project_id: 'proj-1',
	project_title: 'Promo for Acme',
	deliverable_id: 'deliv-1',
	blueprint_id: 'generic_v1',
	status: 'running',
	current_stage: 'narrate',
	started_at: '2026-06-29T10:00:00Z',
	created_at: '2026-06-29T10:00:00Z',
	updated_at: '2026-06-29T10:00:00Z',
	lease_present: true,
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('(platform)/active-runs page', () => {
	it('lists running runs across tenants with project title + stage', async () => {
		runsMock.mockResolvedValue({
			items: [
				item(),
				item({ run_id: 'run-2', tenant_id: 'tenant-bbb', status: 'pending', lease_present: null })
			],
			total: 2
		});
		render(Page);

		const rows = await screen.findAllByTestId('run-row');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('Promo for Acme');
		expect(rows[0].textContent).toContain('narrate');
		expect(rows[0].textContent).toContain('tenant-aaa');
		expect(runsMock).toHaveBeenCalledWith({ status: 'running' });
	});

	it('shows a live badge for a leased run and an orphan badge when the lease is gone', async () => {
		runsMock.mockResolvedValue({
			items: [
				item({ run_id: 'live', lease_present: true }),
				item({ run_id: 'orphan', lease_present: false })
			],
			total: 2
		});
		render(Page);

		await screen.findAllByTestId('run-row');
		expect(screen.getByTestId('live-badge')).toBeTruthy();
		expect(screen.getByTestId('orphan-badge')).toBeTruthy();
		expect(screen.getByTestId('orphan-summary').textContent).toContain('1 orphaned');
	});

	// REGRESSION (run 01a1770d, 2026-10-26/27): a run parked at a storyboard review
	// gate sat in this pane for 29h as a neutral "paused" pill aged from started_at —
	// indistinguishable from a 29h-old run that was stuck executing — and was
	// cancelled as stuck. A paused row must say it needs review, and for how long,
	// from paused_at.
	it('shows a checkpoint-paused row as Needs review, aged from when it paused', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-27T12:10:51Z'));
		try {
			runsMock.mockResolvedValue({
				items: [
					item({
						run_id: 'gate',
						status: 'paused',
						current_stage: 'promo_storyboard',
						// Started 29h ago, but it only began waiting 25 minutes ago.
						started_at: '2026-10-26T07:12:10Z',
						paused_at: '2026-10-27T11:45:51Z',
						pause_reason: 'checkpoint',
						lease_present: null
					})
				],
				total: 1
			});
			render(Page);
			const [row] = await screen.findAllByTestId('run-row');
			expect(row.querySelector('[data-testid="run-status"]')?.textContent?.trim()).toBe(
				'Needs review'
			);
			expect(row.querySelector('[data-testid="run-age"]')?.textContent?.trim()).toBe(
				'since 25m ago'
			);
			expect(screen.queryByTestId('orphan-badge')).toBeNull();
			expect(screen.queryByTestId('live-badge')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	// A run someone paused (POST /runs/{id}/pause) has nothing to review.
	it('shows a manually paused row as Paused, never Needs review', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-27T12:10:51Z'));
		try {
			runsMock.mockResolvedValue({
				items: [
					item({
						status: 'paused',
						paused_at: '2026-10-27T12:00:51Z',
						pause_reason: 'manual',
						lease_present: null
					})
				],
				total: 1
			});
			render(Page);
			const [row] = await screen.findAllByTestId('run-row');
			expect(row.querySelector('[data-testid="run-status"]')?.textContent?.trim()).toBe('Paused');
			expect(row.textContent).not.toMatch(/review/i);
			expect(row.querySelector('[data-testid="run-age"]')?.textContent?.trim()).toBe(
				'since 10m ago'
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ages a paused row from started_at when the orchestrator sends no paused_at', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-27T12:10:51Z'));
		try {
			runsMock.mockResolvedValue({
				items: [item({ status: 'paused', started_at: '2026-10-26T07:12:10Z' })],
				total: 1
			});
			render(Page);
			const [row] = await screen.findAllByTestId('run-row');
			expect(row.querySelector('[data-testid="run-age"]')?.textContent?.trim()).toBe('1d ago');
		} finally {
			vi.useRealTimers();
		}
	});

	it('switches to the recent view (terminal runs)', async () => {
		runsMock.mockResolvedValue({ items: [], total: 0 });
		render(Page);
		await screen.findByText('Nothing in flight');

		await fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
		expect(runsMock).toHaveBeenCalledWith({ status: 'recent' });
	});

	it('shows the empty state when nothing is running', async () => {
		runsMock.mockResolvedValue({ items: [], total: 0 });
		render(Page);
		expect(await screen.findByText('Nothing in flight')).toBeTruthy();
		expect(screen.queryByTestId('run-row')).toBeNull();
	});

	it('shows an error state when /admin/runs fails', async () => {
		runsMock.mockRejectedValue(new Error('nope'));
		render(Page);
		const err = await screen.findByTestId('error-state');
		expect(err.textContent).toContain("Couldn't load runs");
	});

	// REGRESSION: the 5s silent refresh shared `error` with the initial load, so a
	// single transient 502 replaced a working live run table with the full-page
	// error state. The last good rows must survive a failed refresh.
	//
	// Real timers on purpose: the page's poll lives in a Svelte `$effect`, and
	// driving it with vi.useFakeTimers() deadlocks against the effect scheduler.
	// One real 5s tick is the honest way to exercise the actual interval.
	it('keeps previously-loaded rows on screen when a silent refresh fails', async () => {
		runsMock.mockResolvedValue({ items: [item()], total: 1 });
		render(Page);
		await vi.waitFor(() => expect(screen.queryAllByTestId('run-row')).toHaveLength(1));

		// The next (silent, interval-driven) refresh blows up.
		runsMock.mockRejectedValue(new Error('502 Bad Gateway'));
		await vi.waitFor(() => expect(runsMock).toHaveBeenCalledTimes(2), { timeout: 15000 });
		// ...and the failure is surfaced non-destructively.
		await vi.waitFor(() => expect(screen.queryByTestId('refresh-error')).not.toBeNull());

		// Rows survive; the page did NOT flip to the destructive error state.
		expect(screen.queryAllByTestId('run-row')).toHaveLength(1);
		expect(screen.getByTestId('runs-list').textContent).toContain('Promo for Acme');
		expect(screen.queryByTestId('error-state')).toBeNull();
	}, 30000);

	it('clears the refresh-failed badge once a later silent refresh succeeds', async () => {
		runsMock.mockResolvedValue({ items: [item()], total: 1 });
		render(Page);
		await vi.waitFor(() => expect(screen.queryAllByTestId('run-row')).toHaveLength(1));

		runsMock.mockRejectedValue(new Error('502 Bad Gateway'));
		await vi.waitFor(() => expect(screen.queryByTestId('refresh-error')).not.toBeNull(), {
			timeout: 15000
		});

		runsMock.mockResolvedValue({ items: [item()], total: 1 });
		await vi.waitFor(() => expect(screen.queryByTestId('refresh-error')).toBeNull(), {
			timeout: 15000
		});
		expect(screen.queryAllByTestId('run-row')).toHaveLength(1);
	}, 30000);

	it('still shows the full error state when the FOREGROUND load fails', async () => {
		runsMock.mockRejectedValue(new Error('nope'));
		render(Page);
		expect(await screen.findByTestId('error-state')).toBeTruthy();
		expect(screen.queryByTestId('refresh-error')).toBeNull();
	});
});

// The age must keep moving while the pane stays open. On the RECENT view nothing
// refetches, so only the shared clock can move it — a fixed render-time Date.now()
// would freeze it and fail here.
describe('(platform)/active-runs page — ages tick', () => {
	it('advances a paused row age as time passes, with no refetch', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
		vi.setSystemTime(new Date('2026-10-27T12:10:51Z'));
		try {
			runsMock.mockResolvedValue({ items: [], total: 0 });
			render(Page);
			await screen.findByText('Nothing in flight');
			runsMock.mockResolvedValue({
				items: [
					item({
						run_id: 'gate',
						status: 'paused',
						paused_at: '2026-10-27T11:45:51Z',
						pause_reason: 'checkpoint',
						lease_present: null
					})
				],
				total: 1
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
			const [row] = await screen.findAllByTestId('run-row');
			const age = () => row.querySelector('[data-testid="run-age"]')?.textContent?.trim();
			expect(age()).toBe('since 25m ago');
			const calls = runsMock.mock.calls.length;

			await vi.advanceTimersByTimeAsync(10 * 60_000);
			expect(age()).toBe('since 35m ago');
			expect(runsMock.mock.calls.length).toBe(calls); // the clock moved it, not a refetch
		} finally {
			vi.useRealTimers();
		}
	});
});

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import JobStatusBadge from './JobStatusBadge.svelte';

describe('JobStatusBadge', () => {
	it('renders a distinct "Skipped" state (not relabelled to Cancelled)', () => {
		const { getByText, queryByText } = render(JobStatusBadge, { status: 'skipped' });
		expect(getByText('Skipped')).toBeTruthy();
		expect(queryByText('Cancelled')).toBeNull();
	});

	it('still renders the run/pipeline states', () => {
		expect(render(JobStatusBadge, { status: 'completed' }).getByText('Completed')).toBeTruthy();
		expect(render(JobStatusBadge, { status: 'cancelled' }).getByText('Cancelled')).toBeTruthy();
		expect(render(JobStatusBadge, { status: 'running' }).getByText('Running')).toBeTruthy();
	});

	it('relabels a degraded completed run as "Completed with warnings"', () => {
		const { getByText, queryByText } = render(JobStatusBadge, {
			status: 'completed',
			degraded: true
		});
		expect(getByText('Completed with warnings')).toBeTruthy();
		expect(queryByText('Completed', { exact: true })).toBeNull();
	});

	it('ignores degraded for a clean completed run and for non-completed states', () => {
		expect(
			render(JobStatusBadge, { status: 'completed', degraded: false }).getByText('Completed')
		).toBeTruthy();
		// degraded only applies to a completed item — a running run is unaffected
		expect(
			render(JobStatusBadge, { status: 'running', degraded: true }).getByText('Running')
		).toBeTruthy();
	});

	// The run page's header badge said "Paused" for a run waiting at a review gate,
	// while the banner below it said "Needs review". One word per state.
	it.each([
		['checkpoint', 'Needs review'],
		['manual', 'Paused'],
		['unknown', 'Paused'],
		[null, 'Paused']
	] as const)('labels a %s pause "%s"', (pauseReason, label) => {
		const { container } = render(JobStatusBadge, { status: 'paused', pauseReason });
		expect(container.textContent?.trim()).toBe(label);
	});
});

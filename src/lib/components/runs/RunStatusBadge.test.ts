import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import RunStatusBadge from './RunStatusBadge.svelte';

describe('RunStatusBadge', () => {
	it('relabels a degraded completed run as "Completed with warnings"', () => {
		const { getByText, queryByText } = render(RunStatusBadge, {
			status: 'completed',
			degraded: true
		});
		expect(getByText('Completed with warnings')).toBeTruthy();
		// The bare status must NOT still be shown — that was the bug: a run list
		// rendered a clean "completed" for a run that soft-failed a stage.
		expect(queryByText('completed', { exact: true })).toBeNull();
	});

	it('leaves a clean completed run untouched', () => {
		const { getByText, queryByText } = render(RunStatusBadge, {
			status: 'completed',
			degraded: false
		});
		expect(getByText('Completed')).toBeTruthy();
		expect(queryByText('Completed with warnings')).toBeNull();
	});

	it('defaults to the clean label when degraded is not supplied', () => {
		const { getByText } = render(RunStatusBadge, { status: 'completed' });
		expect(getByText('Completed')).toBeTruthy();
	});

	it('ignores degraded for non-completed states', () => {
		for (const [status, label] of [
			['running', 'Running'],
			['failed', 'Failed'],
			['paused', 'Paused'],
			['cancelled', 'Cancelled'],
			['pending', 'Pending']
		] as const) {
			const { getByText, queryByText } = render(RunStatusBadge, { status, degraded: true });
			expect(getByText(label)).toBeTruthy();
			expect(queryByText('Completed with warnings')).toBeNull();
		}
	});

	// One word per state on every surface: a checkpoint pause "Needs review"; a run
	// someone paused, or one paused before the reason was recorded, just "Paused".
	it.each([
		['checkpoint', 'Needs review'],
		['manual', 'Paused'],
		['unknown', 'Paused'],
		[null, 'Paused']
	] as const)('labels a %s pause "%s"', (pauseReason, label) => {
		const { getByTestId } = render(RunStatusBadge, { status: 'paused', pauseReason });
		expect(getByTestId('run-status-badge').textContent?.trim()).toBe(label);
		expect(getByTestId('run-status-badge').getAttribute('data-status')).toBe('paused');
	});

	it('keeps data-status stable so downstream selectors do not break', () => {
		const { getByTestId } = render(RunStatusBadge, { status: 'completed', degraded: true });
		expect(getByTestId('run-status-badge').getAttribute('data-status')).toBe('completed');
	});
});

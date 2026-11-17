import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BarChart from './BarChart.svelte';

describe('BarChart', () => {
	it('renders one bar per point with a value tooltip and axis labels', () => {
		render(BarChart, {
			points: [
				{ label: '2026-06-13', value: 1.5 },
				{ label: '2026-06-14', value: 0 },
				{ label: '2026-06-15', value: 4 }
			],
			formatValue: (v: number) => `$${v.toFixed(2)}`
		});

		const svg = screen.getByTestId('usage-bars');
		const bars = svg.querySelectorAll('[data-testid="usage-bar"]');
		expect(bars.length).toBe(3);
		// Per-bar <title> carries the formatted value.
		expect(bars[2].querySelector('title')?.textContent).toBe('2026-06-15: $4.00');

		expect(screen.getByTestId('usage-bars-first').textContent).toBe('2026-06-13');
		expect(screen.getByTestId('usage-bars-last').textContent).toBe('2026-06-15');
		expect(screen.getByTestId('usage-bars-peak').textContent).toContain('$4.00');
	});

	it('scales bar height to the max value (tallest = full height, zero = no height)', () => {
		render(BarChart, {
			points: [
				{ label: 'a', value: 0 },
				{ label: 'b', value: 10 }
			]
		});
		const bars = screen.getByTestId('usage-bars').querySelectorAll('[data-testid="usage-bar"]');
		expect(Number(bars[0].getAttribute('height'))).toBe(0);
		expect(Number(bars[1].getAttribute('height'))).toBeGreaterThan(0);
	});

	it('renders the empty caption and no bars when there are no points', () => {
		render(BarChart, { points: [], emptyLabel: 'No dated usage to chart yet.' });
		expect(screen.getByTestId('usage-bars-empty').textContent).toContain(
			'No dated usage to chart yet.'
		);
		expect(screen.queryByTestId('usage-bars')).toBeNull();
		expect(screen.queryAllByTestId('usage-bar').length).toBe(0);
	});
});

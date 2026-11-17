import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CardSkeleton from './CardSkeleton.svelte';
import TableRowSkeleton from './TableRowSkeleton.svelte';
import StatSkeleton from './StatSkeleton.svelte';

describe('skeleton primitives', () => {
	it('CardSkeleton renders a shimmer container with aria-hidden', () => {
		const { container } = render(CardSkeleton);
		const root = container.querySelector('[aria-hidden="true"]');
		expect(root).not.toBeNull();
		expect(root?.className).toContain('animate-pulse');
	});

	it('TableRowSkeleton renders the configured number of columns', () => {
		const { container } = render(TableRowSkeleton, { props: { columns: 5 } });
		const cells = container.querySelectorAll('[aria-hidden="true"] > *');
		expect(cells.length).toBe(5);
	});

	it('StatSkeleton renders', () => {
		const { container } = render(StatSkeleton);
		expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
	});
});

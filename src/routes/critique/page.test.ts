import { describe, it, expect, vi, beforeEach } from 'vitest';

// The page starts a critique via critique.create → goto(); mock the nav edges
// and the api so nothing touches the network. resolve is identity so the
// item hrefs stay assertable.
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const createMock = vi.fn();
const listMock = vi.fn();
vi.mock('$lib/api', () => ({
	critique: {
		create: (...a: unknown[]) => createMock(...a),
		list: (...a: unknown[]) => listMock(...a)
	}
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';

function item(overrides: Record<string, unknown> = {}) {
	return {
		id: 'crit-1',
		url: 'https://acme.example.com',
		status: 'completed',
		created_at: '2026-07-15T10:00:00Z',
		findings: [],
		...overrides
	};
}

function makeData(items: Record<string, unknown>[] = [], overrides: Record<string, unknown> = {}) {
	return {
		critiqueList: { items, total: items.length },
		currentPage: 1,
		currentStatus: '',
		...overrides
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('critique page', () => {
	it('lists critiques from loader data without a fetch on mount', () => {
		const { container } = render(Page, {
			props: {
				data: makeData([
					item({ id: 'a', url: 'https://acme.example.com', status: 'completed' }),
					item({ id: 'b', url: 'https://globex.io', status: 'running' })
				])
			}
		});

		// One clickable row per critique, linking to its detail page.
		const rows = container.querySelectorAll('a[href^="/critique/"]');
		expect(rows).toHaveLength(2);
		expect(screen.getByText('acme.example.com')).toBeTruthy();
		expect(screen.getByText('globex.io')).toBeTruthy();
		// The list is loader-driven; no client-side list fetch fires on mount.
		expect(listMock).not.toHaveBeenCalled();
	});

	it('shows the empty state when there are no critiques', () => {
		render(Page, { props: { data: makeData([]) } });
		expect(screen.getByText('No critiques found')).toBeTruthy();
		expect(screen.queryByText('acme.example.com')).toBeNull();
	});
});

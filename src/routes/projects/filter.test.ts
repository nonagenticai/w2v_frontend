import { describe, it, expect, vi, beforeEach } from 'vitest';

// The page navigates via goto(resolve(...)). Mock those edges; resolve is
// identity so we can assert on the raw URL string. Keep everything else real.
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/stores/projects.svelte.js', () => ({ removeProject: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('$lib/stores/settings.svelte.js', () => ({
	getSettings: () => ({ projectsView: { layout: 'gallery' } }),
	updateProjectsView: vi.fn()
}));

import { render, screen, fireEvent } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import Page from './+page.svelte';

const gotoMock = vi.mocked(goto);

function makeData(overrides: Record<string, unknown> = {}) {
	return {
		projectList: { items: [], total: 0 },
		currentPage: 1,
		currentStatus: '',
		currentType: '',
		currentSort: 'created_at',
		currentOrder: 'desc',
		...overrides
	} as never;
}

beforeEach(() => {
	gotoMock.mockReset();
	gotoMock.mockResolvedValue(undefined);
});

describe('projects page — type filter', () => {
	it('navigates to ?type=promo when the Promo pill is clicked', async () => {
		render(Page, { props: { data: makeData() } });
		await fireEvent.click(screen.getByRole('button', { name: 'Promo video' }));
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(gotoMock.mock.calls[0][0]).toBe('/projects?type=promo');
	});

	it('clearing back to "All types" drops the type param', async () => {
		render(Page, { props: { data: makeData({ currentType: 'promo' }) } });
		await fireEvent.click(screen.getByRole('button', { name: 'All types' }));
		expect(gotoMock.mock.calls[0][0]).toBe('/projects');
	});

	it('preserves an active status while switching type', async () => {
		render(Page, { props: { data: makeData({ currentStatus: 'completed' }) } });
		await fireEvent.click(screen.getByRole('button', { name: 'Course' }));
		// status is preserved, page resets to 1 (omitted because page===1)
		expect(gotoMock.mock.calls[0][0]).toBe('/projects?status=completed&type=course');
	});

	it('switching type resets the page back to 1', async () => {
		render(Page, { props: { data: makeData({ currentType: 'promo', currentPage: 3 }) } });
		await fireEvent.click(screen.getByRole('button', { name: 'Generic' }));
		// page 3 is dropped (reset to 1) — only type changes
		expect(gotoMock.mock.calls[0][0]).toBe('/projects?type=generic');
	});

	it('derives the active pill highlight from loader data, not local clicks', async () => {
		render(Page, { props: { data: makeData({ currentType: 'website_review' }) } });
		const active = screen.getByRole('button', { name: 'Website review' });
		// The accent class is only applied to the loader-selected type.
		expect(active.className).toContain('--color-accent)] text-');
		expect(screen.getByRole('button', { name: 'Promo video' }).className).not.toContain(
			'--color-accent)] text-'
		);
	});
});

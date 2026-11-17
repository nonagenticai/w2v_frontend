import { describe, it, expect, vi } from 'vitest';
import { readable } from 'svelte/store';

// The topbar renders no heading, so every page — including every nested
// +error.svelte boundary — must render exactly ONE h1 of its own.
const { pageState } = vi.hoisted(() => ({
	pageState: {
		status: 500,
		error: { message: 'boom' },
		url: new URL('http://x/settings'),
		params: { pid: 'p1', id: 'r1', stage: 's1' }
	}
}));
vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: (v: unknown) => void) => readable(pageState).subscribe(fn) }
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/environment', () => ({ dev: false, browser: true }));
vi.mock('$lib/api/client.js', () => ({ scopedMediaUrl: (u: string) => u }));
vi.mock('$lib/stores/auth.svelte', () => ({
	isTenantAdmin: () => false,
	isSuperAdmin: () => false
}));

import { render, cleanup } from '@testing-library/svelte';

const boundaries = import.meta.glob('./**/+error.svelte', { eager: true }) as Record<
	string,
	{ default: never }
>;

const h1Count = () => document.querySelectorAll('h1').length;

describe('exactly one h1 per page', () => {
	it('finds every nested error boundary', () => {
		// root + the 10 nested ones the topbar h1 used to cover.
		expect(Object.keys(boundaries).length).toBeGreaterThanOrEqual(11);
	});

	for (const [path, mod] of Object.entries(boundaries)) {
		it(`${path} renders exactly one h1`, () => {
			render(mod.default);
			expect(h1Count()).toBe(1);
			cleanup();
		});
	}

	it('a representative shell page (dashboard) renders exactly one h1', async () => {
		const Page = (await import('./+page.svelte')).default;
		render(Page, {
			props: {
				data: {
					projectList: { items: [], total: 0, limit: 20, offset: 0 },
					projectsError: null,
					statusCounts: { completed: 0, running: 0, failed: 0 },
					statusCountsError: null
				}
			} as never
		});
		expect(h1Count()).toBe(1);
		cleanup();
	});
});

import { describe, it, expect, vi } from 'vitest';

// The dashboard must branch on the loader's `projectsError` / `statusCountsError`
// (+page.ts) BEFORE looking at the list or the counts: a load that did not answer
// is not "No projects yet", and an unmeasured count is not a real 0.
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn() }));
vi.mock('$lib/api/client.js', () => ({ scopedMediaUrl: (u: string) => u }));
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => true }));

import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';

const list = (items: unknown[], total = items.length) => ({ items, total, limit: 20, offset: 0 });
const counts = { completed: 2, running: 1, failed: 3 };
const project = {
	id: 'p1',
	title: 'Acme promo',
	type: 'demo_video',
	status: 'producing',
	deliverable_count: 1,
	thumbnail_url: null
};

function renderWith(data: Record<string, unknown>) {
	return render(Page, {
		props: {
			data: {
				projectList: list([]),
				projectsError: null,
				statusCounts: counts,
				statusCountsError: null,
				...data
			}
		} as never
	});
}

describe('dashboard page', () => {
	it('a failed project load shows an error with retry, NOT the empty state', () => {
		renderWith({ projectsError: { status: 429, detail: 'slow down' } });
		expect(screen.getByTestId('dashboard-projects-error').textContent).toContain('slow down');
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
		expect(screen.queryByTestId('dashboard-empty')).toBeNull();
		expect(screen.getByTestId('stat-total').textContent?.trim()).toBe('—');
	});

	it('failed counts render "—" with a notice, never a fabricated 0', () => {
		renderWith({
			projectList: list([project], 1),
			statusCountsError: { status: null, detail: 'network' },
			statusCounts: { completed: 0, running: 0, failed: 0 }
		});
		expect(screen.getByTestId('dashboard-counts-error')).toBeTruthy();
		for (const k of ['completed', 'producing', 'failed']) {
			expect(screen.getByTestId(`stat-${k}`).textContent?.trim(), k).toBe('—');
		}
		expect(screen.getByTestId('stat-total').textContent?.trim()).toBe('1');
	});

	it('an empty workspace gets an action and a first-run checklist', () => {
		renderWith({});
		const empty = screen.getByTestId('dashboard-empty');
		expect(screen.getByTestId('first-run-checklist').querySelectorAll('li')).toHaveLength(3);
		const cta = Array.from(empty.querySelectorAll('a')).find((a) =>
			a.textContent?.includes('Create your first project')
		);
		expect(cta?.getAttribute('href')).toBe('/projects/new');
	});

	it('labels type and status in words, and shows measured counts (no "Total Jobs")', () => {
		renderWith({ projectList: list([project], 1) });
		const body = document.body.textContent ?? '';
		expect(body).toContain('In production');
		expect(body).not.toMatch(/\bproducing\b/);
		expect(body).not.toContain('demo_video');
		expect(body).not.toContain('Total Jobs');
		expect(body).not.toContain('Success Rate');
		expect(screen.getByTestId('stat-failed').textContent?.trim()).toBe('3');
	});
});

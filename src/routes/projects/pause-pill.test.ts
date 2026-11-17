import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/stores/projects.svelte.js', () => ({ removeProject: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
const layoutHolder = vi.hoisted(() => ({ layout: 'gallery' as 'gallery' | 'list' }));
vi.mock('$lib/stores/settings.svelte.js', () => ({
	getSettings: () => ({ projectsView: { layout: layoutHolder.layout } }),
	updateProjectsView: vi.fn()
}));

import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';

function project(reason: 'checkpoint' | 'manual' | 'unknown') {
	return {
		id: `p-${reason}`,
		tenant_id: 't',
		owner_subject_id: 's',
		visibility: 'tenant',
		type: 'promo',
		title: `Project ${reason}`,
		status: 'producing',
		brief: {},
		created_at: '2026-10-26T07:00:00Z',
		updated_at: '2026-10-26T07:00:00Z',
		deliverable_count: 1,
		last_run_status: 'paused',
		last_run_pause_reason: reason
	};
}

function data() {
	return {
		projectList: {
			items: [project('checkpoint'), project('manual'), project('unknown')],
			total: 3
		},
		currentPage: 1,
		currentStatus: '',
		currentType: '',
		currentSort: 'created_at',
		currentOrder: 'desc'
	} as never;
}

// The project gallery/table carried TWO pills for a paused project — the project
// status and the latest run's raw status ("paused"). Both now say WHY: a checkpoint
// pause "Needs review"; a manual or unclassified pause just "Paused".
describe.each(['gallery', 'list'] as const)('projects page (%s) — pause pills', (layout) => {
	it('says Needs review only for a checkpoint pause', async () => {
		layoutHolder.layout = layout;
		render(Page, { props: { data: data() } });
		const rowOf = (title: string) =>
			(screen.getByText(title).closest('[data-testid="project-card"], tr') as HTMLElement)
				.textContent ?? '';
		await screen.findByText('Project checkpoint');
		expect(rowOf('Project checkpoint')).toContain('Needs review');
		for (const title of ['Project manual', 'Project unknown']) {
			expect(rowOf(title)).toContain('Paused');
			expect(rowOf(title)).not.toMatch(/review/i);
			expect(rowOf(title)).not.toContain('paused'); // never the raw lower-case enum
		}
	});
});

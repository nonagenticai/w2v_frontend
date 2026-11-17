import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

import { render } from '@testing-library/svelte';
import BranchBanner from './BranchBanner.svelte';
import type { BranchContext } from '$lib/types';

function ctx(over: Partial<BranchContext> = {}): BranchContext {
	return {
		branch_id: 'b1',
		name: 'shorter cold open',
		status: 'open',
		root_project_id: 'root-9',
		root_title: 'Launch Film',
		...over
	};
}

describe('BranchBanner', () => {
	it('names the root project, the branch and its status', () => {
		const { getByTestId } = render(BranchBanner, { props: { branch: ctx() } });

		const banner = getByTestId('branch-banner');
		expect(banner.textContent).toContain('Branch of');
		expect(banner.textContent).toContain('Launch Film');
		expect(banner.textContent).toContain('shorter cold open');
		expect(banner.textContent).toContain('open');
	});

	it('links back to the ROOT project — the only way out of a branch', () => {
		const { getByTestId } = render(BranchBanner, { props: { branch: ctx() } });

		const link = getByTestId('branch-banner-root-link') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/projects/root-9');
	});

	it('says nothing about read-only history while the branch is open', () => {
		const { queryByTestId } = render(BranchBanner, { props: { branch: ctx() } });
		expect(queryByTestId('branch-banner-note')).toBeNull();
	});

	it('calls a merged branch read-only history, not a live lane', () => {
		const { getByTestId } = render(BranchBanner, { props: { branch: ctx({ status: 'merged' }) } });

		const note = getByTestId('branch-banner-note');
		expect(note.textContent).toContain('merged');
		expect(note.textContent).toContain('read-only history');
		expect(getByTestId('branch-banner').textContent).toContain('merged');
	});

	it('calls an abandoned branch read-only history, not a live lane', () => {
		const { getByTestId } = render(BranchBanner, {
			props: { branch: ctx({ status: 'abandoned' }) }
		});

		const note = getByTestId('branch-banner-note');
		expect(note.textContent).toContain('abandoned');
		expect(note.textContent).toContain('read-only history');
	});

	it('shows no lineage breadcrumb for a direct branch (one hop or no ancestors)', () => {
		// Absent ancestors (an orchestrator that predates the field) …
		const bare = render(BranchBanner, { props: { branch: ctx() } });
		expect(bare.queryByTestId('branch-banner-lineage')).toBeNull();
		// … and a single-element chain (the immediate parent IS the root) both fall back
		// to the one-hop `root_title` render — no redundant breadcrumb.
		const direct = render(BranchBanner, {
			props: {
				branch: ctx({
					ancestors: [{ project_id: 'root-9', title: 'Launch Film', is_branch: false }]
				})
			}
		});
		expect(direct.queryByTestId('branch-banner-lineage')).toBeNull();
	});

	it('renders the full ancestor chain root-first, each hop a link, for a branch-of-branch', () => {
		// Grandchild D of a chain: root "Launch Film" ← "Mid" ← this branch. ancestors is
		// immediate-parent-first, so the immediate parent is "Mid" and the ultimate root
		// is "Launch Film".
		const { getByTestId, getAllByTestId } = render(BranchBanner, {
			props: {
				branch: ctx({
					name: 'tighter act 2',
					root_project_id: 'mid-pid',
					root_title: 'Mid',
					ancestors: [
						{ project_id: 'mid-pid', title: 'Mid', is_branch: true },
						{ project_id: 'root-9', title: 'Launch Film', is_branch: false }
					]
				})
			}
		});

		const lineage = getByTestId('branch-banner-lineage');
		// Rendered ROOT-FIRST: the ultimate root leads, the immediate parent follows,
		// then this branch's own name terminates the chain.
		expect(lineage.textContent).toContain('Launch Film');
		expect(lineage.textContent).toContain('Mid');
		expect(lineage.textContent).toContain('tighter act 2');

		const hops = getAllByTestId('branch-banner-lineage-hop') as HTMLAnchorElement[];
		expect(hops.map((h) => h.getAttribute('href'))).toEqual([
			'/projects/root-9', // ultimate root first
			'/projects/mid-pid' // immediate parent second
		]);
	});
});

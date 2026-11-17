import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import RunWarningsPanel from './RunWarningsPanel.svelte';

/**
 * A degraded step must say where it is fixed (prod run 01a17e6f showed three
 * warnings — thin site text, a failed design — and no way to act on any of them).
 * Each WARNING stage links its own step page, which holds "Regenerate this stage";
 * the non-degrading Notes tier does not.
 */
const stages = [
	{
		stage_name: 'site_capture',
		degraded: true,
		degradation_codes: ['site_page_text_thin'],
		output: {
			degradations: [
				{
					code: 'site_page_text_thin',
					detail: 'Captured pages contain too little readable text to ground the script'
				}
			]
		}
	},
	{
		stage_name: 'compile',
		degraded: false,
		degradation_codes: [],
		output: { advisories: [{ code: 'media_not_compositable', detail: 'x' }] }
	}
];

describe('RunWarningsPanel — fix and rerun this step', () => {
	it('links every warning stage to its step page', () => {
		const { getAllByTestId, queryAllByTestId } = render(RunWarningsPanel, {
			stages,
			stageHref: (s: string) => `/projects/p/runs/r/stages/${s}`
		});
		const links = getAllByTestId('run-warning-fix-link') as HTMLAnchorElement[];
		expect(links).toHaveLength(1);
		expect(links[0].getAttribute('href')).toBe('/projects/p/runs/r/stages/site_capture');
		expect(links[0].textContent?.trim()).toBe('Fix and rerun this step');
		expect(queryAllByTestId('run-advisory-fix-link')).toHaveLength(0);
	});

	it('renders no link when the page gives no step URL', () => {
		const { queryAllByTestId } = render(RunWarningsPanel, { stages });
		expect(queryAllByTestId('run-warning-fix-link')).toHaveLength(0);
	});
});

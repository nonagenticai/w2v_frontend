import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import RunWarningsPanel from './RunWarningsPanel.svelte';

/**
 * Advisories on a NON-degraded run.
 *
 * Prod run `01a0a4cf` completed with `degraded=false` and empty `degradations`,
 * yet its stages carried the advisories `media_not_compositable` and
 * `slides_not_authored` — the only account of what the pipeline silently could
 * not do. If the Notes section were gated on `degraded` (as the warnings
 * section legitimately is) those facts would never reach the operator.
 *
 * This pins that the advisory tier is INDEPENDENT of `degraded`, and that it
 * renders in its own section — promoting an advisory into the warnings list
 * would misreport a clean run as degraded.
 */
const stages = [
	{
		stage_name: 'compile',
		degraded: false,
		degradation_codes: [],
		output: {
			advisories: [
				{ code: 'media_not_compositable', detail: 'Pinned media could not be composited.' }
			]
		}
	},
	{
		stage_name: 'slide_build',
		degraded: false,
		degradation_codes: [],
		output: {
			advisories: [{ code: 'slides_not_authored', detail: 'No slides were authored.' }]
		}
	}
];

describe('RunWarningsPanel — advisories on a completed, non-degraded run', () => {
	it('renders both advisories even though the run is not degraded', () => {
		const { container } = render(RunWarningsPanel, {
			props: { stages, runDegraded: false, runStatus: 'completed' } as never
		});
		const items = [...container.querySelectorAll('[data-testid="run-advisory"]')].map((el) =>
			el.textContent!.replace(/\s+/g, ' ').trim()
		);
		expect(items).toHaveLength(2);
		expect(items.join(' ')).toContain('media_not_compositable');
		expect(items.join(' ')).toContain('slides_not_authored');
	});

	it('keeps them out of the warnings section, in a visually distinct Notes section', () => {
		const { container } = render(RunWarningsPanel, {
			props: { stages, runDegraded: false, runStatus: 'completed' } as never
		});
		// No warnings + not degraded ⇒ the warning banner must not appear at all.
		expect(container.querySelector('[data-testid="run-warnings"]')).toBeNull();
		const notes = container.querySelector('[data-testid="run-advisories"]');
		expect(notes).not.toBeNull();
		expect(notes!.textContent).toContain('Notes');
	});
});

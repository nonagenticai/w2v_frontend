import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import PanelBoundary from './PanelBoundary.svelte';
import BoundaryHarness from './PanelBoundary.harness.test.svelte';

describe('PanelBoundary', () => {
	let errSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		// Svelte logs the caught error; silence it so a deliberate throw does not
		// look like a broken test run.
		errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => errSpy.mockRestore());

	it('renders its children when nothing throws', () => {
		render(BoundaryHarness, { props: { shouldThrow: false } });
		expect(screen.getByTestId('boundary-child')).toBeInTheDocument();
		expect(screen.queryByTestId('panel-boundary-failed')).toBeNull();
	});

	it('contains a render-time throw to this panel instead of blanking the page', () => {
		render(BoundaryHarness, { props: { shouldThrow: true } });

		const failed = screen.getByTestId('panel-boundary-failed');
		expect(failed).toBeInTheDocument();
		expect(failed.getAttribute('data-panel')).toBe('Outputs');
		expect(failed.textContent).toContain('each_key_duplicate');
		// The sibling panel outside the boundary still rendered — that is the whole
		// point: one bad payload must not take the run page with it.
		expect(screen.getByTestId('sibling-panel')).toBeInTheDocument();
		expect(screen.queryByTestId('boundary-child')).toBeNull();
	});

	it('is exported from the errors barrel', async () => {
		const mod = await import('./index');
		expect(mod.PanelBoundary).toBe(PanelBoundary);
	});
});

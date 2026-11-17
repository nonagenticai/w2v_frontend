import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import StageOutputView from './StageOutputView.svelte';

describe('StageOutputView', () => {
	it('renders the empty label when output is null/empty', () => {
		const { getByText } = render(StageOutputView, { output: null });
		expect(getByText('No output recorded.')).toBeTruthy();
	});

	it('renders an image artifact as a thumbnail', () => {
		const { container } = render(StageOutputView, {
			output: { thumbnail_url: 'https://x/cover.png' }
		});
		const img = container.querySelector('img');
		expect(img?.getAttribute('src')).toBe('https://x/cover.png');
	});

	it('renders a video artifact_url inline', () => {
		const { container } = render(StageOutputView, {
			output: { artifact_url: 'https://x/v.mp4' }
		});
		expect(container.querySelector('video')?.getAttribute('src')).toBe('https://x/v.mp4');
	});

	it('renders script lines via the rich ScriptDialogue renderer', () => {
		const { getByText, container } = render(StageOutputView, {
			output: { lines: [{ id: 'L1', text: 'Hello world', seconds: 2, speaker: 'a' }] }
		});
		expect(getByText('Hello world')).toBeTruthy();
		// Dispatched to the registry renderer, not the generic list fallback.
		expect(container.querySelector('[data-testid="script-dialogue"]')).toBeTruthy();
	});

	it('renders findings with a severity pill', () => {
		const { getByText, getAllByText } = render(StageOutputView, {
			output: {
				findings: [{ title: 'Slow hero', severity: 'high', recommendation: 'Compress it' }]
			}
		});
		expect(getByText('Slow hero')).toBeTruthy();
		expect(getByText('high')).toBeTruthy();
		// "Compress it" renders in the Fix line AND the always-present raw JSON.
		expect(getAllByText(/Compress it/).length).toBeGreaterThan(0);
	});

	it('renders scalar fields as a key/value table', () => {
		const { getByText } = render(StageOutputView, {
			output: { style: 'modern', accessibility_score: 92 }
		});
		expect(getByText('style')).toBeTruthy();
		expect(getByText('modern')).toBeTruthy();
		expect(getByText('accessibility_score')).toBeTruthy();
		expect(getByText('92')).toBeTruthy();
	});

	it('always offers a raw JSON disclosure', () => {
		const { getByText } = render(StageOutputView, { output: { a: 1 } });
		expect(getByText('Raw JSON')).toBeTruthy();
	});
});

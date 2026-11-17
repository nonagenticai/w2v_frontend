import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AuditsSection from './AuditsSection.svelte';

describe('AuditsSection — "Add AI analysis" copy', () => {
	it('says what the AI review adds and promises no voice/video step', () => {
		const { getByTestId } = render(AuditsSection, { type: 'marketing_scorecard' as never });
		const label = getByTestId('audit-include-llm-toggle').closest('label')!;
		const text = (label.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('Add AI analysis');
		expect(text).toMatch(/fix advice/);
		expect(text).toMatch(/executive summary/);
		expect(text).toMatch(/no voice or video/);
		expect(text).toMatch(/score stays the same/);
		expect(text).not.toMatch(/micro-LLM/);
	});
});

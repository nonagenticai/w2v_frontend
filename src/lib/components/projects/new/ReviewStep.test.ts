import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ReviewStep from './ReviewStep.svelte';
import { createWizard as cw } from './create-wizard.svelte.js';
import { wizard } from '$lib/stores/wizard.svelte.js';

// ui-review 2026-10-17: the Review step must read back what was chosen, and only
// rows that mean something for the type.
beforeEach(() => {
	cw.reset();
	wizard.url = '';
});

describe('ReviewStep', () => {
	it('action_reel shows its footage, not a "Source URL —" row', () => {
		cw.setProjectType('action_reel');
		cw.videoSources = [{ source_id: 's1', filename: 'drone.mp4' } as never];
		const { getByTestId, queryByText } = render(ReviewStep);
		expect(getByTestId('review-footage').textContent).toMatch(/1\s+clip:\s+drone\.mp4/);
		expect(queryByText('Source URL')).toBeNull();
	});

	it('audits read back AI analysis, intent and the video opt-in', () => {
		cw.setProjectType('cro_audit');
		cw.brief = { include_llm: true, intent: 'more signups' };
		const { getByTestId } = render(ReviewStep);
		expect(getByTestId('review-ai-analysis').textContent?.trim()).toBe('On');
		expect(getByTestId('review-audit-intent').textContent?.trim()).toBe('more signups');
		expect(getByTestId('review-audit-video').textContent?.trim()).toBe('Off');
	});

	it('marketing_scorecard (scan-only) has no narrated-video row', () => {
		cw.setProjectType('marketing_scorecard');
		const { getByTestId, queryByTestId } = render(ReviewStep);
		expect(getByTestId('review-ai-analysis').textContent?.trim()).toBe('Off');
		expect(queryByTestId('review-audit-video')).toBeNull();
	});

	it('website_review reads back the outputs chosen on the Source step', () => {
		cw.setProjectType('website_review');
		cw.generateCritique = true;
		cw.generateRedesign = true;
		cw.generateVideo = false;
		const { getByTestId } = render(ReviewStep);
		expect(getByTestId('review-outputs').textContent?.trim()).toBe('Critique report · Redesign');
	});

	it('website_review lists the redesign the video implies', () => {
		cw.setProjectType('website_review');
		cw.generateCritique = false;
		cw.generateRedesign = false;
		cw.generateVideo = true;
		const { getByTestId } = render(ReviewStep);
		expect(getByTestId('review-outputs').textContent?.trim()).toBe(
			'Redesign · Narrated review video'
		);
	});

	it('types without output opt-ins have no Outputs row', () => {
		cw.setProjectType('promo');
		const { queryByTestId } = render(ReviewStep);
		expect(queryByTestId('review-outputs')).toBeNull();
	});

	it('audiobook shows narration but no video "Look" (theme / resolution)', () => {
		cw.setProjectType('audiobook');
		const { queryByTestId, getByText } = render(ReviewStep);
		expect(getByText('Narration')).toBeTruthy();
		expect(queryByTestId('review-look')).toBeNull();
	});
});

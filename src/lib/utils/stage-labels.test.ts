import { describe, it, expect } from 'vitest';
import { stageLabel, stageOutputSummary, formatDurationSeconds } from './stage-labels';

describe('stageLabel', () => {
	it('maps known stages to curated labels', () => {
		expect(stageLabel('website_review_visual_director')).toBe('Website Review Visual Director');
		expect(stageLabel('promo_render')).toBe('Promo Render');
		expect(stageLabel('course_stitch')).toBe('Course Stitch');
	});

	it('title-cases unknown snake_case stages as a fallback', () => {
		expect(stageLabel('some_new_stage')).toBe('Some New Stage');
		expect(stageLabel('foo')).toBe('Foo');
	});
});

describe('formatDurationSeconds', () => {
	it('renders seconds and minutes, and -- for nullish', () => {
		expect(formatDurationSeconds(4.23)).toBe('4.2s');
		expect(formatDurationSeconds(72)).toBe('1m 12s');
		expect(formatDurationSeconds(null)).toBe('--');
	});
});

describe('stageOutputSummary', () => {
	it('summarises a video output', () => {
		expect(stageOutputSummary({ artifact_url: 'http://x/v.mp4', duration_seconds: 72 })).toBe(
			'video · 1m 12s'
		);
	});

	it('summarises a script (lines) output', () => {
		expect(stageOutputSummary({ lines: [{ text: 'a' }, { text: 'b' }], total_seconds: 42 })).toBe(
			'2 lines · 42.0s'
		);
	});

	it('summarises critique findings', () => {
		expect(stageOutputSummary({ findings: [{ title: 'x' }] })).toBe('1 findings');
	});

	it('falls back to a field count, and empty for nullish', () => {
		expect(stageOutputSummary({ a: 1, b: 2 })).toBe('2 fields');
		expect(stageOutputSummary(null)).toBe('');
		expect(stageOutputSummary({})).toBe('');
	});
});

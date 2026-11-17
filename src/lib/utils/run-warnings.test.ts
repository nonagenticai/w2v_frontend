import { describe, expect, it } from 'vitest';
import { degradationCodeTitle, extractRunWarnings } from './run-warnings';

describe('extractRunWarnings', () => {
	it('returns nothing for clean stages', () => {
		expect(
			extractRunWarnings([
				{ stage_name: 'website_review_script', degraded: false, output: { lines: [] } },
				{ stage_name: 'x', output: null }
			])
		).toEqual([]);
	});

	it('renders explicit degradations with code + human detail, labelled by stage', () => {
		const w = extractRunWarnings([
			{
				stage_name: 'website_review_compile',
				degraded: true,
				degradation_codes: ['duration_out_of_tolerance'],
				output: {
					degradations: [
						{
							code: 'duration_out_of_tolerance',
							detail: 'website_review_compile delivered 15.1s vs 10.0s ordered'
						}
					]
				}
			}
		]);
		expect(w).toEqual([
			{
				stageName: 'website_review_compile',
				label: 'Website Review Compile',
				items: [
					{
						code: 'duration_out_of_tolerance',
						detail: 'website_review_compile delivered 15.1s vs 10.0s ordered'
					}
				]
			}
		]);
	});

	it('includes legacy prose notes (they raise `degraded` too)', () => {
		const w = extractRunWarnings([
			{ stage_name: 'narrate', degraded: true, output: { notes: ['captions dropped', '  '] } }
		]);
		expect(w[0].items).toEqual([{ code: null, detail: 'captions dropped' }]);
	});

	it('keeps a code named only in degradation_codes (output absent) instead of losing it', () => {
		const w = extractRunWarnings([
			{ stage_name: 'compile', degraded: true, degradation_codes: ['sound_bed_missing'] }
		]);
		expect(w[0].items).toEqual([{ code: 'sound_bed_missing', detail: 'Music bed missing' }]);
	});

	it('does not duplicate a code present in both channels', () => {
		const w = extractRunWarnings([
			{
				stage_name: 'compile',
				degraded: true,
				degradation_codes: ['captions_missing'],
				output: { degradations: [{ code: 'captions_missing', detail: 'no subtitles' }] }
			}
		]);
		expect(w[0].items).toHaveLength(1);
	});

	it('never points the badge at an empty panel: degraded with no details gets a generic item', () => {
		const w = extractRunWarnings([{ stage_name: 'compile', degraded: true, output: {} }]);
		expect(w).toHaveLength(1);
		expect(w[0].items[0].detail).toMatch(/recorded no details/);
	});

	it('tolerates malformed entries', () => {
		const w = extractRunWarnings([
			{
				stage_name: 'compile',
				output: { degradations: [null, 'x', { code: '' }, { detail: 'only detail' }], notes: 'no' }
			}
		]);
		expect(w[0].items).toEqual([{ code: null, detail: 'only detail' }]);
	});
});

describe('degradationCodeTitle', () => {
	it('titles an unknown code from a newer pod instead of dropping it', () => {
		expect(degradationCodeTitle('brand_new_code')).toBe('Brand new code');
	});
	it('review_skipped (final_critique fail-open, orchestrator #1150) has a human title', () => {
		expect(degradationCodeTitle('review_skipped')).toBe(
			'Final review skipped (analyzer unavailable)'
		);
		const w = extractRunWarnings([
			{ stage_name: 'final_critique', degraded: true, degradation_codes: ['review_skipped'] }
		]);
		expect(w[0].items).toEqual([
			{ code: 'review_skipped', detail: 'Final review skipped (analyzer unavailable)' }
		]);
	});
});

it('counts a structured warning and its legacy note only once', () => {
	const warnings = extractRunWarnings([
		{
			stage_name: 'promo_html',
			output: {
				degradations: [{ code: 'promo_html_design_failed', detail: 'promo_html: design failed' }],
				notes: ['design failed', ' design   failed ', 'a distinct issue']
			}
		}
	]);
	expect(warnings[0].items).toEqual([
		{ code: 'promo_html_design_failed', detail: 'promo_html: design failed' },
		{ code: null, detail: 'a distinct issue' }
	]);
});

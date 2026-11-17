import { describe, expect, it } from 'vitest';
import { formatTokenCount, noChargeNote, summarizeUsage, usageFromTokens } from './usage';
import type { RunUsageTotal } from '$lib/types/runs';

// Run 01a15193-b4bc-73bd-8efe-8437f9c2a366 (marketing_scorecard, 2026-10-19).
const scorecard: RunUsageTotal = {
	input_tokens: 7463,
	output_tokens: 1407,
	cost_usd: 0,
	cost_status: 'ok',
	cost_unavailable_reason: null,
	cost_settled: true,
	by_stage: [
		{
			stage_name: 'marketing_scorecard_scan',
			model: 'local-llm',
			provider: 'vllm',
			input_tokens: 239,
			output_tokens: 137,
			cost_usd: 0
		},
		{
			stage_name: 'marketing_scorecard_scan',
			model: 'local-llm',
			provider: 'vllm',
			input_tokens: 1023,
			output_tokens: 27,
			cost_usd: 0
		}
	]
};

describe('formatTokenCount', () => {
	it('is compact', () => {
		expect(formatTokenCount(7463)).toBe('7.5K');
		expect(formatTokenCount(1407)).toBe('1.4K');
		expect(formatTokenCount(950)).toBe('950');
		expect(formatTokenCount(2_400_000)).toBe('2.4M');
	});
	it('never renders garbage for a missing figure', () => {
		expect(formatTokenCount(null)).toBe('0');
		expect(formatTokenCount(Number.NaN)).toBe('0');
	});
});

describe('summarizeUsage', () => {
	it('reads the run totals and flags a metered $0 local-model spend', () => {
		const s = summarizeUsage(scorecard);
		expect(s).toMatchObject({
			input: 7463,
			output: 1407,
			total: 8870,
			noCharge: true,
			local: true
		});
		expect(s?.models).toEqual(['local-llm']);
		expect(noChargeNote(s)).toBe('Local model (local-llm) — no charge');
	});

	it('sums one stage over its several calls', () => {
		const s = summarizeUsage(scorecard, 'marketing_scorecard_scan');
		expect(s).toMatchObject({ input: 1262, output: 164, total: 1426 });
		expect(summarizeUsage(scorecard, 'source_ingest')).toBeNull();
	});

	it('returns null when nothing was recorded', () => {
		expect(summarizeUsage(null)).toBeNull();
		expect(
			summarizeUsage({ ...scorecard, input_tokens: 0, output_tokens: 0, by_stage: [] })
		).toBeNull();
	});

	it('has no note when the spend cost money', () => {
		const s = summarizeUsage({ ...scorecard, cost_usd: 0.12 });
		expect(s?.noCharge).toBe(false);
		expect(noChargeNote(s)).toBeNull();
	});

	it('never claims "no charge" for an unavailable cost', () => {
		const s = summarizeUsage({ ...scorecard, cost_usd: null, cost_status: 'unavailable' });
		expect(s?.noCharge).toBe(false);
		expect(noChargeNote(s)).toBeNull();
	});

	it('does not call a hosted model local', () => {
		const s = summarizeUsage({
			...scorecard,
			by_stage: [{ ...scorecard.by_stage[0], model: 'gpt-x', provider: 'openai' }]
		});
		expect(s?.local).toBe(false);
		expect(noChargeNote(s)).toBe('Metered, no charge recorded');
	});
});

describe('usageFromTokens', () => {
	it('summarises bare list totals with no cost claim', () => {
		const s = summarizeUsage(usageFromTokens(100, 50));
		expect(s).toMatchObject({ input: 100, output: 50, total: 150, noCharge: false });
	});

	it('is empty (renders nothing) when both totals are 0 or missing', () => {
		expect(summarizeUsage(usageFromTokens(0, 0))).toBeNull();
		expect(summarizeUsage(usageFromTokens(undefined, null))).toBeNull();
	});
});

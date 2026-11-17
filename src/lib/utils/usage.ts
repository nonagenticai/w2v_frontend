/**
 * Token usage, summarised for display next to cost.
 *
 * Run detail reports real token counts in `usage_total` (and per call in
 * `by_stage`), but the run page only ever rendered the cost — so a run served
 * by the local model, which is metered at `$0`, read "Cost $0.0000" with no
 * sign that 8,870 tokens had been spent. Tokens are the figure that actually
 * moves there.
 */
import type { RunUsageTotal } from '$lib/types/runs';

type UsageRow = RunUsageTotal['by_stage'][number];

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const FULL = new Intl.NumberFormat('en');

/** `7463` → `7.5K`; `950` → `950`. Non-finite/negative ⇒ `0`. */
export function formatTokenCount(n: number | null | undefined): string {
	return COMPACT.format(typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
}

/** `7463` → `7,463` (tooltips). */
export function formatTokenCountFull(n: number): string {
	return FULL.format(n);
}

// Providers that serve a model the platform runs itself (pgx vLLM etc.): a
// metered $0 on these is "local", not "unpriced".
const LOCAL_PROVIDERS = new Set(['vllm', 'ollama', 'llama.cpp', 'llamacpp', 'mlx', 'local']);

function isLocalRow(row: UsageRow): boolean {
	const provider = (row.provider ?? '').toLowerCase();
	const model = (row.model ?? '').toLowerCase();
	return LOCAL_PROVIDERS.has(provider) || model.startsWith('local');
}

export interface UsageSummary {
	input: number;
	output: number;
	total: number;
	/** Distinct models that served the calls, in first-seen order. */
	models: string[];
	/** Tokens were spent and the reported cost is exactly $0 (status ok). */
	noCharge: boolean;
	/** Every call that spent tokens ran on a local model. */
	local: boolean;
}

const distinct = (xs: (string | null | undefined)[]): string[] => [
	...new Set(xs.filter((x): x is string => Boolean(x)))
];

/**
 * Summarise a run's usage, or one stage's when `stage` is given (summed over
 * that stage's `by_stage` rows — a stage can carry several calls).
 * Returns `null` when nothing was recorded (no tokens, no rows).
 */
export function summarizeUsage(
	usage: RunUsageTotal | null | undefined,
	stage?: string
): UsageSummary | null {
	if (!usage) return null;
	const rows =
		stage === undefined
			? (usage.by_stage ?? [])
			: (usage.by_stage ?? []).filter((r) => r.stage_name === stage);
	const sum = (pick: (r: UsageRow) => number | null | undefined) =>
		rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
	const input = stage === undefined ? (usage.input_tokens ?? 0) : sum((r) => r.input_tokens);
	const output = stage === undefined ? (usage.output_tokens ?? 0) : sum((r) => r.output_tokens);
	const total = input + output;
	if (total <= 0 && rows.length === 0) return null;
	const cost = stage === undefined ? usage.cost_usd : sum((r) => r.cost_usd);
	const spent = rows.filter((r) => (r.input_tokens ?? 0) + (r.output_tokens ?? 0) > 0);
	return {
		input,
		output,
		total,
		models: distinct(spent.map((r) => r.model)),
		noCharge: total > 0 && usage.cost_status !== 'unavailable' && cost === 0,
		local: spent.length > 0 && spent.every(isLocalRow)
	};
}

/** Short explanation for a metered-but-free spend, or `null` when there is a cost. */
export function noChargeNote(summary: UsageSummary | null): string | null {
	if (!summary?.noCharge) return null;
	if (summary.local) {
		return summary.models.length > 0
			? `Local model (${summary.models.join(', ')}) — no charge`
			: 'Local model — no charge';
	}
	return 'Metered, no charge recorded';
}

/**
 * A run-level usage shape from bare token totals — `RunSummary` (the run LIST)
 * carries `input_tokens` / `output_tokens` but no cost or per-stage rows, so
 * the shared `TokenUsage` display can render it. Cost is left `null` (unknown,
 * not `$0`) so no "no charge" note is claimed; both totals 0 ⇒ renders nothing.
 */
export function usageFromTokens(
	input: number | null | undefined,
	output: number | null | undefined
): RunUsageTotal {
	return {
		input_tokens: input ?? 0,
		output_tokens: output ?? 0,
		cost_usd: null,
		cost_status: 'ok',
		// Not final: a run LIST row carries no settlement information.
		cost_settled: false,
		by_stage: []
	};
}

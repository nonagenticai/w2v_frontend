import type { components } from './types.gen';
import { api } from './client.js';

type FeatureSuggestionInput = components['schemas']['FeatureSuggestionInput'];
type CritiqueFindingInput = components['schemas']['CritiqueFindingInput'];

export type FixRankResponse = components['schemas']['FixRankResponse'];
export type RankedFixSuggestion = components['schemas']['RankedFixSuggestion'];
export type RankingConfidenceSummary = components['schemas']['RankingConfidenceSummary'];

export interface FixRankInput {
	proposals: FeatureSuggestionInput[];
	critique_findings?: CritiqueFindingInput[];
}

export const fixes = {
	/**
	 * Rank feature-fix proposals by ROI (critique severity + video impact vs.
	 * estimated implementation cost) via the orchestrator's authoritative model.
	 *
	 * The cost model — the token→USD rate, the effort/severity/impact tables — is
	 * owned server-side (`POST /api/fixes/rank`), NOT the browser. We deliberately
	 * do NOT pass `output_cost_per_million_usd`: the server applies its own default
	 * so the pricing can never drift from real billing or be tampered with in the
	 * shipped bundle. Each ranked entry echoes back its `output_cost_per_million_usd`
	 * for display.
	 */
	rank(input: FixRankInput): Promise<FixRankResponse> {
		return api.post<FixRankResponse>('/fixes/rank', input);
	}
};

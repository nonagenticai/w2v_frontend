// Blueprint metadata — GET /api/blueprints returns every registered blueprint
// and its stages (the per-type DAG topology). The project home uses this as the
// rot-proof source of truth for "what stages does this type run", instead of a
// hard-coded list that drifts when blueprints change.

import type { components } from './types.gen';
import { api } from './client.js';

export type BlueprintSummary = components['schemas']['BlueprintSummary'];
export type BlueprintStage = components['schemas']['BlueprintStage'];

export const blueprints = {
	list(): Promise<BlueprintSummary[]> {
		return api.get<BlueprintSummary[]>('/blueprints');
	}
};

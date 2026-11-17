// Element PATCH + restamp store (Svelte 5 runes) — v3 surface.
//
// v3 output is `Record<string, unknown>` (no typed elements[]). Two
// mutation verbs are wired:
//   update()  → PATCH (shallow-merge, no downstream effect)        BE PR #52
//   restamp() → POST  (full replace + downstream pending)          A.3 (PR #59)
//
// After restamp() returns, downstream stages are marked pending and the
// caller can invoke runs.regenerate(runId) to re-execute from the first
// dirty stage. The store carries no cache — re-render from the returned
// StageOutputResponse or refetch via runs.stages.output.

import { runs } from '$lib/api';
import type { StageOutputResponse } from '$lib/types/runs';

export async function update(
	runId: string,
	stage: string,
	elementId: string,
	patch: Record<string, unknown>
): Promise<StageOutputResponse> {
	return runs.stages.patchElement(runId, stage, elementId, { patch });
}

export async function restamp(
	runId: string,
	stage: string,
	elementId: string,
	value: Record<string, unknown>
): Promise<StageOutputResponse> {
	return runs.stages.restampElement(runId, stage, elementId, { value });
}

export function invalidate(): void {
	// no-op: v3 store holds no cache. Kept so existing call sites compile
	// while the wider UI gut for B.4 is in flight.
}

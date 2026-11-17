// Auto-derive the regenerate scope from a list of selected open annotations.
//
// Rule (matches the FE-B plan):
//   - 0 selected             → null (caller hides the button)
//   - all share one element  → element scope, hits per-element regenerate
//   - any stage-pinned OR    → stage scope, hits whole-stage regenerate
//     mixed element targets
//
// The element scope passes ``element_type`` so the caller can route to the
// right URL (per-element regenerate is keyed by element_type+id).

import type { AnnotationResponse } from '$lib/types';

export type RegenScope =
	| {
			kind: 'element';
			elementId: string;
			annotationIds: string[];
	  }
	| {
			kind: 'stage';
			annotationIds: string[];
	  };

export function deriveScope(selected: AnnotationResponse[]): RegenScope | null {
	if (selected.length === 0) return null;

	const targets = new Set<string | null>(selected.map((a) => a.element_id));
	const ids = selected.map((a) => a.id);

	if (targets.size === 1 && !targets.has(null)) {
		const elementId = [...targets][0] as string;
		return { kind: 'element', elementId, annotationIds: ids };
	}

	return { kind: 'stage', annotationIds: ids };
}

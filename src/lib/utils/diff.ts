// Element-keyed diff between two stage drafts.
//
// Both drafts are arrays of objects keyed by a stable id (scene_id /
// shot_id / slide_id / line_id / chapter_id). The id-based diff produces
// per-element changes the UI can render in a single column or side-by-side.
//
// On 'modified' the caller can ask for a word-level inner diff over a
// specific text field (e.g. ``narrate.lines[i].text``). That uses jsdiff's
// diffWords; the array of {value, added?, removed?} parts maps directly to
// the inner spans rendered by DiffElementCard.

import { diffWords } from 'diff';

export type ElementChange =
	| { kind: 'unchanged'; id: string; left: IdentifiedElement; right: IdentifiedElement }
	| { kind: 'added'; id: string; right: IdentifiedElement }
	| { kind: 'removed'; id: string; left: IdentifiedElement }
	| { kind: 'modified'; id: string; left: IdentifiedElement; right: IdentifiedElement };

export interface IdentifiedElement {
	id: string;
	[k: string]: unknown;
}

export function diffByStableId(
	leftList: IdentifiedElement[],
	rightList: IdentifiedElement[]
): ElementChange[] {
	const leftById = new Map(leftList.map((e) => [e.id, e]));
	const rightById = new Map(rightList.map((e) => [e.id, e]));

	const changes: ElementChange[] = [];

	// Walk RIGHT first so the result preserves the right list's display
	// order (the new draft is what the operator wants to scan).
	for (const right of rightList) {
		const left = leftById.get(right.id);
		if (!left) {
			changes.push({ kind: 'added', id: right.id, right });
			continue;
		}
		if (deepEqual(left, right)) {
			changes.push({ kind: 'unchanged', id: right.id, left, right });
		} else {
			changes.push({ kind: 'modified', id: right.id, left, right });
		}
	}
	// Removed elements live at the end. Their relative order matches the
	// LEFT list (last accepted draft).
	for (const left of leftList) {
		if (!rightById.has(left.id)) {
			changes.push({ kind: 'removed', id: left.id, left });
		}
	}
	return changes;
}

export interface WordDiffPart {
	value: string;
	added?: boolean;
	removed?: boolean;
}

export function wordDiff(left: string, right: string): WordDiffPart[] {
	return diffWords(left, right);
}

// JSON.stringify is a coarse but correct equality for structured-clone-safe
// values (the stage payloads we ship are JSON, by design). The order of
// object keys can produce false-positive 'modified' if two stages serialize
// the same logical content with different key orders — accept the risk; the
// LLM produces stable orders.
function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

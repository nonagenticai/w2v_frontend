// Pure ordering helpers for verbatim items.
//
// Kept dependency-free (no store, no API, no Svelte) so the ordering rules are
// unit-testable in isolation — they are the part that silently produces a wrong
// pipeline if it drifts, and the part the UI cannot show you is wrong.

export interface Positioned {
	id: string;
	position: number;
	created_at: string;
}

/**
 * Stable render order: position, then created_at, then id.
 *
 * The two tiebreakers matter because `position` is not guaranteed unique — the
 * BE assigns it per project, older rows may share a value, and two items
 * created in the same request can land on the same number. Falling through to
 * created_at and finally id makes the order total, so a re-render never
 * reshuffles equal-position rows under the user.
 */
export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
	return [...items].sort((a, b) => {
		if (a.position !== b.position) return a.position - b.position;
		if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
		if (a.id !== b.id) return a.id < b.id ? -1 : 1;
		return 0;
	});
}

/**
 * Plan a one-step move of `itemId` within `trackItems` (same kind, any order).
 * Returns the position writes needed, or [] when the move is a no-op (already
 * at the edge, or itemId not present).
 *
 * Strategy: SWAP positions with the adjacent neighbour. A swap is correct
 * whether `position` is a global sequence or a per-kind one, and it never
 * invents or densifies values — the multiset of positions is unchanged, so it
 * cannot collide with a server-side unique constraint mid-flight.
 *
 * `dir === -1` moves the item up (earlier in render order), `+1` down.
 */
export function planMove<T extends Positioned>(
	trackItems: readonly T[],
	itemId: string,
	dir: -1 | 1
): { id: string; position: number }[] {
	// Never trust the caller's array order — the render order is the only order
	// the user reasoned about when clicking the arrow.
	const sorted = sortByPosition(trackItems);
	const index = sorted.findIndex((i) => i.id === itemId);
	if (index === -1) return [];

	const target = index + dir;
	if (target < 0 || target >= sorted.length) return [];

	const moving = sorted[index];
	const neighbour = sorted[target];

	if (moving.position !== neighbour.position) {
		return [
			{ id: moving.id, position: neighbour.position },
			{ id: neighbour.id, position: moving.position }
		];
	}

	// Degenerate case: the two swap partners share a position (the tiebreakers
	// decided their order), so swapping would write the same numbers back and
	// the move would appear to do nothing. Fall back to normalising the whole
	// track to its sorted index — with the pair transposed — and emit only the
	// rows whose position actually changes.
	const normalised = [...sorted];
	normalised[index] = neighbour;
	normalised[target] = moving;
	return normalised
		.map((item, i) => ({ id: item.id, position: i, was: item.position }))
		.filter((write) => write.position !== write.was)
		.map(({ id, position }) => ({ id, position }));
}

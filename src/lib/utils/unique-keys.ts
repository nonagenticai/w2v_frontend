/**
 * Keyed-`{#each}` key hardening.
 *
 * Svelte throws `each_key_duplicate` when a keyed `{#each}` sees the same key
 * twice, and an uncaught throw during render destroys the WHOLE page, not just
 * the offending list. Stage outputs arrive as untyped JSONB from the
 * orchestrator, so any field a component keys by (`sequence`, `id`, `number`)
 * can legitimately be absent for a payload shape that component was not written
 * for — every such row then keys as `undefined` and the run page goes blank.
 *
 * `withUniqueKeys` keeps genuine keyed-ness (identical input ⇒ identical key, so
 * DOM reuse across re-renders is preserved) and only disambiguates the
 * pathological repeats by appending an occurrence counter. It is NOT a licence to
 * drop the key: pass the most identity-bearing field available as `keyOf`.
 */
export interface Keyed<T> {
	item: T;
	index: number;
	key: string;
}

export function withUniqueKeys<T>(
	items: readonly T[],
	keyOf: (item: T, index: number) => string | number | null | undefined
): Keyed<T>[] {
	const seen = new Map<string, number>();
	return items.map((item, index) => {
		const raw = keyOf(item, index);
		// A missing key falls back to the position, which is unique by construction
		// and matches what an unkeyed `{#each}` would have done for that row.
		const base = raw === null || raw === undefined || raw === '' ? `@${index}` : String(raw);
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return { item, index, key: n === 1 ? base : `${base}#${n}` };
	});
}

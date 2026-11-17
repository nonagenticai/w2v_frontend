// Pipeline (run) order for a blueprint's stages.
//
// The orchestrator seeds every stage_output row in one transaction and lists
// them `ORDER BY created_at, stage_name` — so a run's stages arrive
// ALPHABETICAL ("Claim Finish" first, "Source Ingest" near the end), not in
// the order the pipeline runs them. The blueprint's declaration order is not
// topological either (demo_video declares `reconcile_timeline` before its
// upstream `demo_video_record`), so neither source alone is run order.
//
// This is a stable topological sort over the blueprint's `depends_on` edges:
// among the stages whose upstreams are all placed, the one that started
// earliest goes next, then the one declared earliest. Edges to stages outside the blueprint are ignored; a cycle (a
// malformed blueprint) degrades to declaration order for the remainder rather
// than dropping stages.

/** When each stage actually started (ISO timestamp), from the run's own
 *  `stage_outputs`. `null`/absent = not started yet. */
export type StageStartTimes = ReadonlyMap<string, string | null | undefined>;

/** Milliseconds since the epoch, keeping the MICROSECONDS Postgres stamps.
 *  `Date.parse` truncates to the millisecond, and sibling roots launched
 *  together start within µs of each other (the paused demo_video run:
 *  source_ingest at …27.051520Z, demo_video_gen at …27.051566Z) — truncated,
 *  they tie and the start-time tie-break silently does nothing.
 *  Unparseable/absent ⇒ +Infinity (not started). */
export function startInstant(iso: string | null | undefined): number {
	if (!iso) return Number.POSITIVE_INFINITY;
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
	const frac = /\.(\d+)/.exec(iso)?.[1] ?? '';
	const subMs = frac.length > 3 ? Number(frac.slice(3, 6).padEnd(3, '0')) / 1000 : 0;
	return ms + subMs;
}

/** stage name → rank in pipeline order, from the blueprint's `depends_on` map
 *  (whose insertion order is the blueprint's declaration order).
 *
 *  Declaration order alone is not enough to break ties between stages that are
 *  ready at the same time. demo_video has TWO roots — `demo_video_gen` and
 *  `source_ingest` — and gen is declared first, so a pure declaration tie-break
 *  listed "Demo Video Gen, Script Doctor, Source Ingest, …" although
 *  source_ingest is what the run executed first. So, among the ready stages,
 *  the one that STARTED earliest goes next (`startedAt`, from the run itself);
 *  stages that have not started yet follow, in declaration order. Because a
 *  stage can only start once its upstreams are done, this never contradicts the
 *  edges.
 *
 *  `runStages` are the names the run actually has. Any the blueprint does not
 *  know (the blueprint changed since the run was created, or no blueprint
 *  matched) still get a rank — ordered among the ready set by when they
 *  started, unstarted ones last — instead of keeping the API's alphabetical
 *  order. */
export function blueprintStageRank(
	dependsOn: ReadonlyMap<string, readonly string[]>,
	startedAt: StageStartTimes = new Map(),
	runStages: readonly string[] = []
): Map<string, number> {
	const nodes = [...dependsOn.keys()];
	const known = new Set(nodes);
	for (const name of runStages) {
		if (!known.has(name)) {
			known.add(name);
			nodes.push(name);
		}
	}
	const startMs = (name: string): number => startInstant(startedAt.get(name));
	const placed = new Set<string>();
	const rank = new Map<string, number>();
	const pick = (candidates: number[]): number | undefined => {
		let best: number | undefined;
		for (const i of candidates) {
			if (best === undefined) best = i;
			else {
				const a = startMs(nodes[i]);
				const b = startMs(nodes[best]);
				// Strict `<` keeps the earlier index on equal (incl. both unstarted).
				if (a < b) best = i;
			}
		}
		return best;
	};
	while (placed.size < nodes.length) {
		const remaining = nodes.map((_, i) => i).filter((i) => !placed.has(nodes[i]));
		const ready = remaining.filter((i) =>
			(dependsOn.get(nodes[i]) ?? []).every((dep) => placed.has(dep) || !known.has(dep))
		);
		// A cycle (malformed blueprint) leaves nothing ready: degrade to the same
		// started-then-declared order over what is left rather than drop stages.
		const next = pick(ready.length > 0 ? ready : remaining);
		if (next === undefined) break;
		placed.add(nodes[next]);
		rank.set(nodes[next], rank.size);
	}
	return rank;
}

/** Sort `items` into pipeline order by `rank`. Items the blueprint does not
 *  know keep their incoming relative order, after the known ones. Returns a
 *  new array; never mutates the input. */
export function sortByStageRank<T>(
	items: readonly T[],
	rank: ReadonlyMap<string, number>,
	nameOf: (item: T) => string
): T[] {
	if (rank.size === 0) return [...items];
	return items
		.map((item, i) => ({ item, i, r: rank.get(nameOf(item)) ?? Number.POSITIVE_INFINITY }))
		.sort((a, b) => a.r - b.r || a.i - b.i)
		.map((x) => x.item);
}

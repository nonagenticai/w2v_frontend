import { loadList } from '$lib/stores/projects.svelte.js';
import type { ProjectListResponse, ProjectResponse, ProjectType } from '$lib/types';

/** Server-side cap on `GET /projects?limit=` (orchestrator
 *  `projects.py: Query(ge=1, le=200)`). Asking for more is a 422, which would
 *  take the whole picker down. */
const CLONE_FETCH_LIMIT = 200;

export interface Cloneable {
	id: string;
	title: string;
	type: ProjectType;
}

export interface CloneablesResult {
	cloneables: Cloneable[];
	/** Total projects the tenant has, per the API — NOT the option count. */
	cloneablesTotal: number;
	/** True when the API had more projects than we fetched, so the dropdown is a
	 *  partial view. Drives the "showing N of M" hint. */
	cloneablesTruncated: boolean;
	/** The picker could not be loaded at all. Distinct from "no projects": an
	 *  empty list is a fact, a failure is a missing capability. */
	cloneablesFailed: boolean;
}

export const load = async (): Promise<CloneablesResult> => {
	// Populate the "Clone settings from" dropdown on the Brief step.
	//
	// Lessons are excluded because their brand/voice/theme are inherited from the
	// parent course and copying them only re-creates that inheritance one level
	// deeper. The exclusion MUST be applied to as wide a page as the API allows:
	// the filter runs client-side (the API has a single-value `type=` filter, no
	// "exclude type"), so filtering a 50-row page could — and did — return zero
	// options whenever the 50 most recent projects happened to all be lessons.
	// Fetching the server maximum makes that far less likely and, when the tenant
	// still has more projects than one page, `cloneablesTruncated` says so out
	// loud instead of silently hiding thousands of them.
	let res: ProjectListResponse;
	try {
		res = await loadList({ limit: CLONE_FETCH_LIMIT });
	} catch {
		return {
			cloneables: [],
			cloneablesTotal: 0,
			cloneablesTruncated: false,
			cloneablesFailed: true
		};
	}

	const items: ProjectResponse[] = res.items;
	const cloneables = items
		.filter((p: ProjectResponse) => p.type !== 'lesson')
		.map((p: ProjectResponse) => ({
			id: p.id,
			title: p.title,
			type: p.type as ProjectType
		}));

	return {
		cloneables,
		cloneablesTotal: res.total,
		cloneablesTruncated: items.length < res.total,
		cloneablesFailed: false
	};
};

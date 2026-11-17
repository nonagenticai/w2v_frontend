import { projects } from '$lib/api';
import { ApiError } from '$lib/api/client.js';
import { markBackendDown } from '$lib/stores/health.svelte.js';
import type { ProjectListResponse } from '$lib/types';

const emptyList: ProjectListResponse = { items: [], total: 0, limit: 20, offset: 0 };

/** A load that did not answer. Distinct from a load that answered "nothing". */
export interface DashboardLoadFailure {
	/** HTTP status when the failure came back from the API, else null (network/abort). */
	status: number | null;
	detail: string;
}

function toFailure(err: unknown): DashboardLoadFailure {
	if (err instanceof ApiError) return { status: err.status, detail: err.detail };
	if (err instanceof Error) return { status: null, detail: err.message };
	return { status: null, detail: String(err) };
}

function isBackendDownError(err: unknown): boolean {
	if (err instanceof ApiError) return err.status >= 500;
	return true;
}

export async function load() {
	// All fetches share one auth-ready gate (+layout.ts awaits ensureAuthReady()
	// before any +page.ts load). v3 dashboard maps onto projects (statuses:
	// drafting | producing | completed | archived); the legacy /api/pipeline
	// endpoint was deleted in the Studio v3 reset.
	const results = await Promise.allSettled([
		projects.list({ limit: 20, offset: 0 }),
		projects.list({ status: 'completed', limit: 1, offset: 0 }),
		projects.list({ status: 'producing', limit: 1, offset: 0 }),
		projects.list({ status: 'failed', limit: 1, offset: 0 })
	]);

	const allFailed = results.every((r) => r.status === 'rejected');
	const allBackendDown =
		allFailed && results.every((r) => r.status === 'rejected' && isBackendDownError(r.reason));
	if (allBackendDown) markBackendDown();

	const [projectListRes, completedRes, runningRes, failedRes] = results;

	// A rejected list fetch MUST NOT be presented as "you have no projects" — a
	// 400/404/429 previously fell through to `emptyList` and rendered the empty
	// state, telling the user their work was gone. `projectsError` is the whole
	// point of this shape: it makes "we could not load this" expressible and
	// distinguishable from "loaded, and it is empty". Consumers must branch on
	// `projectsError !== null` BEFORE looking at `projectList.items.length`.
	const projectsError: DashboardLoadFailure | null =
		projectListRes.status === 'rejected' ? toFailure(projectListRes.reason) : null;
	const projectList = projectListRes.status === 'fulfilled' ? projectListRes.value : emptyList;

	// Same gap, smaller blast radius: a failed count fetch used to be rendered as
	// a real `0`. Keep the numeric shape (StatsGrid needs numbers) but flag the
	// counts as unmeasured so the UI can decline to state a success rate.
	const statusCountsError: DashboardLoadFailure | null =
		completedRes.status === 'rejected'
			? toFailure(completedRes.reason)
			: runningRes.status === 'rejected'
				? toFailure(runningRes.reason)
				: failedRes.status === 'rejected'
					? toFailure(failedRes.reason)
					: null;

	const statusCounts = {
		completed: completedRes.status === 'fulfilled' ? (completedRes.value?.total ?? 0) : 0,
		running: runningRes.status === 'fulfilled' ? (runningRes.value?.total ?? 0) : 0,
		// Measured, not hard-coded: the failed-projects count.
		failed: failedRes.status === 'fulfilled' ? (failedRes.value?.total ?? 0) : 0
	};

	return { projectList, projectsError, statusCounts, statusCountsError };
}

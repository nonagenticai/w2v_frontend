// Projects store (Svelte 5 runes).
//
// Loads and caches projects + their deliverable trees by id. Pages call
// `loadList()` / `loadOne(pid)` from their +page.ts load functions and read
// state from getList() / getOne(pid) inside +page.svelte.

import { projects as projectsApi } from '$lib/api';
import type { CreateDraftProjectRequest } from '$lib/api';
import type {
	CreateChildProjectRequest,
	CreateProjectRequest,
	ProjectDetailResponse,
	ProjectListResponse,
	ProjectResponse,
	ReorderChildrenRequest,
	UpdateProjectRequest
} from '$lib/types';

let list = $state<ProjectListResponse | null>(null);
let listLoading = $state(false);
let byId = $state<Record<string, ProjectDetailResponse>>({});
let oneLoading = $state<Record<string, boolean>>({});

// Monotonic request counters guard against out-of-order responses: when a page
// fires loadList/loadOne in quick succession (filter change, rapid navigation),
// a slower earlier response must not overwrite newer data in the shared store.
// Plain counters, not $state — they gate writes, they're not rendered.
let listSeq = 0;
const oneSeq: Record<string, number> = {};

export async function loadList(params?: {
	status?: string;
	type?: string;
	sortBy?: string;
	order?: string;
	limit?: number;
	offset?: number;
}): Promise<ProjectListResponse> {
	const seq = ++listSeq;
	listLoading = true;
	try {
		const result = await projectsApi.list(params);
		// Only the latest in-flight request may publish to the shared store.
		if (seq === listSeq) list = result;
		return result;
	} finally {
		// Only the latest request owns the loading flag — an older one finishing
		// late must not clear it while a newer request is still in flight.
		if (seq === listSeq) listLoading = false;
	}
}

export function getList(): ProjectListResponse | null {
	return list;
}

export function isListLoading(): boolean {
	return listLoading;
}

export async function loadOne(projectId: string): Promise<ProjectDetailResponse> {
	const seq = (oneSeq[projectId] = (oneSeq[projectId] ?? 0) + 1);
	oneLoading = { ...oneLoading, [projectId]: true };
	try {
		const result = await projectsApi.get(projectId);
		// Only the latest in-flight request for this id may publish.
		if (seq === oneSeq[projectId]) byId = { ...byId, [projectId]: result };
		return result;
	} finally {
		if (seq === oneSeq[projectId]) oneLoading = { ...oneLoading, [projectId]: false };
	}
}

export function getOne(projectId: string): ProjectDetailResponse | undefined {
	return byId[projectId];
}

export function isOneLoading(projectId: string): boolean {
	return oneLoading[projectId] === true;
}

export async function create(
	req: CreateProjectRequest,
	opts?: { idempotencyKey?: string }
): Promise<ProjectDetailResponse> {
	const result = await projectsApi.create(req, opts);
	byId = { ...byId, [result.id]: result };
	// Invalidate list cache so the next list view re-fetches.
	list = null;
	return result;
}

/**
 * Pre-create a `drafting` project (storyboard wizard path). Mirrors `create`:
 * seeds the detail cache and invalidates the list so the next list re-fetches.
 */
export async function createDraft(
	req: CreateDraftProjectRequest,
	opts?: { idempotencyKey?: string }
): Promise<ProjectDetailResponse> {
	const result = await projectsApi.draft(req, opts);
	byId = { ...byId, [result.id]: result };
	// Invalidate list cache so the next list view re-fetches.
	list = null;
	return result;
}

export async function update(
	projectId: string,
	req: UpdateProjectRequest
): Promise<ProjectResponse> {
	const updated = await projectsApi.update(projectId, req);
	const cached = byId[projectId];
	if (cached) {
		byId = {
			...byId,
			[projectId]: { ...cached, ...updated }
		};
	}
	return updated;
}

/**
 * Replace the cached detail for a project with the given snapshot. Used by
 * tests and by WS reconciliation to seed/replace state without a fetch.
 */
export function setOneSnapshot(snapshot: ProjectDetailResponse): void {
	byId = { ...byId, [snapshot.id]: snapshot };
}

/**
 * Create a child project under `parentId`. Appends the returned child row to
 * the parent's `children` list in cache so the page re-renders without a refetch.
 */
export async function addChild(
	parentId: string,
	req: CreateChildProjectRequest,
	opts?: { idempotencyKey?: string }
): Promise<ProjectResponse> {
	const child = await projectsApi.addChild(parentId, req, opts);
	const parent = byId[parentId];
	if (parent) {
		byId = {
			...byId,
			[parentId]: { ...parent, children: [...parent.children, child] }
		};
	}
	return child;
}

/**
 * Reorder children locally + call BE PATCH. Positions on the cached children
 * are renumbered 1..N to match the BE; the BE renumbers as part of the PATCH
 * so the cache stays in sync without a refetch.
 */
export async function reorderChildren(
	parentId: string,
	req: ReorderChildrenRequest
): Promise<void> {
	await projectsApi.reorderChildren(parentId, req);
	const parent = byId[parentId];
	if (!parent) return;
	const byChildId: Record<string, ProjectResponse> = {};
	for (const c of parent.children) byChildId[c.id] = c;
	const reordered: ProjectResponse[] = [];
	req.ordered_child_ids.forEach((id, idx) => {
		const c = byChildId[id];
		if (c) reordered.push({ ...c, position: idx + 1 });
	});
	byId = {
		...byId,
		[parentId]: { ...parent, children: reordered }
	};
}

// ---------------------------------------------------------------------------
// WebSocket / SSE reconciliation helpers
//
// These mirror the BE's project-level lifecycle events (child_added,
// child_reordered, child_status_changed). They are pure cache mutations —
// the transport (SSE on /api/projects/{id}/events) lives on a follow-up to
// the BE-1 PR; the FE wiring will plug into these helpers from the project
// page once that endpoint exists.
// ---------------------------------------------------------------------------

export function applyChildAdded(parentId: string, child: ProjectResponse): void {
	const parent = byId[parentId];
	if (!parent) return;
	if (parent.children.some((c) => c.id === child.id)) return;
	byId = {
		...byId,
		[parentId]: { ...parent, children: [...parent.children, child] }
	};
}

export function applyChildReordered(parentId: string, order: string[]): void {
	const parent = byId[parentId];
	if (!parent) return;
	// Local lookup, not stored as state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const byCid = new Map(parent.children.map((c) => [c.id, c]));
	const next: ProjectResponse[] = [];
	for (const id of order) {
		const c = byCid.get(id);
		if (c) next.push({ ...c, position: next.length + 1 });
	}
	byId = { ...byId, [parentId]: { ...parent, children: next } };
}

export function applyChildStatusChanged(
	parentId: string,
	childId: string,
	status: ProjectResponse['status']
): void {
	const parent = byId[parentId];
	if (!parent) return;
	const next = parent.children.map((c) => (c.id === childId ? { ...c, status } : c));
	byId = { ...byId, [parentId]: { ...parent, children: next } };
}

/**
 * Soft-delete (archive) a project. Drops it from the detail cache and
 * invalidates the list so the next load re-fetches without it.
 */
export async function removeProject(projectId: string): Promise<void> {
	await projectsApi.remove(projectId);
	const next = { ...byId };
	delete next[projectId];
	byId = next;
	list = null;
}

export function invalidate(projectId?: string): void {
	if (projectId) {
		const next = { ...byId };
		delete next[projectId];
		byId = next;
	} else {
		byId = {};
		list = null;
	}
}

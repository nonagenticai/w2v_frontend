import type {
	ProjectResponse,
	ProjectDetailResponse,
	ProjectListResponse,
	CreateProjectRequest,
	UpdateProjectRequest,
	CreateChildProjectRequest,
	ReorderChildrenRequest,
	CreateDeliverableRequest,
	DeliverableResponse
} from '$lib/types';
import type { components } from './types.gen.js';
import { api } from './client.js';

type ProjectDraftCreate = components['schemas']['ProjectDraftCreate'];

/** Body for `POST /projects/draft` — pre-create a `drafting` project of a chosen
 *  type with NO deliverables (the wizard adds them at finalize). The generated
 *  `ProjectDraftCreate`, with the server-defaulted `title` / `visibility` left
 *  optional. `clone_from_project_id` seeds the draft's brief defaults / brand /
 *  voice / theme from that project (same tenant; 404 `clone_source_not_found`
 *  otherwise) — w2v_orchestrator#1116. */
export type CreateDraftProjectRequest = Pick<ProjectDraftCreate, 'type'> &
	Partial<Omit<ProjectDraftCreate, 'type'>>;

export const projects = {
	list(params?: {
		status?: string;
		type?: string;
		sortBy?: string;
		order?: string;
		limit?: number;
		offset?: number;
	}): Promise<ProjectListResponse> {
		const qs = new URLSearchParams();
		if (params?.status) qs.set('status', params.status);
		if (params?.type) qs.set('type', params.type);
		if (params?.sortBy) qs.set('sort_by', params.sortBy);
		if (params?.order) qs.set('order', params.order);
		if (params?.limit !== undefined) qs.set('limit', String(params.limit));
		if (params?.offset !== undefined) qs.set('offset', String(params.offset));
		const suffix = qs.toString() ? `?${qs}` : '';
		return api.get<ProjectListResponse>(`/projects${suffix}`);
	},

	get(projectId: string): Promise<ProjectDetailResponse> {
		return api.get<ProjectDetailResponse>(`/projects/${projectId}`);
	},

	create(
		req: CreateProjectRequest,
		opts?: { idempotencyKey?: string }
	): Promise<ProjectDetailResponse> {
		return api.post<ProjectDetailResponse>('/projects', req, opts);
	},

	/** Pre-create a `drafting` project (chosen type, no deliverables). Returns a
	 *  full ProjectDetailResponse the wizard scopes its live storyboard UI to,
	 *  then finalizes via update + addDeliverable at Review submit. */
	draft(
		req: CreateDraftProjectRequest,
		opts?: { idempotencyKey?: string }
	): Promise<ProjectDetailResponse> {
		return api.post<ProjectDetailResponse>('/projects/draft', req, opts);
	},

	update(projectId: string, req: UpdateProjectRequest): Promise<ProjectResponse> {
		return api.patch<ProjectResponse>(`/projects/${projectId}`, req);
	},

	addDeliverable(projectId: string, req: CreateDeliverableRequest): Promise<DeliverableResponse> {
		return api.post<DeliverableResponse>(`/projects/${projectId}/deliverables`, req);
	},

	/** Create a child project under `projectId`. BE returns the bare child row. */
	addChild(
		projectId: string,
		req: CreateChildProjectRequest,
		opts?: { idempotencyKey?: string }
	): Promise<ProjectResponse> {
		return api.post<ProjectResponse>(`/projects/${projectId}/children`, req, opts);
	},

	/** Reorder existing children. BE returns 204; resolved to void. */
	reorderChildren(projectId: string, req: ReorderChildrenRequest): Promise<void> {
		return api.patch<void>(`/projects/${projectId}/children/reorder`, req);
	},

	/** Soft-delete (archive) a project. BE returns 204; archived rows drop out
	 *  of the default list. Named `remove` because `delete` is a reserved word. */
	remove(projectId: string): Promise<void> {
		return api.delete<void>(`/projects/${projectId}`);
	}
};

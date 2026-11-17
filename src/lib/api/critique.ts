import type { CritiqueList, CritiqueResponse, CritiqueCategory } from '$lib/types';
import { api, ApiError } from './client.js';

const VALID_CATEGORIES: CritiqueCategory[] = ['seo', 'a11y', 'security', 'performance', 'ux'];

/**
 * Normalize a raw critique API response to match the CritiqueResponse interface.
 * The backend returns `category_scores` / `job_id` / `error` whereas the frontend
 * type uses `scores` / `id` / `error_message` / `categories`.
 */
function normalizeCritiqueResponse(raw: Record<string, unknown>): CritiqueResponse {
	const categoryScores = (raw.category_scores ?? raw.scores ?? {}) as Record<string, number>;

	// Map 'accessibility' key to canonical 'a11y' if present
	if ('accessibility' in categoryScores && !('a11y' in categoryScores)) {
		categoryScores['a11y'] = categoryScores['accessibility'];
		delete categoryScores['accessibility'];
	}

	const categories = VALID_CATEGORIES.filter((c) => c in categoryScores);

	return {
		id: (raw.id ?? raw.job_id ?? '') as string,
		job_id: (raw.job_id ?? null) as string | null,
		url: (raw.url ?? '') as string,
		status: (raw.status ?? 'pending') as CritiqueResponse['status'],
		categories,
		findings: Array.isArray(raw.findings) ? raw.findings : [],
		scores: categoryScores,
		summary: (raw.summary ?? null) as string | null,
		pages_scanned: (raw.pages_scanned ?? 0) as number,
		github_repo_url: (raw.github_repo_url ?? null) as string | null,
		repo_detection_confidence: (raw.repo_detection_confidence ?? null) as string | null,
		error_message: (raw.error_message ?? raw.error ?? null) as string | null,
		created_at: (raw.created_at ?? '') as string,
		completed_at: (raw.completed_at ?? null) as string | null
	};
}

export interface CritiqueCreateRequest {
	url: string;
	categories?: CritiqueCategory[];
	instructions?: string;
	max_pages?: number;
}

export const critique = {
	async create(req: CritiqueCreateRequest): Promise<CritiqueResponse> {
		// Orchestrator POST /api/critique → analysis_service. Returns the new job
		// keyed by `job_id`; normalize so callers get a stable `id` to route to.
		const raw = await api.post<Record<string, unknown>>('/critique', req);
		return normalizeCritiqueResponse(raw);
	},

	async list(page = 1, pageSize = 20, status?: string): Promise<CritiqueList> {
		const params = new URLSearchParams();
		params.set('page', String(page));
		params.set('page_size', String(pageSize));
		if (status) params.set('status', status);
		const raw = await api.get<{
			items?: Record<string, unknown>[];
			total?: number;
			page?: number;
			page_size?: number;
		}>(`/critique?${params}`);
		// analysis_service responds with raw items keyed by `job_id` (no `id`).
		// Without per-item normalization the CritiqueResponse type lies at
		// runtime, leading to `<a href={`/critique/${item.id}`}>` rendering
		// `/critique/undefined` and a 404 storm on the list page.
		const items = Array.isArray(raw.items) ? raw.items.map(normalizeCritiqueResponse) : [];
		return {
			items,
			total: typeof raw.total === 'number' ? raw.total : items.length,
			page: typeof raw.page === 'number' ? raw.page : page,
			page_size: typeof raw.page_size === 'number' ? raw.page_size : pageSize
		};
	},

	async get(id: string): Promise<CritiqueResponse> {
		// Guard against `/critique/undefined` requests synthesized from a
		// stale link or an upstream item missing its id. Surface as a 404
		// equivalent so `+page.ts` shows the canonical "not found" view.
		if (!id || id === 'undefined' || id === 'null') {
			throw new ApiError(404, 'Critique not found', 'NOT_FOUND');
		}
		const raw = await api.get<Record<string, unknown>>(`/critique/${id}`);
		return normalizeCritiqueResponse(raw);
	}
};

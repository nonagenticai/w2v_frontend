import { api } from './client.js';
import type { components } from './types.gen.js';

/** One media item returned by media-discovery (trimmed by the orchestrator
 *  `POST /api/media/search` route).
 *
 *  Field-for-field identical to the generated schema, so alias it rather than
 *  keep a second copy that can silently diverge. */
export type MediaResult = components['schemas']['MediaResult'];

export interface MediaSearchResult {
	results: MediaResult[];
	total: number;
	sources_queried: string[];
	sources_failed: string[];
}

export interface MediaSearchParams {
	sources?: string[];
	media_types?: string[];
	limit?: number;
}

export const media = {
	/**
	 * Search media-discovery for real images/clips to pin onto a project's
	 * sources (the wizard's "Find media" panel). The orchestrator authorizes the
	 * media-discovery call with its service token, so the SPA only needs to be signed in.
	 */
	search(query: string, params: MediaSearchParams = {}): Promise<MediaSearchResult> {
		return api.post<MediaSearchResult>('/media/search', { query, ...params });
	}
};

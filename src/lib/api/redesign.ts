import type { RedesignJob, RedesignResult } from '$lib/types';
import { api } from './client.js';

export interface RedesignCreateRequest {
	url: string;
	/** Findings from a completed critique — redesign addresses what they flagged. */
	critique_findings?: unknown[];
	scope?: string;
	style?: string;
	styles?: string[];
}

/*
 * ⚠️ These paths MUST be `/redesign*`, never `/designs*`.
 *
 * `/api/designs` only ever worked under `vite dev`: the dev-only SvelteKit
 * proxy (`src/routes/api/[...path]/+server.ts`) special-cases a `designs`
 * prefix and forwards it straight to HTML_RENDER_URL. The PRODUCTION
 * entrypoint is `server.js` (`CMD ["node","server.js"]`), which knows nothing
 * about `designs` / HTML_RENDER_URL and forwards every `/api/*` to the
 * orchestrator. The orchestrator mounts `APIRouter(prefix="/api/redesign")`
 * and has no `/api/designs` at all — so a `/designs*` call is a hard 404 in
 * production while looking perfectly healthy in dev.
 *
 * The orchestrator's `/api/redesign/*` forwards to html_render_service's
 * `/api/designs/*`, so the route shapes map 1:1 — see `downloads.ts`, which
 * has always used the correct prefix.
 */
export const redesign = {
	/** Start a design job. Orchestrator POST /api/redesign → html_render_service. */
	create(req: RedesignCreateRequest): Promise<RedesignJob> {
		return api.post<RedesignJob>('/redesign', req);
	},

	/** Poll a design job's status. */
	get(jobId: string): Promise<RedesignJob> {
		return api.get<RedesignJob>(`/redesign/jobs/${jobId}`);
	},

	/** Fetch the full result (variants + artifacts) of a completed design job. */
	result(jobId: string): Promise<RedesignResult> {
		return api.get<RedesignResult>(`/redesign/jobs/${jobId}/result`);
	}
};

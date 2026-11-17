import { getToken } from '$lib/services/keycloak.js';
import {
	ApiError,
	codeFromBody,
	detailFromBody,
	detailsFromBody,
	getActiveTenantId,
	getTenantHeader
} from './client.js';

/**
 * Download helpers for user-generated artifacts (videos, slides, reports,
 * client bundles). These wrap raw fetch + browser blob plumbing so call sites
 * don't have to repeat the keycloak-token-at-request-time + tenant-header
 * dance, and so error handling matches the rest of `$lib/api`.
 *
 * Auth headers are built HERE, independently of `client.ts` — this module does
 * not go through `request()`. The comment that used to sit here claimed they
 * "mirror client.ts", and that claim is exactly what hid a bug: `client.ts`
 * grew the super-admin `X-Active-Tenant-Id` scope-switch header and this copy
 * did not, so every byte-returning route below (report PDFs, redesign HTML,
 * storyboard CSV/EDL/FCPXML, and `fetchArtifact` itself) silently re-scoped to
 * the admin's own tenant and 404'd while browsing another tenant. Treat the two
 * header builders as siblings that must be changed together, not as one
 * mirroring the other.
 *
 * The three axes:
 *  - Authorization is read FRESH from Keycloak per request
 *  - X-Tenant-Id carries `Bearer <license_token>` per backend contract,
 *    only when a license token is in scope (otherwise omitted — backend
 *    falls back to the JWT in Authorization).
 *  - X-Active-Tenant-Id carries the super-admin tenant switch, only when one is
 *    selected. These are real `fetch()` calls, so the switch goes in the header
 *    (the `active_tenant` query param is only for channels that cannot set
 *    headers — SSE and browser-initiated media; see `scopedMediaUrl`).
 *
 * On non-2xx, throws `ApiError` (same envelope as the JSON `api` client).
 */

function authHeaders(): Record<string, string> {
	const token = getToken();
	const headers: Record<string, string> = {};
	const tenant = getTenantHeader();
	if (tenant) headers['X-Tenant-Id'] = tenant;
	const activeTenant = getActiveTenantId();
	if (activeTenant) headers['X-Active-Tenant-Id'] = activeTenant;
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

/**
 * The `ApiError` for a non-2xx byte-route response, parsed with the SAME body
 * readers as the JSON client — so `code` and the structured `details` survive
 * (a 402 `byo_provider_required` on the voice preview is recognised by
 * `byoProviderRequiredFromError` exactly like one from `request()`), and an
 * object `detail` renders as its message instead of `[object Object]`.
 */
async function blobError(response: Response): Promise<ApiError> {
	let detail = response.statusText;
	let code: string | undefined;
	let details: Record<string, unknown> | undefined;
	try {
		const body: unknown = await response.clone().json();
		detail = detailFromBody(body, response.statusText);
		code = codeFromBody(body);
		details = detailsFromBody(body);
	} catch {
		// keep statusText fallback
	}
	return new ApiError(response.status, response.statusText, detail, code, details);
}

async function fetchArtifact(path: string, accept?: string): Promise<Response> {
	const headers = authHeaders();
	if (accept) headers.Accept = accept;
	const response = await fetch(`/api${path}`, { headers });
	if (!response.ok) throw await blobError(response);
	return response;
}

/**
 * POST /api{path} with a JSON body and read the response back as a binary blob.
 * Used for endpoints that return audio/image bytes from a POST (e.g. TTS voice
 * preview). Same auth-header dance + ApiError envelope as `fetchArtifact`.
 */
export async function postForBlob(path: string, body: unknown, accept?: string): Promise<Blob> {
	const headers: Record<string, string> = { ...authHeaders(), 'Content-Type': 'application/json' };
	if (accept) headers.Accept = accept;
	const response = await fetch(`/api${path}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
	if (!response.ok) throw await blobError(response);
	return response.blob();
}

/**
 * Trigger a browser save-as for an in-memory blob using a hidden anchor.
 * Centralised so cleanup of the object URL is guaranteed.
 */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	} finally {
		URL.revokeObjectURL(url);
	}
}

export interface DownloadResult {
	blob: Blob;
	filename: string;
}

/**
 * GET /api{path} as a binary blob. Resolves to the blob + the filename to
 * suggest. The caller is expected to pass an explicit filename — the helper
 * does NOT trust Content-Disposition because our edge strips it on cross-origin
 * proxy hops.
 */
export async function downloadBlob(
	path: string,
	filename: string,
	accept?: string
): Promise<DownloadResult> {
	const response = await fetchArtifact(path, accept);
	const blob = await response.blob();
	return { blob, filename };
}

/**
 * Download a binary artifact and trigger save-as in one shot.
 */
export async function downloadAndSave(
	path: string,
	filename: string,
	accept?: string
): Promise<void> {
	const { blob } = await downloadBlob(path, filename, accept);
	saveBlob(blob, filename);
}

/**
 * GET a JSON artifact and save it as a pretty-printed .json file. Used for
 * client report bundles, which the orchestrator returns as JSON but the user
 * expects to download.
 */
export async function downloadJsonAsFile<T = unknown>(path: string, filename: string): Promise<T> {
	const response = await fetchArtifact(path, 'application/json');
	const payload = (await response.json()) as T;
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	saveBlob(blob, filename);
	return payload;
}

export const downloads = {
	saveBlob,
	downloadBlob,
	downloadAndSave,
	downloadJsonAsFile,

	/**
	 * Critique → report PDF. Path lives on the orchestrator's critique proxy
	 * (`/api/critique/{job_id}/report/pdf` → analysis_service).
	 */
	critiqueReportPdf(critiqueRunId: string, filename: string): Promise<void> {
		return downloadAndSave(`/critique/${critiqueRunId}/report/pdf`, filename, 'application/pdf');
	},

	/**
	 * SEO/CRO audit → the run's scorecard as a PDF. Rendered on demand by the
	 * orchestrator (`/api/runs/{run_id}/report/pdf`) from the scan output via
	 * html_render_service (headless Chromium).
	 */
	auditReportPdf(runId: string, filename: string): Promise<void> {
		return downloadAndSave(`/runs/${runId}/report/pdf`, filename, 'application/pdf');
	},

	/**
	 * Design → a single variant's HTML. The orchestrator proxy is mounted at
	 * `/api/redesign/*` (it forwards to html_render_service's `/api/designs/*`).
	 */
	redesignVariantHtml(jobId: string, style: string, filename: string): Promise<void> {
		return downloadAndSave(
			`/redesign/jobs/${jobId}/variants/${encodeURIComponent(style)}/html`,
			filename,
			'text/html'
		);
	},

	/**
	 * Design → the primary generated HTML (single-style jobs without variants),
	 * via the orchestrator redesign proxy (`/api/redesign/jobs/{job_id}/html`).
	 */
	redesignHtml(jobId: string, filename: string): Promise<void> {
		return downloadAndSave(`/redesign/jobs/${jobId}/html`, filename, 'text/html');
	},

	/**
	 * Design → the generated page rendered to PDF (minted on demand by
	 * html_render_service), via the orchestrator redesign proxy.
	 */
	redesignPdf(jobId: string, filename: string): Promise<void> {
		return downloadAndSave(`/redesign/jobs/${jobId}/pdf`, filename, 'application/pdf');
	},

	/**
	 * Storyboard → the project's shot list as CSV, minted by the orchestrator
	 * (`/api/projects/{project_id}/storyboard/export.csv`).
	 */
	storyboardCsv(projectId: string, filename = `storyboard-${projectId}.csv`): Promise<void> {
		return downloadAndSave(`/projects/${projectId}/storyboard/export.csv`, filename, 'text/csv');
	},

	/**
	 * Storyboard → the project's timeline as a CMX3600 EDL, minted by the
	 * orchestrator (`/api/projects/{project_id}/storyboard/export.edl`).
	 */
	storyboardEdl(projectId: string, filename = `storyboard-${projectId}.edl`): Promise<void> {
		return downloadAndSave(`/projects/${projectId}/storyboard/export.edl`, filename, 'text/plain');
	},

	/**
	 * Storyboard → the project's timeline as Final Cut Pro XML, minted by the
	 * orchestrator (`/api/projects/{project_id}/storyboard/export.fcpxml`).
	 */
	storyboardFcpxml(projectId: string, filename = `storyboard-${projectId}.fcpxml`): Promise<void> {
		return downloadAndSave(
			`/projects/${projectId}/storyboard/export.fcpxml`,
			filename,
			'application/xml'
		);
	},

	/**
	 * Storyboard → the project's shot list as a printable PDF, minted by the
	 * orchestrator (`/api/projects/{project_id}/storyboard/export.pdf`).
	 */
	storyboardPdf(projectId: string, filename = `storyboard-${projectId}.pdf`): Promise<void> {
		return downloadAndSave(
			`/projects/${projectId}/storyboard/export.pdf`,
			filename,
			'application/pdf'
		);
	}
};

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { redesign } from './redesign.js';

/*
 * REGRESSION GUARD — dev-vs-prod proxy divergence.
 *
 * These assertions previously PINNED the defect: they asserted `/api/designs`,
 * which only resolves under `vite dev` (the dev-only SvelteKit proxy in
 * `src/routes/api/[...path]/+server.ts` special-cases a `designs` prefix onto
 * HTML_RENDER_URL). Production runs `server.js`, which proxies every `/api/*`
 * to the orchestrator, and the orchestrator has no `/api/designs` — its router
 * is `APIRouter(prefix="/api/redesign")`. So the green test certified a client
 * that 404s in production only.
 *
 * Do NOT "restore" `/api/designs` here. `/api/redesign/*` is the contract; the
 * orchestrator forwards it to html_render_service's `/api/designs/*`.
 */
describe('redesign api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	it('create POSTs url + critique_findings to /api/redesign (NOT /api/designs)', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ job_id: 'rd-1', status: 'pending' })
		});
		const job = await redesign.create({
			url: 'https://example.com',
			critique_findings: [{ finding_id: 'f1' }]
		});
		expect(job.job_id).toBe('rd-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/redesign');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({
			url: 'https://example.com',
			critique_findings: [{ finding_id: 'f1' }]
		});
	});

	it('get polls /api/redesign/jobs/{id} (NOT /api/designs/...)', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ job_id: 'rd-1', status: 'running' })
		});
		const job = await redesign.get('rd-1');
		expect(job.status).toBe('running');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/redesign/jobs/rd-1');
	});

	it('result GETs /api/redesign/jobs/{id}/result with variants', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({
				job_id: 'rd-1',
				url: 'https://example.com',
				scope: 'full_page',
				style: 'modern',
				variants: [{ variant_id: 'v1', style: 'modern', status: 'completed' }]
			})
		});
		const res = await redesign.result('rd-1');
		expect(res.variants?.[0].style).toBe('modern');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/redesign/jobs/rd-1/result');
	});
});

describe('redesign api client — production reachability', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
	});

	/*
	 * `server.js` (the prod entrypoint) forwards EVERY /api/* to the
	 * orchestrator. This is the orchestrator's real redesign router surface:
	 *   APIRouter(prefix="/api/redesign")
	 *     POST ""                                   GET "/jobs/{job_id}"
	 *     GET  "/jobs/{job_id}/result"              GET "/jobs/{job_id}/html"
	 *     GET  "/jobs/{job_id}/pdf"
	 *     GET  "/jobs/{job_id}/variants/{style}/html"
	 * Anything this client requests that does not match one of these is a 404
	 * in production, no matter how green `vite dev` looks.
	 */
	const ORCHESTRATOR_REDESIGN_ROUTES = [
		/^\/api\/redesign$/,
		/^\/api\/redesign\/jobs\/[^/]+$/,
		/^\/api\/redesign\/jobs\/[^/]+\/result$/,
		/^\/api\/redesign\/jobs\/[^/]+\/html$/,
		/^\/api\/redesign\/jobs\/[^/]+\/pdf$/,
		/^\/api\/redesign\/jobs\/[^/]+\/variants\/[^/]+\/html$/
	];

	const reachableInProd = (path: string) => ORCHESTRATOR_REDESIGN_ROUTES.some((r) => r.test(path));

	it.each([
		['create', () => redesign.create({ url: 'https://example.com' })],
		['get', () => redesign.get('rd-1')],
		['result', () => redesign.result('rd-1')]
	])('%s hits a path the orchestrator actually serves', async (_name, call) => {
		await call();
		const path = fetchMock.mock.calls[0][0] as string;
		expect(path.startsWith('/api/designs')).toBe(false);
		expect(reachableInProd(path)).toBe(true);
	});
});

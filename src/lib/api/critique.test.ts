import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { critique } from './critique.js';
import { ApiError } from './client.js';

describe('critique api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	describe('list', () => {
		it('normalizes job_id → id on each item so /critique/${item.id} stops rendering "undefined"', async () => {
			// analysis_service returns raw items keyed `job_id` (no `id`). Without
			// per-item normalization the FE list page produced `<a
			// href="/critique/undefined">` and any router preload fired
			// GET /api/critique/undefined → 404 in the browser console.
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					items: [
						{
							job_id: 'c-1',
							url: 'https://example.com',
							status: 'completed',
							category_scores: { ux: 0.8 },
							findings: [],
							created_at: '2026-05-20T00:00:00Z'
						},
						{
							job_id: 'c-2',
							url: 'https://example.org',
							status: 'running',
							category_scores: {},
							findings: [],
							created_at: '2026-05-20T01:00:00Z'
						}
					],
					total: 2,
					page: 1,
					page_size: 20
				})
			});
			const result = await critique.list();
			expect(result.items).toHaveLength(2);
			expect(result.items.map((i) => i.id)).toEqual(['c-1', 'c-2']);
			expect(result.items[0].url).toBe('https://example.com');
			expect(result.total).toBe(2);
		});

		it('falls back to safe defaults when the upstream omits envelope fields', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ items: [] })
			});
			const result = await critique.list(3, 50);
			expect(result.items).toEqual([]);
			expect(result.total).toBe(0);
			expect(result.page).toBe(3);
			expect(result.page_size).toBe(50);
		});

		it('forwards status filter to the query string', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ items: [], total: 0, page: 1, page_size: 20 })
			});
			await critique.list(1, 20, 'completed');
			const [url] = fetchMock.mock.calls[0];
			expect(url).toContain('status=completed');
		});
	});

	describe('create', () => {
		it('POSTs the url to /api/critique and normalizes job_id → id', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					job_id: 'new-job',
					url: 'https://example.com',
					status: 'pending',
					findings: []
				})
			});
			const result = await critique.create({ url: 'https://example.com' });
			expect(result.id).toBe('new-job');
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/api/critique');
			expect(init.method).toBe('POST');
			expect(JSON.parse(init.body as string)).toEqual({ url: 'https://example.com' });
		});
	});

	describe('get', () => {
		it('rejects the literal "undefined"/"null" segment locally without hitting the network', async () => {
			await expect(critique.get('undefined')).rejects.toBeInstanceOf(ApiError);
			await expect(critique.get('null')).rejects.toBeInstanceOf(ApiError);
			await expect(critique.get('')).rejects.toBeInstanceOf(ApiError);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('normalizes a single response (job_id → id)', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					job_id: 'real-id',
					url: 'https://example.com',
					status: 'completed',
					category_scores: { accessibility: 0.9 }, // legacy key — should map to a11y
					findings: [],
					created_at: '2026-05-20T00:00:00Z'
				})
			});
			const result = await critique.get('real-id');
			expect(result.id).toBe('real-id');
			expect(result.scores.a11y).toBe(0.9);
			expect(result.scores.accessibility).toBeUndefined();
		});
	});
});

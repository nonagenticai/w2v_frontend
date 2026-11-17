import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { storyboard } from './storyboard.js';

describe('storyboard api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0 })
		});
	});

	it('listPanels GETs the project storyboard panels', async () => {
		await storyboard.listPanels('proj-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/panels');
		expect(init.method).toBeUndefined();
	});

	it('createPanel POSTs the body to the project panels route', async () => {
		await storyboard.createPanel('proj-1', { shot_key: 'clip-1', status: 'draft' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/panels');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ shot_key: 'clip-1', status: 'draft' });
	});

	it('updatePanel PATCHes the panel-scoped route with the partial body', async () => {
		await storyboard.updatePanel('panel-9', { action_description: 'wide shot' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/panels/panel-9');
		expect(url).not.toContain('/projects/');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ action_description: 'wide shot' });
	});

	it('deletePanel DELETEs the panel-scoped route', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deletePanel('panel-9');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/panels/panel-9');
		expect(init.method).toBe('DELETE');
	});

	it('reorderPanels PATCHes the reorder route and returns the reordered rows', async () => {
		const rows = [
			{ id: 'p2', lock_version: 1, position: 0 },
			{ id: 'p1', lock_version: 1, position: 1 }
		];
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => rows });
		const result = await storyboard.reorderPanels('proj-1', ['p2', 'p1']);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/panels/reorder');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ ordered_panel_ids: ['p2', 'p1'] });
		// The 200 body (new order + fresh tokens) is returned for the store to reconcile.
		expect(result.map((r) => [r.id, r.lock_version])).toEqual([
			['p2', 1],
			['p1', 1]
		]);
	});

	it('draftFromBrief POSTs the project draft route with the brief body', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ panels: [], assets: [], scenes: [] })
		});
		await storyboard.draftFromBrief('proj-1', { panel_count: 6 } as never);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/draft');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ panel_count: 6 });
	});

	it('rewritePanel POSTs the panel-scoped rewrite route', async () => {
		await storyboard.rewritePanel('panel-9', { instruction: 'punch it up' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/panels/panel-9/rewrite');
		expect(url).not.toContain('/projects/');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ instruction: 'punch it up' });
	});

	it('listAssets GETs the project assets route', async () => {
		await storyboard.listAssets('proj-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/assets');
		expect(init.method).toBeUndefined();
	});

	it('createAsset POSTs the body to the project assets route', async () => {
		await storyboard.createAsset('proj-1', { kind: 'character', name: 'Ada' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/assets');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ kind: 'character', name: 'Ada' });
	});

	it('updateAsset PATCHes the asset-scoped route', async () => {
		await storyboard.updateAsset('asset-3', { name: 'Ada Lovelace' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/assets/asset-3');
		expect(url).not.toContain('/projects/');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ name: 'Ada Lovelace' });
	});

	it('deleteAsset DELETEs the asset-scoped route', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deleteAsset('asset-3');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/assets/asset-3');
		expect(init.method).toBe('DELETE');
	});

	it('listScenes GETs the project scenes route', async () => {
		await storyboard.listScenes('proj-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/scenes');
		expect(init.method).toBeUndefined();
	});

	it('createScene POSTs the body to the project scenes route', async () => {
		await storyboard.createScene('proj-1', { name: 'Opening' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/scenes');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ name: 'Opening' });
	});

	it('updateScene PATCHes the scene-scoped route', async () => {
		await storyboard.updateScene('scene-2', { location: 'Rooftop' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/scenes/scene-2');
		expect(url).not.toContain('/projects/');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ location: 'Rooftop' });
	});

	it('deleteScene DELETEs the scene-scoped route', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deleteScene('scene-2');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/scenes/scene-2');
		expect(init.method).toBe('DELETE');
	});

	it('listSnapshots GETs the project snapshots route with no query params when called bare', async () => {
		await storyboard.listSnapshots('proj-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/snapshots');
		expect(url).not.toContain('?');
		expect(init.method).toBeUndefined();
	});

	it('listSnapshots threads limit + offset as query params when provided', async () => {
		await storyboard.listSnapshots('proj-1', { limit: 20, offset: 40 });
		const [url] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/snapshots?');
		expect(url).toContain('limit=20');
		expect(url).toContain('offset=40');
	});

	it('deleteSnapshot DELETEs the project-scoped snapshot route', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deleteSnapshot('proj-1', 'snap-9');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/snapshots/snap-9');
		expect(init.method).toBe('DELETE');
	});
});

describe('storyboard branches api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0 })
		});
	});

	it('listBranches GETs the project branches route with no query params when called bare', async () => {
		await storyboard.listBranches('proj-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/branches');
		expect(url).not.toContain('?');
		expect(init.method).toBeUndefined();
	});

	it('listBranches threads limit + offset as query params when provided', async () => {
		await storyboard.listBranches('proj-1', { limit: 10, offset: 30 });
		const [url] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/branches?');
		expect(url).toContain('limit=10');
		expect(url).toContain('offset=30');
	});

	it('listBranches omits limit entirely when only offset is given', async () => {
		await storyboard.listBranches('proj-1', { offset: 20 });
		const [url] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/branches?offset=20');
		expect(url).not.toContain('limit');
	});

	it('createBranch POSTs the name to the project branches route', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
		await storyboard.createBranch('proj-1', 'alt-cut');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/storyboard/branches');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ name: 'alt-cut' });
	});

	it('abandonBranch DELETEs the branch-scoped route', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.abandonBranch('branch-7');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/storyboard/branches/branch-7');
		expect(url).not.toContain('/projects/');
		expect(init.method).toBe('DELETE');
	});
});

// ── Optimistic-concurrency tokens on the six previously-unguarded mutations ──
//
// The orchestrator is about to REQUIRE these fields; the frontend ships first
// (today's backend has `extra="ignore"`, so sending them is a no-op). Every
// assertion below reads the actual request URL / body — a call-count or
// argument-position assertion would not catch the failure mode that matters,
// which is a field that never reaches the wire (or reaches it as camelCase:
// the orchestrator has NO `alias_generator`, so `expectedLockVersions` would be
// silently dropped and the guard would be inert).
describe('storyboard api client — lock-version wire format', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
	});

	function lastRequest(): { url: string; init: { method?: string; body?: string } } {
		const [url, init] = fetchMock.mock.calls[0];
		return { url: String(url), init };
	}

	it('deletePanel puts expected_lock_version on the DELETE query string', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deletePanel('panel-9', 4);
		const { url, init } = lastRequest();
		expect(init.method).toBe('DELETE');
		expect(new URL(url, 'http://x').searchParams.get('expected_lock_version')).toBe('4');
		expect(url).not.toContain('expectedLockVersion');
	});

	it('deleteScene puts expected_lock_version on the DELETE query string', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deleteScene('scene-2', 7);
		const { url } = lastRequest();
		expect(url).toContain('/storyboard/scenes/scene-2?');
		expect(new URL(url, 'http://x').searchParams.get('expected_lock_version')).toBe('7');
	});

	it('deleteAsset puts expected_lock_version on the DELETE query string', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deleteAsset('asset-3', 0);
		const { url } = lastRequest();
		// 0 is a real token, not "absent" — a falsy-check bug would drop it.
		expect(new URL(url, 'http://x').searchParams.get('expected_lock_version')).toBe('0');
	});

	it('the three deletes omit the param entirely when no token is known', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
		await storyboard.deletePanel('panel-9');
		await storyboard.deleteScene('scene-2');
		await storyboard.deleteAsset('asset-3');
		for (const [url] of fetchMock.mock.calls) {
			expect(String(url)).not.toContain('expected_lock_version');
		}
	});

	it('reorderPanels puts expected_lock_versions in the PATCH body', async () => {
		await storyboard.reorderPanels('proj-1', ['p2', 'p1'], { p2: 3, p1: 5 });
		const { init } = lastRequest();
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body!)).toEqual({
			ordered_panel_ids: ['p2', 'p1'],
			expected_lock_versions: { p2: 3, p1: 5 }
		});
	});

	it('reorderScenes puts expected_lock_versions in the PATCH body', async () => {
		await storyboard.reorderScenes('proj-1', ['s2', 's1'], { s2: 1, s1: 2 });
		const { init } = lastRequest();
		expect(JSON.parse(init.body!)).toEqual({
			ordered_scene_ids: ['s2', 's1'],
			expected_lock_versions: { s2: 1, s1: 2 }
		});
	});

	it('the reorders omit the key entirely (not null) when no map is given', async () => {
		await storyboard.reorderPanels('proj-1', ['p2', 'p1']);
		await storyboard.reorderScenes('proj-1', ['s2', 's1']);
		for (const [, init] of fetchMock.mock.calls) {
			expect(Object.keys(JSON.parse(init.body))).not.toContain('expected_lock_versions');
		}
	});

	it('restoreSnapshot POSTs a whole-board expected_lock_versions map', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
		await storyboard.restoreSnapshot('snap-1', { 's-1': 2, 'p-1': 9, 'a-1': 0 });
		const { url, init } = lastRequest();
		expect(url).toContain('/storyboard/snapshots/snap-1/restore');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body!)).toEqual({
			expected_lock_versions: { 's-1': 2, 'p-1': 9, 'a-1': 0 }
		});
	});

	it('restoreSnapshot still sends NO body when no map is given', async () => {
		fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
		await storyboard.restoreSnapshot('snap-1');
		expect(lastRequest().init.body).toBeUndefined();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadListMock = vi.fn();

vi.mock('$lib/stores/projects.svelte.js', () => ({
	loadList: (...a: unknown[]) => loadListMock(...a),
	getList: () => null
}));

import { load } from './+page';

const proj = (id: string, type: string, title = `p-${id}`) => ({
	id,
	title,
	type,
	status: 'ready'
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('projects/new +page.ts — clone-settings picker', () => {
	// REGRESSION: the loader asked for limit:50 and THEN filtered out lessons, so
	// a tenant whose 50 most-recent projects were all lessons got an EMPTY
	// dropdown — and with ~4374 projects the other 4324 were unreachable with no
	// indication the list was partial.
	it('does not come back empty when the newest 50 projects are all lessons', async () => {
		const items = [
			...Array.from({ length: 50 }, (_, i) => proj(`lesson-${i}`, 'lesson')),
			proj('promo-1', 'promo', 'Launch promo')
		];
		loadListMock.mockResolvedValue({ items, total: items.length, limit: 200, offset: 0 });

		const res = await load();

		expect(res.cloneables.map((c) => c.id)).toEqual(['promo-1']);
		expect(res.cloneablesFailed).toBe(false);
	});

	it('requests the server maximum page (200), not 50', async () => {
		loadListMock.mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
		await load();
		expect(loadListMock).toHaveBeenCalledWith({ limit: 200 });
	});

	it('flags truncation with the real total when the tenant has more than one page', async () => {
		const items = Array.from({ length: 200 }, (_, i) => proj(`p${i}`, 'promo'));
		loadListMock.mockResolvedValue({ items, total: 4374, limit: 200, offset: 0 });

		const res = await load();

		expect(res.cloneablesTruncated).toBe(true);
		expect(res.cloneablesTotal).toBe(4374);
		expect(res.cloneables).toHaveLength(200);
	});

	it('does not flag truncation when the whole list fits', async () => {
		const items = [proj('a', 'promo'), proj('b', 'lesson')];
		loadListMock.mockResolvedValue({ items, total: 2, limit: 200, offset: 0 });

		const res = await load();

		expect(res.cloneablesTruncated).toBe(false);
		expect(res.cloneables).toHaveLength(1);
	});

	// A caught-and-ignored failure removed the control entirely, making an outage
	// indistinguishable from "you have no projects".
	it('makes a load FAILURE distinguishable from an empty list', async () => {
		loadListMock.mockRejectedValue(new Error('502 Bad Gateway'));
		const failed = await load();
		expect(failed.cloneablesFailed).toBe(true);
		expect(failed.cloneables).toEqual([]);

		loadListMock.mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 });
		const empty = await load();
		expect(empty.cloneablesFailed).toBe(false);
		expect(empty.cloneables).toEqual([]);
	});
});

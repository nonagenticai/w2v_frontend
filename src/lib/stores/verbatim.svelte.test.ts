import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api', () => ({
	verbatim: {
		listProject: vi.fn(),
		createForProject: vi.fn(),
		updateForProject: vi.fn(),
		deleteForProject: vi.fn()
	}
}));

import { verbatim as verbatimApi } from '$lib/api';
import { ApiError } from '$lib/api/client';
import type { VerbatimItemListResponse, VerbatimItemResponse } from '$lib/types';
import {
	loadProject,
	getProject,
	getProjectList,
	updateForProject,
	reorderProject,
	invalidateAll
} from './verbatim.svelte.js';

function item(id: string, overrides: Partial<VerbatimItemResponse> = {}): VerbatimItemResponse {
	return {
		id,
		updated_at: '2026-01-01T00:00:00Z',
		tenant_id: 'tenant-1',
		subject_id: 'subject-1',
		visibility: 'private',
		project_id: 'proj-1',
		job_id: null,
		kind: 'tts',
		text: `text-${id}`,
		hint: null,
		scope: 'pipeline',
		scope_target: null,
		status: 'pending',
		placed_in_stage: null,
		placed_in_element_id: null,
		retry_count: 0,
		position: 0,
		created_at: '2026-07-12T00:00:00Z',
		...overrides
	};
}

function list(...items: VerbatimItemResponse[]): VerbatimItemListResponse {
	return { items, total: items.length };
}

/**
 * Deep, proxy-safe clone of the cached envelope. `structuredClone` throws on a
 * Svelte `$state` proxy, so JSON round-trip it instead — the payload is plain
 * JSON anyway.
 */
function snap(projectId: string): unknown {
	return JSON.parse(JSON.stringify(getProject(projectId) ?? null));
}

/**
 * Pull `{id, position}` out of a mocked PATCH call without pinning the exact
 * argument arity of `verbatimApi.updateForProject`.
 */
function patchArgs(call: unknown[]): { id: string; position: number | undefined } {
	const body = call.find((a) => typeof a === 'object' && a !== null) as
		{ position?: number } | undefined;
	const strings = call.filter((a): a is string => typeof a === 'string');
	return { id: strings[strings.length - 1], position: body?.position };
}

describe('verbatim store', () => {
	beforeEach(() => {
		invalidateAll();
		vi.mocked(verbatimApi.listProject).mockReset();
		vi.mocked(verbatimApi.createForProject).mockReset();
		vi.mocked(verbatimApi.updateForProject).mockReset();
		vi.mocked(verbatimApi.deleteForProject).mockReset();
	});

	it('getProjectList returns items in position order even when the cache is not sorted', async () => {
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(item('c', { position: 2 }), item('a', { position: 0 }), item('b', { position: 1 }))
		);
		await loadProject('proj-1');
		expect(getProjectList('proj-1').map((i) => i.id)).toEqual(['a', 'b', 'c']);
		expect(getProjectList('proj-1').map((i) => i.position)).toEqual([0, 1, 2]);
	});

	it('updateForProject replaces the row with the server response and leaves total unchanged', async () => {
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(item('a', { position: 0 }), item('b', { position: 1 }))
		);
		await loadProject('proj-1');
		expect(getProject('proj-1')?.total).toBe(2);

		vi.mocked(verbatimApi.updateForProject).mockResolvedValueOnce(
			item('a', { position: 0, text: 'edited on the server' })
		);
		const returned = await updateForProject('proj-1', 'a', { text: 'edited' });

		expect(returned.text).toBe('edited on the server');
		expect(getProjectList('proj-1').find((i) => i.id === 'a')?.text).toBe('edited on the server');
		// The sibling row is untouched and the row count did not change.
		expect(getProjectList('proj-1').find((i) => i.id === 'b')?.text).toBe('text-b');
		expect(getProjectList('proj-1')).toHaveLength(2);
		expect(getProject('proj-1')?.total).toBe(2);
	});

	it('updateForProject leaves the cache byte-identical and rethrows when the PATCH rejects', async () => {
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(item('a', { position: 0 }), item('b', { position: 1 }))
		);
		await loadProject('proj-1');
		const before = snap('proj-1');

		vi.mocked(verbatimApi.updateForProject).mockRejectedValueOnce(
			new ApiError(409, 'Conflict', 'item was modified concurrently')
		);

		await expect(updateForProject('proj-1', 'a', { text: 'edited' })).rejects.toBeInstanceOf(
			ApiError
		);
		// Pessimistic write: nothing may be applied on the failure path.
		expect(snap('proj-1')).toEqual(before);
	});

	it('reorderProject applies the positions optimistically and reconciles the server rows', async () => {
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(item('a', { position: 0 }), item('b', { position: 1 }), item('c', { position: 2 }))
		);
		await loadProject('proj-1');

		// Swap a and b: the server echoes the requested positions back.
		vi.mocked(verbatimApi.updateForProject)
			.mockResolvedValueOnce(item('a', { position: 1 }))
			.mockResolvedValueOnce(item('b', { position: 0 }));

		await reorderProject('proj-1', [
			{ id: 'a', position: 1 },
			{ id: 'b', position: 0 }
		]);

		expect(verbatimApi.updateForProject).toHaveBeenCalledTimes(2);
		expect(vi.mocked(verbatimApi.updateForProject).mock.calls.map(patchArgs)).toEqual([
			{ id: 'a', position: 1 },
			{ id: 'b', position: 0 }
		]);
		expect(getProjectList('proj-1').map((i) => i.id)).toEqual(['b', 'a', 'c']);
		expect(getProjectList('proj-1').map((i) => i.position)).toEqual([0, 1, 2]);
	});

	it('reorderProject restores the EXACT snapshot when the 2nd of 3 PATCHes rejects', async () => {
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(item('a', { position: 0 }), item('b', { position: 1 }), item('c', { position: 2 }))
		);
		await loadProject('proj-1');
		const before = snap('proj-1');

		vi.mocked(verbatimApi.updateForProject)
			.mockResolvedValueOnce(item('a', { position: 2 }))
			.mockRejectedValueOnce(new ApiError(409, 'Conflict', 'position taken'))
			.mockResolvedValueOnce(item('c', { position: 1 }));

		await expect(
			reorderProject('proj-1', [
				{ id: 'a', position: 2 },
				{ id: 'b', position: 0 },
				{ id: 'c', position: 1 }
			])
		).rejects.toBeInstanceOf(ApiError);

		// Not a partially-applied state: the pre-reorder snapshot is restored whole.
		expect(snap('proj-1')).toEqual(before);
		expect(getProjectList('proj-1').map((i) => [i.id, i.position])).toEqual([
			['a', 0],
			['b', 1],
			['c', 2]
		]);
	});

	it('reorderProject stops issuing PATCHes after a rejection', async () => {
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(item('a', { position: 0 }), item('b', { position: 1 }), item('c', { position: 2 }))
		);
		await loadProject('proj-1');

		vi.mocked(verbatimApi.updateForProject)
			.mockResolvedValueOnce(item('a', { position: 2 }))
			.mockRejectedValueOnce(new ApiError(500, 'Server Error', 'boom'))
			.mockResolvedValueOnce(item('c', { position: 1 }));

		await expect(
			reorderProject('proj-1', [
				{ id: 'a', position: 2 },
				{ id: 'b', position: 0 },
				{ id: 'c', position: 1 }
			])
		).rejects.toBeInstanceOf(ApiError);

		// Sequential-await contract: the 3rd write must never leave the client.
		expect(verbatimApi.updateForProject).toHaveBeenCalledTimes(2);
	});

	it('serializes concurrent reorders instead of interleaving their writes', async () => {
		// The slide and TTS columns are two separate VerbatimItemList instances
		// with separate in-flight guards, so nothing in the UI prevents both
		// calling reorderProject before either settles. That matters because each
		// call snapshots `items` for its rollback: if the second snapshots while
		// the first is mid-flight, it captures the first's UNCOMMITTED optimistic
		// write, and a later rollback restores a state that never existed on the
		// server. Serializing makes every snapshot a settled state.
		vi.mocked(verbatimApi.listProject).mockResolvedValueOnce(
			list(
				item('slide-1', { kind: 'slide', position: 0 }),
				item('slide-2', { kind: 'slide', position: 1 }),
				item('tts-1', { kind: 'tts', position: 0 }),
				item('tts-2', { kind: 'tts', position: 1 })
			)
		);
		await loadProject('proj-1');

		const order: string[] = [];
		vi.mocked(verbatimApi.updateForProject).mockImplementation(async (_p, id) => {
			order.push(id as string);
			// Yield twice, so an unserialized second call has a real opportunity to
			// slot a write in between this call's two writes.
			await Promise.resolve();
			await Promise.resolve();
			return item(id as string, {});
		});

		await Promise.all([
			reorderProject('proj-1', [
				{ id: 'slide-2', position: 0 },
				{ id: 'slide-1', position: 1 }
			]),
			reorderProject('proj-1', [
				{ id: 'tts-2', position: 0 },
				{ id: 'tts-1', position: 1 }
			])
		]);

		// Batches must not interleave: both slide writes, then both tts writes.
		expect(order).toEqual(['slide-2', 'slide-1', 'tts-2', 'tts-1']);
	});
});

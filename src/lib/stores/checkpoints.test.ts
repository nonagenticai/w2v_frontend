import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api', () => ({
	runs: {
		checkpoints: {
			get: vi.fn(),
			patch: vi.fn()
		}
	}
}));

import { runs as runsApi } from '$lib/api';
import {
	get,
	getList,
	invalidate,
	isLoading,
	load,
	patch,
	setFromSnapshot
} from './checkpoints.svelte.js';
import type { CheckpointsResponse } from '$lib/api/runs';

const empty: CheckpointsResponse = { run_id: 'r1', pause_after_stages: [] };
const two: CheckpointsResponse = {
	run_id: 'r1',
	pause_after_stages: ['storyline', 'shotlist']
};

describe('checkpoints store', () => {
	beforeEach(() => {
		invalidate();
		vi.mocked(runsApi.checkpoints.get).mockReset();
		vi.mocked(runsApi.checkpoints.patch).mockReset();
	});

	it('load fetches and caches per runId', async () => {
		vi.mocked(runsApi.checkpoints.get).mockResolvedValueOnce(two);
		const result = await load('r1');
		expect(result).toEqual(two);
		expect(get('r1')).toEqual(two);
		expect(getList('r1')).toEqual(['storyline', 'shotlist']);
		expect(get('r2')).toBeUndefined();
	});

	it('isLoading flips during load', async () => {
		let resolveOuter: (v: CheckpointsResponse) => void = () => {};
		vi.mocked(runsApi.checkpoints.get).mockReturnValueOnce(
			new Promise<CheckpointsResponse>((resolve) => {
				resolveOuter = resolve;
			})
		);
		const promise = load('r1');
		expect(isLoading('r1')).toBe(true);
		resolveOuter(empty);
		await promise;
		expect(isLoading('r1')).toBe(false);
	});

	it('patch updates the cache from the response', async () => {
		vi.mocked(runsApi.checkpoints.patch).mockResolvedValueOnce(two);
		const result = await patch('r1', ['storyline', 'shotlist']);
		expect(result).toEqual(two);
		expect(getList('r1')).toEqual(['storyline', 'shotlist']);
	});

	it('patch with null clears checkpoints', async () => {
		vi.mocked(runsApi.checkpoints.patch).mockResolvedValueOnce(empty);
		await patch('r1', null);
		expect(runsApi.checkpoints.patch).toHaveBeenCalledWith('r1', null);
		expect(getList('r1')).toEqual([]);
	});

	it('setFromSnapshot seeds the cache without a fetch', () => {
		setFromSnapshot(two);
		expect(get('r1')).toEqual(two);
		expect(runsApi.checkpoints.get).not.toHaveBeenCalled();
	});

	it('invalidate(runId) drops one entry; invalidate() clears all', async () => {
		vi.mocked(runsApi.checkpoints.get).mockResolvedValue(empty);
		await load('r1');
		await load('r2');

		invalidate('r1');
		expect(get('r1')).toBeUndefined();
		expect(get('r2')).toEqual(empty);

		invalidate();
		expect(get('r2')).toBeUndefined();
	});

	it('getList returns an empty array when nothing is cached', () => {
		expect(getList('r-missing')).toEqual([]);
	});
});

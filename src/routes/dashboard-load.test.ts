import { describe, it, expect, vi, beforeEach } from 'vitest';

// Defect under test: a REJECTED projects fetch used to fall through to
// `emptyList`, so `+page.svelte` rendered "No projects yet" for a 400/404/429.
// The load result must make "we could not load this" distinguishable from
// "loaded, and it is empty".

const h = vi.hoisted(() => {
	class ApiError extends Error {
		status: number;
		statusText: string;
		detail: string;
		constructor(status: number, statusText: string, detail: string) {
			super(`${status} ${statusText}: ${detail}`);
			this.status = status;
			this.statusText = statusText;
			this.detail = detail;
		}
	}
	return { ApiError };
});
const ApiError = h.ApiError;
vi.mock('$lib/api/client.js', () => ({ ApiError: h.ApiError }));

const listMock = vi.fn();
vi.mock('$lib/api', () => ({ projects: { list: (...a: unknown[]) => listMock(...a) } }));

const markBackendDownMock = vi.fn();
vi.mock('$lib/stores/health.svelte.js', () => ({
	markBackendDown: () => markBackendDownMock()
}));

import { load } from './+page';

/** A NON-EMPTY page of counts, so an assertion cannot pass just because every
 *  fixture value is 0/empty anyway. */
const page = (total: number, items: { id: string }[] = []) => ({
	items,
	total,
	limit: 20,
	offset: 0
});

beforeEach(() => {
	listMock.mockReset();
	markBackendDownMock.mockClear();
});

describe('dashboard load — failure is expressible', () => {
	it('a rejected projects fetch does NOT produce the empty-success shape', async () => {
		// The counts SUCCEED with non-zero totals, so the two results differ only
		// because of the list rejection — not because the fixture is blank.
		listMock
			.mockRejectedValueOnce(new ApiError(429, 'Too Many Requests', 'slow down'))
			.mockResolvedValueOnce(page(7))
			.mockResolvedValueOnce(page(3));
		const failed = await load();

		listMock.mockReset();
		listMock
			.mockResolvedValueOnce(page(0, []))
			.mockResolvedValueOnce(page(7))
			.mockResolvedValueOnce(page(3));
		const emptySuccess = await load();

		// The whole point: the two are not the same object shape.
		expect(failed).not.toEqual(emptySuccess);
		expect(failed.projectsError).not.toBeNull();
		expect(failed.projectsError).toEqual({ status: 429, detail: 'slow down' });
		expect(emptySuccess.projectsError).toBeNull();

		// ...and the caller cannot tell them apart from the list alone, which is
		// exactly why the flag has to exist.
		expect(failed.projectList.items).toEqual(emptySuccess.projectList.items);
	});

	it('a genuinely empty successful response still reads as empty', async () => {
		listMock
			.mockResolvedValueOnce(page(0, []))
			.mockResolvedValueOnce(page(0))
			.mockResolvedValueOnce(page(0));
		const data = await load();

		expect(data.projectsError).toBeNull();
		expect(data.statusCountsError).toBeNull();
		expect(data.projectList.items).toHaveLength(0);
		expect(data.projectList.total).toBe(0);
	});

	it('a non-ApiError rejection is still reported, with a null status', async () => {
		listMock
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))
			.mockResolvedValueOnce(page(7))
			.mockResolvedValueOnce(page(3));
		const data = await load();

		expect(data.projectsError).toEqual({ status: null, detail: 'Failed to fetch' });
	});

	it('flags fabricated counts when a count fetch fails, while the list succeeds', async () => {
		listMock
			.mockResolvedValueOnce(page(4, [{ id: 'p1' }]))
			.mockRejectedValueOnce(new ApiError(404, 'Not Found', 'gone'))
			.mockResolvedValueOnce(page(3));
		const data = await load();

		expect(data.projectsError).toBeNull();
		expect(data.statusCountsError).toEqual({ status: 404, detail: 'gone' });
		// The 0 is NOT a measurement — statusCountsError is what says so.
		expect(data.statusCounts.completed).toBe(0);
	});

	it('still marks the backend down when all three fetches 5xx', async () => {
		listMock.mockRejectedValue(new ApiError(503, 'Unavailable', 'down'));
		const data = await load();

		expect(markBackendDownMock).toHaveBeenCalled();
		expect(data.projectsError).toEqual({ status: 503, detail: 'down' });
	});
});

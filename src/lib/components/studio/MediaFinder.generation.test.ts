// A verification `fetch` outlives the search that started it. The operator can
// run a second search while one is still in flight, and the same media id can
// come back in those results with a thumbnail that now loads fine. If the stale
// non-ok response were still allowed to write `brokenThumbs`, "preview
// unavailable" would be painted over a visibly working image and would stay
// until the next search. The failure branch is generation-guarded for exactly
// that; the ok branch deletes an absent key and needs no guard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchMock = vi.fn();

vi.mock('$lib/api', () => ({
	media: { search: (...args: unknown[]) => searchMock(...args) },
	ApiError: class ApiError extends Error {
		detail = 'api error';
	}
}));
vi.mock('$lib/api/client.js', () => ({
	thumbnailSrc: (url: string) => `/api/media/thumb?url=${encodeURIComponent(url)}`
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import MediaFinder from './MediaFinder.svelte';

const RESULT = {
	id: 'm1',
	url: 'https://stock.example/photo/1',
	title: 'Team collaboration',
	source: 'stock.example',
	media_type: 'image',
	thumbnail_url: 'https://cdn.stock.example/t/1.jpg'
};

async function runSearch(term: string) {
	await fireEvent.input(screen.getByTestId('media-search-input'), { target: { value: term } });
	await fireEvent.click(screen.getByRole('button', { name: /find/i }));
}

beforeEach(() => {
	vi.clearAllMocks();
	searchMock.mockResolvedValue({ results: [RESULT] });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('MediaFinder — an in-flight verification from a previous search', () => {
	it('does not mark a working thumbnail broken when it resolves after a new search', async () => {
		// The verification fetch is held open so the second search can overtake it.
		let settle!: (res: unknown) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise((resolve) => {
					settle = resolve;
				})
		);
		vi.stubGlobal('fetch', fetchMock);

		render(MediaFinder);

		// Search A: the thumbnail fails, which latches the placeholder and starts
		// the verification round-trip for id m1.
		await runSearch('team');
		await fireEvent.error(await screen.findByTestId('media-thumb'));
		await waitFor(() => expect(screen.getByTestId('media-thumb-unavailable')).toBeInTheDocument());
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Search B, while that fetch is still in flight. Same id comes back, and
		// this time the <img> loads: no error event, so the placeholder is gone.
		await runSearch('team collaboration');
		await waitFor(() => expect(screen.getByTestId('media-thumb')).toBeInTheDocument());
		expect(screen.queryByTestId('media-thumb-unavailable')).toBeNull();

		// Only NOW does search A's verification come back, and it says 400.
		settle({
			ok: false,
			status: 400,
			json: async () => ({ detail: { reason: 'thumbnail host not allow-listed' } })
		});
		// Give the resolution every chance to write before asserting it did not:
		// two macrotask ticks are well past the await chain (fetch, res.json) and
		// Svelte's flush. With the guard removed this is where the stale write
		// lands, which is what makes the assertion below non-vacuous.
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(screen.queryByTestId('media-thumb-unavailable')).toBeNull();
		expect(screen.getByTestId('media-thumb')).toBeInTheDocument();
	});
});

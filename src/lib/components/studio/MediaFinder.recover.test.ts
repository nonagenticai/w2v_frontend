// A thumbnail that fails ONCE must not be latched to the "preview unavailable"
// placeholder forever. The `<img>` error event carries no status, so the
// component re-asks the proxy; when that re-fetch comes back ok the resource is
// demonstrably retrievable (a transient blip, a slow CDN) and the placeholder is
// a lie. Clearing the latch gives the image exactly ONE more chance — a second
// error settles on the placeholder without re-fetching, so a genuinely dead
// thumbnail cannot oscillate between error and retry.
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

async function search() {
	render(MediaFinder);
	await fireEvent.input(screen.getByTestId('media-search-input'), { target: { value: 'team' } });
	await fireEvent.click(screen.getByRole('button', { name: /find/i }));
	return await screen.findByTestId('media-thumb');
}

beforeEach(() => {
	vi.clearAllMocks();
	searchMock.mockResolvedValue({ results: [RESULT] });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('MediaFinder — a thumbnail that recovers', () => {
	it('clears the placeholder when the re-fetch proves the image is retrievable', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
		vi.stubGlobal('fetch', fetchMock);

		const img = await search();
		await fireEvent.error(img);

		// The re-fetch says 200: the image comes back, the placeholder is gone.
		await waitFor(() => expect(screen.getByTestId('media-thumb')).toBeInTheDocument());
		expect(screen.queryByTestId('media-thumb-unavailable')).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('settles on the placeholder after ONE retry — it does not oscillate', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
		vi.stubGlobal('fetch', fetchMock);

		const img = await search();
		await fireEvent.error(img);
		await waitFor(() => expect(screen.getByTestId('media-thumb')).toBeInTheDocument());

		// Second failure of the SAME id: latched, and no second verification
		// round-trip — that pair is what an error/retry loop would repeat forever.
		await fireEvent.error(screen.getByTestId('media-thumb'));
		await waitFor(() => expect(screen.getByTestId('media-thumb-unavailable')).toBeInTheDocument());
		expect(screen.queryByTestId('media-thumb')).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('still latches when the re-fetch confirms the resource is refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				json: async () => ({ detail: { reason: 'thumbnail host not allow-listed' } })
			})
		);

		const img = await search();
		await fireEvent.error(img);

		await waitFor(() =>
			expect(screen.getByTestId('media-thumb-unavailable')).toHaveTextContent(
				'thumbnail host not allow-listed'
			)
		);
		expect(screen.queryByTestId('media-thumb')).toBeNull();
	});
});

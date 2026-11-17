// F1 — "checking…" must be an interim state, not a terminal one.
//
// The placeholder stopped claiming a cause it never learned and now says it is
// still checking while the verification fetch is in flight. That is only honest
// if something guarantees the fetch ENDS. `fetch` has no client-side deadline,
// and the proxy being verified is the one that answered 502 on 21 of 22 prod
// requests — a request that HANGS rather than failing leaves the tile reading
// "Preview unavailable — checking…" until the browser's own timeout.
//
// So the component gives it a wall-clock deadline and the abort resolves to the
// NEUTRAL line. The fetch mock below never settles by itself: the ONLY thing
// that can end it is the component aborting the signal it was handed. Remove
// the abort wiring and this spec hangs on "checking…" forever, which is what
// makes it non-vacuous.
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

import { tick } from 'svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MediaFinder, { THUMB_UNAVAILABLE, THUMB_VERIFY_TIMEOUT_MS } from './MediaFinder.svelte';

const RESULT = {
	id: 'm1',
	url: 'https://stock.example/photo/1',
	title: 'Team collaboration',
	source: 'stock.example',
	media_type: 'image',
	thumbnail_url: 'https://cdn.stock.example/t/1.jpg'
};

/**
 * A fetch that models a WEDGED proxy: it accepts the connection and then never
 * answers. It resolves for nobody and rejects for nobody — the returned promise
 * settles only if the caller aborts the signal it passed in, exactly as a real
 * `fetch` does. A caller that passes no signal waits forever.
 */
function wedgedFetch() {
	return vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
		return new Promise<never>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal) return; // no deadline was armed — hangs, like the real thing
			if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
			else
				signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
		});
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	searchMock.mockResolvedValue({ results: [RESULT] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('MediaFinder — a verification fetch that never answers', () => {
	it('settles the tile on the neutral line instead of "checking…" forever', async () => {
		const fetchMock = wedgedFetch();
		vi.stubGlobal('fetch', fetchMock);

		render(MediaFinder);
		await fireEvent.input(screen.getByTestId('media-search-input'), {
			target: { value: 'team' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /find/i }));
		const img = await screen.findByTestId('media-thumb');

		// Fake timers only from here, so the search above ran on real ones.
		vi.useFakeTimers();
		await fireEvent.error(img);

		// Precondition — the tile really is in the pending state we claim to fix.
		// Without this a green result could mean the fetch was never started.
		const tile = screen.getByTestId('media-thumb-unavailable');
		expect(tile).toHaveTextContent('checking');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Nothing ever answers. Only the deadline can end this.
		await vi.advanceTimersByTimeAsync(THUMB_VERIFY_TIMEOUT_MS + 1);
		await tick();

		// The abort must land on the NEUTRAL line — not still checking, and not a
		// claimed cause it never learned (a timeout is not a refusal).
		expect(tile).toHaveTextContent(THUMB_UNAVAILABLE);
		expect(tile).not.toHaveTextContent('checking');
		expect(tile.textContent?.trim()).toBe(THUMB_UNAVAILABLE);
	});

	it('bounds the deadline to the SPA-wide request timeout', () => {
		// A deadline exists only to make "checking…" terminal; one long enough to
		// outlive the operator's attention would satisfy the test above while
		// leaving the defect in place.
		expect(THUMB_VERIFY_TIMEOUT_MS).toBeGreaterThan(0);
		expect(THUMB_VERIFY_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
	});
});

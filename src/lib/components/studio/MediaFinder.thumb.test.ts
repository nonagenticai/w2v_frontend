// N2 (client half) — a thumbnail the /api/media/thumb proxy refuses must render
// as an explicit "preview unavailable" placeholder, not a broken <img>.
//
// The proxy allow-lists upstream hosts and 400s anything else. An <img> error
// event carries no status and no body, so the component re-asks the proxy for its
// typed reason; the body shape is owned by the orchestrator and handled
// defensively (any non-2xx is "unavailable"; a reason is quoted if present).
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
import MediaFinder, {
	THUMB_CHECKING,
	thumbFailureMessage,
	thumbFailureReason,
	thumbReasonText
} from './MediaFinder.svelte';

const RESULT = {
	id: 'm1',
	url: 'https://stock.example/photo/1',
	title: 'Team collaboration',
	source: 'stock.example',
	media_type: 'image',
	thumbnail_url: 'https://cdn.not-allow-listed.example/t/1.jpg'
};

async function searchAndBreakTheThumb() {
	render(MediaFinder);
	await fireEvent.input(screen.getByTestId('media-search-input'), { target: { value: 'team' } });
	await fireEvent.click(screen.getByRole('button', { name: /find/i }));
	const img = await screen.findByTestId('media-thumb');
	await fireEvent.error(img);
}

beforeEach(() => {
	vi.clearAllMocks();
	searchMock.mockResolvedValue({ results: [RESULT] });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('thumbFailureReason / thumbFailureMessage — defensive about the 400 body', () => {
	it('quotes a typed reason wherever the body puts it', () => {
		expect(thumbFailureReason({ reason: 'host not allow-listed' })).toBe('host not allow-listed');
		expect(thumbFailureReason({ detail: 'upstream host not permitted' })).toBe(
			'upstream host not permitted'
		);
		expect(thumbFailureReason({ detail: { reason: 'nested reason' } })).toBe('nested reason');
		expect(thumbFailureMessage({ detail: { reason: 'nested reason' } })).toBe(
			'Preview unavailable — nested reason'
		);
	});

	it('degrades to the NEUTRAL line for a body it cannot read — it names no cause', () => {
		expect(thumbFailureReason(null)).toBeNull();
		expect(thumbFailureReason('<html>502 Bad Gateway</html>')).toBeNull();
		expect(thumbFailureReason({ unrelated: 'x' })).toBeNull();
		// A cause we never learned must not be asserted. Live on 2026-09-15 the
		// proxy answered 502 21/22 times and 400 never, so "source not supported"
		// here was a confident, specific, false explanation of an upstream 403.
		for (const body of [null, {}, '<html>502 Bad Gateway</html>', { unrelated: 'x' }]) {
			expect(thumbFailureMessage(body)).toBe('Preview unavailable');
			expect(thumbFailureMessage(body)).not.toMatch(/source not supported/i);
		}
	});
});

describe('thumbReasonText — open to reasons the orchestrator has not invented yet', () => {
	it('renders the host-not-allowed code as the specific claim', () => {
		expect(thumbReasonText('host_not_allowed')).toBe('source not supported');
		expect(thumbFailureMessage({ detail: { reason: 'host_not_allowed' } })).toBe(
			'Preview unavailable — source not supported'
		);
	});

	it('passes an unknown typed reason through instead of dropping or mislabelling it', () => {
		// The orchestrator is concurrently adding a typed reason for SVG sources.
		// It must reach the operator as itself, never as "source not supported".
		expect(thumbReasonText('vector_source_not_previewable')).toBe('vector source not previewable');
		expect(thumbFailureMessage({ reason: 'vector_source_not_previewable' })).toBe(
			'Preview unavailable — vector source not previewable'
		);
		expect(thumbFailureMessage({ reason: 'vector_source_not_previewable' })).not.toMatch(
			/source not supported/i
		);
		// A human sentence is quoted verbatim.
		expect(thumbReasonText('upstream returned 403')).toBe('upstream returned 403');
	});
});

describe('MediaFinder — a refused thumbnail', () => {
	it('renders an explicit unavailable placeholder instead of the broken image', async () => {
		// No typed body available (network/CORS): still explicit, never a broken img.
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		await searchAndBreakTheThumb();

		const placeholder = await screen.findByTestId('media-thumb-unavailable');
		expect(placeholder).toHaveTextContent(/Preview unavailable/i);
		// Nothing was learned, so nothing is claimed — and "checking…" is resolved,
		// not left pending forever.
		await waitFor(() => expect(placeholder).toHaveTextContent('Preview unavailable'));
		expect(placeholder).not.toHaveTextContent(/source not supported/i);
		expect(placeholder).not.toHaveTextContent(/checking/i);
		// The broken <img> is gone, and this is NOT the neutral no-thumbnail
		// placeholder (which just printed the media_type, "image").
		expect(screen.queryByTestId('media-thumb')).toBeNull();
		expect(screen.queryByTestId('media-thumb-placeholder')).toBeNull();
	});

	it('does NOT diagnose a cause before verification comes back', async () => {
		// The <img> error carries no status and no body. Hold the verification
		// fetch open and read what the operator sees in that window: on 2026-09-15
		// two live tiles were read in exactly this state, both asserting "source
		// not supported" about a 502 nobody had diagnosed.
		let release: (res: unknown) => void = () => {};
		const pending = new Promise((resolve) => {
			release = resolve;
		});
		vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));
		await searchAndBreakTheThumb();

		const placeholder = await screen.findByTestId('media-thumb-unavailable');
		expect(placeholder).toHaveTextContent('Preview unavailable — checking…');
		expect(placeholder).not.toHaveTextContent(/source not supported/i);
		expect(THUMB_CHECKING).not.toMatch(/source not supported/i);

		// …and it resolves once the proxy answers.
		release({
			ok: false,
			status: 400,
			json: async () => ({ detail: { reason: 'host_not_allowed' } })
		});
		await waitFor(() =>
			expect(screen.getByTestId('media-thumb-unavailable')).toHaveTextContent(
				'Preview unavailable — source not supported'
			)
		);
	});

	it('claims "source not supported" only when the proxy actually says host_not_allowed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				json: async () => ({ detail: { reason: 'host_not_allowed' } })
			})
		);
		await searchAndBreakTheThumb();

		await waitFor(() =>
			expect(screen.getByTestId('media-thumb-unavailable')).toHaveTextContent(
				'Preview unavailable — source not supported'
			)
		);
	});

	it('renders a 502 with an unreadable body neutrally, not as a diagnosis', async () => {
		// The live shape: 21 of 22 requests were 502 with an HTML body.
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 502,
				json: async () => {
					throw new SyntaxError('Unexpected token <');
				}
			})
		);
		await searchAndBreakTheThumb();

		const placeholder = await screen.findByTestId('media-thumb-unavailable');
		await waitFor(() => expect(placeholder).toHaveTextContent('Preview unavailable'));
		expect(placeholder).not.toHaveTextContent(/source not supported/i);
		expect(placeholder).not.toHaveTextContent(/checking/i);
	});

	it('shows the proxy’s typed reason when it gives one', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				json: async () => ({ detail: { reason: 'thumbnail host not allow-listed' } })
			})
		);
		await searchAndBreakTheThumb();

		await waitFor(() =>
			expect(screen.getByTestId('media-thumb-unavailable')).toHaveTextContent(
				'thumbnail host not allow-listed'
			)
		);
	});

	it('leaves a working thumbnail alone', async () => {
		vi.stubGlobal('fetch', vi.fn());
		render(MediaFinder);
		await fireEvent.input(screen.getByTestId('media-search-input'), { target: { value: 'team' } });
		await fireEvent.click(screen.getByRole('button', { name: /find/i }));

		expect(await screen.findByTestId('media-thumb')).toBeInTheDocument();
		expect(screen.queryByTestId('media-thumb-unavailable')).toBeNull();
	});
});

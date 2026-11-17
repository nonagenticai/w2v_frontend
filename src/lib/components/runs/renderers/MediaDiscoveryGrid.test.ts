import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import MediaDiscoveryGrid from './MediaDiscoveryGrid.svelte';

/**
 * The run page's Find-media grid renders `media_discovery` results, which are
 * overwhelmingly third-party stock/CDN URLs (`i.ytimg.com`, stock hosts).
 *
 * Prod CSP is `img-src 'self' data: blob:` (server.js + kit.csp), so an external
 * URL placed straight into `<img src>` is blocked by the browser — this grid was
 * the last caller still doing that and emitted 24 CSP violations per run page.
 * Every external thumbnail must go through the same-origin, SSRF-guarded
 * `/api/media/thumb` proxy; our own `/api/…` artifacts must NOT be proxied.
 */
const output = {
	query: 'sunset drone',
	sources_queried: ['youtube', 'pexels'],
	items: [
		{
			id: 'yt-1',
			title: 'Sunset drone pass',
			media_type: 'video',
			url: 'https://www.youtube.com/watch?v=abc',
			thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
			quality_score: 0.82
		},
		{
			id: 'own-1',
			title: 'Our composite',
			media_type: 'image',
			url: '/api/runs/r1/artifact/composite.png',
			thumbnail_url: '/api/runs/r1/artifact/composite.png'
		},
		{ id: 'bare-1', title: 'No thumbnail', media_type: 'image' }
	]
};

function srcs() {
	const { container } = render(MediaDiscoveryGrid, {
		props: { output, stageName: 'media_discovery' } as never
	});
	return {
		container,
		list: [
			...container.querySelectorAll<HTMLImageElement>('img[data-testid="media-discovery-thumb"]')
		].map((el) => el.getAttribute('src') ?? '')
	};
}

describe('MediaDiscoveryGrid thumbnails vs the CSP', () => {
	it('routes a third-party thumbnail through the same-origin /api/media/thumb proxy', () => {
		const { list } = srcs();
		const external = 'https://i.ytimg.com/vi/abc/hqdefault.jpg';
		expect(list[0]).toBe(`/api/media/thumb?url=${encodeURIComponent(external)}`);
	});

	it('never emits a bare remote host into an <img src> (the CSP blocks it)', () => {
		const { list } = srcs();
		for (const src of list) {
			expect(src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')).toBe(
				false
			);
		}
	});

	it('leaves our own /api artifact URL unproxied', () => {
		const { list } = srcs();
		expect(list[1]).toBe('/api/runs/r1/artifact/composite.png');
	});

	it('renders a placeholder, not an empty tile, for a result with no usable URL', () => {
		const { container, list } = srcs();
		// Only the two items that HAVE a URL produce an <img>.
		expect(list).toHaveLength(2);
		const ph = container.querySelector('[data-testid="media-discovery-thumb-placeholder"]');
		expect(ph).not.toBeNull();
		expect(ph!.textContent!.trim()).toBe('image');
	});
});

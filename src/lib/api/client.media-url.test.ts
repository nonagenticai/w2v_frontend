import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn(),
	getToken: vi.fn()
}));

import { getToken } from '$lib/services/keycloak.js';
import { clearLicenseToken, scopedMediaUrl, setActiveTenantId, thumbnailSrc } from './client.js';
import { downloadBlob } from './downloads.js';

describe('scopedMediaUrl — scope-switch for browser-initiated requests', () => {
	// The active tenant id is module-level state in client.ts; without this it
	// leaks from one test into the next and the "own tenant" cases pass for the
	// wrong reason.
	beforeEach(() => setActiveTenantId(null));

	it('returns the SAME REFERENCE when no tenant switch is active', () => {
		const url = '/api/runs/r1/artifact/bucket/key.mp4';
		// `toBe`, deliberately: a helper that rebuilt an identical string would
		// satisfy `toEqual` while actually rewriting on the own-tenant path.
		expect(scopedMediaUrl(url)).toBe(url);
	});

	it('appends active_tenant to an /api/ path once a tenant is selected', () => {
		setActiveTenantId('tenant-b');
		expect(scopedMediaUrl('/api/runs/x/artifact/b/k')).toBe(
			'/api/runs/x/artifact/b/k?active_tenant=tenant-b'
		);
	});

	it('appends with & when the url already carries a query', () => {
		setActiveTenantId('tenant-b');
		expect(scopedMediaUrl('/api/runs/x/artifact/b/k?inline=1')).toBe(
			'/api/runs/x/artifact/b/k?inline=1&active_tenant=tenant-b'
		);
	});

	it('url-encodes the tenant id', () => {
		setActiveTenantId('a b/c');
		expect(scopedMediaUrl('/api/runs/x/artifact/b/k')).toBe(
			'/api/runs/x/artifact/b/k?active_tenant=a%20b%2Fc'
		);
	});

	it.each([
		['absolute https', 'https://example.com/logo.png'],
		['absolute http', 'http://example.com/logo.png'],
		['protocol-relative', '//cdn.example.com/logo.png'],
		['blob url', 'blob:http://localhost:5173/9f1c-abc'],
		['data url', 'data:image/png;base64,iVBORw0KGgo='],
		['relative non-api path', 'assets/placeholder.svg'],
		['root non-api path', '/favicon.png']
	])('leaves a %s url untouched even with a switch active', (_label, url) => {
		setActiveTenantId('tenant-b');
		// Scraped source images, YouTube links, external site previews and
		// client-minted blob:/data: URLs must never receive our tenant id.
		expect(scopedMediaUrl(url)).toBe(url);
	});

	it('is idempotent on an already-scoped url', () => {
		setActiveTenantId('tenant-b');
		const scoped = '/api/runs/x/artifact/b/k?active_tenant=tenant-b';
		// Components re-render and re-derive; double-appending would corrupt it.
		expect(scopedMediaUrl(scoped)).toBe(scoped);
	});

	it.each([undefined, null, ''] as const)('passes %s straight through', (value) => {
		setActiveTenantId('tenant-b');
		expect(scopedMediaUrl(value)).toBe(value);
	});
});

describe('downloads authHeaders — X-Active-Tenant-Id on byte-returning routes', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			blob: async () => new Blob(['bytes']),
			clone: () => ({ json: async () => ({}) })
		});
		vi.mocked(getToken).mockReset();
		vi.mocked(getToken).mockReturnValue(undefined);
		clearLicenseToken();
		setActiveTenantId(null);
	});

	function lastHeaders(): Record<string, string> {
		const call = fetchMock.mock.calls.at(-1)!;
		return (call[1] as RequestInit).headers as Record<string, string>;
	}

	it('omits the header when acting as our own tenant', async () => {
		await downloadBlob('/runs/r1/report/pdf', 'report.pdf', 'application/pdf');
		expect(lastHeaders()['X-Active-Tenant-Id']).toBeUndefined();
	});

	it('sends X-Active-Tenant-Id once a tenant switch is active', async () => {
		setActiveTenantId('tenant-b');
		await downloadBlob('/runs/r1/report/pdf', 'report.pdf', 'application/pdf');
		expect(lastHeaders()['X-Active-Tenant-Id']).toBe('tenant-b');
	});

	it('drops the header again when the switch is cleared', async () => {
		setActiveTenantId('tenant-b');
		setActiveTenantId(null);
		await downloadBlob('/runs/r1/report/pdf', 'report.pdf', 'application/pdf');
		expect(lastHeaders()['X-Active-Tenant-Id']).toBeUndefined();
	});
});

describe('thumbnailSrc — external thumbnails go through the same-origin proxy', () => {
	beforeEach(() => setActiveTenantId(null));

	it('routes an https stock thumbnail through /api/media/thumb, url-encoded', () => {
		const ext = 'https://images.pexels.com/photos/1/a b.jpg?w=320&h=180';
		expect(thumbnailSrc(ext)).toBe(`/api/media/thumb?url=${encodeURIComponent(ext)}`);
	});

	it('treats a protocol-relative url as external (and pins https)', () => {
		expect(thumbnailSrc('//cdn.example.com/t.png')).toBe(
			`/api/media/thumb?url=${encodeURIComponent('https://cdn.example.com/t.png')}`
		);
	});

	it('scopes the proxied url to the active tenant like any other /api media url', () => {
		setActiveTenantId('tenant-b');
		expect(thumbnailSrc('http://x.test/t.jpg')).toBe(
			`/api/media/thumb?url=${encodeURIComponent('http://x.test/t.jpg')}&active_tenant=tenant-b`
		);
	});

	it('never proxies our own /api paths, data: or blob: urls', () => {
		const own = '/api/runs/r1/artifact/b/k.jpg';
		expect(thumbnailSrc(own)).toBe(own);
		expect(thumbnailSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
		expect(thumbnailSrc('blob:https://w2v/x')).toBe('blob:https://w2v/x');
		setActiveTenantId('tenant-b');
		expect(thumbnailSrc(own)).toBe(`${own}?active_tenant=tenant-b`);
	});

	it('passes falsy input through', () => {
		expect(thumbnailSrc(null)).toBeNull();
		expect(thumbnailSrc(undefined)).toBeUndefined();
		expect(thumbnailSrc('')).toBe('');
	});
});

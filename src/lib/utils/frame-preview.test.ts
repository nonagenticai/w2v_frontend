import { describe, expect, it, vi } from 'vitest';
import { framingAllowed, probeFramePreview } from './frame-preview';

const res = (status: number, headers: Record<string, string> = {}) =>
	new Response('<html></html>', { status, headers });

describe('probeFramePreview', () => {
	it('ok for a same-origin 200 that allows SAMEORIGIN framing', async () => {
		const f = vi.fn().mockResolvedValue(res(200, { 'x-frame-options': 'SAMEORIGIN' }));
		expect(await probeFramePreview('/api/redesign/jobs/j1/html?active_tenant=t', f)).toBe('ok');
		expect(f).toHaveBeenCalledWith(
			'/api/redesign/jobs/j1/html?active_tenant=t',
			expect.objectContaining({ credentials: 'same-origin' })
		);
	});

	it('unavailable when the server refuses framing (the prod blank-frame cause)', async () => {
		const f = vi.fn().mockResolvedValue(res(200, { 'x-frame-options': 'DENY' }));
		expect(await probeFramePreview('/api/redesign/jobs/j1/html', f)).toBe('unavailable');
	});

	it("unavailable on frame-ancestors 'none'", async () => {
		const f = vi
			.fn()
			.mockResolvedValue(
				res(200, { 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" })
			);
		expect(await probeFramePreview('/api/x', f)).toBe('unavailable');
	});

	it('unavailable on a non-2xx and on a network error', async () => {
		expect(await probeFramePreview('/api/x', vi.fn().mockResolvedValue(res(404)))).toBe(
			'unavailable'
		);
		expect(await probeFramePreview('/api/x', vi.fn().mockRejectedValue(new TypeError('x')))).toBe(
			'unavailable'
		);
	});

	it('never frames another origin (CSP default-src self) and does not even fetch it', async () => {
		const f = vi.fn();
		expect(await probeFramePreview('https://evil.example/x', f)).toBe('unavailable');
		expect(await probeFramePreview('//evil.example/x', f)).toBe('unavailable');
		expect(f).not.toHaveBeenCalled();
	});
});

describe('framingAllowed', () => {
	it("allows frame-ancestors 'self' and no headers", () => {
		expect(
			framingAllowed(new Headers({ 'content-security-policy': "frame-ancestors 'self'" }))
		).toBe(true);
		expect(framingAllowed(new Headers())).toBe(true);
	});
});

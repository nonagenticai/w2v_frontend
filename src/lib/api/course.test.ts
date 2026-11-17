import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { course } from './course.js';

describe('course api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 'so-1', output: {} })
		});
	});

	it('patchChapters PATCHes the chapters route with the overrides map', async () => {
		await course.patchChapters('run-1', { p2: 'Deep Dive' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/stages/course_stitch/chapters');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ overrides: { p2: 'Deep Dive' } });
	});

	it('patchThumbnail PATCHes a snake_case thumbnail_url', async () => {
		await course.patchThumbnail('run-1', 'http://minio.test/b/k.png');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/stages/course_stitch/thumbnail');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ thumbnail_url: 'http://minio.test/b/k.png' });
	});

	it('patchThumbnail sends null to clear the override', async () => {
		await course.patchThumbnail('run-1', null);
		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({ thumbnail_url: null });
	});

	it('uploadThumbnail POSTs multipart form-data to /uploads/thumbnail', async () => {
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
		await course.uploadThumbnail(blob, 'frame.png');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/uploads/thumbnail');
		expect(init.method).toBe('POST');
		expect(init.body).toBeInstanceOf(FormData);
		expect((init.body as FormData).has('file')).toBe(true);
	});
});

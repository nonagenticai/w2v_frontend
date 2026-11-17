import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import {
	MAX_VIDEO_SOURCE_BYTES,
	uploads,
	videoSourceErrorMessage,
	videoSourceTooLargeMessage,
	videoUploadTimeoutMs
} from './uploads.js';
import { ApiError } from './client.js';
import { installXhrFetchShim } from './test-support/xhr-fetch-shim.js';

/** A File whose bytes are irrelevant — every assertion here is about the
 *  request shape or the mapped error, never the payload. */
function clip(name: string, size = 1024, type = 'video/mp4'): File {
	const file = new File([new Uint8Array(1)], name, { type });
	// `size` is read-only on File, and we need an over-cap file without
	// allocating gigabytes.
	Object.defineProperty(file, 'size', { value: size });
	return file;
}

function errorResponse(status: number, message: string) {
	return {
		ok: false,
		status,
		statusText: 'error',
		json: async () => ({ error: { message } })
	};
}

describe('uploads.videoSource', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value));
		fetchMock.mockReset();
	});

	it('POSTs one file to the project-scoped route as multipart', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({
				source_id: 'src-1',
				filename: 'a.mp4',
				bytes: 1024,
				content_type: 'video/mp4',
				preview_status: 'pending',
				original_url: null
			})
		});

		const res = await uploads.videoSource('proj-1', clip('a.mp4'));

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/video-sources');
		expect(init.method).toBe('POST');
		expect(init.body).toBeInstanceOf(FormData);
		expect(res.source_id).toBe('src-1');
	});

	it('sends an explicit video/* part type even when the browser reports octet-stream', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({
				source_id: 'src-2',
				filename: 'DRONE.MP4',
				bytes: 10,
				preview_status: 'pending'
			})
		});

		await uploads.videoSource('proj-1', clip('DRONE.MP4', 10, 'application/octet-stream'));

		const form = fetchMock.mock.calls[0][1].body as FormData;
		const part = form.get('file') as Blob;
		// Without this the backend refuses the upload with 415 before reading a byte.
		expect(part.type).toBe('video/mp4');
	});

	it('rejects a non-video extension locally, without a request', async () => {
		await expect(uploads.videoSource('proj-1', clip('notes.pdf'))).rejects.toThrow(
			'notes.pdf is not a supported video. Use an .mp4, .mov, or .m4v file.'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects an over-cap clip locally, without a request', async () => {
		// DERIVED, not typed: the expected copy comes from the same function the
		// app uses, so a re-hardcoded "512 MB" in the message reds this without
		// the test needing an edit on the next cap change.
		await expect(
			uploads.videoSource('proj-1', clip('big.mov', MAX_VIDEO_SOURCE_BYTES + 1))
		).rejects.toThrow(videoSourceTooLargeMessage('big.mov'));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		[415, 'is not a supported video'],
		// A wire 413 is the EDGE refusing the body size, not a verdict on the file —
		// `validateVideoSource` already refused anything past the cap locally.
		[413, 'rejected by the network'],
		[409, 'upload session for'],
		[400, 'is not readable as video'],
		[404, 'This project no longer exists']
	])('maps a server %i onto its own human message', async (status, fragment) => {
		fetchMock.mockResolvedValueOnce(errorResponse(status, 'raw backend detail'));

		await expect(uploads.videoSource('proj-1', clip('shot.mov', 2048))).rejects.toThrow(
			new RegExp(fragment)
		);
	});

	it('gives each failure code a DISTINCT message (no shared fallback)', () => {
		const messages = [415, 413, 409, 400, 404].map((status) =>
			videoSourceErrorMessage(new ApiError(status, 'x', 'raw'), 'shot.mov')
		);
		expect(new Set(messages).size).toBe(messages.length);
		for (const m of messages) expect(m).toContain('shot.mov');
	});

	it('renders a FastAPI 422 detail ARRAY as readable text, not [object Object]', async () => {
		// ⛔ THE FENCE for defect 3's other half. A 422 `detail` is a LIST of
		// `{loc, msg, type}` objects, and the old `body?.detail ?? JSON.stringify(body)`
		// handed that list straight to ApiError's message template — which stringifies
		// it as `[object Object]`, the single most useless thing a form can say.
		// Revert `detailFromBody` and this reds.
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 422,
			statusText: 'Unprocessable Entity',
			json: async () => ({
				detail: [
					{ loc: ['body', 'file'], msg: 'Field required', type: 'missing' },
					{ loc: ['body', 'content_type'], msg: 'Input should be a valid string' }
				]
			})
		});

		const message = await uploads.videoSource('proj-1', clip('shot.mov', 2048)).then(
			() => 'resolved',
			(err: Error) => err.message
		);

		expect(message).not.toContain('[object Object]');
		expect(message).toContain('file: Field required');
		expect(message).toContain('content_type: Input should be a valid string');
	});

	it('falls back to the backend detail on an unmapped status', () => {
		expect(videoSourceErrorMessage(new ApiError(500, 'x', 'storage exploded'), 'a.mp4')).toBe(
			'storage exploded'
		);
	});
});

describe('uploads.listVideoSources / deleteVideoSource', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value));
		fetchMock.mockReset();
	});

	it('GETs the project clip list', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ items: [], total: 0 })
		});

		const res = await uploads.listVideoSources('proj-1');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/video-sources');
		expect(init.method).toBeUndefined();
		expect(res.total).toBe(0);
	});

	it('DELETEs the source-scoped route and tolerates a 204 empty body', async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });

		await uploads.deleteVideoSource('proj-1', 'src-9');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/video-sources/src-9');
		expect(init.method).toBe('DELETE');
	});
});

describe('videoSourceTooLargeMessage', () => {
	it('is the 4 GiB cap, so a ~1.9 GB drone clip is accepted', () => {
		// The defect this cap raise fixes: ordinary 4K drone footage is ~1.9 GB
		// per clip and the old 512 MiB cap refused it before a byte moved. The
		// transport was already chunked at 32 MiB parts, so nothing else changed.
		expect(MAX_VIDEO_SOURCE_BYTES).toBe(4 * 1024 * 1024 * 1024);
		expect(1.9 * 1000 * 1000 * 1000).toBeLessThan(MAX_VIDEO_SOURCE_BYTES);
	});

	it('DERIVES the limit in the sentence from the constant', () => {
		// ⛔ THE FENCE. The string used to hardcode "512 MB" while the cap lived in
		// `MAX_VIDEO_SOURCE_BYTES` — two places for one number, which is how the UI
		// ends up quoting a limit that no longer exists. Every figure below is
		// computed from the exported constant, so re-typing a literal reds this.
		const gib = MAX_VIDEO_SOURCE_BYTES / (1024 * 1024 * 1024);
		expect(videoSourceTooLargeMessage('drone.mp4')).toBe(
			`drone.mp4 is larger than the ${gib} GB limit. Trim or compress the clip and upload it again.`
		);
	});

	it('renders whole gigabytes, not a fractional or byte figure', () => {
		const msg = videoSourceTooLargeMessage('drone.mp4');
		expect(msg).toMatch(/\b4 GB limit\b/);
		expect(msg).not.toMatch(/\d+\.\d+ GB/);
		expect(msg).not.toContain(String(MAX_VIDEO_SOURCE_BYTES));
	});

	it('keeps the rest of the sentence exactly as it was', () => {
		const msg = videoSourceTooLargeMessage('a clip.mov');
		expect(msg.startsWith('a clip.mov is larger than the ')).toBe(true);
		expect(msg.endsWith(' limit. Trim or compress the clip and upload it again.')).toBe(true);
	});
});

describe('videoUploadTimeoutMs', () => {
	it('gives a 134 MB drone clip far more than the 120s blanket default', () => {
		// The clip size this product was designed around. Under the old fixed
		// 120s it needed ~9 Mbps sustained or it aborted mid-transfer and the
		// operator was told the FILE had failed.
		const ms = videoUploadTimeoutMs(134 * 1024 * 1024);
		expect(ms).toBeGreaterThan(120_000);
	});

	it('never drops below the floor for a tiny clip', () => {
		expect(videoUploadTimeoutMs(1024)).toBe(120_000);
	});

	it('caps a 512 MiB clip so a dead link cannot hold the slot open forever', () => {
		expect(videoUploadTimeoutMs(512 * 1024 * 1024)).toBe(30 * 60_000);
	});
});

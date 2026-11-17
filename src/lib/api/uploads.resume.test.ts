import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { uploads } from './uploads.js';
import { loadResumeRecord, saveResumeRecord, type ResumableUpload } from './upload-resume.js';
import { installXhrFetchShim } from './test-support/xhr-fetch-shim.js';

const MIB = 1024 * 1024;
const PART_SIZE = 32 * MIB;
const FUTURE = '2099-01-01T00:00:00Z';

/** A File reporting a large size without allocating it — same trick the sibling
 *  chunked suite uses. `lastModified` is PINNED so the identity key is stable
 *  across the two `videoSourceAuto` calls a resume test has to make. */
function clip(name: string, size: number, lastModified = 1_700_000_000_000): File {
	const file = new File([new Uint8Array(1)], name, { type: 'video/mp4', lastModified });
	Object.defineProperty(file, 'size', { value: size });
	const realSlice = file.slice.bind(file);
	vi.spyOn(file, 'slice').mockImplementation(() => realSlice(0, 1));
	return file;
}

function jsonOk(status: number, body: unknown) {
	return { ok: true, status, json: async () => body };
}

function session(partCount: number, uploadId = 'up-1') {
	return {
		upload_id: uploadId,
		source_id: 'src-1',
		part_size: PART_SIZE,
		part_count: partCount,
		expires_at: FUTURE
	};
}

function created() {
	return {
		source_id: 'src-1',
		filename: 'drone.mp4',
		bytes: 96 * MIB,
		content_type: 'video/mp4',
		preview_status: 'pending',
		original_url: null
	};
}

/** happy-dom exposes `window` but not a working Storage, and the resume record
 *  lives in `localStorage`. Map-backed stand-in, reinstalled per test so records
 *  never leak between them. */
function installLocalStorageMock(): void {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	});
}

type Call = { url: string; init: RequestInit };

describe('chunked upload resume', () => {
	const fetchMock = vi.fn();
	let calls: Call[];

	beforeEach(() => {
		calls = [];
		installLocalStorageMock();
		vi.stubGlobal('fetch', fetchMock);
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value));
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function route(handler: (call: Call) => unknown) {
		fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
			const call = { url, init };
			calls.push(call);
			return handler(call);
		});
	}

	const isOpen = (c: Call) => c.url.endsWith('/video-sources/uploads') && c.init.method === 'POST';
	const isPart = (c: Call) => c.url.includes('/parts/');
	const isDelete = (c: Call) => c.init.method === 'DELETE';
	const partNumber = (c: Call) => Number(c.url.split('/parts/')[1]);
	const partAck = (c: Call) =>
		jsonOk(200, {
			part_number: partNumber(c),
			bytes: PART_SIZE,
			received_parts: partNumber(c),
			received_bytes: partNumber(c) * PART_SIZE
		});

	/** Attempt 1: parts 1 and 2 land, part 3's PUTs all fail with a transient
	 *  502 — i.e. the clip dies near the end of a long transfer. */
	async function failNearTheEnd(file: File) {
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) {
				if (partNumber(c) < 3) return partAck(c);
				return { ok: false, status: 502, statusText: 'error', json: async () => ({}) };
			}
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});
		await expect(uploads.videoSourceAuto('proj-1', file)).rejects.toThrow();
	}

	it('resumes from the first missing part instead of re-sending the whole clip', async () => {
		// ⛔ THE FENCE for W7-3. Without the persisted session+part list, the second
		// attempt opens a NEW session and re-PUTs parts 1 and 2 — a 500 MB clip
		// dying at 90% costs the operator the entire upload, every time.
		vi.useFakeTimers();
		const file = clip('drone.mp4', 96 * MIB);
		const pending = failNearTheEnd(file);
		await vi.advanceTimersByTimeAsync(20_000); // burn the 1/2/4s part ladder
		await pending;
		vi.useRealTimers();

		// The staging session was NOT released — releasing it is what makes resume
		// impossible.
		expect(calls.filter(isDelete)).toHaveLength(0);

		calls = [];
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3, 'up-2'));
			if (isPart(c)) return partAck(c);
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});
		await expect(uploads.videoSourceAuto('proj-1', file)).resolves.toMatchObject({
			source_id: 'src-1'
		});

		// No new session: the old one is reused.
		expect(calls.filter(isOpen)).toHaveLength(0);
		// And only the missing part goes back over the wire.
		expect(calls.filter(isPart).map(partNumber)).toEqual([3]);
		expect(calls.filter(isPart)[0].url).toContain('/uploads/up-1/');
	});

	it('clears the record once the upload completes, so a re-pick starts fresh', async () => {
		// Resuming into a COMPOSED session would re-PUT parts of an object that
		// already exists.
		const file = clip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) return partAck(c);
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});
		await uploads.videoSourceAuto('proj-1', file);
		expect(loadResumeRecord('proj-1', file)).toBeNull();
	});

	it('refuses to resume a DIFFERENT file into an existing session', async () => {
		// ⛔ The load-bearing identity check. A session is a fixed-stride byte range
		// over ONE file; splicing another file's bytes into it composes a corrupt
		// object that still probes as valid video. Drop any of name/size/mtime from
		// the comparison and this reds.
		const record: ResumableUpload = {
			uploadId: 'up-1',
			sourceId: 'src-1',
			projectId: 'proj-1',
			partSize: PART_SIZE,
			partCount: 3,
			expiresAt: FUTURE,
			completedParts: [1, 2],
			fileName: 'drone.mp4',
			fileSize: 96 * MIB,
			fileLastModified: 1_700_000_000_000
		};
		saveResumeRecord(record);

		// Same name, same mtime — different bytes.
		expect(loadResumeRecord('proj-1', clip('drone.mp4', 90 * MIB))).toBeNull();
		// Same name, same size — re-exported, so a different mtime.
		expect(loadResumeRecord('proj-1', clip('drone.mp4', 96 * MIB, 1_800_000_000_000))).toBeNull();
		// Same size, same mtime — a different file.
		expect(loadResumeRecord('proj-1', clip('other.mp4', 96 * MIB))).toBeNull();
		// Right file, wrong project.
		expect(loadResumeRecord('proj-2', clip('drone.mp4', 96 * MIB))).toBeNull();
		// Only the exact match resumes.
		expect(loadResumeRecord('proj-1', clip('drone.mp4', 96 * MIB))).toEqual(record);
	});

	it('re-uploads every part rather than resuming when a different file is picked', async () => {
		// The end-to-end consequence of the check above: a swapped file must not
		// skip parts 1 and 2.
		vi.useFakeTimers();
		const original = clip('drone.mp4', 96 * MIB);
		const pending = failNearTheEnd(original);
		await vi.advanceTimersByTimeAsync(20_000);
		await pending;
		vi.useRealTimers();

		calls = [];
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3, 'up-2'));
			if (isPart(c)) return partAck(c);
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});
		// Same name and mtime, RE-EXPORTED to a different size.
		await uploads.videoSourceAuto('proj-1', clip('drone.mp4', 90 * MIB));

		expect(calls.filter(isOpen)).toHaveLength(1); // fresh session
		expect(calls.filter(isPart).map(partNumber)).toEqual([1, 2, 3]);
		expect(calls.filter(isPart)[0].url).toContain('/uploads/up-2/');
	});

	it('does not resume into a session the server has already swept', async () => {
		// Past `expires_at` the parts are gone and every call 409s; resuming would
		// turn a recoverable upload into a hard failure.
		saveResumeRecord({
			uploadId: 'up-1',
			sourceId: 'src-1',
			projectId: 'proj-1',
			partSize: PART_SIZE,
			partCount: 3,
			expiresAt: '2020-01-01T00:00:00Z',
			completedParts: [1, 2],
			fileName: 'drone.mp4',
			fileSize: 96 * MIB,
			fileLastModified: 1_700_000_000_000
		});
		const file = clip('drone.mp4', 96 * MIB);
		expect(loadResumeRecord('proj-1', file)).toBeNull();

		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3, 'up-2'));
			if (isPart(c)) return partAck(c);
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});
		await uploads.videoSourceAuto('proj-1', file);
		expect(calls.filter(isOpen)).toHaveLength(1);
		expect(calls.filter(isPart).map(partNumber)).toEqual([1, 2, 3]);
	});

	it('drops the session AND the record on a cancel or a deterministic verdict', async () => {
		// Neither can ever be resumed: a cancel means the operator does not want
		// the clip, and a 415 refuses the same bytes the same way every time. Both
		// must release the staged parts exactly as they did before resume existed.
		for (const scenario of ['abort', 'deterministic'] as const) {
			installLocalStorageMock();
			calls = [];
			const file = clip('drone.mp4', 96 * MIB);
			const controller = new AbortController();
			if (scenario === 'abort') controller.abort(new Error('cancelled'));
			route((c) => {
				if (isOpen(c)) return jsonOk(201, session(3));
				if (isPart(c))
					return { ok: false, status: 415, statusText: 'error', json: async () => ({}) };
				if (isDelete(c)) return { ok: true, status: 204 };
				return jsonOk(201, created());
			});

			await expect(
				uploads.videoSourceAuto('proj-1', file, {
					signal: scenario === 'abort' ? controller.signal : undefined
				})
			).rejects.toThrow();

			expect(calls.filter(isDelete)).toHaveLength(1);
			expect(loadResumeRecord('proj-1', file)).toBeNull();
		}
	});

	it('keeps the record durable across a simulated tab close', async () => {
		// The `beforeunload` handler is a COURTESY, not the mechanism: the record is
		// already on disk after each ACKed part. Firing unload changes nothing, and
		// crucially does NOT delete the session — which would destroy the very
		// parts resume exists to reuse.
		vi.useFakeTimers();
		const file = clip('drone.mp4', 96 * MIB);
		const pending = failNearTheEnd(file);
		await vi.advanceTimersByTimeAsync(20_000);
		await pending;
		vi.useRealTimers();

		window.dispatchEvent(new Event('beforeunload'));
		expect(calls.filter(isDelete)).toHaveLength(0);
		expect(loadResumeRecord('proj-1', file)).toMatchObject({
			uploadId: 'up-1',
			completedParts: [1, 2]
		});
	});
});

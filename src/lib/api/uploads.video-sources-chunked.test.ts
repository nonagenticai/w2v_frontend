import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import {
	CHUNKED_UPLOAD_THRESHOLD_BYTES,
	MAX_VIDEO_SOURCE_BYTES,
	uploads,
	videoCompleteTimeoutMs,
	videoSourceErrorMessage,
	videoSourceTooLargeMessage
} from './uploads.js';
import { ApiError } from './client.js';
import { installXhrFetchShim } from './test-support/xhr-fetch-shim.js';

const MIB = 1024 * 1024;
const PART_SIZE = 32 * MIB;

/**
 * A File that REPORTS a large size without allocating it.
 *
 * `size` is overridden rather than backed by real bytes because the assertions
 * here are about the request SHAPE — how the file is sliced and how many bodies
 * are issued — not about payload content, and materialising ~100 MB per test in
 * the CI browser is exactly the kind of thing that has starved this suite before.
 * `slice` is spied so the ranges the uploader asks for are directly observable;
 * that is the honest proxy for "no request body larger than a part", since a
 * body can only ever be as big as the range it was cut from.
 */
function bigClip(name: string, size: number, type = 'video/mp4') {
	const file = new File([new Uint8Array(1)], name, { type });
	Object.defineProperty(file, 'size', { value: size });
	const ranges: Array<[number, number]> = [];
	const realSlice = file.slice.bind(file);
	vi.spyOn(file, 'slice').mockImplementation((start?: number, end?: number) => {
		ranges.push([start ?? 0, end ?? size]);
		return realSlice(0, 1);
	});
	return { file, ranges };
}

function jsonOk(status: number, body: unknown) {
	return { ok: true, status, json: async () => body };
}

function jsonErr(status: number, message: string) {
	return { ok: false, status, statusText: 'error', json: async () => ({ error: { message } }) };
}

function session(partCount: number) {
	return {
		upload_id: 'up-1',
		source_id: 'src-1',
		part_size: PART_SIZE,
		part_count: partCount,
		expires_at: '2099-01-01T00:00:00Z'
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

describe('uploads.videoSourceAuto — chunked path', () => {
	const fetchMock = vi.fn();
	let calls: Call[];

	beforeEach(() => {
		calls = [];
		// Resume records are durable by design (localStorage). Clear them between
		// tests or a staging failure in one test silently resumes into the next.
		installLocalStorageMock();
		vi.stubGlobal('fetch', fetchMock);
		// The part PUTs run on XMLHttpRequest (fetch emits no upload-progress
		// event). The shim routes them back through this same fetch mock, so every
		// assertion below still reads one request stream.
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value));
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	/** Route the mock by URL+method so a test never depends on call ORDER, which
	 *  is what makes the retry tests readable. */
	function route(handler: (call: Call) => unknown) {
		fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
			const call = { url, init };
			calls.push(call);
			return handler(call);
		});
	}

	const isOpen = (c: Call) => c.url.endsWith('/video-sources/uploads') && c.init.method === 'POST';
	const isPart = (c: Call) => c.url.includes('/parts/');
	const isComplete = (c: Call) => c.url.endsWith('/complete');
	const isDelete = (c: Call) => c.init.method === 'DELETE';
	const partNumber = (c: Call) => Number(c.url.split('/parts/')[1]);

	it('never issues a body larger than one part for an over-threshold clip', async () => {
		// REVERT THIS AND THE REPORTED BUG COMES BACK VERBATIM: the whole clip goes
		// out as one body, Cloudflare 413s anything over 100 MB, and every real 4K
		// drone clip (the demo corpus is four files at ~134 MB) becomes impossible
		// to upload through the product at all.
		const { file, ranges } = bigClip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c))
				return jsonOk(200, {
					part_number: partNumber(c),
					bytes: PART_SIZE,
					received_parts: partNumber(c),
					received_bytes: partNumber(c) * PART_SIZE
				});
			return jsonOk(201, created());
		});

		const res = await uploads.videoSourceAuto('proj-1', file);

		expect(res.source_id).toBe('src-1');
		const parts = calls.filter(isPart);
		expect(parts.map(partNumber)).toEqual([1, 2, 3]);
		for (const part of parts) expect(part.init.method).toBe('PUT');
		// Every slice is at most one part wide, and together they cover the file
		// exactly once — no gap (a corrupt object) and no whole-file body.
		expect(ranges).toEqual([
			[0, PART_SIZE],
			[PART_SIZE, 2 * PART_SIZE],
			[2 * PART_SIZE, 96 * MIB]
		]);
		for (const [start, end] of ranges) {
			expect(end - start).toBeLessThanOrEqual(PART_SIZE);
			expect(end - start).toBeLessThanOrEqual(CHUNKED_UPLOAD_THRESHOLD_BYTES);
		}
		// And the single-shot multipart route was never touched.
		expect(calls.some((c) => c.init.body instanceof FormData)).toBe(false);
	});

	it('sends parts as raw octet-stream, not multipart', async () => {
		// A multipart envelope per part would add a boundary preamble to every
		// body and make the pod re-parse a payload whose shape it already knows.
		const { file } = bigClip('drone.mov', 96 * MIB, 'video/quicktime');
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			return jsonOk(201, created());
		});

		await uploads.videoSourceAuto('proj-1', file);

		const headers = calls.filter(isPart)[0].init.headers as Record<string, string>;
		expect(headers['Content-Type']).toBe('video/quicktime');
		expect(calls.filter(isPart)[0].init.body).toBeInstanceOf(Blob);
	});

	it('reports part-grained progress that ends at exactly 1', async () => {
		const { file } = bigClip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			return jsonOk(201, created());
		});
		const seen: number[] = [];

		await uploads.videoSourceAuto('proj-1', file, { onProgress: (f) => seen.push(f) });

		// The last part is short, so an unclamped completed×part_size would report
		// >1 and a progress bar would overshoot its track.
		expect(Math.max(...seen)).toBe(1);
		expect(seen).toEqual([...seen].sort((a, b) => a - b));
	});

	it('retries the SAME part index on a transport error and still completes', async () => {
		// REVERTED: one flaky part — a TCP reset, a proxy dropping a long-lived
		// connection — discards the entire multi-hundred-MB transfer and the
		// operator starts from byte zero.
		vi.useFakeTimers();
		const { file } = bigClip('drone.mp4', 96 * MIB);
		let part2Attempts = 0;
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) {
				if (partNumber(c) === 2) {
					part2Attempts++;
					if (part2Attempts === 1) throw new TypeError('Failed to fetch');
				}
				return jsonOk(200, {
					part_number: partNumber(c),
					bytes: 1,
					received_parts: partNumber(c),
					received_bytes: 1
				});
			}
			return jsonOk(201, created());
		});

		const pending = uploads.videoSourceAuto('proj-1', file);
		// Walk past the 1s/2s/4s backoff ladder without waiting for it.
		await vi.advanceTimersByTimeAsync(10_000);
		const res = await pending;

		expect(res.source_id).toBe('src-1');
		expect(part2Attempts).toBe(2);
		// The retry re-sends part 2 — it does not skip ahead or restart at part 1.
		expect(calls.filter(isPart).map(partNumber)).toEqual([1, 2, 2, 3]);
		expect(calls.filter(isComplete)).toHaveLength(1);
	});

	it('gives up after 3 attempts on a part that keeps failing', async () => {
		vi.useFakeTimers();
		const { file } = bigClip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) return jsonErr(503, 'storage unavailable');
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});

		// Surfaces the BACKEND DETAIL verbatim, not a filename-prefixed sentence.
		// That is the documented contract for an unmapped status — pinned by
		// `uploads.video-sources.test.ts` ("falls back to the backend detail on an
		// unmapped status") — and it is right here: every queue row in
		// `VideoSourcesUpload.svelte` already renders beside its own file name, so
		// repeating it inside the message buys nothing and pushes the one piece of
		// information the operator does NOT have ("storage unavailable") further
		// along the line. An earlier draft of this test asserted /drone\.mp4/ and
		// was contradicting that contract, not finding a bug.
		const pending = uploads.videoSourceAuto('proj-1', file);
		const assertion = expect(pending).rejects.toThrow(/storage unavailable/);
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;

		// Bounded: an unbounded retry loop on a down storage backend would hammer
		// the pod for as long as the tab stays open.
		expect(calls.filter(isPart)).toHaveLength(3);
	});

	it('does NOT retry a 415 — the same bytes are refused the same way every time', async () => {
		// REVERTED: a deterministic rejection is sent three times, tripling the
		// traffic and the operator's wait before showing the identical error.
		const { file } = bigClip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) return jsonErr(415, 'Unsupported Media Type');
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});

		await expect(uploads.videoSourceAuto('proj-1', file)).rejects.toThrow(
			/is not a supported video/
		);

		expect(calls.filter(isPart)).toHaveLength(1);
	});

	it.each([400, 404, 409, 413])('does NOT retry a deterministic %i', async (status) => {
		const { file } = bigClip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) return jsonErr(status, 'nope');
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(201, created());
		});

		await expect(uploads.videoSourceAuto('proj-1', file)).rejects.toThrow();

		expect(calls.filter(isPart)).toHaveLength(1);
	});

	it('DELETEs the staging session when the caller aborts', async () => {
		// REVERTED: a cancelled 400 MB transfer leaves its parts in the staging
		// bucket until the session TTL sweeps them.
		const { file } = bigClip('drone.mp4', 96 * MIB);
		const controller = new AbortController();
		controller.abort();
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonOk(200, {});
		});

		await expect(
			uploads.videoSourceAuto('proj-1', file, { signal: controller.signal })
		).rejects.toThrow();

		const deletes = calls.filter(isDelete);
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toContain('/video-sources/uploads/up-1');
		// Aborted before a single byte went out.
		expect(calls.filter(isPart)).toHaveLength(0);
	});

	/** A request that never answers and only settles when its own deadline fires.
	 *  That is precisely the prod failure: the pod is still composing + probing,
	 *  and the client hangs up on it. Reports how long it was given, so a test can
	 *  assert the DEADLINE ITSELF rather than merely that "something timed out". */
	function hangUntilDeadline(init: RequestInit, record: (ms: number) => void): Promise<never> {
		const started = Date.now();
		const signal = init.signal as AbortSignal;
		return new Promise<never>((_resolve, reject) => {
			signal.addEventListener('abort', () => {
				record(Date.now() - started);
				reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
			});
		});
	}

	it('gives complete a size-scaled deadline, not the 30s JSON default', async () => {
		// REVERTED (drop the `timeoutMs` and this reds): `complete` carries an empty
		// body, so it inherits DEFAULT_REQUEST_TIMEOUT_MS = 30_000 — while the pod
		// behind it composes N staged objects, downloads the whole clip and ffprobes
		// it. Measured in prod on a 134 MB clip: the client aborted with
		// "request_timeout", the UI said "0 clips uploaded", and the backend had
		// ALREADY written a fully probed `video_sources` row.
		vi.useFakeTimers();
		const { file } = bigClip('drone.mp4', 134_496_939);
		const deadlines: number[] = [];
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(5));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			if (isDelete(c)) return { ok: true, status: 204 };
			return hangUntilDeadline(c.init, (ms) => deadlines.push(ms));
		});

		const pending = uploads.videoSourceAuto('proj-1', file);
		const assertion = expect(pending).rejects.toThrow();
		await vi.advanceTimersByTimeAsync(30 * 60_000);
		await assertion;

		// Exact, so a regression to ANY smaller default is caught — not just a
		// `toBeGreaterThan(30_000)` that a 31s default would slip past.
		expect(deadlines[0]).toBe(videoCompleteTimeoutMs(file.size));
		expect(deadlines[0]).toBeGreaterThan(30_000);
		// And it scales: a clip at the cap must get materially more than a small one.
		expect(videoCompleteTimeoutMs(MAX_VIDEO_SOURCE_BYTES)).toBeGreaterThan(
			videoCompleteTimeoutMs(1024)
		);
	});

	it('does not clip the complete deadline at the size cap', () => {
		// The scaling assertion above passes even when the ceiling CLIPS (a clipped
		// 600s still beats a small clip's 120s floor), so it cannot catch the
		// regression that matters. This can: at the cap the deadline must still be
		// the size-derived budget, not the ceiling. If it ever equals the ceiling,
		// every clip past that size silently shares one deadline that is SHORTER
		// than the work — the client hangs up, reports "0 clips uploaded", and the
		// pod finishes the upload anyway (the prod failure this ladder exists for).
		const atCap = videoCompleteTimeoutMs(MAX_VIDEO_SOURCE_BYTES);
		const overCap = videoCompleteTimeoutMs(MAX_VIDEO_SOURCE_BYTES * 2);
		expect(atCap).toBeLessThan(overCap);
	});

	it('retries a timed-out complete and resolves when the retry succeeds', async () => {
		// REVERTED: the single most common real outcome — the edge hangs up at 524
		// while the pod finishes — is reported to the operator as a failed upload of
		// a clip that is sitting in their project.
		vi.useFakeTimers();
		const { file } = bigClip('drone.mp4', 134_496_939);
		let completeAttempts = 0;
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(5));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			if (isDelete(c)) return { ok: true, status: 204 };
			completeAttempts++;
			if (completeAttempts === 1) return hangUntilDeadline(c.init, () => {});
			return jsonOk(201, created());
		});

		const pending = uploads.videoSourceAuto('proj-1', file);
		await vi.advanceTimersByTimeAsync(30 * 60_000);
		const res = await pending;

		// `complete` is idempotent against an already-composed object, so the second
		// call returns the same VideoSourceResponse — the whole upload succeeds.
		expect(res.source_id).toBe('src-1');
		expect(completeAttempts).toBe(2);
		expect(calls.filter(isDelete)).toHaveLength(0);
	});

	it('does NOT abandon the staging session when complete times out', async () => {
		// ⛔ THE FENCE. Remove the terminal/indeterminate split and this reds.
		// On a `complete` timeout the server may have already composed, probed and
		// attached the clip (it had, in the prod run this was written from). DELETEing
		// the session then races or destroys a SUCCESSFUL upload — the same ordering
		// hazard blocked pre-merge in orchestrator #838, re-entering from the client.
		vi.useFakeTimers();
		const { file } = bigClip('drone.mp4', 134_496_939);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(5));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			if (isDelete(c)) return { ok: true, status: 204 };
			return hangUntilDeadline(c.init, () => {});
		});

		const pending = uploads.videoSourceAuto('proj-1', file);
		const assertion = expect(pending).rejects.toThrow(/may already be attached/i);
		await vi.advanceTimersByTimeAsync(30 * 60_000);
		await assertion;

		expect(calls.filter(isDelete)).toHaveLength(0);
		// Bounded — it does not re-issue `complete` for as long as the tab is open.
		expect(calls.filter(isComplete)).toHaveLength(3);
	});

	it('does not tell the operator the clip failed when the outcome is unknown', async () => {
		// The actual harm being fixed: "Could not upload C0005.MP4: request_timeout"
		// sent a tester to re-upload 128 MiB that was already there, creating a
		// duplicate. The copy must point at the clip list, not at re-uploading.
		vi.useFakeTimers();
		const { file } = bigClip('C0005.MP4', 134_496_939);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(5));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			if (isDelete(c)) return { ok: true, status: 204 };
			return hangUntilDeadline(c.init, () => {});
		});

		const pending = uploads.videoSourceAuto('proj-1', file);
		const assertion = pending.then(
			() => {
				throw new Error('expected rejection');
			},
			(err: Error) => err.message
		);
		await vi.advanceTimersByTimeAsync(30 * 60_000);
		const message = await assertion;

		expect(message).toContain('C0005.MP4');
		expect(message).toMatch(/check this project's clips/i);
		expect(message).not.toMatch(/request_timeout/);
		expect(message).not.toMatch(/could not upload/i);
	});

	it('still abandons when complete returns a terminal 4xx', async () => {
		// A 4xx is a verdict the server reached BEFORE composing anything, so the
		// staged parts are worthless and releasing them is right — unchanged
		// behaviour, fenced so the indeterminate path above cannot swallow it.
		const { file } = bigClip('drone.mp4', 134_496_939);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(5));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			if (isDelete(c)) return { ok: true, status: 204 };
			return jsonErr(409, 'session expired');
		});

		await expect(uploads.videoSourceAuto('proj-1', file)).rejects.toThrow(/expired/i);

		expect(calls.filter(isDelete)).toHaveLength(1);
		// A deterministic verdict is not retried.
		expect(calls.filter(isComplete)).toHaveLength(1);
	});

	/** Like `bigClip`, but each slice REPORTS the width of the range it was cut
	 *  from while still holding one byte. The XHR shim advertises `body.size` as
	 *  the progress total, so this is what makes a part's intra-part progress
	 *  observable without allocating 32 MiB per part in the test browser. */
	function bigClipWithSizedSlices(name: string, size: number) {
		const file = new File([new Uint8Array(1)], name, { type: 'video/mp4' });
		Object.defineProperty(file, 'size', { value: size });
		const realSlice = file.slice.bind(file);
		vi.spyOn(file, 'slice').mockImplementation((start?: number, end?: number) => {
			const chunk = realSlice(0, 1);
			Object.defineProperty(chunk, 'size', { value: (end ?? size) - (start ?? 0) });
			return chunk;
		});
		return file;
	}

	it('reports intermediate BYTES within a part, not one tick per part', async () => {
		// ⛔ THE FENCE for defect 2 on the chunked path. Part size is FIXED at 32 MiB
		// server-side (`_UPLOAD_PART_BYTES`), so a 134 MB clip got FOUR ticks across
		// several minutes — and the gaps between them are exactly when an operator
		// decides the thing has wedged. Drop `onUploadProgress` from the part PUT and
		// this reds: every reported value lands on a part boundary.
		const file = bigClipWithSizedSlices('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			return jsonOk(201, created());
		});
		const seen: number[] = [];

		await uploads.videoSourceAuto('proj-1', file, { onProgress: (f) => seen.push(f) });

		const strictlyInside = seen.filter((f) => f > 0 && f < 1);
		expect(strictlyInside.length).toBeGreaterThan(0);
		// Off the 1/3 and 2/3 part boundaries — i.e. bytes, not completed parts.
		expect(seen.some((f) => f > 0 && f < 1 / 3)).toBe(true);
		// Never walks backwards: a part retry re-sends counted bytes, and a bar that
		// reverses reads as "something was lost".
		expect(seen).toEqual([...seen].sort((a, b) => a - b));
		expect(Math.max(...seen)).toBe(1);
	});

	it('aborts mid-part AND releases the staged parts', async () => {
		// ⛔ THE FENCE for defect 1. There was no cancel at all: a mis-picked 512 MB
		// file could only be escaped by closing the tab, and because the pump is
		// sequential it blocked every clip queued behind it too. Drop `signal` from
		// `putVideoSourcePart`'s `api.putRaw` call and this hangs instead of failing.
		const file = bigClipWithSizedSlices('drone.mp4', 96 * MIB);
		const controller = new AbortController();
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isDelete(c)) return { ok: true, status: 204 };
			if (isPart(c)) {
				// A part that never answers, cancelled while it is in flight — the real
				// shape of "the operator changed their mind three minutes in".
				queueMicrotask(() => controller.abort(new Error('The upload was cancelled.')));
				return new Promise((_resolve, reject) => {
					const signal = c.init.signal as AbortSignal;
					signal.addEventListener('abort', () => reject(new Error('aborted')));
				});
			}
			return jsonOk(201, created());
		});

		await expect(
			uploads.videoSourceAuto('proj-1', file, { signal: controller.signal })
		).rejects.toThrow(/cancelled/i);

		// STAGING phase: nothing is composed, so the parts are worthless and
		// releasing them is unambiguously right.
		const deletes = calls.filter(isDelete);
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toContain('/video-sources/uploads/up-1');
		// A cancel is not a transport blip: the part is not re-sent three times, and
		// `complete` is never issued for a transfer the operator stopped.
		expect(calls.filter(isPart)).toHaveLength(1);
		expect(calls.filter(isComplete)).toHaveLength(0);
	});

	it('does NOT release the parts when the abort lands after complete was sent', async () => {
		// ⛔ THE COUNTER-FENCE, and the reason cancel could not simply "abort and
		// clean up". Once `complete` is on the wire the parts may ALREADY be a
		// composed, probed, attached clip — the pod finishes work the client stopped
		// waiting for (measured in prod). DELETEing then races or destroys a
		// SUCCESSFUL upload. Move the abandon out of the staging block into a shared
		// unwind and this reds.
		const file = bigClipWithSizedSlices('drone.mp4', 96 * MIB);
		const controller = new AbortController();
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c))
				return jsonOk(200, { part_number: 1, bytes: 1, received_parts: 1, received_bytes: 1 });
			if (isDelete(c)) return { ok: true, status: 204 };
			queueMicrotask(() => controller.abort(new Error('The upload was cancelled.')));
			return new Promise((_resolve, reject) => {
				const signal = c.init.signal as AbortSignal;
				signal.addEventListener('abort', () => reject(new Error('aborted')));
			});
		});

		const pending = uploads.videoSourceAuto('proj-1', file, { signal: controller.signal });

		// The copy is the indeterminate one, NOT "cancelled, nothing happened":
		// every byte is staged and `complete` was issued, so the client cannot say.
		await expect(pending).rejects.toThrow(/may already be attached/i);
		expect(calls.filter(isDelete)).toHaveLength(0);
		// And the abort stops the retry ladder rather than re-issuing `complete`.
		expect(calls.filter(isComplete)).toHaveLength(1);
	});

	it('never lets a failed cleanup DELETE mask the real error', async () => {
		const { file } = bigClip('drone.mp4', 96 * MIB);
		route((c) => {
			if (isOpen(c)) return jsonOk(201, session(3));
			if (isPart(c)) return jsonErr(415, 'Unsupported Media Type');
			if (isDelete(c)) throw new TypeError('Failed to fetch');
			return jsonOk(201, created());
		});

		// The 415 is what the operator must see — not "Failed to fetch" from a
		// best-effort cleanup call they never made.
		await expect(uploads.videoSourceAuto('proj-1', file)).rejects.toThrow(
			/is not a supported video/
		);
	});
});

describe('uploads.videoSourceAuto — single-shot path', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		installXhrFetchShim((name, value) => vi.stubGlobal(name, value), { fallbackTotal: 1024 });
		fetchMock.mockReset();
	});

	afterEach(() => vi.restoreAllMocks());

	it('leaves a sub-threshold clip on the untouched multipart path', async () => {
		// REVERTED: small clips start paying three round trips and the whole
		// session/expiry/retry state machine for a transfer that never needed it.
		const { file } = bigClip('short.mp4', CHUNKED_UPLOAD_THRESHOLD_BYTES);
		fetchMock.mockResolvedValueOnce(jsonOk(200, created()));

		await uploads.videoSourceAuto('proj-1', file);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/projects/proj-1/video-sources');
		expect(url).not.toContain('/uploads');
		expect(init.method).toBe('POST');
		expect(init.body).toBeInstanceOf(FormData);
	});

	it('reports REAL BYTES on the single-shot path, not just 0 then 1', async () => {
		// ⛔ THE FENCE for the lie. This path was literally `onProgress(0)` → await →
		// `onProgress(1)`, so a 60 MiB clip — under the chunked threshold, therefore
		// still minutes on an ordinary uplink — showed an EMPTY bar for the entire
		// transfer and then snapped to full. Indistinguishable from a hang, and the
		// path least able to prove otherwise, since it has no per-part ticks either.
		// Revert `videoSource` to `api.postForm` and this reds: `seen` is [0, 1].
		const { file } = bigClip('short.mp4', 1024);
		fetchMock.mockResolvedValueOnce(jsonOk(200, created()));
		const seen: number[] = [];

		await uploads.videoSourceAuto('proj-1', file, { onProgress: (f) => seen.push(f) });

		expect(seen[0]).toBe(0);
		expect(seen[seen.length - 1]).toBe(1);
		const intermediate = seen.filter((f) => f > 0 && f < 1);
		expect(intermediate.length).toBeGreaterThan(0);
		expect(seen).toEqual([...seen].sort((a, b) => a - b));
	});
});

describe('videoSourceErrorMessage — 413 blames the network, not the clip', () => {
	it('does not tell the operator to compress a file that is within the limit', () => {
		// REVERTED: an operator re-compresses a 134 MB clip that was never over the
		// app cap — and the smaller file fails at the same edge anyway.
		// `validateVideoSource` is the only honest source of "too large", and it
		// runs before a byte leaves the browser.
		const msg = videoSourceErrorMessage(new ApiError(413, 'Payload Too Large', ''), 'drone.mp4');

		expect(msg).toContain('drone.mp4');
		expect(msg).toMatch(/network/i);
		// Derived from the real copy, so this stays a live assertion after a cap
		// change. A literal "512 MB limit" here could never match again and the
		// check would silently become vacuous.
		expect(msg).not.toContain('is larger than the');
		expect(msg).not.toContain(videoSourceTooLargeMessage('drone.mp4'));
		expect(msg).not.toMatch(/compress/i);
	});

	it('tells the operator a 409 means the session expired, not that the clip is bad', () => {
		const msg = videoSourceErrorMessage(new ApiError(409, 'Conflict', ''), 'drone.mp4');

		expect(msg).toMatch(/expired/i);
		expect(msg).toContain('drone.mp4');
	});
});

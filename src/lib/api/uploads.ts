import { api, ApiError } from './client.js';
import { clearResumeByUploadId, loadResumeRecord, saveResumeRecord } from './upload-resume.js';
import type { components as gen } from '$lib/api/types.gen';

// Field-for-field identical to the generated schema, so alias it rather than
// keep a second copy that can silently diverge.
export type ManuscriptUploadResponse = gen['schemas']['ManuscriptUploadResponse'];

export interface DocumentUploadResponse {
	document_ref: string;
	document_name: string;
	bytes: number;
}

export interface PackageUploadResponse {
	package_url: string;
	bytes: number;
}

export interface VoiceoverUploadResponse {
	audio_url: string;
	/** Server-probed (ffprobe) duration of the upload. This becomes the shot's
	 *  length on the re-stitch — the compiler is authoritative on duration. */
	seconds: number;
}

/** Aliased to the generated schema rather than hand-declared: the backend now
 *  publishes this shape, and two same-named types is how `CheckpointsResponse`
 *  came to declare `job_id` against a backend returning `run_id`.
 *
 *  `width`/`height` are server-probed pixel dimensions. They are absent or
 *  `null` when the decoder could not read a size (e.g. an animated GIF the
 *  backend declines to probe) — treat them as display hints, never as a
 *  validation signal. */
export type StoryboardAssetImageUploadResponse =
	gen['schemas']['StoryboardAssetImageUploadResponse'];

/** One registered action_reel source clip. `preview_status` is `pending` on
 *  create — the derivative pass flips it to `ready`/`failed` later. */
export type VideoSourceResponse = gen['schemas']['VideoSourceResponse'];
export type VideoSourceListResponse = gen['schemas']['VideoSourceListResponse'];

/** Server cap per clip (413 past this). Enforced client-side FIRST so an
 *  over-cap file is never streamed to the pod just to be refused.
 *
 *  Raised 512 MiB → 4 GiB: ordinary 4K drone footage runs ~1.9 GB per clip and
 *  was refused outright. The transport already chunks at a server-chosen 32 MiB
 *  part size, so nothing about how the bytes move changes with the larger cap.
 *  Never render this number by hand — see `videoSourceTooLargeMessage`. */
export const MAX_VIDEO_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;

/** Assumed sustained upload throughput when sizing a clip's request deadline.
 *  1 Mbps is deliberately pessimistic — an ordinary office/home link, not a
 *  datacentre one. */
const ASSUMED_UPLOAD_BYTES_PER_SECOND = 128 * 1024;
/** Floor, so a small clip on a momentarily stalled link still gets a fair go. */
const MIN_VIDEO_UPLOAD_TIMEOUT_MS = 120_000;
/** Ceiling, so a dead connection cannot hold a slot open forever. */
const MAX_VIDEO_UPLOAD_TIMEOUT_MS = 30 * 60_000;

/** A per-clip request deadline scaled to the clip's size.
 *
 *  The client's blanket 120s upload timeout is wrong for this route by an order
 *  of magnitude: finishing a 512 MiB clip inside it demands ~36 Mbps SUSTAINED,
 *  which ordinary connections do not hold, and even a typical 134 MiB drone clip
 *  needs ~9 Mbps. The abort surfaces as a per-file failure, so a slow link reads
 *  to the operator as "this clip is broken" and they re-pick a file that was
 *  never the problem. Scaling by size makes the deadline mean "this transfer has
 *  stalled" instead of "your connection is not a datacentre". */
export function videoUploadTimeoutMs(bytes: number): number {
	const budget = (bytes / ASSUMED_UPLOAD_BYTES_PER_SECOND) * 1000;
	return Math.min(MAX_VIDEO_UPLOAD_TIMEOUT_MS, Math.max(MIN_VIDEO_UPLOAD_TIMEOUT_MS, budget));
}

/** Fixed cost of a `complete` that moves no bytes: the request round trip, the
 *  MinIO compose call itself, ffprobe's startup, and the DB write. */
const COMPLETE_BASE_MS = 60_000;
/** Assumed throughput for the SERVER's own byte-shuffling during `complete`
 *  (compose the parts, stream the composed object to a temp file, ffprobe it).
 *  Deliberately NOT `ASSUMED_UPLOAD_BYTES_PER_SECOND`: those bytes never cross
 *  the operator's uplink, they move inside the cluster between the pod and
 *  MinIO. 4 MiB/s is still an order of magnitude below what that link does — it
 *  is a "the pod is busy and the disk is contended" floor, not a throughput
 *  estimate, because the only job of this number is to stop us hanging up on a
 *  request that is still working. */
const COMPLETE_BYTES_PER_SECOND = 4 * 1024 * 1024;
/** Never shorter than the per-part deadline: a `complete` doing strictly more
 *  work than one part PUT must never have less time than one. */
const MIN_VIDEO_COMPLETE_TIMEOUT_MS = 120_000;
/** Ceiling. At the 4 GiB cap the formula asks for ~1084s, so 30 min keeps this
 *  a pure backstop — it exists so a wedged pod cannot hold the queue open
 *  indefinitely, NOT to cut short a pod that is still working.
 *  ⚠️ Keep it above `videoCompleteTimeoutMs(MAX_VIDEO_SOURCE_BYTES)`. At the
 *  previous 10 min it CLIPPED for anything past ~2.1 GiB, which reinstates the
 *  exact prod failure documented on `videoCompleteTimeoutMs` below: the client
 *  hangs up, reports "0 clips uploaded", and the pod finishes the upload anyway.
 *  If the cap rises again, re-check this number. */
const MAX_VIDEO_COMPLETE_TIMEOUT_MS = 30 * 60_000;

/**
 * Deadline for the chunked upload's `complete` call, scaled by clip size.
 *
 * `complete` carries an EMPTY body, so it looks like a cheap JSON POST and got
 * the client's 30s JSON default. It is in fact the most expensive call in the
 * protocol: the pod composes the N staged objects, downloads the whole clip
 * (up to `MAX_VIDEO_SOURCE_BYTES`) to a temp file and runs ffprobe on it.
 * Measured in prod on a
 * 134 MB drone clip that work did not fit in 30s — the client aborted, showed
 * "Could not upload …: request_timeout" and "0 clips uploaded", while the
 * backend went on to finish: the `video_sources` row existed, probed, with the
 * exact byte count. The operator was told to re-upload 128 MiB that was already
 * there.
 *
 * 60s base + 1s per 4 MiB gives 120s (the floor) for anything up to ~240 MiB
 * and ~1084s at the 4 GiB cap, under the 30 min ceiling — comfortably over the
 * real cost, which is the point: this deadline should only ever fire on a pod
 * that has actually stopped responding, never on one that is merely working.
 * The ceiling must stay above the value this returns for a max-size clip, or
 * the clipping reinstates the prod failure described above.
 */
export function videoCompleteTimeoutMs(bytes: number): number {
	const budget = COMPLETE_BASE_MS + (bytes / COMPLETE_BYTES_PER_SECOND) * 1000;
	return Math.min(MAX_VIDEO_COMPLETE_TIMEOUT_MS, Math.max(MIN_VIDEO_COMPLETE_TIMEOUT_MS, budget));
}

/** The only extensions the backend accepts (case-insensitive; 415 otherwise). */
export const VIDEO_SOURCE_EXTENSIONS = ['mp4', 'mov', 'm4v'] as const;

const VIDEO_CONTENT_TYPES: Record<string, string> = {
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	m4v: 'video/x-m4v'
};

function fileExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * The ONE genuine over-cap message. Kept separate from the wire-413 case below
 * because the two mean different things and used to share one string: this is
 * the only place that can honestly say "your file is too big", because it is the
 * only place that has measured `file.size` against `MAX_VIDEO_SOURCE_BYTES`.
 *
 * The limit in the sentence is DERIVED from that constant, never typed. It used
 * to be the literal "512 MB", which is exactly how a cap and the copy that
 * describes it desync: raising the constant would have left the UI telling
 * operators about a limit that no longer existed.
 */
export function videoSourceTooLargeMessage(filename: string): string {
	return `${filename} is larger than the ${formatVideoSourceLimit()} limit. Trim or compress the clip and upload it again.`;
}

const GIB = 1024 * 1024 * 1024;

/** The cap as operator-facing copy: whole gigabytes when it is an exact
 *  multiple of 1 GiB (the case today), whole megabytes otherwise. Deliberately
 *  only these two shapes — the message is a hard refusal and a fractional
 *  figure ("3.7 GB") invites the operator to try trimming to just under it. */
function formatVideoSourceLimit(): string {
	if (MAX_VIDEO_SOURCE_BYTES % GIB === 0) {
		return `${MAX_VIDEO_SOURCE_BYTES / GIB} GB`;
	}
	return `${Math.floor(MAX_VIDEO_SOURCE_BYTES / (1024 * 1024))} MB`;
}

/**
 * Human copy for a failed clip upload, keyed on the backend's status codes.
 * The raw ApiError detail is a FastAPI validation string ("Unsupported media
 * type") that tells an operator nothing about what to do next, and this text is
 * rendered per-row next to the clip that failed — so each code gets a distinct
 * message naming the file and the fix.
 */
export function videoSourceErrorMessage(err: unknown, filename: string): string {
	const apiError = err instanceof ApiError ? err : null;
	if (apiError) {
		switch (apiError.status) {
			case 415:
				return `${filename} is not a supported video. Use an .mp4, .mov, or .m4v file.`;
			case 413:
				// A 413 arriving OVER THE WIRE is not a size verdict on the file.
				// `validateVideoSource` already refused anything past the per-clip cap
				// before a byte left the browser, so by construction every file that
				// reaches the network is within the app's limit. What actually emits
				// this is the edge: `w2v.nonagentic.ai` terminates at Cloudflare, which
				// 413s any body over 100 MB and cannot be raised on our plan (measured:
				// 96 MiB reaches the app, 100 MB is refused, 140 MB is cut off after
				// 2.1 MB). Telling the operator the clip is "too large" made them
				// re-compress a 134 MB drone clip that was never over any limit we
				// enforce — and the smaller file failed the same way. Name the network.
				return `${filename} was rejected by the network before it reached us — this is a transfer limit, not the file's size. Retry the clip; if it keeps failing, the upload could not be split.`;
			case 409:
				// The staging session for a chunked upload has a TTL (`expires_at`).
				// Past it the parts are swept and the part/complete calls 409 — the
				// bytes are gone, so there is nothing to resume and re-picking the file
				// is the only path forward.
				return `The upload session for ${filename} expired — re-add the clip and upload it again.`;
			case 400:
				return `${filename} is not readable as video — the file contents are not MP4/QuickTime. Re-export it and try again.`;
			case 404:
				return `This project no longer exists, so ${filename} could not be attached.`;
			default:
				return apiError.detail || `Could not upload ${filename}.`;
		}
	}
	// Transport/abort errors never reach the backend, so they carry no status.
	return err instanceof Error && err.message
		? `Could not upload ${filename}: ${err.message}`
		: `Could not upload ${filename}.`;
}

/**
 * What a queue row should SHOW for a failed clip.
 *
 * `ApiError`'s own `message` is `${status} ${statusText}: ${detail}` — a wire
 * trace, not copy. Rendering it put "413 Payload Too Large: …" in front of a
 * tester while the human sentence for that exact code sat unused two files away.
 * So: a raw `ApiError` is mapped; anything else is passed through, because every
 * throw site in `uploads.*` has ALREADY replaced its error with human text —
 * including `videoCompleteIndeterminateMessage`, whose "may already be attached"
 * wording must survive intact. That is precisely why this does not walk the
 * `cause` chain: the indeterminate wrapper carries the underlying 5xx as its
 * cause, and re-mapping from that cause would overwrite the one message in this
 * module that is deliberately NOT a verdict.
 */
export function uploadRowErrorMessage(err: unknown, filename: string): string {
	if (err instanceof ApiError) return videoSourceErrorMessage(err, filename);
	if (err instanceof Error && err.message) return err.message;
	return `Could not upload ${filename}.`;
}

/**
 * Human text for the clip-list side calls (list / delete), which are not
 * per-file and so have no `videoSourceErrorMessage` mapping. Same rule: never
 * put `ApiError`'s status-prefixed template on screen — show the backend's
 * detail, or the caller's own fallback sentence when there is none.
 */
export function uploadSideErrorMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError) return err.detail || fallback;
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}

/**
 * Copy for the one outcome the client genuinely CANNOT decide: `complete` was
 * issued, every byte was staged, and no answer came back (deadline, transport
 * drop, or a 5xx from something downstream of the compose).
 *
 * Every other message here is a verdict. This one deliberately is not, because
 * asserting either verdict costs the operator real work: "failed" makes them
 * re-upload 128 MiB that is already attached and creates a duplicate they then
 * have to find and delete (this is exactly what happened in prod), while
 * "succeeded" would hide a clip that never arrived. So it names the ambiguity
 * and points at the one place that can settle it — the project's own clip list,
 * which the uploader re-reads via `listVideoSources`.
 */
export function videoCompleteIndeterminateMessage(filename: string): string {
	return `${filename} finished transferring, but the server did not confirm in time. It may already be attached — check this project's clips before uploading it again, or you will end up with a duplicate.`;
}

/**
 * Client-side pre-flight for the two rejections we can see without a round
 * trip. Returns the SAME copy the server path produces, so a row's message
 * reads identically whether it was caught here or at the pod.
 */
export function validateVideoSource(file: File): string | null {
	if (!(VIDEO_SOURCE_EXTENSIONS as readonly string[]).includes(fileExtension(file.name))) {
		return videoSourceErrorMessage(new ApiError(415, 'Unsupported Media Type', ''), file.name);
	}
	if (file.size > MAX_VIDEO_SOURCE_BYTES) {
		// Deliberately NOT routed through `videoSourceErrorMessage(413)`: that case
		// now describes a network refusal, which is the opposite diagnosis. This is
		// the measured, genuine over-cap.
		return videoSourceTooLargeMessage(file.name);
	}
	return null;
}

/**
 * The multipart part MUST declare a `video/*` content type or the backend
 * refuses it with 415 before reading a byte. A `File` from an `<input>` usually
 * carries the right `type`, but a `.MP4` off some filesystems arrives as
 * `application/octet-stream` (and `.m4v` is frequently blank) — so re-wrap the
 * bytes in a Blob typed from the extension whenever the browser's guess is not
 * already a video type. `api.postForm` sets no per-part content type, so the
 * Blob's own `type` is the only channel for it.
 */
function videoPart(file: File): Blob {
	if (file.type.startsWith('video/')) return file;
	const type = VIDEO_CONTENT_TYPES[fileExtension(file.name)] ?? 'video/mp4';
	return new Blob([file], { type });
}

/**
 * Above this size a clip is uploaded in PARTS instead of as one body.
 *
 * The number is set by the EDGE, not by the app. `w2v.nonagentic.ai` terminates
 * at Cloudflare, whose request-body ceiling is 100 MB and cannot be raised on
 * our plan. Measured against the real public host with
 * `curl -X PUT --data-binary`: 32 / 48 / 64 / 96 MiB all reach the app (they
 * come back 401, i.e. the body got through to auth), 100 MB comes back 413, and
 * 140 MB is cut off after only 2.1 MB. Meanwhile the app itself allows 4 GiB
 * and the `action_reel` demo corpus has four clips at ~134 MB — so a normal 4K
 * drone clip simply could not be uploaded through the product at all.
 *
 * 64 MiB (= 67.1 MB) sits comfortably under the 100 MB wall with room for the
 * request line, headers and any proxy framing, and is the largest of the sizes
 * we actually PROVED gets through. Below it the single-shot multipart path runs
 * completely untouched: small clips keep the simpler, fewer-round-trip route,
 * and the chunked machinery — which is where the retry/cleanup/expiry states
 * live — is never exercised by files that never needed it.
 */
export const CHUNKED_UPLOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;

/** Attempts per part, including the first. */
const PART_MAX_ATTEMPTS = 3;
/** 1s, 2s, 4s. Indexed by the attempt that just failed. */
const PART_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];

/**
 * Statuses that are DETERMINISTIC: the same bytes will be refused the same way
 * every time. Retrying them triples the traffic (and, for a 64 MiB part on a
 * slow link, triples the wait) before showing the operator the identical error.
 *  - 400/415 — the content is not what the route accepts.
 *  - 413 — the edge refused this body size; a smaller one is needed, not a retry.
 *  - 404 — the project or the upload session does not exist.
 *  - 409 — the session expired; the staged parts are already swept.
 */
const NON_RETRYABLE_PART_STATUSES = new Set([400, 404, 409, 413, 415]);

/**
 * Retry only what a second attempt could plausibly fix: a transport failure
 * (no status at all — DNS blip, TCP reset, a proxy dropping a long-lived
 * connection mid-part) and the server-side/backpressure codes 5xx / 408 / 429.
 * Anything else is deterministic; see NON_RETRYABLE_PART_STATUSES.
 */
function isRetryablePartError(err: unknown): boolean {
	if (err instanceof ApiError) {
		if (NON_RETRYABLE_PART_STATUSES.has(err.status)) return false;
		return err.status >= 500 || err.status === 408 || err.status === 429;
	}
	// No status ⇒ the request never produced a response. Transport, retry.
	return true;
}

/** Attempts at `complete`, including the first. */
const COMPLETE_MAX_ATTEMPTS = 3;
/** Indexed by the attempt that just failed. Longer than the part ladder on
 *  purpose: what we are usually waiting out here is the server still finishing
 *  the compose+probe it began on the previous attempt. */
const COMPLETE_RETRY_BACKOFF_MS = [3_000, 8_000];

/**
 * Did `complete` fail in a way that PROVES nothing was created?
 *
 * This is the whole safety question, because the answer decides whether we
 * DELETE the session. A 4xx is a verdict the server reached and returned before
 * doing the work — the media type was wrong, the session had already been
 * swept, the project is gone — so nothing exists and abandoning is correct and
 * cheap. Anything else (no status at all: our own deadline firing, an aborted
 * connection, a Cloudflare 524; or a 5xx, which can be raised *after* the
 * object was composed) leaves the outcome unknown from here. Treating unknown
 * as failure is what destroyed a completed upload: the client aborted at 30s,
 * the pod finished the compose, and the DELETE then raced a `video_sources` row
 * that already existed. Unknown ⇒ retry `complete` (documented idempotent
 * against an already-composed object) and, if that is exhausted, LEAVE THE
 * SESSION ALONE and let the server's TTL sweep decide.
 */
function isTerminalCompleteError(err: unknown): boolean {
	return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Server's reply to `POST …/video-sources/uploads`. Hand-declared rather than
 *  aliased to `types.gen`: these routes are landing in the orchestrator now, so
 *  the generated schema does not carry them yet. Swap this for
 *  `gen['schemas'][…]` on the next `bun run codegen` — two same-named types is
 *  exactly how `CheckpointsResponse` came to declare the wrong field name. */
export interface VideoSourceUploadSession {
	upload_id: string;
	source_id: string;
	/** Bytes per part. The server chooses it; the client MUST slice to it, since
	 *  the completed object is reassembled by part index at that stride. */
	part_size: number;
	part_count: number;
	expires_at: string;
}

export interface VideoSourceUploadPartAck {
	part_number: number;
	bytes: number;
	received_parts: number;
	received_bytes: number;
}

export interface VideoSourceUploadOptions {
	/**
	 * Called with 0..1 as the BYTES go out — on both transports.
	 *
	 * It used to be part-grained, on the reasoning that "a server-chosen part size
	 * in the 8–32 MiB range moves the bar several times per clip". Both halves of
	 * that were wrong: the server's `_UPLOAD_PART_BYTES` is FIXED at 32 MiB, so a
	 * 134 MB clip got exactly four ticks — and a sub-64 MiB clip took the
	 * single-shot path, which reported 0 and then 1, i.e. an empty bar for the
	 * entire transfer. Both now report real bytes via the `XMLHttpRequest`
	 * transport in `client.ts` (`fetch` emits no upload-progress event at all).
	 *
	 * Guaranteed non-decreasing: a part retry re-sends bytes that were already
	 * counted, and a bar that walks backwards reads as corruption.
	 */
	onProgress?: (fraction: number) => void;
	/**
	 * Cancels the whole upload — session create, every part PUT, and `complete`.
	 * Aborting DURING the part phase releases the staged parts; aborting after
	 * `complete` has been issued deliberately does not (see `videoSourceChunked`).
	 */
	signal?: AbortSignal;
}

/** Best-effort release of a half-uploaded staging session.
 *
 *  Fire-and-forget ON PURPOSE. The caller is already unwinding with a real
 *  error (or an abort), and a failure to clean up must never replace it — an
 *  operator debugging "why did my clip fail" must not be shown the DELETE's
 *  error instead of the PUT's. Deliberately does NOT take the caller's signal:
 *  on an abort that signal is already fired, so passing it would cancel the
 *  very cleanup the abort is asking for. */
async function abandonUploadSession(projectId: string, uploadId: string): Promise<void> {
	try {
		await api.delete<void>(`/projects/${projectId}/video-sources/uploads/${uploadId}`);
	} catch {
		// Swallowed by design; the server sweeps expired sessions anyway.
	}
}

export const uploads = {
	/**
	 * Stage an audiobook manuscript (.txt/.docx/.epub). Returns the opaque
	 * storage ref to carry into `brief.manuscript_ref`. Multipart upload via
	 * `api.postForm` (raw body, no JSON Content-Type).
	 */
	manuscript(file: File): Promise<ManuscriptUploadResponse> {
		const form = new FormData();
		form.append('file', file);
		return api.postForm<ManuscriptUploadResponse>('/uploads/manuscript', form);
	},

	/**
	 * Stage a source document (.pdf/.txt/.docx/.epub/.md) for a multi-source
	 * brief. Returns the opaque storage ref to carry into a `brief.sources[]`
	 * entry of kind `document` (parsed by the orchestrator's source_ingest stage).
	 */
	document(file: File): Promise<DocumentUploadResponse> {
		const form = new FormData();
		form.append('file', file);
		return api.postForm<DocumentUploadResponse>('/uploads/document', form);
	},

	/**
	 * Stage a Playwright recording-package (.zip) for a showcase/demo_video
	 * authored run. Returns the presigned `package_url` to carry into
	 * `brief.package_url` (the record stage re-runs the package live).
	 */
	recordingPackage(file: File): Promise<PackageUploadResponse> {
		const form = new FormData();
		form.append('file', file);
		return api.postForm<PackageUploadResponse>('/uploads/package', form);
	},

	/**
	 * Stage a replacement voiceover (audio) for ONE clip. The backend validates
	 * the magic bytes, ffprobes the duration and stores it in an owned bucket.
	 * Carry `audio_url` + `seconds` into that clip's `ClipEdit`
	 * (`audio_url` / `audio_seconds`) — the re-stitch swaps the shot's TTS
	 * narration for this file, and the probed duration becomes the shot's length.
	 */
	voiceover(file: File): Promise<VoiceoverUploadResponse> {
		const form = new FormData();
		form.append('file', file);
		return api.postForm<VoiceoverUploadResponse>('/uploads/voiceover', form);
	},

	/**
	 * Stage ONE reference image (.png/.jpg/.jpeg/.webp/.gif, 10 MiB cap) for a
	 * storyboard asset's moodboard. The backend validates the magic bytes, so a
	 * renamed file is refused with 415 — do not pre-trust the extension here.
	 * Append the returned `image_url` to that asset's `reference_images` and
	 * PATCH it; the upload itself does NOT attach the image to anything.
	 */
	storyboardAssetImage(file: File): Promise<StoryboardAssetImageUploadResponse> {
		const form = new FormData();
		form.append('file', file);
		return api.postForm<StoryboardAssetImageUploadResponse>('/uploads/storyboard-asset', form);
	},

	/**
	 * Upload ONE raw source clip (.mp4/.mov/.m4v, `MAX_VIDEO_SOURCE_BYTES` cap) for an action_reel
	 * project. Unlike every other uploader here this is PROJECT-SCOPED — the
	 * project must already exist — and it takes one file per request by design
	 * (the caller loops, sequentially, so a 10-clip batch does not put ten
	 * 150 MB bodies through the pod at once and one failure only loses one clip).
	 *
	 * Rejects locally on extension/size before opening a connection, and maps
	 * the backend's 415/413/400 onto per-clip copy — callers can surface
	 * `err.message` directly.
	 */
	async videoSource(
		projectId: string,
		file: File,
		opts?: VideoSourceUploadOptions
	): Promise<VideoSourceResponse> {
		const localError = validateVideoSource(file);
		if (localError) throw new Error(localError);
		const form = new FormData();
		// The third arg keeps the original filename on the part after the Blob
		// re-wrap (a bare Blob would be sent as "blob").
		form.append('file', videoPart(file), file.name);
		try {
			// `postFormProgress`, not `postForm`: this is the ONE multipart uploader
			// whose body is big enough that the operator must see it move and must be
			// able to cancel it. `total` comes from the request, not from `file.size`,
			// because the multipart envelope adds a few hundred bytes of boundary and
			// headers — dividing by the file size would let the bar exceed 1.
			return await api.postFormProgress<VideoSourceResponse>(
				`/projects/${projectId}/video-sources`,
				form,
				{
					timeoutMs: videoUploadTimeoutMs(file.size),
					signal: opts?.signal,
					onUploadProgress: opts?.onProgress
						? (loaded, total) => opts.onProgress?.(total > 0 ? Math.min(1, loaded / total) : 0)
						: undefined
				}
			);
		} catch (err) {
			throw new Error(videoSourceErrorMessage(err, file.name), { cause: err });
		}
	},

	/**
	 * Upload ONE raw source clip in PARTS, for clips too large to survive the
	 * edge's 100 MB body ceiling in a single request (see
	 * `CHUNKED_UPLOAD_THRESHOLD_BYTES`).
	 *
	 * Three-call protocol: open a session (the server picks `part_size`), PUT each
	 * slice as a raw `application/octet-stream` body, then `complete`. The
	 * completion returns the SAME `VideoSourceResponse` the single-shot route
	 * returns, byte-identical — so nothing downstream of the uploader can tell
	 * which path ran, and the caller must not care.
	 *
	 * Parts go SEQUENTIALLY, matching the single-shot uploader's own rationale:
	 * the pod streams each body through a worker, and firing eight 32 MiB PUTs at
	 * once spikes memory there while giving the operator no better progress. It
	 * also keeps the retry story simple — exactly one part is ever in flight, so a
	 * retry re-sends that index and nothing else.
	 */
	async videoSourceChunked(
		projectId: string,
		file: File,
		opts?: VideoSourceUploadOptions
	): Promise<VideoSourceResponse> {
		const localError = validateVideoSource(file);
		if (localError) throw new Error(localError);

		const signal = opts?.signal;
		const contentType = videoPart(file).type;

		// RESUME. A 512 MB clip that died at 90% used to cost the operator the
		// whole transfer: `abandonUploadSession` runs only from a caught error, a
		// tab close skips it entirely, and re-picking the file opened a brand new
		// session that started again at part 1 while the old parts sat on the
		// server until its TTL. `loadResumeRecord` returns a session ONLY when the
		// project, the file's name+size+lastModified and the server's own
		// `expires_at` all still line up — see `upload-resume.ts` for why that
		// check is load-bearing rather than defensive.
		const resumed = loadResumeRecord(projectId, file);
		let session: VideoSourceUploadSession;
		const completedParts = new Set<number>(resumed?.completedParts ?? []);
		if (resumed) {
			session = {
				upload_id: resumed.uploadId,
				source_id: resumed.sourceId,
				part_size: resumed.partSize,
				part_count: resumed.partCount,
				expires_at: resumed.expiresAt
			};
		} else {
			try {
				session = await api.post<VideoSourceUploadSession>(
					`/projects/${projectId}/video-sources/uploads`,
					{ filename: file.name, content_type: contentType, bytes: file.size }
				);
			} catch (err) {
				throw new Error(videoSourceErrorMessage(err, file.name), { cause: err });
			}
		}

		const persist = () =>
			saveResumeRecord({
				uploadId: session.upload_id,
				sourceId: session.source_id,
				projectId,
				partSize: session.part_size,
				partCount: session.part_count,
				expiresAt: session.expires_at,
				completedParts: [...completedParts],
				fileName: file.name,
				fileSize: file.size,
				fileLastModified: file.lastModified
			});
		persist();

		/**
		 * `beforeunload` COURTESY, explicitly not the mechanism.
		 *
		 * The mechanism is the record above, written after every ACKed part — it is
		 * already durable before this listener ever fires, which is the whole point:
		 * `beforeunload` is not guaranteed to run (a crash, an OOM kill, a phone
		 * backgrounding the tab all skip it) so nothing may DEPEND on it.
		 *
		 * Note what it deliberately does NOT do: issue the session DELETE. That was
		 * the obvious "cleanup", and it is now exactly wrong — deleting the staging
		 * session on unload destroys the parts this feature exists to resume from,
		 * turning the courtesy into the bug. Server-side TTL remains the janitor for
		 * a session nobody comes back for.
		 */
		const flushOnUnload = () => persist();
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', flushOnUnload);
		}
		const detachUnloadFlush = () => {
			if (typeof window !== 'undefined') {
				window.removeEventListener('beforeunload', flushOnUnload);
			}
		};

		const partSize = session.part_size;
		// Non-decreasing gate. A part retry re-sends bytes already counted, so the
		// raw `completed + loaded` figure walks backwards mid-transfer; a bar that
		// goes back reads as "something was lost" to the person watching it.
		let highWater = 0;
		const report = (fraction: number) => {
			const clamped = Math.min(1, Math.max(0, fraction));
			if (clamped <= highWater) return;
			highWater = clamped;
			opts?.onProgress?.(clamped);
		};
		// Seed the bar at what the previous attempt already landed, so a resumed
		// transfer does not open at 0% and read as "it started over".
		report((completedParts.size * partSize) / file.size);
		try {
			for (let index = 0; index < session.part_count; index++) {
				// Already ACKed by the server on an earlier attempt — the whole point
				// of the resume record. The server keys parts by number, so skipping
				// one leaves the identical byte range in place.
				if (completedParts.has(index + 1)) continue;
				const start = index * partSize;
				// `file.slice` is a view, not a copy: the browser streams the bytes off
				// disk. Slicing a 512 MiB File into parts never materialises 512 MiB in
				// the tab's heap, which is the whole reason this is affordable at all.
				const chunk = file.slice(start, Math.min(start + partSize, file.size));
				await uploads.putVideoSourcePart(projectId, session.upload_id, index + 1, chunk, {
					contentType,
					signal,
					// Real bytes: completed parts + what is in flight on THIS one. Without
					// it a 134 MB clip ticked four times in several minutes, and the gaps
					// between ticks are exactly when an operator decides it has hung.
					onProgress: opts?.onProgress
						? (loaded) => report((start + loaded) / file.size)
						: undefined
				});
				// Persist BEFORE reporting: the record is the durable artefact and the
				// bar is cosmetic, and a tab killed between the two must not lose the
				// part it just paid for.
				completedParts.add(index + 1);
				persist();
				// Floor the bar at the parts that have actually LANDED, so it cannot be
				// left behind by a part whose progress events under-reported.
				report(((index + 1) * partSize) / file.size);
			}
		} catch (err) {
			detachUnloadFlush();
			// STAGING phase. Whether the staged bytes are worthless — and therefore
			// whether releasing them is right — now depends on WHY we are here.
			//
			// A cancel, or a deterministic verdict (400/404/409/413/415: wrong media
			// type, swept session, project gone), can never be resumed: the next
			// attempt would fail identically or 409 into a dead session. Release the
			// parts and drop the record, as before.
			//
			// A transport failure or an exhausted 5xx/408/429 ladder is the opposite:
			// the parts that DID land are the only thing standing between the
			// operator and re-sending 500 MB. Keep the session and the record so the
			// next attempt resumes from the first missing part, and let the server's
			// TTL sweep decide if nobody comes back. This is the defect: a clip dying
			// at 90% used to cost the entire upload.
			const resumable = !opts?.signal?.aborted && isRetryablePartError(err);
			if (!resumable) {
				// Awaited (not floated) so the request is actually issued before this
				// frame unwinds, but it can never throw — see `abandonUploadSession`.
				await abandonUploadSession(projectId, session.upload_id);
				clearResumeByUploadId(session.upload_id);
			}
			throw new Error(videoSourceErrorMessage(err, file.name), { cause: err });
		}

		// COMPLETION phase — deliberately OUTSIDE the block above, because the
		// cleanup that is correct for a half-staged transfer is destructive here.
		// From this point the server may already hold a finished object, so the
		// unwinding rules are different and must not be shared with the loop.
		const completePath = `/projects/${projectId}/video-sources/uploads/${session.upload_id}/complete`;
		let lastError: unknown;
		for (let attempt = 0; attempt < COMPLETE_MAX_ATTEMPTS; attempt++) {
			try {
				const created = await api.post<VideoSourceResponse>(completePath, undefined, {
					// The reason this call exists as more than one line. See
					// `videoCompleteTimeoutMs`: without it this inherits the 30s JSON
					// default and aborts a request the pod goes on to finish.
					timeoutMs: videoCompleteTimeoutMs(file.size),
					signal: opts?.signal
				});
				opts?.onProgress?.(1);
				// The session is spent: its parts are now a composed, probed clip, and
				// resuming into it would re-PUT parts of an object that already exists.
				detachUnloadFlush();
				clearResumeByUploadId(session.upload_id);
				return created;
			} catch (err) {
				lastError = err;
				// A verdict from the server: nothing was created, so release the parts
				// exactly as the staging phase would, and report the server's own reason.
				if (isTerminalCompleteError(err)) {
					detachUnloadFlush();
					await abandonUploadSession(projectId, session.upload_id);
					clearResumeByUploadId(session.upload_id);
					throw new Error(videoSourceErrorMessage(err, file.name), { cause: err });
				}
				// Not a verdict. Re-issue `complete`: it is idempotent against an
				// already-composed object, so the retry returns the SAME
				// `VideoSourceResponse` if the first attempt actually succeeded behind
				// our back — which is how a 524 at the edge resolves into a normal
				// success instead of a phantom failure.
				if (opts?.signal?.aborted) break;
				if (attempt === COMPLETE_MAX_ATTEMPTS - 1) break;
				await sleep(COMPLETE_RETRY_BACKOFF_MS[attempt]);
			}
		}
		// Exhausted, and still no verdict. ⛔ Do NOT abandon here: the parts may
		// already be a composed, probed, attached clip, and the DELETE would race
		// or destroy it. The server's TTL sweep is the only safe janitor for this
		// state, and the message tells the operator to look before re-uploading.
		// Drop the resume record too, for the SAME reason the DELETE is withheld:
		// from here the parts may already BE a finished clip. Re-PUTting parts into
		// a composed session is the one thing worse than re-uploading — so the
		// operator is sent to the clip list (the only place that can settle it)
		// rather than silently resumed into an ambiguous session.
		detachUnloadFlush();
		clearResumeByUploadId(session.upload_id);
		throw new Error(videoCompleteIndeterminateMessage(file.name), { cause: lastError });
	},

	/**
	 * PUT one part, with bounded retries.
	 *
	 * The retry is what makes a multi-part transfer worth having: a 134 MB clip is
	 * five or more separate requests over a link that only has to hiccup ONCE for
	 * the operator to lose the whole transfer and start over. So a transport
	 * error / 5xx / 408 / 429 re-sends THE SAME part index — the server keys parts
	 * by number, so a re-send overwrites rather than appends, and a part that
	 * actually landed before the connection died is simply written again.
	 *
	 * Deterministic statuses (400/404/409/413/415) are NOT retried; see
	 * `NON_RETRYABLE_PART_STATUSES`. Neither is a caller abort — re-checking the
	 * signal before each attempt keeps "cancel" from taking up to 7 more seconds
	 * of backoff to be honoured.
	 */
	async putVideoSourcePart(
		projectId: string,
		uploadId: string,
		partNumber: number,
		chunk: Blob,
		opts?: {
			contentType?: string;
			signal?: AbortSignal;
			/** `(loadedBytesOfThisPart)`. Restarts at 0 on a retry — the caller is
			 *  responsible for not letting that walk its bar backwards. */
			onProgress?: (loaded: number) => void;
		}
	): Promise<VideoSourceUploadPartAck> {
		const path = `/projects/${projectId}/video-sources/uploads/${uploadId}/parts/${partNumber}`;
		let lastError: unknown;
		for (let attempt = 0; attempt < PART_MAX_ATTEMPTS; attempt++) {
			if (opts?.signal?.aborted) {
				throw opts.signal.reason instanceof Error
					? opts.signal.reason
					: new Error('Upload cancelled.');
			}
			try {
				return await api.putRaw<VideoSourceUploadPartAck>(path, chunk, {
					contentType: opts?.contentType ?? 'application/octet-stream',
					// The deadline is sized to THIS PART, not to the whole clip: a part
					// that has stalled should be abandoned and retried long before the
					// budget for the entire file is gone.
					timeoutMs: videoUploadTimeoutMs(chunk.size),
					signal: opts?.signal,
					onUploadProgress: opts?.onProgress ? (loaded) => opts.onProgress?.(loaded) : undefined
				});
			} catch (err) {
				lastError = err;
				if (opts?.signal?.aborted) throw err;
				if (!isRetryablePartError(err)) throw err;
				if (attempt === PART_MAX_ATTEMPTS - 1) throw err;
				await sleep(PART_RETRY_BACKOFF_MS[attempt]);
			}
		}
		// Unreachable: the loop either returns or throws. Present so the function
		// has no implicit `undefined` return path.
		throw lastError instanceof Error ? lastError : new Error('Upload part failed.');
	},

	/**
	 * THE entry point the UI should call. Picks single-shot or chunked purely by
	 * size, so no call site has to know the edge's body ceiling exists — putting
	 * that `if` in a component is how one caller ends up with the 100 MB bug still
	 * live after the fix shipped.
	 *
	 * BOTH branches report real byte progress and honour `signal`. The single-shot
	 * branch used to be `onProgress(0)` → await → `onProgress(1)`, which meant a
	 * 60 MiB clip — under the threshold, so still minutes on an ordinary uplink —
	 * showed an empty bar for the whole transfer and then jumped to full. It was
	 * the path MOST likely to be mistaken for a hang, because it is also the path
	 * with no per-part ticks to prove otherwise.
	 */
	async videoSourceAuto(
		projectId: string,
		file: File,
		opts?: VideoSourceUploadOptions
	): Promise<VideoSourceResponse> {
		if (file.size > CHUNKED_UPLOAD_THRESHOLD_BYTES) {
			return uploads.videoSourceChunked(projectId, file, opts);
		}
		// Leading 0 so a caller that renders a bar only once progress has been
		// reported paints an empty track immediately, rather than after the first
		// chunk of body has left.
		opts?.onProgress?.(0);
		const created = await uploads.videoSource(projectId, file, opts);
		opts?.onProgress?.(1);
		return created;
	},

	/** The project's clips, oldest first (upload order = shoot order). Used to
	 *  reconcile the local queue after a partial failure or a page revisit —
	 *  each row carries a freshly presigned `original_url` (1 h TTL). */
	listVideoSources(projectId: string): Promise<VideoSourceListResponse> {
		return api.get<VideoSourceListResponse>(`/projects/${projectId}/video-sources`);
	},

	/** Remove a clip uploaded by mistake. The row is the record of truth the cut
	 *  stage reads; the object sweep behind it is best-effort server-side. */
	deleteVideoSource(projectId: string, sourceId: string): Promise<void> {
		return api.delete<void>(`/projects/${projectId}/video-sources/${sourceId}`);
	}
};

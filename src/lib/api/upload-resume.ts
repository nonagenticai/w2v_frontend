/**
 * Durable record of a half-finished chunked video-source upload, so a transfer
 * that dies at 90% can be picked up from the first missing part instead of
 * re-sending 500 MB from part 1.
 *
 * ## Why localStorage and not sessionStorage
 *
 * `sessionStorage` is scoped to the TAB and is cleared when that tab closes.
 * The failure this exists to fix is *precisely* a tab that closed (or crashed,
 * or was navigated away) mid-upload — `abandonUploadSession` only runs from a
 * caught error, so an unload leaves the staged parts alive on the server until
 * its session TTL. Reopening the app is by definition a NEW browsing session,
 * where `sessionStorage` is already empty: a resume record kept there could
 * never once be read on the path it was written for. `localStorage` is the only
 * web storage that survives the event we are recovering from, so it is the only
 * one that can serve this feature at all.
 *
 * The usual objections do not bite here. The record holds no secret — an
 * `upload_id`, a part count and the picked file's name/size/mtime; the upload
 * session itself is still authorised per request by the normal auth headers, so
 * a stolen id buys nothing a session cookie did not already buy. And the store
 * is bounded and self-pruning: entries are dropped once the server's own
 * `expires_at` has passed (there is nothing to resume into after that), and the
 * newest `MAX_RECORDS` are kept regardless.
 *
 * ## Why the identity check is load-bearing
 *
 * A staging session is a fixed-stride byte range on the server: part N is
 * "bytes [N-1)*part_size .. N*part_size" of ONE specific file. Resuming a
 * DIFFERENT file into it splices two files together and the `complete` composes
 * a corrupt object that still probes as valid video. The browser gives no file
 * handle identity across sessions, so `name` + `size` + `lastModified` is the
 * strongest signal available — and `size` alone already makes a stride mismatch
 * impossible. All three must match, plus the project id, or the record is
 * discarded and a fresh session is opened.
 */

/** Bumped if the record shape changes; an old key is simply never read. */
const STORAGE_KEY = 'w2v:video-upload-resume:v1';

/** Ceiling on retained records. The uploader is sequential and a project's clip
 *  corpus is a handful of files, so this is generous; it exists only so a long
 *  -lived browser profile cannot grow the entry without bound. */
const MAX_RECORDS = 20;

export interface ResumableUpload {
	/** Server-side staging session id. */
	uploadId: string;
	sourceId: string;
	projectId: string;
	/** Fixed stride the server chose. The resumed loop MUST slice to this, since
	 *  the composed object is reassembled by part index at that stride. */
	partSize: number;
	partCount: number;
	/** Server's TTL. Past it the parts are swept and part/complete 409 — there is
	 *  nothing left to resume into. */
	expiresAt: string;
	/** 1-based part numbers the server has ACKed. Sparse-tolerant: the resume
	 *  loop skips any index present here and sends every index that is not. */
	completedParts: number[];
	/** File identity — see the header note. All three must match to resume. */
	fileName: string;
	fileSize: number;
	fileLastModified: number;
}

/** Identity of a file within a project. Two clips can share a name, so the
 *  size and mtime are part of the key, not just of the verification. `|` is a
 *  legal filename character, so the key alone is not proof of identity — the
 *  field-by-field comparison in `loadResumeRecord` is what settles it. */
function recordKey(projectId: string, file: File): string {
	return `${projectId}|${file.name}|${file.size}|${file.lastModified}`;
}

function keyOf(rec: ResumableUpload): string {
	return `${rec.projectId}|${rec.fileName}|${rec.fileSize}|${rec.fileLastModified}`;
}

/** `typeof` guard rather than `browser` from `$app/environment`: this module is
 *  imported by `uploads.ts`, which is itself imported during SSR of any route
 *  that touches the API surface, and a private-mode browser can throw on access
 *  as well as on write. Every entry point is total — it degrades to "no resume",
 *  never to a thrown error inside an upload. */
function readAll(): ResumableUpload[] {
	if (typeof localStorage === 'undefined') return [];
	let raw: string | null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return [];
	}
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isResumableUpload);
	} catch {
		return [];
	}
}

function writeAll(records: ResumableUpload[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
	} catch {
		// Quota / private mode. Resume is an optimisation; losing it must never
		// take the upload down with it.
	}
}

/** Structural validation of a parsed record. Anything hand-edited, truncated or
 *  written by an older build is dropped rather than trusted — this data decides
 *  which BYTES get skipped, so a malformed record is a corruption risk. */
function isResumableUpload(value: unknown): value is ResumableUpload {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.uploadId === 'string' &&
		typeof v.sourceId === 'string' &&
		typeof v.projectId === 'string' &&
		typeof v.partSize === 'number' &&
		v.partSize > 0 &&
		typeof v.partCount === 'number' &&
		v.partCount > 0 &&
		typeof v.expiresAt === 'string' &&
		Array.isArray(v.completedParts) &&
		v.completedParts.every((p) => typeof p === 'number' && Number.isInteger(p) && p >= 1) &&
		typeof v.fileName === 'string' &&
		typeof v.fileSize === 'number' &&
		typeof v.fileLastModified === 'number'
	);
}

/** A record is only usable while the SERVER still holds the parts. An unparsable
 *  `expires_at` is treated as expired: guessing "probably still fine" here is
 *  how a resume walks into a swept session and 409s a whole transfer. */
function isLive(rec: ResumableUpload, now: number): boolean {
	const at = Date.parse(rec.expiresAt);
	return Number.isFinite(at) && at > now;
}

/**
 * The resume record for THIS project + THIS file, or `null`.
 *
 * Returns null — and drops the record — unless every identity field matches and
 * the server session is still live. Callers treat null as "open a fresh
 * session", which is always safe.
 */
export function loadResumeRecord(
	projectId: string,
	file: File,
	now: number = Date.now()
): ResumableUpload | null {
	const key = recordKey(projectId, file);
	const all = readAll();
	const live = all.filter((r) => isLive(r, now));
	if (live.length !== all.length) writeAll(live);

	const found = live.find((r) => keyOf(r) === key);
	if (!found) return null;
	// Belt-and-braces: the key already encodes all four, but this is the check
	// that stops a hand-edited or colliding entry from splicing a different
	// file's bytes into an existing session.
	if (
		found.projectId !== projectId ||
		found.fileName !== file.name ||
		found.fileSize !== file.size ||
		found.fileLastModified !== file.lastModified
	) {
		clearResumeRecord(projectId, file);
		return null;
	}
	return found;
}

/** Insert or replace the record for its own project+file key. */
export function saveResumeRecord(rec: ResumableUpload): void {
	const key = keyOf(rec);
	const others = readAll().filter((r) => keyOf(r) !== key);
	writeAll([...others, rec]);
}

export function clearResumeRecord(projectId: string, file: File): void {
	const key = recordKey(projectId, file);
	const kept = readAll().filter((r) => keyOf(r) !== key);
	writeAll(kept);
}

/** Drop by session id — used on the paths that know the upload is dead (the
 *  server abandoned it, or it completed) but may not still hold the `File`. */
export function clearResumeByUploadId(uploadId: string): void {
	writeAll(readAll().filter((r) => r.uploadId !== uploadId));
}

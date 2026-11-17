// SigV4 presigned-URL expiry, read from the URL itself.
//
// Source clips on the review gates are presigned with a 1 h TTL, and a gate is
// routinely opened long after the run finished. Before this helper the ONLY way
// the UI learned a link was dead was to fire the request and handle `onerror` —
// which on one `cut_plan` page meant ~20 requests for full 128 MiB+ source
// clips, 50 console errors (ERR_HTTP2_PROTOCOL_ERROR / 503) and an orchestrator
// HPA scale-out 2 → 5, all to discover something the URL already stated.
//
// A SigV4 presign carries `X-Amz-Date` (ISO 8601 basic, e.g. `20260817T053255Z`)
// and `X-Amz-Expires` (a lifetime in seconds). Expiry is their sum. Reading them
// costs nothing and is exact.
//
// Params are matched by regex over the raw string rather than through
// `URLSearchParams`, deliberately: these urls are handed around after
// `scopedMediaUrl()` has string-concatenated `?active_tenant=` onto the END and
// a `#t=` media fragment may follow, so the result is not always a
// well-formed single-query URL. A regex reads the two params correctly in every
// one of those shapes.

/**
 * Clock-skew / in-flight margin. A link with less than this left is treated as
 * already expired.
 *
 * 30s: the browser's clock can sit seconds off the signer's, and a `<video>`
 * preflight is followed by range requests over the following seconds, so a link
 * expiring "in 5s" produces exactly the failed-request storm this helper exists
 * to prevent. It is also only 0.8% of the 1 h TTL these urls are minted with —
 * far too small to blank a preview anyone would call live.
 */
export const PRESIGN_SKEW_SECONDS = 30;

const DATE_PARAM = /[?&]X-Amz-Date=([^&#\s]+)/i;
const EXPIRES_PARAM = /[?&]X-Amz-Expires=([^&#\s]+)/i;
// ISO 8601 basic, always UTC: YYYYMMDD'T'HHMMSS'Z'.
const AMZ_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/**
 * Absolute expiry of a SigV4 presigned url, in epoch milliseconds, or `null`
 * when the url carries no parseable `X-Amz-Date` + `X-Amz-Expires` pair.
 *
 * `null` means UNKNOWN, never "expired" — see `isPresignExpired`.
 */
export function presignExpiresAt(url: string | null | undefined): number | null {
	if (typeof url !== 'string' || url.length === 0) return null;
	const dateMatch = DATE_PARAM.exec(url);
	const expiresMatch = EXPIRES_PARAM.exec(url);
	if (!dateMatch || !expiresMatch) return null;

	const parts = AMZ_DATE.exec(decodeURIComponent(dateMatch[1]));
	if (!parts) return null;
	const [, y, mo, d, h, mi, s] = parts;
	const signedAt = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
	if (!Number.isFinite(signedAt)) return null;

	// A lifetime must be a plain non-negative integer count of seconds; anything
	// else (negative, `abc`, `1e9`) is a url we do not understand.
	const lifetime = decodeURIComponent(expiresMatch[1]);
	if (!/^\d+$/.test(lifetime)) return null;
	return signedAt + Number(lifetime) * 1000;
}

// A same-origin artifact-proxy path: a RELATIVE path that begins `/api/` and
// whose PATH portion (before any `?` or `#`) contains an `/artifact/` segment,
// e.g. `/api/runs/{run_id}/artifact/{bucket}/{key}`.
//
// Deliberately narrow on all three axes:
//   - `//host/...` and `scheme://...` are excluded, so a presigned MinIO url —
//     the thing this module exists to judge — is never exempted.
//   - only `/artifact/`, not every relative `/api/` path.
//   - the marker is matched in the PATH only, so `?key=/artifact/x` cannot buy
//     an exemption.
const PROXY_ARTIFACT_PATH = /^\/api\/(?:[^?#]*\/)?artifact\//;

const isSameOriginArtifactProxy = (url: string): boolean =>
	!url.startsWith('//') && PROXY_ARTIFACT_PATH.test(url);

/**
 * True only when the url is PROVABLY dead — i.e. it carries a readable SigV4
 * expiry that has already passed (less `PRESIGN_SKEW_SECONDS` of margin).
 *
 * A same-origin artifact-proxy path is NEVER expired, whatever query it
 * carries. The orchestrator rewrites artifact urls to
 * `/api/runs/{run_id}/artifact/{bucket}/{key}?<original presign query verbatim>`
 * and that endpoint re-fetches server-side with its OWN credentials, ignoring
 * the inbound query string entirely (`artifact_proxy.py`). The stale
 * `X-Amz-Date` / `X-Amz-Expires` params are inert passengers: parseable, and
 * meaningless. Reading them blanked all 20 shot thumbnails on a live `cut_plan`
 * gate — a reviewer asked to approve an edit they could not see — with zero
 * failed requests, because `src` was never set. The check is placed here rather
 * than in `presignExpiresAt` on purpose: the parser answers "what expiry does
 * this string STATE?", which for a proxy url is still that timestamp. Whether a
 * stated expiry BINDS is a fact about who serves the url, and that is a policy
 * question belonging to the predicate.
 *
 * Fails OPEN by design: a url with no expiry params, an unparseable date, or a
 * non-presigned same-origin artifact path all return `false`, so the caller
 * still renders the media and falls back to its `onerror` handling. Hiding a
 * working preview because parsing failed would be a worse bug than the request
 * storm this prevents.
 */
export function isPresignExpired(
	url: string | null | undefined,
	now: number = Date.now()
): boolean {
	if (typeof url === 'string' && isSameOriginArtifactProxy(url)) return false;
	const expiresAt = presignExpiresAt(url);
	if (expiresAt === null) return false;
	return expiresAt - PRESIGN_SKEW_SECONDS * 1000 <= now;
}

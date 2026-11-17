import { randomUUID } from 'node:crypto';
import { API_URL, HTML_RENDER_URL, TEST_RUNNER_URL } from '$lib/server/config';
import { applyCookieAuthFallback } from '$lib/server/cookie-auth';
import type { RequestHandler } from './$types';

// Allow trailing slashes on API routes — the backend uses them to distinguish
// directory listings from single-file requests (e.g. /artifacts/{id}/crawl/).
export const trailingSlash = 'ignore';

/**
 * Parse a Range header like "bytes=1000-2000" or "bytes=1000-".
 * Returns null if the header is missing or malformed.
 */
function parseRange(header: string | null, total: number): { start: number; end: number } | null {
	if (!header) return null;
	const match = header.match(/^bytes=(\d+)-(\d*)$/);
	if (!match) return null;
	const start = parseInt(match[1], 10);
	const end = match[2] ? parseInt(match[2], 10) : total - 1;
	if (start > end || start >= total) return null;
	return { start, end: Math.min(end, total - 1) };
}

/**
 * Stream-slice a body to the byte window [start, end] inclusive.
 *
 * Reads chunks from the upstream response without buffering the full body —
 * skips bytes before `start`, yields the bytes inside the window, and stops
 * once `end` is reached. Critical for large videos: the previous
 * `arrayBuffer()` approach pulled the whole file into the Node heap.
 */
function byteRangeTransform(range: {
	start: number;
	end: number;
}): TransformStream<Uint8Array, Uint8Array> {
	const want = range.end - range.start + 1;
	let consumed = 0;
	let emitted = 0;
	return new TransformStream({
		transform(chunk, controller) {
			if (emitted >= want) return;
			const chunkStart = consumed;
			const chunkEnd = consumed + chunk.byteLength;
			consumed = chunkEnd;
			if (chunkEnd <= range.start) return; // before window
			if (chunkStart > range.end) {
				controller.terminate();
				return;
			}
			const sliceStart = Math.max(0, range.start - chunkStart);
			const sliceEnd = Math.min(chunk.byteLength, range.end - chunkStart + 1);
			const slice = chunk.subarray(sliceStart, sliceEnd);
			emitted += slice.byteLength;
			controller.enqueue(slice);
			if (emitted >= want) controller.terminate();
		}
	});
}

async function proxy({
	request,
	url,
	cookies
}: {
	request: Request;
	url: URL;
	cookies: import('@sveltejs/kit').Cookies;
}): Promise<Response> {
	// Build target URL preserving the original path (including trailing slash)
	const originalPath = url.pathname.replace(/^\/api\//, '');

	// Route service-specific paths to their upstreams.
	const baseUrl = originalPath.startsWith('designs')
		? HTML_RENDER_URL
		: originalPath.startsWith('test-runner')
			? TEST_RUNNER_URL
			: API_URL;
	const targetUrl = `${baseUrl}/api/${originalPath}${url.search}`;

	const headers = new Headers(request.headers);
	headers.delete('host');
	// Propagate or generate X-Request-Id so the browser → frontend →
	// orchestrator → siblings trace chain shares a single correlation id.
	// Mirrors server.js production proxy.
	const inboundRequestId = request.headers.get('x-request-id');
	const requestId =
		inboundRequestId && inboundRequestId.length > 0 ? inboundRequestId : randomUUID();
	headers.set('X-Request-Id', requestId);
	// Forward Range to the backend so it can answer 206 natively when the
	// upstream object store supports it. If the upstream answers 200 with
	// the full body we stream-slice below — both branches avoid buffering
	// multi-GB videos into the Node heap (the previous arrayBuffer() path).

	// Cookie-based auth fallback for navigation-style requests that can't
	// attach Authorization / X-Tenant-Id headers (e.g. `window.open`, <a>
	// click on an /api/* URL, <iframe src>), plus the cross-site CSRF guard
	// and the upstream cookie-strip. Shared with the /auth/cookie writer — see
	// `$lib/server/cookie-auth.ts` for the full rationale.
	applyCookieAuthFallback(headers, cookies, request.headers.get('sec-fetch-site'));

	try {
		// Follow redirects server-side: the backend returns 307 redirects to
		// internal MinIO presigned URLs (e.g. http://minio:9000/...) which are
		// not reachable from the browser. By following them here, the proxy
		// fetches the content and streams it back to the client.
		const response = await fetch(targetUrl, {
			method: request.method,
			headers,
			body:
				request.method !== 'GET' && request.method !== 'HEAD'
					? await request.arrayBuffer()
					: undefined,
			redirect: 'follow'
		});

		const responseHeaders = new Headers(response.headers);
		responseHeaders.delete('transfer-encoding');
		// Always echo the correlation id the orchestrator saw, even when the
		// upstream response strips it (e.g. a MinIO redirect followed
		// server-side — only the FRONTEND's outbound request id survives).
		responseHeaders.set('X-Request-Id', requestId);

		const contentType = response.headers.get('content-type') ?? '';
		const rangeHeader = request.headers.get('range');

		// Upstream supports Range natively: pass the 206 + Content-Range
		// through unchanged. Most modern object stores (MinIO, S3) do this.
		// responseHeaders already carries X-Request-Id from above.
		if (response.status === 206) {
			return new Response(response.body, {
				status: 206,
				statusText: response.statusText,
				headers: responseHeaders
			});
		}

		// Upstream returned the full body (200) but the client asked for a
		// Range. Stream-slice via a TransformStream so we never materialise
		// the entire response in memory.
		if (rangeHeader && response.status === 200 && contentType.startsWith('video/')) {
			const totalHeader = response.headers.get('content-length');
			const total = totalHeader ? parseInt(totalHeader, 10) : NaN;
			if (!Number.isFinite(total) || total <= 0 || !response.body) {
				// No total known — fall through to non-range full response;
				// the client will replay as a full GET if needed.
			} else {
				const range = parseRange(rangeHeader, total);
				if (!range) {
					return new Response('Range Not Satisfiable', {
						status: 416,
						headers: { 'Content-Range': `bytes */${total}`, 'X-Request-Id': requestId }
					});
				}
				const sliced = response.body.pipeThrough(byteRangeTransform(range));
				return new Response(sliced, {
					status: 206,
					headers: {
						'Content-Type': contentType,
						'Content-Length': String(range.end - range.start + 1),
						'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
						'Accept-Ranges': 'bytes',
						'X-Request-Id': requestId
					}
				});
			}
		}

		// For non-range requests to video, add Accept-Ranges so the browser
		// knows it can make range requests for seeking.
		if (contentType.startsWith('video/')) {
			responseHeaders.set('Accept-Ranges', 'bytes');
		}

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders
		});
	} catch {
		return new Response(JSON.stringify({ detail: 'Backend unavailable' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId }
		});
	}
}

export const GET: RequestHandler = (event) => proxy(event);
export const POST: RequestHandler = (event) => proxy(event);
export const PUT: RequestHandler = (event) => proxy(event);
export const DELETE: RequestHandler = (event) => proxy(event);
export const PATCH: RequestHandler = (event) => proxy(event);

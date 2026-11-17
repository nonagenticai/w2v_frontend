// Explicit request-body backpressure for the /api/* proxy.
//
// WHY THIS EXISTS
// ---------------
// The runtime is bun (see Dockerfile — both stages are
// registry.test:5000/library/bun:1.3.11-alpine, and the `node` on PATH in
// that image is bun's own shim, so "run it under node" is not a one-line CMD
// change). bun's node:http IncomingMessage does not honour the *implicit*
// backpressure that `req.pipe(proxyReq)` relies on: `pipe()` calls
// `req.pause()` when the sink's write() returns false, node stops reading from
// the socket, and bun keeps reading anyway. http-proxy-3's web-incoming pass
// does exactly that pipe — `(options.buffer || req).pipe(proxyReq)`.
//
// Consequence in production: a 64 MiB multipart upload part (see
// CHUNKED_UPLOAD_THRESHOLD_BYTES in src/lib/.../uploads.ts) going to an
// orchestrator that absorbs slower than the browser pushes is retained almost
// in its entirety in the frontend pod's heap. Measured on linux bun 1.3.11:
// ~76 MiB retained per in-flight part. With a 512Mi limit and ~470 MiB of
// headroom, ~6 concurrent uploading operators OOMKill the pod — which is what
// happened to both replicas on 2026-08-20 (exitCode 137).
//
// THE FIX
// -------
// Do not rely on pipe()'s implicit pause. Read the request with an explicit
// 'data' handler, write into a small bounded PassThrough, and call
// `req.pause()` / `req.resume()` ourselves around its high-water mark. The
// PassThrough is handed to http-proxy-3 as `options.buffer`, so the proxy
// pipes *it* — not the raw request — to the upstream. Peak retention becomes
// the PassThrough's high-water mark plus one chunk, instead of the whole body.
import { PassThrough } from 'node:stream';

// How much of an in-flight body we are willing to hold per request. Small
// enough that dozens of concurrent uploads fit in the pod's headroom, large
// enough not to thrash pause/resume on every 64 KiB socket read.
export const BODY_HIGH_WATER_MARK = Number(process.env.W2V_PROXY_BODY_HWM_BYTES || 256 * 1024);

// Methods whose bodies we never expect. http-proxy-3's `deleteLength` pass
// already forces content-length: 0 for DELETE/OPTIONS, so gating them here
// keeps the two in agreement.
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE']);

/** @param {import('node:http').IncomingMessage} req */
export function requestHasBody(req) {
	if (BODYLESS_METHODS.has(String(req.method || 'GET').toUpperCase())) return false;
	const len = req.headers?.['content-length'];
	if (typeof len === 'string' && Number(len) === 0) return false;
	return true;
}

// Returns a Readable to hand to http-proxy-3 as `options.buffer`, fed from
// `req` under explicit flow control.
/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ highWaterMark?: number }} [opts]
 * @returns {PassThrough}
 */
export function backpressuredBody(req, { highWaterMark = BODY_HIGH_WATER_MARK } = {}) {
	const gate = new PassThrough({ highWaterMark });
	let paused = false;

	req.on('data', (/** @type {Buffer} */ chunk) => {
		if (!gate.write(chunk) && !paused) {
			paused = true;
			req.pause();
		}
	});
	gate.on('drain', () => {
		if (paused) {
			paused = false;
			req.resume();
		}
	});

	req.on('end', () => gate.end());
	// A client that hangs up mid-body must not leave the gate (and therefore
	// the upstream request) open forever.
	req.on('aborted', () => gate.destroy());
	req.on('error', (/** @type {Error} */ err) => gate.destroy(err));
	// And an upstream that dies must stop us reading from the client.
	gate.on('error', () => req.destroy());

	return gate;
}

// Single entry point used by server.js: the per-call options object to pass to
// proxy.web(). Bodyless requests get no buffer so the proxy keeps its normal
// fast path.
/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ buffer: PassThrough } | undefined}
 */
export function proxyWebOptions(req) {
	return requestHasBody(req) ? { buffer: backpressuredBody(req) } : undefined;
}

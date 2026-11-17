// Regression cover for the /api/* proxy body gate (../../../server-backpressure.js),
// the fix for the 2026-08-20 frontend OOMKills (exitCode 137, both replicas,
// 512Mi limit) caused by bun's node:http ignoring pipe()'s implicit pause on a
// 64 MiB upload part.
//
// ⚠️ THESE TESTS PIN THE MECHANISM, NOT THE MEMORY NUMBER. They prove that the
// request is explicitly paused at the gate's high-water mark and resumed on
// drain, and that bodyless requests keep the proxy's fast path. They do NOT and
// cannot assert peak RSS — a real measurement needs linux bun, a 64 MiB body
// and a deliberately slow upstream, which is what scripts/oom-repro/ does
// (measured: 75.9 MiB retained per in-flight part before, 18.3 MiB after).
// If someone deletes the pause/resume wiring, these fail; if someone raises
// W2V_PROXY_BODY_HWM_BYTES to 64 MiB, they still pass and the pod still dies.
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
	backpressuredBody,
	proxyWebOptions,
	requestHasBody
} from '../../../server-backpressure.js';

type FakeRequest = IncomingMessage & {
	pause: ReturnType<typeof vi.fn>;
	resume: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
};

/** Minimal stand-in for a node IncomingMessage in flowing mode. */
function fakeRequest(method = 'PUT', headers: Record<string, string> = {}): FakeRequest {
	const req = Object.assign(new EventEmitter(), {
		method,
		headers,
		pause: vi.fn(),
		resume: vi.fn(),
		destroy: vi.fn()
	});
	return req as unknown as FakeRequest;
}

describe('requestHasBody', () => {
	it.each(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE', 'get'])('is false for %s', (method) => {
		expect(requestHasBody(fakeRequest(method))).toBe(false);
	});

	it.each(['PUT', 'POST', 'PATCH'])('is true for %s', (method) => {
		expect(requestHasBody(fakeRequest(method))).toBe(true);
	});

	it('is false for an explicitly empty body', () => {
		expect(requestHasBody(fakeRequest('POST', { 'content-length': '0' }))).toBe(false);
	});
});

describe('backpressuredBody', () => {
	it('pauses the request once the gate is over its high-water mark', () => {
		const req = fakeRequest();
		backpressuredBody(req, { highWaterMark: 1024 });

		req.emit('data', Buffer.alloc(512));
		expect(req.pause).not.toHaveBeenCalled();

		// Nothing is reading the gate, so this crosses the mark.
		req.emit('data', Buffer.alloc(4096));
		expect(req.pause).toHaveBeenCalledTimes(1);
	});

	it('resumes the request when the gate drains, and pauses only once per stall', async () => {
		const req = fakeRequest();
		const gate = backpressuredBody(req, { highWaterMark: 1024 });

		req.emit('data', Buffer.alloc(4096));
		req.emit('data', Buffer.alloc(4096));
		expect(req.pause).toHaveBeenCalledTimes(1);
		expect(req.resume).not.toHaveBeenCalled();

		// Drain the gate the way http-proxy-3's `(options.buffer).pipe(proxyReq)`
		// would.
		gate.resume();
		await vi.waitFor(() => expect(req.resume).toHaveBeenCalled());
	});

	it('ends the gate when the request ends', async () => {
		const req = fakeRequest();
		const gate = backpressuredBody(req);
		const ended = new Promise((resolve) => gate.on('end', resolve));
		gate.resume();
		req.emit('data', Buffer.from('hello'));
		req.emit('end');
		await expect(ended).resolves.toBeUndefined();
	});

	it('tears the gate down when the client aborts mid-body', async () => {
		const req = fakeRequest();
		const gate = backpressuredBody(req);
		const closed = new Promise((resolve) => gate.on('close', resolve));
		req.emit('aborted');
		await expect(closed).resolves.toBeUndefined();
	});
});

describe('proxyWebOptions', () => {
	it('hands http-proxy-3 a buffer for requests that carry a body', () => {
		const options = proxyWebOptions(fakeRequest('POST'));
		// `buffer` is the documented http-proxy-3 hook that replaces
		// `req.pipe(proxyReq)` with `options.buffer.pipe(proxyReq)`.
		expect(options?.buffer).toBeDefined();
		expect(typeof options?.buffer?.pipe).toBe('function');
	});

	it('leaves bodyless requests on the proxy fast path', () => {
		expect(proxyWebOptions(fakeRequest('GET'))).toBeUndefined();
	});
});

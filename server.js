// Custom Node server: wraps SvelteKit's adapter-node handler and proxies /api/*
// HTTP + WebSocket upgrade traffic to w2v-orchestrator via cluster DNS.
// The browser only ever talks to w2v-frontend; w2v-orchestrator has no public
// hostname. Mirrors fr pattern.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import httpProxy from 'http-proxy-3';
import { proxyWebOptions } from './server-backpressure.js';
// Cookie→header auth fallback for header-less navigations. Lives in its own
// module so it is unit-testable — this file calls server.listen() at import
// time. See server-cookie-auth.js for the Authorization precedence rules.
import { injectCookieAuth } from './server-cookie-auth.js';
import { handler } from './build/handler.js';

const PORT = Number(process.env.PORT || 6183);
const BACKEND = process.env.W2V_API_URL || 'http://w2v-orchestrator.w2v:6300';

// Upstream proxy + server timeouts. Without these a hung w2v-orchestrator
// can pin Node sockets indefinitely; without server.requestTimeout a slow
// client can hold an open connection without sending a body.
//
// ⚠️ This MUST exceed the orchestrator's longest per-request budget, or the
// proxy aborts work the backend is still doing. It was 30_000 until
// 2026-11-02, when that assumption was already false: the service bench's
// routes budget 120 s (tts/asr/llm/vlm/ocr), 180 s (image) and 300 s (video)
// in `w2v_orchestrator/src/api/routes/service_lab.py::_TIMEOUT_SECONDS`.
// Measured: two `POST /api/services/image` were killed at 30,051 ms and
// 30,064 ms — envoy reported `503 UC upstream_reset_before_response_started`
// to the browser while the orchestrator finished and stored the image. The
// user saw a failure for a run that had succeeded.
//
// 360 s = the 300 s video budget + headroom, so the backend's own answer
// (200, or its mapped 502/504) always arrives first. Envoy is not the next
// wall: the w2v VirtualService sets `timeout: 3600s` on this route.
const PROXY_TIMEOUT_MS = Number(process.env.W2V_PROXY_TIMEOUT_MS || 360_000);

const proxy = httpProxy.createProxyServer({
	target: BACKEND,
	changeOrigin: true,
	ws: true,
	xfwd: true,
	timeout: PROXY_TIMEOUT_MS,
	proxyTimeout: PROXY_TIMEOUT_MS
});

// Propagate or generate X-Request-Id so the trace chain
// browser → frontend → orchestrator → siblings shares one correlation id.
// Without this, the orchestrator's request_id middleware mints a new uuid
// per inbound call and there is no way to grep one user action across the
// fleet's logs.
function ensureRequestId(req) {
	const inbound = req.headers['x-request-id'];
	const id = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
	req.headers['x-request-id'] = id;
	return id;
}

proxy.on('error', (err, req, res) => {
	console.error(`[proxy] ${req?.url}: ${err.message}`);
	if (res && 'writeHead' in res && !res.headersSent) {
		res.writeHead(502, { 'content-type': 'text/plain' });
		res.end('Bad Gateway');
	} else if (res && 'destroy' in res) {
		res.destroy();
	}
});

// Security headers applied to every SvelteKit response. CSP is owned by
// SvelteKit's kit.csp config (per-page hash) and emitted as a <meta> tag,
// so it isn't duplicated here. The /api/* proxy path skips these because
// the orchestrator owns its own response headers.
const SECURITY_HEADERS = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	// Limits which origins can embed our SPA's resources as
	// <script>/<img>/<link>. HSTS is owned by Cloudflare at the edge so
	// it's not duplicated here.
	'Cross-Origin-Resource-Policy': 'same-origin'
};

function applySecurityHeaders(res) {
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
		if (!res.headersSent && !res.getHeader(k)) {
			res.setHeader(k, v);
		}
	}
}

const server = http.createServer((req, res) => {
	if (req.url && req.url.startsWith('/api/')) {
		injectCookieAuth(req);
		const requestId = ensureRequestId(req);
		// Mirror the correlation id on our response BEFORE the proxy responds.
		// If the upstream orchestrator also emits X-Request-Id with the same
		// value (its middleware always does), the values agree; if a hop
		// strips the header, the client still sees it from us.
		res.setHeader('X-Request-Id', requestId);
		// Bodies go upstream through an explicitly backpressured gate rather
		// than http-proxy-3's default `req.pipe(proxyReq)` — bun's node:http
		// ignores the implicit pause that pipe() performs and retains the whole
		// body in the pod's heap. See server-backpressure.js.
		proxy.web(req, res, proxyWebOptions(req));
		return;
	}
	applySecurityHeaders(res);
	handler(req, res);
});

server.on('upgrade', (req, socket, head) => {
	if (req.url && req.url.startsWith('/api/')) {
		injectCookieAuth(req);
		ensureRequestId(req);
		proxy.ws(req, socket, head);
	} else {
		socket.destroy();
	}
});

// Bound the inbound connection so a slow / malicious client cannot pin a
// socket forever without sending a full request. Values intentionally above
// the proxy timeout so a legitimate slow backend completes before the
// client connection is reset.
//
// ⚠️ keepAliveTimeout WAS 10s, and that produced intermittent 503s on real
// user requests. Captured 2026-08-21 in the istio-ingressgateway access log
// (request id 84d5bc62-54e3-47c3-88f2-b1eb41afa1b4): a reviewer stepping
// through an action_reel run's review gates got
//   503 UC upstream_reset_before_response_started{connection_termination}
//   ... outbound|6183||w2v-frontend.w2v
// on one gate, with the SAME url returning 200 fifteen seconds either side.
// The backend never saw the request — its handler cannot even return 503.
//
// The race: envoy pools upstream connections and its DEFAULT idle timeout is
// one HOUR, so it holds sockets this process has already decided to close at
// 10s. When envoy dispatches onto a socket node is closing, the connection
// terminates before response headers and envoy must 503 the client — it cannot
// know the request was never processed.
//
// This value alone cannot fix it: nothing sane out-waits a one-hour idle. The
// half that closes the race is a DestinationRule giving envoy a 5s
// `connectionPool.http.idleTimeout` for this service
// (the deployment manifests),
// so envoy is always the side that gives up first. 65s here is the margin that
// keeps it that way — an order of magnitude above envoy's 5s, so node can never
// win the race back.
//
// NODE CONSTRAINT: `headersTimeout` must stay ABOVE `keepAliveTimeout`, so it
// moves with it. Raising keepAlive without raising headers re-breaks slow
// requests instead of pooled ones.
server.requestTimeout = Number(process.env.W2V_REQUEST_TIMEOUT_MS || 60_000);
server.headersTimeout = Number(process.env.W2V_HEADERS_TIMEOUT_MS || 70_000);
server.keepAliveTimeout = Number(process.env.W2V_KEEPALIVE_TIMEOUT_MS || 65_000);
server.maxHeadersCount = 100;

server.listen(PORT, () => {
	console.log(`w2v-frontend on :${PORT} — proxying /api/* (HTTP+WS) to ${BACKEND}`);
});

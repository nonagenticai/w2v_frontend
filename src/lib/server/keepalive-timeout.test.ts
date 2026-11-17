// Regression cover for the intermittent 503s a reviewer hit on the run gates.
//
// ⚠️ THIS PINS A RELATION, NOT A NUMBER — two of them, and both are load-bearing.
//
// THE DEFECT, captured 2026-08-21 in the istio-ingressgateway access log
// (request id 84d5bc62-54e3-47c3-88f2-b1eb41afa1b4):
//
//   "GET /api/runs/<run>/stages/segment_select/annotations HTTP/1.1"
//   503 UC upstream_reset_before_response_started{connection_termination}
//   ... outbound|6183||w2v-frontend.w2v
//
// The same url returned 200 fifteen seconds either side, and the backend never
// saw the request — its handler raises only 404s and cannot return 503 at all.
// envoy pools upstream connections with a DEFAULT idle timeout of one HOUR,
// while this process was closing them at 10s. Dispatching onto a socket node is
// closing terminates the connection before response headers, and envoy must
// 503 the client because it cannot know the request was never processed.
//
// Half the fix lives in gitops — a DestinationRule giving envoy a 5s
// `connectionPool.http.idleTimeout` for this service, so envoy always gives up
// first. This half is the margin that keeps it that way. A future edit dropping
// keepAliveTimeout back toward envoy's idle re-opens the race, and the symptom
// is a rare 503 on an unrelated url — which is exactly the kind of thing nobody
// traces back to this line. Hence a test rather than a comment.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(resolve(process.cwd(), 'server.js'), 'utf8');

/** The numeric default in `server.X = Number(process.env.Y || <default>)`. */
function timeoutDefault(property: string): number {
	const match = server.match(
		new RegExp(`server\\.${property}\\s*=\\s*Number\\([^)]*?\\|\\|\\s*([0-9_]+)\\)`)
	);
	if (!match) throw new Error(`server.js no longer sets ${property}`);
	return Number(match[1].replaceAll('_', ''));
}

// The DestinationRule's value. Kept as a named constant so the relation below
// reads as the comparison it is; the authority is the gitops manifest.
const ENVOY_IDLE_TIMEOUT_MS = 5_000;

/**
 * The orchestrator's longest per-request budget, for the service bench
 * (`w2v_orchestrator/src/api/routes/service_lab.py::_TIMEOUT_SECONDS` — video
 * at 300 s). Cross-repo by nature: if that table ever grows, this constant and
 * the proxy timeout in `server.js` must grow with it.
 */
const LONGEST_SERVICE_LAB_BUDGET_MS = 300_000;

/** The numeric default in `const NAME = Number(process.env.Y || <default>)`. */
function constantDefault(name: string): number {
	const match = server.match(
		new RegExp(`const ${name}\\s*=\\s*Number\\([^)]*?\\|\\|\\s*([0-9_]+)\\)`)
	);
	if (!match) throw new Error(`server.js no longer defines ${name}`);
	return Number(match[1].replaceAll('_', ''));
}

describe('the proxy timeout vs the orchestrator’s slow routes', () => {
	// 2026-11-02: PROXY_TIMEOUT_MS was 30 s while the bench's routes budget
	// 120–300 s. Two image runs were killed at 30,051 ms and 30,064 ms; envoy
	// reported 503 UC to the browser and the user saw a failure for a run the
	// orchestrator had already completed and stored. A number, not a relation,
	// is what went wrong — the proxy must outlast the backend, always.
	it('never aborts a request the orchestrator is still allowed to answer', () => {
		expect(constantDefault('PROXY_TIMEOUT_MS')).toBeGreaterThanOrEqual(
			LONGEST_SERVICE_LAB_BUDGET_MS
		);
	});
});

describe('server keep-alive vs the envoy idle timeout', () => {
	it('lets envoy close a pooled connection first, by a wide margin', () => {
		// Not `> ENVOY_IDLE_TIMEOUT_MS`: equal-ish values still race. The margin
		// is the point — envoy must be unambiguously the side that gives up.
		expect(timeoutDefault('keepAliveTimeout')).toBeGreaterThanOrEqual(ENVOY_IDLE_TIMEOUT_MS * 10);
	});

	it('keeps headersTimeout above keepAliveTimeout, as node requires', () => {
		// Raising keepAlive without raising this re-breaks slow requests instead
		// of pooled ones — a different outage wearing the same fix.
		expect(timeoutDefault('headersTimeout')).toBeGreaterThan(timeoutDefault('keepAliveTimeout'));
	});

	it('still bounds a slow client rather than removing the limit', () => {
		// `keepAliveTimeout = 0` disables the timeout entirely and would also
		// "fix" the 503 — by letting a client pin an idle socket forever.
		expect(timeoutDefault('keepAliveTimeout')).toBeGreaterThan(0);
		expect(timeoutDefault('requestTimeout')).toBeGreaterThan(0);
	});
});

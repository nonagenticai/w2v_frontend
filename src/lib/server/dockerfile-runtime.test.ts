// Regression cover for the runtime stage of the production image.
//
// ⚠️ THIS PINS THE MECHANISM, NOT THE MEMORY NUMBER. It asserts that the final
// Dockerfile stage is a real node base started with `node`, because that — not
// any amount of JS-side stream plumbing — is what actually bounds request-body
// memory. bun's node:http keeps draining the request socket into an internal
// buffer even after an explicit `req.pause()` (probe:
// scripts/oom-repro/pause-probe.js — bun accepted all 64 MiB, node accepted
// ~2 MiB), which retained ~76 MiB per in-flight 64 MiB upload part and
// OOMKilled both w2v-frontend replicas on 2026-08-20 (exitCode 137, 512Mi).
//
// It also guards the specific REFUTED fix: `CMD ["node", "server.js"]` on the
// bun base image is inert, because the `node` on PATH there is bun's own shim
// at /usr/local/bun-node-fallback-bin/node. Runtime CMD and runtime FROM have
// to agree, so both are asserted together.
//
// bun remains the build-stage bundler + package manager; only the final stage
// is asserted here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs with the repo root as cwd (see vitest.config.ts).
const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

/** Everything from the last `FROM` line onward — i.e. the runtime stage. */
function runtimeStage(text: string): string {
	const froms = [...text.matchAll(/^FROM .*$/gm)];
	const last = froms.at(-1);
	if (!last?.index) throw new Error('Dockerfile has no FROM line');
	return text.slice(last.index);
}

describe('production image runtime stage', () => {
	const stage = runtimeStage(dockerfile);

	it('is a real node base, not bun', () => {
		const from = stage.split('\n')[0];
		expect(from).toMatch(/(^|\s|\/)node:/);
		expect(from).not.toMatch(/bun/);
	});

	it('starts the server with the node binary', () => {
		expect(stage).toMatch(/^CMD \["node", "server\.js"\]/m);
		expect(stage).not.toMatch(/^CMD \["bun"/m);
	});

	it('ships the proxy backpressure module the server imports', () => {
		expect(stage).toContain('server-backpressure.js');
	});

	it('ships the cookie-auth module the server imports', () => {
		// server.js does a static `import` of this file. A missing COPY is not a
		// degraded feature — the container dies at startup with ERR_MODULE_
		// NOT_FOUND, and nothing else in this repo would catch it, because the
		// unit tests import the module straight from the source tree.
		expect(stage).toContain('server-cookie-auth.js');
	});

	it('still builds with bun in an earlier stage', () => {
		expect(dockerfile).toMatch(/^FROM .*\/bun:.* AS builder$/m);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';

// Pins the load-time BEHAVIOUR of the health store: importing it must not
// touch the network. The old module-scope `if (browser) { check(); ... }` did,
// which is what let ESM evaluation order decide the app's first health status.
//
// `browser: true` is the whole point — health.svelte.test.ts mocks it to false,
// which is precisely why the original bug was invisible to the existing suite.
vi.mock('$app/environment', () => ({ browser: true }));

const { readyMock } = vi.hoisted(() => ({ readyMock: vi.fn(async () => ({ status: 'ok' })) }));
vi.mock('$lib/api/health.js', () => ({ health: { ready: readyMock } }));

// Static import, deliberately. The module is evaluated HERE, before any test
// body runs, which is exactly the moment under test — so the call count is
// sampled immediately and never cleared before the first assertion reads it.
import { getHealthStatus, startHealthPolling, stopHealthPolling } from './health.svelte.js';

const probeCallsAtImport = readyMock.mock.calls.length;
const statusAtImport = getHealthStatus();

describe('health store probe timing (browser: true)', () => {
	afterEach(() => {
		stopHealthPolling(); // clear any real interval this test armed
		readyMock.mockClear();
	});

	it('does not probe the backend at module load', () => {
		// The regression. Before the fix this module ran check() at import, so
		// this count was 1 and status had already been decided by whichever
		// module happened to finish evaluating first.
		expect(probeCallsAtImport).toBe(0);
		expect(statusAtImport).toBe('unknown');
	});

	it('probes once startHealthPolling is called, and is idempotent', () => {
		startHealthPolling();
		expect(readyMock).toHaveBeenCalledTimes(1);

		// A second call must not arm a second interval — the root layout's
		// onMount can re-run (HMR, remount) and two timers would double the
		// poll rate and orphan the first handle.
		startHealthPolling();
		expect(readyMock).toHaveBeenCalledTimes(1);
	});

	it('re-arms after stopHealthPolling so a re-login resumes polling', () => {
		startHealthPolling();
		expect(readyMock).toHaveBeenCalledTimes(1);

		stopHealthPolling(); // logout
		startHealthPolling(); // re-login

		expect(readyMock).toHaveBeenCalledTimes(2);
	});
});

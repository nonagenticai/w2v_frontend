import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * A stream that stays OPEN but silent must eventually be declared failed.
 *
 * `rebuildOnIdle` called `openEventSource()` directly, bypassing the
 * `RECONNECT_MAX_ATTEMPTS` check that lives in `scheduleReconnect`. So a zombie
 * — an EventSource that connects fine and then delivers nothing, ever —
 * rebuilt on every watchdog tick indefinitely and never reached
 * `connectionStatus = 'failed'`. The UI showed "connected" over a dead stream,
 * permanently, while re-opening an EventSource every 180s.
 *
 * The counter has to be separate from `reconnectAttempts`, which resets in
 * `onopen`: a zombie opens perfectly well. Only a real MESSAGE clears it, which
 * is exactly the property that separates a live stream from an open pipe with
 * nothing in it.
 *
 * Asserted against the source because the behaviour is a private method driven
 * by a shared watchdog timer; a behavioural harness here would test the harness.
 */
describe('idle rebuild is capped', () => {
	const src = readFileSync('src/lib/stores/job-progress/sse-transport.svelte.ts', 'utf8');

	it('has a counter distinct from reconnectAttempts', () => {
		expect(src).toContain('consecutiveIdleRebuilds');
	});

	it('checks that counter against the shared cap before rebuilding', () => {
		const body = src.slice(src.indexOf('private rebuildOnIdle'));
		const guardIdx = body.indexOf('consecutiveIdleRebuilds >= RECONNECT_MAX_ATTEMPTS');
		const reopenIdx = body.indexOf('this.openEventSource()');
		expect(guardIdx).toBeGreaterThan(-1);
		expect(reopenIdx).toBeGreaterThan(-1);
		expect(guardIdx).toBeLessThan(reopenIdx);
	});

	it('declares the connection failed once the cap is hit', () => {
		const body = src.slice(src.indexOf('private rebuildOnIdle'));
		const guarded = body.slice(0, body.indexOf('this.openEventSource()'));
		expect(guarded).toContain("connectionStatus = 'failed'");
	});

	it('resets the counter on a real message, NOT on open', () => {
		// `onopen` must not reset it — a zombie opens successfully every time.
		const onopen = src.slice(src.indexOf('this.es.onopen'), src.indexOf('this.es.onerror'));
		expect(onopen).not.toContain('consecutiveIdleRebuilds');

		const handler = src.slice(src.indexOf('const handleMessage'), src.indexOf('this.es.onopen'));
		expect(handler).toContain('consecutiveIdleRebuilds = 0');
	});
});

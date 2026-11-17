import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { nowSubscribersForTests, useNow } from './now.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
});

describe('useNow', () => {
	// REGRESSION: the review banner computed "(1m ago)" once and kept saying it for as
	// long as the tab stayed open.
	it('ticks while a component holds it, and stops when the last one lets go', () => {
		let a: { readonly current: number } | undefined;
		let b: { readonly current: number } | undefined;
		const stopA = $effect.root(() => {
			a = useNow(1000);
		});
		const stopB = $effect.root(() => {
			b = useNow(1000);
		});
		flushSync();
		expect(nowSubscribersForTests()).toBe(2);
		const t0 = a!.current;

		vi.advanceTimersByTime(3000);
		expect(a!.current - t0).toBe(3000);
		expect(b!.current).toBe(a!.current); // one shared clock

		stopA();
		expect(nowSubscribersForTests()).toBe(1);
		vi.advanceTimersByTime(1000);
		expect(b!.current - t0).toBe(4000);

		stopB();
		expect(nowSubscribersForTests()).toBe(0);
		expect(vi.getTimerCount()).toBe(0); // no interval left running
	});

	// A background tab throttles timers; on return the clock must not wait for the
	// next tick to be right.
	it('refreshes the moment the tab becomes visible again', () => {
		let a: { readonly current: number } | undefined;
		const stop = $effect.root(() => {
			a = useNow(60_000);
		});
		flushSync();
		const t0 = a!.current;
		vi.setSystemTime(t0 + 5 * 60_000); // time passed while hidden, no tick fired
		expect(a!.current).toBe(t0);
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(a!.current).toBe(t0 + 5 * 60_000);
		stop();
	});
});

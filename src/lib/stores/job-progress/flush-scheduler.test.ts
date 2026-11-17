import { describe, it, expect, vi } from 'vitest';
import { FlushScheduler } from './flush-scheduler';

// Drive the scheduler with a manual queue so the coalescing logic is tested
// deterministically (no real rAF). schedule() records the callback; runScheduled()
// fires the frame.
function manual() {
	let queue: Array<(() => void) | null> = [];
	return {
		schedule: (cb: () => void) => {
			queue.push(cb);
			return queue.length; // handle = 1-based index
		},
		cancel: (h: number) => {
			queue[h - 1] = null;
		},
		runFrame: () => {
			const q = queue;
			queue = [];
			for (const cb of q) cb?.();
		},
		size: () => queue.filter(Boolean).length
	};
}

describe('FlushScheduler', () => {
	it('coalesces many request() calls into a single flush per frame', () => {
		const flush = vi.fn();
		const m = manual();
		const s = new FlushScheduler(flush, m.schedule, m.cancel);

		s.request();
		s.request();
		s.request();
		expect(flush).not.toHaveBeenCalled(); // deferred
		expect(s.pending).toBe(true);
		expect(m.size()).toBe(1); // only one frame scheduled despite 3 requests

		m.runFrame();
		expect(flush).toHaveBeenCalledTimes(1);
		expect(s.pending).toBe(false);
	});

	it('schedules a fresh flush after the previous frame fired', () => {
		const flush = vi.fn();
		const m = manual();
		const s = new FlushScheduler(flush, m.schedule, m.cancel);

		s.request();
		m.runFrame();
		expect(flush).toHaveBeenCalledTimes(1);

		s.request();
		m.runFrame();
		expect(flush).toHaveBeenCalledTimes(2);
	});

	it('flushNow() flushes synchronously and cancels a pending frame', () => {
		const flush = vi.fn();
		const m = manual();
		const s = new FlushScheduler(flush, m.schedule, m.cancel);

		s.request();
		expect(s.pending).toBe(true);
		s.flushNow();
		expect(flush).toHaveBeenCalledTimes(1);
		expect(s.pending).toBe(false);

		// The previously scheduled frame must NOT flush again.
		m.runFrame();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it('flushNow() works with no pending frame', () => {
		const flush = vi.fn();
		const m = manual();
		const s = new FlushScheduler(flush, m.schedule, m.cancel);
		s.flushNow();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it('cancel() drops a pending flush without flushing', () => {
		const flush = vi.fn();
		const m = manual();
		const s = new FlushScheduler(flush, m.schedule, m.cancel);

		s.request();
		s.cancel();
		expect(s.pending).toBe(false);
		m.runFrame();
		expect(flush).not.toHaveBeenCalled();
	});
});

// A hidden tab runs no animation frames. The default schedule must still flush
// (on its timer arm), or every live update parks until the tab is looked at.
describe('FlushScheduler default schedule — hidden tab', () => {
	it('flushes on the timer when requestAnimationFrame never fires, exactly once', () => {
		vi.useFakeTimers();
		const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
		try {
			const flush = vi.fn();
			const s = new FlushScheduler(flush);
			s.request();
			s.request();
			expect(flush).not.toHaveBeenCalled();
			vi.advanceTimersByTime(300);
			expect(flush).toHaveBeenCalledTimes(1);
			expect(s.pending).toBe(false);
			vi.advanceTimersByTime(1000);
			expect(flush).toHaveBeenCalledTimes(1);
		} finally {
			raf.mockRestore();
			vi.useRealTimers();
		}
	});

	it('cancel() also disarms the timer arm', () => {
		vi.useFakeTimers();
		const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
		try {
			const flush = vi.fn();
			const s = new FlushScheduler(flush);
			s.request();
			s.cancel();
			vi.advanceTimersByTime(1000);
			expect(flush).not.toHaveBeenCalled();
		} finally {
			raf.mockRestore();
			vi.useRealTimers();
		}
	});
});

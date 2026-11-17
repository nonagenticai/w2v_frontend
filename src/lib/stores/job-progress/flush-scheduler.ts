// Coalesces many rapid update requests into a single deferred flush.
//
// Why this exists: on a long multi-stage run the live SSE/poll stream applies a
// burst of state mutations to JobProgressState. Each mutation used to trigger
// its own Svelte reactive flush, so on a CPU-constrained client (the contended
// CI ARC core, or any slow device) a single render could take longer than the
// gap to the next event — renders then chained back-to-back with no idle gap,
// pegging the main thread until the page (and the e2e badge poll) wedged. This
// scheduler caps the re-render RATE: a burst of events applies all its
// mutations but triggers at most ONE flush per animation frame, so the main
// thread always gets idle gaps between renders. Terminal events bypass the
// defer via flushNow() so the status badge updates immediately.
//
// Plain .ts (no runes) so the coalescing logic is unit-testable with an
// injected synchronous scheduler.

export type ScheduleFn = (cb: () => void) => number;
export type CancelFn = (handle: number) => void;

// A hidden tab runs NO animation frames, so a rAF-only schedule parked every
// live update until the tab was looked at again — and a terminal event then
// flushed a pile of stale ones at once. The timer arm guarantees a flush within
// HIDDEN_TAB_FLUSH_MS whatever the tab's visibility; in a visible tab the frame
// almost always wins, so the coalescing behaviour is unchanged.
const HIDDEN_TAB_FLUSH_MS = 250;

let nextHandle = 1;
const armed = new Map<number, { raf: number | null; timer: ReturnType<typeof setTimeout> }>();

const defaultSchedule: ScheduleFn = (cb) => {
	const handle = nextHandle++;
	const fire = () => {
		const entry = armed.get(handle);
		if (!entry) return;
		armed.delete(handle);
		if (entry.raf !== null && typeof cancelAnimationFrame !== 'undefined') {
			cancelAnimationFrame(entry.raf);
		}
		clearTimeout(entry.timer);
		cb();
	};
	const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(fire) : null;
	// SSR / non-DOM: the timer alone still coalesces a synchronous burst.
	const timer = setTimeout(fire, raf === null ? 16 : HIDDEN_TAB_FLUSH_MS);
	armed.set(handle, { raf, timer });
	return handle;
};

const defaultCancel: CancelFn = (handle) => {
	const entry = armed.get(handle);
	if (!entry) return;
	armed.delete(handle);
	if (entry.raf !== null && typeof cancelAnimationFrame !== 'undefined') {
		cancelAnimationFrame(entry.raf);
	}
	clearTimeout(entry.timer);
};

export class FlushScheduler {
	private handle: number | null = null;

	constructor(
		private readonly flush: () => void,
		private readonly schedule: ScheduleFn = defaultSchedule,
		private readonly cancelScheduled: CancelFn = defaultCancel
	) {}

	/** Request a flush on the next frame. Repeated calls before the frame fires
	 *  collapse into a single flush. */
	request(): void {
		if (this.handle !== null) return;
		this.handle = this.schedule(() => {
			this.handle = null;
			this.flush();
		});
	}

	/** Flush synchronously now, cancelling any pending scheduled flush. Use for
	 *  terminal events that must reflect immediately. */
	flushNow(): void {
		this.cancel();
		this.flush();
	}

	/** Cancel any pending flush without flushing (e.g. on disconnect/teardown). */
	cancel(): void {
		if (this.handle !== null) {
			this.cancelScheduled(this.handle);
			this.handle = null;
		}
	}

	/** True while a flush is queued — exposed for tests. */
	get pending(): boolean {
		return this.handle !== null;
	}
}

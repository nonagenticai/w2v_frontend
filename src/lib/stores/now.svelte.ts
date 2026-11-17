// One shared, ticking "now" for relative times ("paused 5m ago").
//
// A relative time computed once at render is wrong a minute later and keeps getting
// wronger: the review banner said "(1m ago)" for as long as the tab stayed open. Every
// component that renders a relative time reads `useNow().current`, so it re-renders
// on each tick. ONE interval serves every subscriber, started by the first and
// stopped by the last, so a page with forty relative times still has one timer.

const DEFAULT_TICK_MS = 30_000;

let now = $state(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

// A background tab throttles (or freezes) timers, so on return the clock can be
// minutes stale until the next tick. Refresh it the moment the tab is visible again.
function onVisibility(): void {
	if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
		now = Date.now();
	}
}

function subscribe(tickMs: number): () => void {
	subscribers += 1;
	if (timer === undefined) {
		now = Date.now();
		timer = setInterval(() => {
			now = Date.now();
		}, tickMs);
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', onVisibility);
		}
	}
	return () => {
		subscribers -= 1;
		if (subscribers === 0 && timer !== undefined) {
			clearInterval(timer);
			timer = undefined;
			if (typeof document !== 'undefined') {
				document.removeEventListener('visibilitychange', onVisibility);
			}
		}
	};
}

/** Call during component setup. `current` is the shared clock in epoch ms, refreshed
 *  every `tickMs` while at least one component that asked for it is mounted. */
export function useNow(tickMs: number = DEFAULT_TICK_MS): { readonly current: number } {
	$effect(() => subscribe(tickMs));
	return {
		get current() {
			return now;
		}
	};
}

/** Test seam: how many components currently hold the clock. */
export function nowSubscribersForTests(): number {
	return subscribers;
}

// SPA chunk-load resilience across a deploy. A hashed JS chunk that 404s after a new build
// shipped (stale chunk graph in a long-lived tab, sometimes edge-negative-cached) fires Vite's
// `vite:preloadError` — which otherwise surfaces as the route error boundary's "Internal Error"
// with no recovery (observed live after a frontend deploy: navigating to the run route imported a
// stale `nodes/*.js` hash). A one-shot full reload fetches the fresh no-cache shell with the NEW
// chunk hashes and recovers (it never re-requests the dead hash).
//
// The one-shot guard is a `sessionStorage` stamp — so the reload is only safe to trigger when that
// stamp is KNOWN to have persisted. Where `sessionStorage` throws or silently drops writes (Safari
// private mode, storage blocked by policy, a partitioned third-party context) the stamp can never
// be read back, every load would re-fire `vite:preloadError`, and the tab would reload FOREVER with
// nothing shown to the user. So: no durable stamp ⇒ no reload. A stale-chunk error surfaced once is
// strictly better than an unbounded reload loop.

export const PRELOAD_RELOAD_KEY = 'w2v:chunk-reloaded';

/** True only when the stamp was written AND reads back — i.e. the one-shot guard is real. */
function claimReload(): boolean {
	try {
		sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
		return sessionStorage.getItem(PRELOAD_RELOAD_KEY) === '1';
	} catch {
		return false;
	}
}

function alreadyReloaded(): boolean {
	try {
		return sessionStorage.getItem(PRELOAD_RELOAD_KEY) === '1';
	} catch {
		return false;
	}
}

/**
 * Attach the one-shot stale-chunk recovery reload. Returns the detach function.
 * Client-only — the caller guards on `typeof window`.
 */
export function installChunkReloadRecovery(): () => void {
	const onPreloadError = (e: Event) => {
		e.preventDefault(); // suppress Vite's default re-throw; we drive recovery
		if (alreadyReloaded()) return; // already had our one shot — let the error surface
		if (!claimReload()) return; // storage unavailable ⇒ no guard ⇒ never reload
		location.reload();
	};
	window.addEventListener('vite:preloadError', onPreloadError);
	// Installed → chunks loaded fine → clear any prior stamp so a future deploy gets its own
	// one-shot recovery reload.
	try {
		sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
	} catch {
		/* ignore */
	}
	return () => window.removeEventListener('vite:preloadError', onPreloadError);
}

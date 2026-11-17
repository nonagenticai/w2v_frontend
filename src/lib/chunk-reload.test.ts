/**
 * Stale-chunk recovery reload.
 *
 * The load-bearing case is the one that used to loop forever: when `sessionStorage`
 * throws (Safari private mode / storage blocked by policy / partitioned context) the
 * one-shot stamp can never persist, so every load re-fires `vite:preloadError` and the
 * old handler reloaded again — endlessly, with nothing shown to the user. The reload is
 * now conditional on the stamp actually having been written.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChunkReloadRecovery, PRELOAD_RELOAD_KEY } from './chunk-reload';

const reload = vi.fn();
let detach: (() => void) | undefined;

function firePreloadError() {
	window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
}

beforeEach(() => {
	reload.mockClear();
	sessionStorage.clear();
	vi.spyOn(location, 'reload').mockImplementation(reload);
});

afterEach(() => {
	detach?.();
	detach = undefined;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	sessionStorage.clear();
});

describe('installChunkReloadRecovery', () => {
	it('reloads exactly once, then lets a second preload error surface', () => {
		detach = installChunkReloadRecovery();

		firePreloadError();
		expect(reload).toHaveBeenCalledTimes(1);
		expect(sessionStorage.getItem(PRELOAD_RELOAD_KEY)).toBe('1');

		firePreloadError();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('does NOT reload when sessionStorage throws — an unwritable stamp means an unbounded loop', () => {
		// Safari private mode / storage blocked by policy: every accessor throws.
		const boom = () => {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		};
		vi.stubGlobal('sessionStorage', { getItem: boom, setItem: boom, removeItem: boom });
		detach = installChunkReloadRecovery();

		firePreloadError();
		firePreloadError();
		firePreloadError();

		expect(reload).not.toHaveBeenCalled();
	});

	it('does NOT reload when the stamp write is silently dropped (no-op storage shim)', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		});
		detach = installChunkReloadRecovery();

		firePreloadError();

		expect(reload).not.toHaveBeenCalled();
	});

	it('suppresses Vite default handling so the error boundary does not double-report', () => {
		detach = installChunkReloadRecovery();
		const e = new Event('vite:preloadError', { cancelable: true });
		window.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(true);
	});

	it('clears a stale stamp on install so a later deploy gets its own one shot', () => {
		sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
		detach = installChunkReloadRecovery();
		expect(sessionStorage.getItem(PRELOAD_RELOAD_KEY)).toBeNull();

		firePreloadError();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('detaches the listener', () => {
		installChunkReloadRecovery()();
		firePreloadError();
		expect(reload).not.toHaveBeenCalled();
	});
});

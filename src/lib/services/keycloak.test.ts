import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each test dynamically imports ./keycloak.js (pulling the keycloak-js shim) and
// awaits initKeycloak() under fake timers. In isolation the whole file runs in
// <9s, but inside the full suite the module-import phase competes for the worker
// and the default 5s per-test timeout flakes on the first init test. Give these
// import-bound tests generous headroom — the assertions themselves are instant.
vi.setConfig({ testTimeout: 20000 });

const loginMock = vi.fn(() => Promise.resolve());
const updateTokenMock = vi.fn();
const initMock = vi.fn(async (_opts: Record<string, unknown>) => true);
const logoutMock = vi.fn(async (_opts?: Record<string, unknown>) => {});

vi.mock('keycloak-js', () => ({
	default: class {
		token = 'kc-token';
		authenticated = true;
		login = loginMock;
		logout = logoutMock;
		updateToken = updateTokenMock;
		init = initMock;
	}
}));

describe('keycloak refresh lifecycle', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		loginMock.mockClear();
		updateTokenMock.mockReset();
		initMock.mockClear();
		initMock.mockImplementation(async (_opts: Record<string, unknown>) => true);
		// Defaults: tab visible, refresh resolves true.
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible'
		});
		updateTokenMock.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('initialises with onLoad:login-required + silentCheckSsoFallback:false', async () => {
		const { initKeycloak } = await import('./keycloak.js');
		await initKeycloak();
		expect(initMock).toHaveBeenCalledTimes(1);
		const opts = initMock.mock.calls[0][0] as Record<string, unknown>;
		expect(opts.onLoad).toBe('login-required');
		expect(opts.silentCheckSsoFallback).toBe(false);
		expect(opts.pkceMethod).toBe('S256');
		expect(opts.checkLoginIframe).toBe(false);
	});

	it('polls updateToken while the tab is visible', async () => {
		const { initKeycloak } = await import('./keycloak.js');
		await initKeycloak();

		await vi.advanceTimersByTimeAsync(11_000);
		expect(updateTokenMock).toHaveBeenCalled();
		expect(updateTokenMock.mock.calls[0][0]).toBe(60);
	});

	it('pauses polling when the tab becomes hidden and resumes on visible', async () => {
		const { initKeycloak } = await import('./keycloak.js');
		await initKeycloak();

		await vi.advanceTimersByTimeAsync(11_000);
		const firstCount = updateTokenMock.mock.calls.length;

		Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));

		await vi.advanceTimersByTimeAsync(30_000);
		expect(updateTokenMock.mock.calls.length).toBe(firstCount);

		Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
		document.dispatchEvent(new Event('visibilitychange'));

		await vi.advanceTimersByTimeAsync(11_000);
		expect(updateTokenMock.mock.calls.length).toBeGreaterThan(firstCount);
	});

	it('stops the refresh interval and triggers login exactly once on refresh failure', async () => {
		updateTokenMock.mockRejectedValue(new Error('refresh token expired'));
		const { initKeycloak } = await import('./keycloak.js');
		await initKeycloak();

		await vi.advanceTimersByTimeAsync(11_000);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(loginMock).toHaveBeenCalledTimes(1);
	});
});

describe('refresh retry policy', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		loginMock.mockClear();
		updateTokenMock.mockReset();
		initMock.mockClear();
		initMock.mockImplementation(async (_opts: Record<string, unknown>) => true);
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible'
		});
		updateTokenMock.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function nowSeconds(): number {
		return Math.floor(Date.now() / 1000);
	}

	it('retries a transient rejection, does NOT redirect, and keeps polling afterwards', async () => {
		// A single network blip mid-pipeline used to end the session outright.
		const { initKeycloak, keycloak } = await import('./keycloak.js');
		keycloak.refreshTokenParsed = { exp: nowSeconds() + 3600 };
		updateTokenMock.mockRejectedValueOnce(new Error('network blip'));
		await initKeycloak();

		// First poll tick (t=10s) rejects. Stop short of the 1s backoff.
		await vi.advanceTimersByTimeAsync(10_050);
		expect(updateTokenMock).toHaveBeenCalledTimes(1);
		expect(loginMock).not.toHaveBeenCalled();

		// ...the ~1s backoff elapses and the retry succeeds.
		await vi.advanceTimersByTimeAsync(1_100);
		expect(updateTokenMock).toHaveBeenCalledTimes(2);
		expect(loginMock).not.toHaveBeenCalled();

		// The interval must still be alive after a recovered blip.
		const afterRecovery = updateTokenMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(11_000);
		expect(updateTokenMock.mock.calls.length).toBeGreaterThan(afterRecovery);
		expect(loginMock).not.toHaveBeenCalled();
	});

	it('redirects on the FIRST rejection with no backoff when the refresh token is expired', async () => {
		const { initKeycloak, keycloak } = await import('./keycloak.js');
		keycloak.refreshTokenParsed = { exp: nowSeconds() - 10 };
		updateTokenMock.mockRejectedValue(new Error('refresh token expired'));
		await initKeycloak();

		// Advance only past the poll tick — NOT past the 1s backoff. A dead
		// session must not spend retry attempts or wall-clock waiting.
		await vi.advanceTimersByTimeAsync(10_050);
		expect(updateTokenMock).toHaveBeenCalledTimes(1);
		expect(loginMock).toHaveBeenCalledTimes(1);
	});

	it('redirects exactly ONCE after all 3 attempts fail with a still-valid refresh token', async () => {
		const { initKeycloak, keycloak } = await import('./keycloak.js');
		keycloak.refreshTokenParsed = { exp: nowSeconds() + 3600 };
		updateTokenMock.mockRejectedValue(new Error('backend unreachable'));
		await initKeycloak();

		await vi.advanceTimersByTimeAsync(10_050);
		expect(updateTokenMock).toHaveBeenCalledTimes(1);
		expect(loginMock).not.toHaveBeenCalled();

		// 1s + 2s backoffs → attempts 2 and 3, then give up.
		await vi.advanceTimersByTimeAsync(4_000);
		expect(updateTokenMock).toHaveBeenCalledTimes(3);
		expect(loginMock).toHaveBeenCalledTimes(1);

		// Polling stopped and the single-flight redirect holds.
		const afterGiveUp = updateTokenMock.mock.calls.length;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(updateTokenMock.mock.calls.length).toBe(afterGiveUp);
		expect(loginMock).toHaveBeenCalledTimes(1);
	});

	it('refreshes immediately on visibilitychange -> visible, without waiting a poll interval', async () => {
		const { initKeycloak, keycloak } = await import('./keycloak.js');
		keycloak.refreshTokenParsed = { exp: nowSeconds() + 3600 };
		await initKeycloak();

		Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(30_000);
		updateTokenMock.mockClear();

		Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
		document.dispatchEvent(new Event('visibilitychange'));
		// Flush microtasks only — do NOT advance by the 10s poll interval.
		await vi.advanceTimersByTimeAsync(0);

		// Not `toHaveBeenCalledTimes(1)`: `vi.resetModules()` gives each test its
		// own module instance, but the `visibilitychange` listener each one
		// attaches lives on the SHARED jsdom document and is never removed — so a
		// dispatch here also re-runs the handlers earlier tests installed, all of
		// which share `updateTokenMock`. The claim under test is "a refresh
		// happens immediately, without waiting a poll interval", and the
		// mockClear() above is what makes a non-zero count mean exactly that.
		expect(updateTokenMock.mock.calls.length).toBeGreaterThan(0);
		expect(updateTokenMock).toHaveBeenCalledWith(60);
		expect(loginMock).not.toHaveBeenCalled();
	});
});

describe('ensureFreshToken', () => {
	beforeEach(() => {
		vi.resetModules();
		loginMock.mockClear();
		updateTokenMock.mockReset();
		initMock.mockClear();
		initMock.mockImplementation(async (_opts: Record<string, unknown>) => true);
		updateTokenMock.mockResolvedValue(true);
	});

	it('refreshes via updateToken(minValidity) and returns the live token', async () => {
		const { ensureFreshToken } = await import('./keycloak.js');
		const tok = await ensureFreshToken(45);
		expect(updateTokenMock).toHaveBeenCalledTimes(1);
		expect(updateTokenMock).toHaveBeenCalledWith(45);
		expect(tok).toBe('kc-token');
	});

	it('uses 30s default minValidity when no argument given', async () => {
		const { ensureFreshToken } = await import('./keycloak.js');
		await ensureFreshToken();
		expect(updateTokenMock).toHaveBeenCalledWith(30);
	});

	it('redirects to login() and returns undefined when refresh fails', async () => {
		updateTokenMock.mockRejectedValueOnce(new Error('refresh dead'));
		const { ensureFreshToken } = await import('./keycloak.js');
		const tok = await ensureFreshToken(30);
		expect(loginMock).toHaveBeenCalledTimes(1);
		expect(tok).toBeUndefined();
	});

	it('fires login() exactly ONCE across N concurrent ensureFreshToken callers on refresh failure', async () => {
		// Reproduces the dashboard symptom: three parallel projects.list()
		// calls each await ensureFreshToken(30). When the refresh token is
		// dead, all three must share a single redirect — not fire three
		// separate keycloak.login() calls, each of which would race against
		// the others for window.location and produce the URL-flicker /
		// 401-burst observed in prod.
		updateTokenMock.mockRejectedValue(new Error('refresh dead'));
		const { ensureFreshToken } = await import('./keycloak.js');

		const results = await Promise.all([
			ensureFreshToken(30),
			ensureFreshToken(30),
			ensureFreshToken(30)
		]);

		expect(loginMock).toHaveBeenCalledTimes(1);
		expect(results).toEqual([undefined, undefined, undefined]);
	});

	it('awaits the redirect promise rather than fire-and-forgetting it', async () => {
		// If the redirect promise stalls (production behaviour:
		// keycloak.login() resolves only after window.location navigates,
		// effectively never within the current document's lifetime), the
		// ensureFreshToken caller must stay suspended — NOT fall through
		// and return undefined while the redirect is still in flight.
		// Otherwise the caller fires an anonymous request and we get the
		// 401-in-the-gap symptom this PR exists to fix.
		updateTokenMock.mockRejectedValueOnce(new Error('refresh dead'));
		let resolveLogin!: () => void;
		loginMock.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveLogin = resolve;
				})
		);
		const { ensureFreshToken } = await import('./keycloak.js');

		const pending = ensureFreshToken(30);
		// Yield twice so the catch arm runs and reaches the await.
		await Promise.resolve();
		await Promise.resolve();

		// Race the suspended call against a sentinel — `pending` must lose.
		const sentinel = Symbol('still-pending');
		const winner = await Promise.race([pending.then(() => 'resolved'), Promise.resolve(sentinel)]);
		expect(winner).toBe(sentinel);

		// Resolve the redirect; now pending should complete.
		resolveLogin();
		const tok = await pending;
		expect(tok).toBeUndefined();
		expect(loginMock).toHaveBeenCalledTimes(1);
	});
});

// Prod symptom (2026-10-07): Logout landed on Keycloak's "invalid redirect uri"
// page because keycloak-js defaulted post_logout_redirect_uri to location.href,
// which still carried the OIDC callback fragment. The client's registered
// post-logout URI is exactly the app root with a trailing slash.
const CALLBACK_FRAGMENT =
	'#state=s-1&session_state=ss-1&iss=https%3A%2F%2Fauth.example%2Frealms%2Fportal&code=c-1';

describe('logout redirect + callback-fragment cleanup', () => {
	beforeEach(() => {
		vi.resetModules();
		logoutMock.mockClear();
		initMock.mockClear();
		initMock.mockImplementation(async (_opts: Record<string, unknown>) => true);
		updateTokenMock.mockReset();
		updateTokenMock.mockResolvedValue(true);
	});

	afterEach(() => {
		history.replaceState(null, '', '/');
	});

	it('logout passes redirectUri === origin + "/" even when location.href carries the callback fragment', async () => {
		history.replaceState(null, '', '/projects/abc' + CALLBACK_FRAGMENT);
		expect(window.location.href).toContain('code=c-1');
		const { logout } = await import('./keycloak.js');

		await logout();

		expect(logoutMock).toHaveBeenCalledTimes(1);
		const opts = logoutMock.mock.calls[0][0] as Record<string, unknown> | undefined;
		expect(opts?.redirectUri).toBe(window.location.origin + '/');
		expect(String(opts?.redirectUri)).not.toContain('#');
	});

	it('strips the OIDC callback fragment from the address bar after init', async () => {
		history.replaceState(null, '', '/projects/abc?tab=runs' + CALLBACK_FRAGMENT);
		const { initKeycloak } = await import('./keycloak.js');

		await initKeycloak();

		expect(window.location.hash).toBe('');
		expect(window.location.pathname + window.location.search).toBe('/projects/abc?tab=runs');
	});

	it('leaves an unrelated app hash alone after init', async () => {
		history.replaceState(null, '', '/docs#section-2');
		const { initKeycloak } = await import('./keycloak.js');

		await initKeycloak();

		expect(window.location.hash).toBe('#section-2');
	});
});

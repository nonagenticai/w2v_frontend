import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomId } from './random-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = globalThis.crypto;

/**
 * Replace `globalThis.crypto` with a NON-SECURE-CONTEXT shape: `getRandomValues`
 * present (it is available everywhere), `randomUUID` absent. This is exactly what
 * the browser exposes on `http://w2v-frontend.w2v:6183`, the
 * origin the in-cluster E2E harness serves.
 */
function withoutRandomUUID(): void {
	Object.defineProperty(globalThis, 'crypto', {
		configurable: true,
		// Hand the REAL `getRandomValues` straight through, bound to the real
		// crypto, and let the object take the platform `Crypto` type. Writing our
		// own signature here is what kept breaking: `Uint8Array` defaults to
		// `Uint8Array<ArrayBufferLike>`, which CI's pinned TS (^6.0.3) will not
		// accept where `ArrayBufferView<ArrayBuffer>` is wanted — and the repo's
		// symlinked node_modules resolves TS 5.9.3, so it type-checks clean
		// locally and fails only in CI. No parameter typing, no drift.
		value: {
			getRandomValues: realCrypto.getRandomValues.bind(realCrypto)
		} as Crypto
	});
}

afterEach(() => {
	Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto });
	vi.restoreAllMocks();
});

describe('randomId', () => {
	it('uses the platform randomUUID when it is available', () => {
		const spy = vi
			.spyOn(realCrypto, 'randomUUID')
			.mockReturnValue('11111111-2222-4333-8444-555555555555');
		expect(randomId()).toBe('11111111-2222-4333-8444-555555555555');
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('still returns a v4-shaped id when randomUUID is undefined (non-secure origin)', () => {
		withoutRandomUUID();
		expect(globalThis.crypto.randomUUID).toBeUndefined();

		const id = randomId();
		expect(id).toMatch(UUID_V4);
	});

	it('does not throw on a non-secure origin — the defect that broke every Studio save', () => {
		withoutRandomUUID();
		expect(() => randomId()).not.toThrow();
	});

	it('draws the fallback bytes from getRandomValues, never Math.random', () => {
		withoutRandomUUID();
		const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
		const mathRandom = vi.spyOn(Math, 'random');

		randomId();

		expect(spy).toHaveBeenCalledTimes(1);
		expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(16);
		expect(mathRandom).not.toHaveBeenCalled();
	});

	it('pins the version and variant bits rather than echoing raw bytes', () => {
		withoutRandomUUID();
		// All-zero bytes: only the version/variant rewrite can make this v4-shaped.
		vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((a: Uint8Array) => {
			a.fill(0);
			return a;
		}) as typeof globalThis.crypto.getRandomValues);

		expect(randomId()).toBe('00000000-0000-4000-8000-000000000000');
	});

	it('is collision-free across a large draw — it is an Idempotency-Key', () => {
		withoutRandomUUID();
		const ids = new Set<string>();
		for (let i = 0; i < 20_000; i++) ids.add(randomId());
		expect(ids.size).toBe(20_000);
	});
});

describe('when there is no CSPRNG at all', () => {
	it('throws a named error rather than degrading to a weak id', () => {
		Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
		expect(() => randomId()).toThrow(/no CSPRNG available/);
	});

	it('does not fall back to Math.random', () => {
		const spy = vi.spyOn(Math, 'random');
		Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
		expect(() => randomId()).toThrow(/no CSPRNG available/);
		expect(spy).not.toHaveBeenCalled();
	});
});

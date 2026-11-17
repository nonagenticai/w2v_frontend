/**
 * A v4-shaped random id that works on a NON-SECURE origin.
 *
 * `crypto.randomUUID` is spec'd as a secure-context-only API: it is `undefined`
 * on plain `http://` origins other than localhost. Production is HTTPS, so real
 * users never saw this — but the in-cluster E2E harness serves the app at
 * `http://w2v-frontend.w2v:6183`
 * (`.github/workflows/scripts/run-e2e-job.sh`), where every `crypto.randomUUID()`
 * call throws. That took out the Studio save path (the throw happened BEFORE the
 * POST, so no request was ever issued) and then took out its own error toast,
 * because the toast store called `crypto.randomUUID()` too — a failure with zero
 * user-visible surface.
 *
 * UNIQUENESS — this value is used as an HTTP `Idempotency-Key`, so a collision
 * would make two DISTINCT saves look like one retry and silently drop the second.
 * The fallback therefore draws its bytes from `crypto.getRandomValues`, a CSPRNG
 * that is available in EVERY context (it is not secure-context gated), and lays
 * them out exactly as RFC 9562 §5.4 specifies: 122 free random bits, with the
 * version and variant nibbles pinned. That is the same entropy budget the
 * platform's own `randomUUID` is required to use. `Math.random()` is NOT used
 * and must not be: it is not a CSPRNG, is seeded per-realm, and collides.
 */
export function randomId(): string {
	const c = globalThis.crypto;
	if (typeof c?.randomUUID === 'function') return c.randomUUID();

	// No CSPRNG at all. Do NOT degrade to `Math.random()` here: a weak id would
	// still be ACCEPTED as an Idempotency-Key and could silently merge two
	// distinct saves. Fail loudly instead — the caller surfaces this inline, so
	// it reads as a real error rather than a button that does nothing.
	if (typeof c?.getRandomValues !== 'function') {
		throw new Error('randomId: no CSPRNG available (globalThis.crypto.getRandomValues is missing)');
	}

	const bytes = new Uint8Array(16);
	c.getRandomValues(bytes);
	// RFC 9562 §5.4: version 4 in the high nibble of octet 6, variant 0b10 in the
	// two high bits of octet 8. Everything else stays random.
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

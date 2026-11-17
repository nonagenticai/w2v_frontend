import { describe, it, expect } from 'vitest';
import { isPresignExpired, presignExpiresAt, PRESIGN_SKEW_SECONDS } from './presign';

const NOW = Date.UTC(2026, 7, 17, 6, 0, 0); // 2026-08-17T06:00:00Z
const url = (date: string, expires: string, tail = '') =>
	`https://minio.test/b/a.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${date}&X-Amz-Expires=${expires}&X-Amz-Signature=deadbeef${tail}`;

describe('presignExpiresAt', () => {
	it('reads X-Amz-Date + X-Amz-Expires as an absolute expiry', () => {
		expect(presignExpiresAt(url('20260817T053255Z', '3600'))).toBe(
			Date.UTC(2026, 7, 17, 6, 32, 55)
		);
	});

	// scopedMediaUrl string-concatenates the tenant switch onto the END and the
	// renderer then appends a `#t=` media fragment, so the string handed to this
	// parser is frequently not a clean single-query URL.
	it('reads them through a concatenated tenant switch and a media fragment', () => {
		const messy = url('20260817T053255Z', '3600', '?active_tenant=tenant-x') + '#t=1.5';
		expect(presignExpiresAt(messy)).toBe(Date.UTC(2026, 7, 17, 6, 32, 55));
	});

	it('returns null — unknown, not expired — when either param is absent', () => {
		expect(presignExpiresAt('/api/runs/r1/artifact/a.mp4')).toBeNull();
		expect(presignExpiresAt('https://minio.test/b/a.mp4?X-Amz-Date=20260817T053255Z')).toBeNull();
		expect(presignExpiresAt('https://minio.test/b/a.mp4?X-Amz-Expires=3600')).toBeNull();
	});

	it('returns null on an unparseable date or lifetime', () => {
		expect(presignExpiresAt(url('2026-08-17T05:32:55Z', '3600'))).toBeNull();
		expect(presignExpiresAt(url('20260817T053255Z', 'abc'))).toBeNull();
		expect(presignExpiresAt(url('20260817T053255Z', '-3600'))).toBeNull();
	});

	it('returns null for nothing at all', () => {
		expect(presignExpiresAt(null)).toBeNull();
		expect(presignExpiresAt(undefined)).toBeNull();
		expect(presignExpiresAt('')).toBeNull();
	});
});

describe('isPresignExpired', () => {
	it('is true once the stated expiry has passed', () => {
		expect(isPresignExpired(url('20260817T040000Z', '3600'), NOW)).toBe(true);
	});

	it('is false while the link is still comfortably live', () => {
		expect(isPresignExpired(url('20260817T055000Z', '3600'), NOW)).toBe(false);
	});

	// A link with seconds left produces exactly the failed-request storm the
	// preflight exists to prevent, and the browser clock is not the signer's.
	it('counts a link expiring inside the skew margin as expired', () => {
		const almost = NOW + (PRESIGN_SKEW_SECONDS - 5) * 1000;
		const signedAt = new Date(almost - 3600_000)
			.toISOString()
			.replace(/[-:]/g, '')
			.replace(/\.\d+Z$/, 'Z');
		expect(isPresignExpired(url(signedAt, '3600'), NOW)).toBe(true);
	});

	// Fails OPEN, always: an unreadable url must still be rendered and left to
	// the caller's onerror fallback.
	it('is false for any url it cannot read an expiry from', () => {
		expect(isPresignExpired('/api/runs/r1/artifact/a.mp4', NOW)).toBe(false);
		expect(isPresignExpired(url('nonsense', '3600'), NOW)).toBe(false);
		expect(isPresignExpired(null, NOW)).toBe(false);
	});
});

// The orchestrator rewrites artifact urls to a same-origin proxy path and
// carries the ORIGINAL presign query along verbatim. That endpoint re-signs
// server-side with its own credentials and ignores the inbound query, so the
// path cannot expire — but the inert `X-Amz-*` passengers parse fine, and
// reading them rendered all 20 shots of a live `cut_plan` gate as dead
// placeholders with zero failed requests.
describe('isPresignExpired — same-origin artifact proxy', () => {
	const PROXY = '/api/runs/0198c4f1-6d2a-7c31-9f80-2b7a41d9e3c5/artifact/w2v-media/shots/s1.mp4';
	// Ordered as the orchestrator emits it: the lifetime is NOT the last param,
	// so it terminates on `&` and stays parseable. A version of this fixture
	// that ended on `X-Amz-Expires=3600` made the tenant-switch case below pass
	// vacuously — the parser choked on `3600?active_tenant=…` and returned
	// UNKNOWN, so the test went green with the exemption deleted.
	const LONG_PAST = 'X-Amz-Date=20260101T000000Z&X-Amz-Expires=3600&X-Amz-Signature=deadbeef';

	it('is NOT expired even with a long-past presign query riding along', () => {
		expect(isPresignExpired(`${PROXY}?${LONG_PAST}`, NOW)).toBe(false);
	});

	it('is NOT expired through a concatenated tenant switch and media fragment', () => {
		expect(isPresignExpired(`${PROXY}?${LONG_PAST}?active_tenant=tenant-x#t=1.5`, NOW)).toBe(false);
	});

	// Regression guard, not a mutation target: this one is false either way,
	// because the parser already returns UNKNOWN with no params to read.
	it('is NOT expired when it carries no presign params at all', () => {
		expect(isPresignExpired(PROXY, NOW)).toBe(false);
	});

	// The guard must not have disabled the real check.
	it('still expires a genuine presigned url on another host', () => {
		expect(isPresignExpired(url('20260101T000000Z', '3600'), NOW)).toBe(true);
	});

	// Narrowness: the exemption is `/api/**/artifact/**` relative paths ONLY.
	it('does not exempt other hosts, other paths, or an `/artifact/` in the query', () => {
		// absolute url to another host that merely mimics the proxy path
		expect(isPresignExpired(`https://minio.test${PROXY}?${LONG_PAST}`, NOW)).toBe(true);
		// protocol-relative — not same-origin
		expect(isPresignExpired(`//minio.test${PROXY}?${LONG_PAST}`, NOW)).toBe(true);
		// a relative /api/ path that is not the artifact proxy
		expect(isPresignExpired(`/api/runs/r1/download?${LONG_PAST}`, NOW)).toBe(true);
		// `/artifact/` only in the QUERY buys no exemption
		expect(isPresignExpired(`/api/runs/r1/x?key=/artifact/a.mp4&${LONG_PAST}`, NOW)).toBe(true);
	});

	// The parser stays honest: it reports what the string STATES. Only the
	// predicate knows the stated expiry does not bind.
	it('leaves presignExpiresAt reporting the stated expiry for a proxy path', () => {
		expect(presignExpiresAt(`${PROXY}?${LONG_PAST}`)).toBe(Date.UTC(2026, 0, 1, 1, 0, 0));
	});
});

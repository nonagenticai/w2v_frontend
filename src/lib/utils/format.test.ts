import { describe, it, expect } from 'vitest';
import { plural, shortId } from './format';

describe('shortId', () => {
	it('returns the first 8 chars of a non-empty id', () => {
		expect(shortId('0123456789abcdef')).toBe('01234567');
	});

	it('returns the default em-dash fallback for null/empty', () => {
		expect(shortId(null)).toBe('—');
		expect(shortId(undefined)).toBe('—');
		expect(shortId('')).toBe('—');
	});

	it('honours a caller-supplied fallback', () => {
		expect(shortId(null, 'system')).toBe('system');
		expect(shortId('subject-1', 'system')).toBe('subject-');
	});
});

describe('extractHostname / fileSafeHost', () => {
	it('extractHostname keeps the path — display screens rely on it (filenames use fileSafeHost)', async () => {
		const { extractHostname } = await import('./format');
		expect(extractHostname('https://a.test/pricing')).toBe('a.test/pricing');
		expect(extractHostname('https://a.test/')).toBe('a.test');
		expect(extractHostname('not a url')).toBe('not a url');
	});

	it('fileSafeHost mirrors the server host_of (filename-safe, "report" fallback)', async () => {
		const { fileSafeHost } = await import('./format');
		expect(fileSafeHost('https://A.Test/pricing?x=1')).toBe('a.test');
		expect(fileSafeHost('https://xn--bcher-kva.example/')).toBe('xn--bcher-kva.example');
		expect(fileSafeHost('')).toBe('report');
		expect(fileSafeHost('not a url')).toBe('report');
		expect(fileSafeHost(null)).toBe('report');
	});
});

describe('plural', () => {
	it('uses the singular for exactly one', () => {
		expect(plural(1, 'entry', 'entries')).toBe('1 entry');
		expect(plural(1, 'lesson')).toBe('1 lesson');
	});
	it('uses the plural for zero and many', () => {
		expect(plural(0, 'lesson')).toBe('0 lessons');
		expect(plural(2, 'entry', 'entries')).toBe('2 entries');
	});
});

import { describe, expect, it } from 'vitest';
import { isSafeHref, safeHref } from './safe-url';

describe('isSafeHref', () => {
	it.each([
		'javascript:alert(1)',
		'JaVaScRiPt:alert(1)',
		'  javascript:alert(1)',
		'data:text/html;base64,PHNjcmlwdD4=',
		'vbscript:msgbox(1)',
		'blob:https://example.com/uuid',
		'file:///etc/passwd',
		'//evil.example.com/path'
	])('refuses %s', (value) => {
		expect(isSafeHref(value)).toBe(false);
		expect(safeHref(value)).toBeUndefined();
	});

	it.each([
		'https://example.com/page?a=1',
		'http://example.com',
		'/projects/123/runs/456',
		'mailto:someone@example.com'
	])('allows %s', (value) => {
		expect(isSafeHref(value)).toBe(true);
	});

	it('refuses non-strings and blanks', () => {
		for (const value of [null, undefined, 42, {}, [], '', '   ']) {
			expect(isSafeHref(value)).toBe(false);
		}
	});

	it('trims before returning so a padded URL is still usable', () => {
		expect(safeHref('  https://example.com  ')).toBe('https://example.com');
	});

	it('refuses protocol-relative URLs, which look site-relative but are not', () => {
		// `//evil.example.com` inherits the page scheme and navigates off-origin
		// while starting with `/` — the reason the `/` check needs a second test.
		expect(isSafeHref('//evil.example.com')).toBe(false);
		expect(isSafeHref('/safe/path')).toBe(true);
	});
});

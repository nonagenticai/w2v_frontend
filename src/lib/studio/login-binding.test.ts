import { describe, expect, it } from 'vitest';
import { contextOrigin, loginBinding, loginChange } from './login-binding';

// The SAME cases the orchestrator pins in tests/services/test_auth_secrets.py:
// an edit outside the binding keeps the saved password, one inside drops it.
const login = {
	type: 'basic',
	username: 'u',
	password: { redacted: true },
	login_url: 'https://victim.example/login'
};
const brief = { target_url: 'https://victim.example', auth_config: login };

describe('loginBinding — mirrors auth_secrets._login_binding', () => {
	it.each([
		['an unrelated key', { ...brief, title_hint: 'renamed' }, login],
		[
			'a capture path',
			{ ...brief, site_capture: { paths: ['https://attacker.example/x'] } },
			login
		],
		['a trailing slash on the site', { ...brief, target_url: 'https://victim.example/' }, login],
		['a newly typed password', brief, { ...login, password: 'fresh' }],
		['the server flag', brief, { ...login, needs_reentry: true }]
	])('%s keeps the binding', (_n, ctx, after) => {
		expect(loginChange(login, brief, after, ctx)).toBeNull();
	});

	it.each([
		['address', { login_url: 'https://victim.example/signin' }, brief],
		['username', { username: 'someone-else' }, brief],
		['site', { signs_into: 'https://app.example' }, brief],
		['settings', { password_selector: '#search' }, brief],
		['settings', { type: 'bearer' }, brief],
		['settings', { label: 'gm' }, brief],
		['site', {}, { ...brief, target_url: 'https://attacker.example' }]
	] as const)('a changed %s changes it', (kind, patch, ctx) => {
		expect(loginChange(login, brief, { ...login, ...patch }, ctx)).toBe(kind);
	});

	it('binds to the ONE bound site, like context_origin', () => {
		expect(contextOrigin({ source_url: 'https://app.example/x' })).toBe('https://app.example');
		expect(
			contextOrigin({ source_url: 'https://app.example/', target_url: 'https://other.example' })
		).toBeNull();
		expect(loginBinding(login, brief)).not.toContain('redacted');
	});
});

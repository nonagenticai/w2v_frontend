import { describe, it, expect } from 'vitest';
import { tenantAuditQueryString, auditDetailSummary } from './tenant-audit.js';
import { tenantMusicForm } from './music.js';
import { LICENCE_LOOKUP_TEXT, limitValueText } from './tenant-limits.js';

describe('tenant audit query', () => {
	it('emits only the set params, snake_case on the wire', () => {
		expect(tenantAuditQueryString()).toBe('');
		expect(
			tenantAuditQueryString({
				limit: 50,
				cursor: 'c',
				action: 'music.upload',
				actorKind: 'member'
			})
		).toBe('?limit=50&cursor=c&action=music.upload&actor_kind=member');
	});

	it('summarises detail one line, nested values as JSON', () => {
		expect(auditDetailSummary({ version: 2, changes: { a: 1 } })).toBe(
			'version: 2 · changes: {"a":1}'
		);
	});
});

describe('tenant music upload form', () => {
	it('carries the multipart fields the API reads; blank optionals are omitted', () => {
		const file = new File(['x'], 'a.mp3');
		const fd = tenantMusicForm({ file, rightsAttested: true, category: 'ambient', slug: '  ' });
		expect(fd.get('file')).toBeInstanceOf(File);
		expect(fd.get('rights_attested')).toBe('true');
		expect(fd.get('category')).toBe('ambient');
		expect(fd.has('slug')).toBe(false);
		expect(fd.has('description')).toBe(false);
	});
});

describe('limit value text', () => {
	it('null is "Not set", lists join, an empty list is "None"', () => {
		const base = { key: 'k', source: 'licence' as const, enforced: false, note: '' };
		expect(limitValueText({ ...base, value: null })).toBe('Not set');
		expect(limitValueText({ ...base, value: ['tts', 'llm'] })).toBe('tts, llm');
		expect(limitValueText({ ...base, value: [] })).toBe('None');
		expect(limitValueText({ ...base, value: 0 })).toBe('0');
	});

	it('a null LICENCE value is "Unknown" when the licence could not be read, never "Not set"', () => {
		const base = { key: 'k', enforced: false, note: '', value: null };
		expect(limitValueText({ ...base, source: 'licence' }, 'unavailable')).toBe('Unknown');
		expect(limitValueText({ ...base, source: 'licence' }, 'no_active_licence')).toBe('Unknown');
		expect(limitValueText({ ...base, source: 'licence' }, 'ok')).toBe('Not set');
		expect(limitValueText({ ...base, source: 'provider_policy' }, 'unavailable')).toBe('Not set');
	});

	it('licence_lookup not_onboarded reads as the contact-your-administrator copy', () => {
		const base = { key: 'k', enforced: false, note: '', value: null, source: 'licence' as const };
		expect(limitValueText(base, 'not_onboarded')).toBe('Unknown');
		expect(LICENCE_LOOKUP_TEXT.not_onboarded).toBe(
			"This workspace isn't set up for Studio yet — contact your administrator."
		);
	});
});

describe('audit action filter', () => {
	it('offers every backend AuditAction, including offboarding.reject', async () => {
		const { TENANT_AUDIT_ACTIONS } = await import('./tenant-audit.js');
		expect(TENANT_AUDIT_ACTIONS).toContain('offboarding.reject');
		expect(new Set(TENANT_AUDIT_ACTIONS).size).toBe(TENANT_AUDIT_ACTIONS.length);
	});

	it('labels the partner + licence-token actions for humans, raw value for unknown ones', async () => {
		const { TENANT_AUDIT_ACTIONS, auditActionLabel } = await import('./tenant-audit.js');
		expect(TENANT_AUDIT_ACTIONS).toEqual(
			expect.arrayContaining([
				'tenant.partner_bind',
				'tenant.licence_token_set',
				'connection.bulk_set'
			])
		);
		expect(auditActionLabel('tenant.licence_token_set')).toBe('Licence token set');
		expect(auditActionLabel('tenant.partner_bind')).toBe('Bound to partner');
		expect(auditActionLabel('some.future_action')).toBe('some.future_action');
	});
});

import { describe, expect, it } from 'vitest';
import { accountInitials, accountLabel } from './display-name';

const SUBJECT = '01a0dd02-d324-77bb-acd8-7c31fb6e95ec';

describe('accountLabel', () => {
	it('prefers the real name', () => {
		expect(accountLabel({ sub: 'u1', name: 'Ada Lovelace', email: 'ada@acme.test' })).toEqual({
			label: 'Ada Lovelace',
			human: true
		});
	});

	it('skips a name that is the subject id (licence-token /auth/me) for the email', () => {
		const u = {
			subject_id: SUBJECT,
			name: SUBJECT,
			preferred_username: SUBJECT,
			email: 'ada@acme.test'
		};
		expect(accountLabel(u).label).toBe('ada@acme.test');
	});

	it('skips any UUID-shaped name even when no id field is present', () => {
		expect(accountLabel({ name: SUBJECT, preferred_username: 'ada' }).label).toBe('ada');
	});

	it('falls back to the subject id only when nothing else exists', () => {
		expect(accountLabel({ subject_id: SUBJECT, name: SUBJECT, email: null })).toEqual({
			label: SUBJECT,
			human: false
		});
	});

	it('says Account for no user', () => {
		expect(accountLabel(null).label).toBe('Account');
	});
});

describe('accountInitials', () => {
	it('uses first + last initial of a real name', () => {
		expect(accountInitials({ name: 'Ada Lovelace' })).toBe('AL');
	});

	it('never shows the first hex digit of a UUID', () => {
		expect(accountInitials({ subject_id: SUBJECT, name: SUBJECT })).toBe('?');
		expect(accountInitials({ name: SUBJECT, email: 'ada@acme.test' })).toBe('AD');
	});
});

import { describe, expect, it } from 'vitest';
import {
	NEEDS_REVIEW,
	PAUSED,
	formatDateTimeWithZone,
	isReviewPause,
	pauseLabel,
	pausedSince,
	reviewWaitSentence,
	reviewWaitShort,
	runStatusLabel
} from './review-wait';

const PAUSED_AT = '2026-10-26T07:15:21Z';
const NOW = new Date('2026-10-27T12:10:51Z').getTime();

describe('review-wait', () => {
	it('one name per state: a checkpoint pause needs review, a manual pause is paused', () => {
		expect(NEEDS_REVIEW).toBe('Needs review');
		expect(PAUSED).toBe('Paused');
		expect(pauseLabel('paused', 'checkpoint')).toBe(NEEDS_REVIEW);
		expect(pauseLabel('paused', 'manual')).toBe(PAUSED);
		// Paused before the orchestrator recorded why (0102 backfill: `unknown`), or no
		// reason at all: a neutral "Paused" — never a guess at review.
		expect(pauseLabel('paused', 'unknown')).toBe(PAUSED);
		expect(pauseLabel('paused', null)).toBe(PAUSED);
		expect(pauseLabel('paused')).toBe(PAUSED);
		expect(isReviewPause('paused', 'unknown')).toBe(false);
		expect(pauseLabel('running', 'manual')).toBeNull();
		expect(isReviewPause('paused', 'manual')).toBe(false);
		expect(isReviewPause('paused', 'checkpoint')).toBe(true);
	});

	it('labels every run status in words', () => {
		expect(runStatusLabel('running')).toBe('Running');
		expect(runStatusLabel('pending')).toBe('Pending');
		expect(runStatusLabel('paused', 'checkpoint')).toBe('Needs review');
		expect(runStatusLabel('paused', 'manual')).toBe('Paused');
		expect(runStatusLabel('cancelled')).toBe('Cancelled');
	});

	it('reports how long a checkpoint pause has waited (run 01a1770d: 29h at a storyboard gate)', () => {
		const run = { status: 'paused', paused_at: PAUSED_AT, pause_reason: 'checkpoint' as const };
		expect(pausedSince(run)).toBe(PAUSED_AT);
		expect(reviewWaitShort(run, NOW)).toBe('since 1d ago');
		const sentence = reviewWaitSentence(run, NOW);
		expect(sentence).toContain('Needs review since');
		expect(sentence).toContain(formatDateTimeWithZone(PAUSED_AT));
		expect(sentence).toContain('(1d ago)');
		expect(sentence).toContain('Nothing continues until you approve it or cancel the run.');
	});

	it('a manual pause never says review', () => {
		const run = { status: 'paused', paused_at: PAUSED_AT, pause_reason: 'manual' as const };
		const sentence = reviewWaitSentence(run, NOW) ?? '';
		expect(sentence.startsWith('Paused since')).toBe(true);
		expect(sentence).not.toMatch(/review/i);
	});

	it('the age follows the clock it is given (a ticking clock keeps it true)', () => {
		const run = { status: 'paused', paused_at: '2026-10-27T12:00:00Z' };
		const t0 = new Date('2026-10-27T12:01:00Z').getTime();
		expect(reviewWaitShort(run, t0)).toBe('since 1m ago');
		expect(reviewWaitShort(run, t0 + 9 * 60_000)).toBe('since 10m ago');
	});

	it('labels the absolute time with its time zone', () => {
		// Whatever zone the test runner is in, the label carries one: a bare local
		// time is ambiguous to a reader in another zone.
		const label = formatDateTimeWithZone(PAUSED_AT);
		const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
			.formatToParts(new Date(PAUSED_AT))
			.find((p) => p.type === 'timeZoneName')?.value;
		expect(zone).toBeTruthy();
		expect(label).toContain(zone as string);
	});

	it.each(['cancelled', 'failed', 'completed', 'running', 'pending'])(
		'never reports a wait for a %s run, even with a stale paused_at',
		(status) => {
			const run = { status, paused_at: PAUSED_AT, pause_reason: 'checkpoint' as const };
			expect(pausedSince(run)).toBeNull();
			expect(reviewWaitShort(run, NOW)).toBeNull();
			expect(reviewWaitSentence(run, NOW)).toBeNull();
		}
	);

	it('says nothing rather than inventing a time when paused_at is missing or invalid', () => {
		expect(pausedSince({ status: 'paused' })).toBeNull();
		expect(pausedSince({ status: 'paused', paused_at: null })).toBeNull();
		expect(pausedSince({ status: 'paused', paused_at: 'not-a-date' })).toBeNull();
	});
});

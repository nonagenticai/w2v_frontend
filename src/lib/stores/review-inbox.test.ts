// Behaviour of the review-inbox store and the bell that owns its poll. The transport is
// injected so each test controls response ordering; what is under test is the store's
// own logic: link building, dismiss semantics, the stale-response guard and poll
// teardown.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

import Bell from '$lib/layout/ReviewInboxBell.svelte';
import {
	ReviewInbox,
	reviewHref,
	reviewInboxStore,
	waitingLabel,
	type ReviewInboxItem
} from './review-inbox.svelte';

function item(over: Partial<ReviewInboxItem> = {}): ReviewInboxItem {
	return {
		run_id: 'r-1',
		project_id: 'p-1',
		project_title: 'Promo',
		deliverable_name: null,
		stage_name: 'storyboard',
		paused_at: '2026-10-26T07:15:21Z',
		reminder: false,
		...over
	};
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

describe('reviewHref', () => {
	it('links to the checkpoint stage page', () => {
		expect(reviewHref(item())).toBe('/projects/p-1/runs/r-1/stages/storyboard');
	});

	it('falls back to the run page when the server names no stage', () => {
		expect(reviewHref(item({ stage_name: null }))).toBe('/projects/p-1/runs/r-1');
	});

	it('encodes a stage name that is not URL-safe', () => {
		expect(reviewHref(item({ stage_name: 'a/b' }))).toBe('/projects/p-1/runs/r-1/stages/a%2Fb');
	});
});

describe('ReviewInbox.dismiss', () => {
	it('removes only the dismissed run after the server accepts', async () => {
		const dismiss = vi.fn().mockResolvedValue(undefined);
		const inbox = new ReviewInbox({ list: vi.fn(), dismiss });
		inbox.items = [item({ run_id: 'a' }), item({ run_id: 'b' })];

		await inbox.dismiss('a');

		expect(dismiss).toHaveBeenCalledWith('a', false);
		expect(inbox.items.map((i) => i.run_id)).toEqual(['b']);
		expect(inbox.count).toBe(1);
	});

	it('drops a stale notice on 404 (run no longer waiting) but keeps it on other errors', async () => {
		const inbox = new ReviewInbox({
			list: vi.fn(),
			dismiss: vi
				.fn()
				.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
				.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
		});
		inbox.items = [item({ run_id: 'a' }), item({ run_id: 'b' })];

		await inbox.dismiss('a');
		await inbox.dismiss('b');

		expect(inbox.items.map((i) => i.run_id)).toEqual(['b']);
	});

	it('ignores a list response that started before the dismiss', async () => {
		const pending = deferred<ReviewInboxItem[]>();
		const inbox = new ReviewInbox({
			list: vi.fn().mockReturnValue(pending.promise),
			dismiss: vi.fn().mockResolvedValue(undefined)
		});
		inbox.items = [item({ run_id: 'a' })];

		const refreshing = inbox.refresh();
		await inbox.dismiss('a');
		pending.resolve([item({ run_id: 'a' })]); // pre-dismiss snapshot
		await refreshing;

		expect(inbox.items).toEqual([]);
	});

	it('ignores a list response that started WHILE the dismiss call was in flight', async () => {
		const dismissing = deferred<void>();
		const listing = deferred<ReviewInboxItem[]>();
		const inbox = new ReviewInbox({
			list: vi.fn().mockReturnValue(listing.promise),
			dismiss: vi.fn().mockReturnValue(dismissing.promise)
		});
		inbox.items = [item({ run_id: 'a' })];

		const dismissed = inbox.dismiss('a');
		const refreshing = inbox.refresh(); // poll fires mid-dismiss
		dismissing.resolve();
		await dismissed;
		listing.resolve([item({ run_id: 'a' })]); // server snapshot from before the dismiss landed
		await refreshing;

		expect(inbox.items).toEqual([]);
	});

	it('tells the server when the dismissed item was the reminder', async () => {
		const dismiss = vi.fn().mockResolvedValue(undefined);
		const inbox = new ReviewInbox({ list: vi.fn(), dismiss });
		inbox.items = [item({ run_id: 'a', reminder: true })];

		await inbox.dismiss('a', true);

		expect(dismiss).toHaveBeenCalledWith('a', true);
	});

	it('a second Dismiss while the first is in flight sends nothing', async () => {
		const call = deferred<void>();
		const dismiss = vi.fn().mockReturnValue(call.promise);
		const inbox = new ReviewInbox({ list: vi.fn(), dismiss });
		inbox.items = [item({ run_id: 'a' })];

		const first = inbox.dismiss('a');
		expect(inbox.dismissing.has('a')).toBe(true);
		await inbox.dismiss('a');
		call.resolve();
		await first;

		expect(dismiss).toHaveBeenCalledTimes(1);
		expect(inbox.dismissing.has('a')).toBe(false);
	});
});

describe('waitingLabel', () => {
	const now = Date.parse('2026-10-26T10:15:21Z');
	it('says how long, without "since … ago"', () => {
		expect(waitingLabel('2026-10-26T07:15:21Z', now)).toBe('waiting 3h');
	});
	it('says "just paused" under a minute', () => {
		expect(waitingLabel('2026-10-26T10:15:00Z', now)).toBe('just paused');
	});
});

describe('ReviewInbox.refresh ordering', () => {
	it('an older overlapping refresh that resolves last does not overwrite the newer one', async () => {
		const older = deferred<ReviewInboxItem[]>();
		const newer = deferred<ReviewInboxItem[]>();
		const inbox = new ReviewInbox({
			list: vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise),
			dismiss: vi.fn()
		});

		const first = inbox.refresh(); // interval tick
		const second = inbox.refresh(); // visibilitychange
		newer.resolve([item({ run_id: 'b' })]);
		await second;
		older.resolve([item({ run_id: 'a' })]);
		await first;

		expect(inbox.items.map((i) => i.run_id)).toEqual(['b']);
	});
});

describe('ReviewInbox polling', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('keeps the last list when a poll fails', async () => {
		const list = vi.fn().mockResolvedValueOnce([item()]).mockRejectedValueOnce(new Error('503'));
		const inbox = new ReviewInbox({ list, dismiss: vi.fn() });
		await inbox.refresh();
		await inbox.refresh();
		expect(inbox.count).toBe(1);
	});

	it('the stop function ends the poll', async () => {
		const list = vi.fn().mockResolvedValue([]);
		const inbox = new ReviewInbox({ list, dismiss: vi.fn() });

		const stop = inbox.startPolling(1000);
		await vi.advanceTimersByTimeAsync(2500);
		expect(list).toHaveBeenCalledTimes(3); // immediate + 2 ticks

		stop();
		await vi.advanceTimersByTimeAsync(5000);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(list).toHaveBeenCalledTimes(3);
	});

	it('unmounting the bell stops the poll it started', async () => {
		const list = vi.spyOn(reviewInboxStore, 'refresh').mockResolvedValue();

		const { unmount } = render(Bell);
		await vi.advanceTimersByTimeAsync(60_000 * 2 + 10);
		const whileMounted = list.mock.calls.length;
		expect(whileMounted).toBe(3);

		unmount();
		await vi.advanceTimersByTimeAsync(60_000 * 5);
		expect(list.mock.calls.length).toBe(whileMounted);
		list.mockRestore();
	});
});

// "Needs your review" inbox (Svelte 5 runes).
//
// Why: run 01a1770d waited 29h at its storyboard checkpoint because nobody knew it was
// waiting. The orchestrator derives the inbox from the run rows (GET /api/review-inbox);
// this store polls it so the top-bar bell and the dashboard / project-list banners show
// every run the caller owns that is paused at a review checkpoint.
//
// The poll is owned by the Header (mounted only inside the authenticated app shell), in
// the same shape as the licence poll in +layout.svelte: an interval plus a refresh when
// the tab becomes visible, both torn down by the returned stop function.

import { SvelteSet } from 'svelte/reactivity';
import { resolve } from '$app/paths';
import { reviewInbox, type ReviewInboxItem } from '$lib/api/review-inbox.js';
import { formatRelativeTime } from '$lib/utils/format';
import { toastError } from './toast.svelte.js';

export type { ReviewInboxItem };

export const REVIEW_INBOX_POLL_MS = 60_000;

type Transport = Pick<typeof reviewInbox, 'list' | 'dismiss'>;

/** The checkpoint's review page; the run page when the server did not name the stage. */
export function reviewHref(item: ReviewInboxItem): string {
	return item.stage_name
		? resolve(
				`/projects/${item.project_id}/runs/${item.run_id}/stages/${encodeURIComponent(item.stage_name)}`
			)
		: resolve(`/projects/${item.project_id}/runs/${item.run_id}`);
}

/** How long the run has been waiting: "waiting 3h", or "just paused" under a minute. */
export function waitingLabel(pausedAt: string, now: number = Date.now()): string {
	const rel = formatRelativeTime(pausedAt, now);
	return rel === 'just now' ? 'just paused' : `waiting ${rel.replace(/ ago$/, '')}`;
}

function statusOf(err: unknown): number {
	return err && typeof err === 'object' && 'status' in err
		? Number((err as { status: unknown }).status)
		: 0;
}

export class ReviewInbox {
	items = $state<ReviewInboxItem[]>([]);
	/** Run ids whose dismiss call is in flight — their Dismiss buttons are disabled. */
	readonly dismissing = new SvelteSet<string>();
	// A list response is applied only if nothing has bumped this since its request
	// started. Bumped by every refresh (overlapping polls — the interval plus
	// visibilitychange — can resolve out of order; only the newest may land) and on both
	// sides of a dismiss (a list that started before OR during the dismiss call predates
	// the dismissal and must not re-add the notice the user just hid).
	#generation = 0;

	constructor(private readonly transport: Transport = reviewInbox) {}

	get count(): number {
		return this.items.length;
	}

	async refresh(): Promise<void> {
		const started = ++this.#generation;
		try {
			const items = await this.transport.list();
			if (started === this.#generation) this.items = items;
		} catch {
			// A background poll never toasts: keep the last list and try again next tick.
		}
	}

	/** `reminder`: the item was shown flagged `reminder` — dismissing it is final for this
	 * pause. A plain dismiss lets the server's 24h reminder still come back. */
	async dismiss(runId: string, reminder = false): Promise<void> {
		if (this.dismissing.has(runId)) return;
		this.dismissing.add(runId);
		this.#generation++;
		try {
			await this.transport.dismiss(runId, reminder);
		} catch (err) {
			// 404 = the run is no longer waiting (resumed, cancelled) or not ours: the
			// notice is stale either way, so it goes. Anything else keeps it visible.
			if (statusOf(err) !== 404) {
				toastError('Could not dismiss the notice', err instanceof Error ? err.message : undefined);
				return;
			}
		} finally {
			// A poll that started while the dismiss call was in flight predates it too.
			this.#generation++;
			this.dismissing.delete(runId);
		}
		this.items = this.items.filter((i) => i.run_id !== runId);
	}

	/** Start polling; returns the stop function (use it as an effect/onMount cleanup). */
	startPolling(intervalMs: number = REVIEW_INBOX_POLL_MS): () => void {
		void this.refresh();
		const timer = setInterval(() => void this.refresh(), intervalMs);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void this.refresh();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	}
}

export const reviewInboxStore = new ReviewInbox();

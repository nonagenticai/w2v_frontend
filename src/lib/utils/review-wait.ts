// One vocabulary for a paused run, and how long it has waited.
//
// A run pauses for one of two reasons, and they mean different things to the person
// looking at it:
//   * `checkpoint` — a review gate tripped; nothing continues until someone approves
//     the stage output. Every surface calls this NEEDS REVIEW (one name: the project
//     card, the deliverable, the operator pane, the run page and its banner).
//   * `manual` — someone pressed Pause (POST /runs/{id}/pause). It is just PAUSED;
//     there is nothing to review and it must never say otherwise.
//   * `unknown` (or no reason at all) — paused before the orchestrator recorded why
//     (migration 0102) and its rows could not tell. Neutral PAUSED: never guess review.
//
// Why the time matters: run 01a1770d (2026-10-26/27) waited 29h at a storyboard
// checkpoint while every surface aged it from `started_at`; it read as a run stuck
// executing for a day and was cancelled as stuck. `paused_at` (null unless paused)
// is when the wait began.
import { formatRelativeTime } from './format';

export const NEEDS_REVIEW = 'Needs review';
export const PAUSED = 'Paused';

export type PauseReason = 'checkpoint' | 'manual' | 'unknown';

/** Anything carrying a run status and, from the orchestrator, `paused_at` /
 *  `pause_reason`. `status` is required so the shape is never "weak". */
export interface PausableRun {
	status: string;
	paused_at?: string | null;
	pause_reason?: PauseReason | null;
}

/** True for a paused run that is waiting for a person to approve a checkpoint. */
export function isReviewPause(
	status: string | null | undefined,
	reason?: PauseReason | null
): boolean {
	return status === 'paused' && reason === 'checkpoint';
}

/** "Needs review" / "Paused" for a paused run; null for any other status. */
export function pauseLabel(
	status: string | null | undefined,
	reason?: PauseReason | null
): typeof NEEDS_REVIEW | typeof PAUSED | null {
	if (status !== 'paused') return null;
	return reason === 'checkpoint' ? NEEDS_REVIEW : PAUSED;
}

/** Human label for a RUN status (pending/running/paused/completed/failed/cancelled). */
export function runStatusLabel(status: string, reason?: PauseReason | null): string {
	const paused = pauseLabel(status, reason);
	if (paused) return paused;
	return status ? status[0].toUpperCase() + status.slice(1) : status;
}

/** When the run began waiting, or null when it is not paused (or the orchestrator did
 *  not say). A terminal run never reports a stale pause. */
export function pausedSince(run: PausableRun): string | null {
	if (run.status !== 'paused') return null;
	const at = run.paused_at;
	if (!at || Number.isNaN(new Date(at).getTime())) return null;
	return at;
}

/** Absolute local time WITH its zone, e.g. "26 Oct 2026, 08:15 CET" — a bare local
 *  time is ambiguous the moment the reader is in another zone than the writer. */
export function formatDateTimeWithZone(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short'
	});
}

/** Short age beside a status pill: "since 1d ago" (the pill already names the state,
 *  "Needs review" or "Paused"). Null when not paused or unknown. Pass the ticking
 *  clock (`useNow().current`) so it stays true while the page is open. */
export function reviewWaitShort(run: PausableRun, now: number = Date.now()): string | null {
	const at = pausedSince(run);
	return at ? `since ${formatRelativeTime(at, now)}` : null;
}

/** The banner line: "Needs review since 26 Oct 2026, 08:15 CET (1d ago)." for a
 *  checkpoint pause, "Paused since … " for a manual one. Null when unknown. */
export function reviewWaitSentence(run: PausableRun, now: number = Date.now()): string | null {
	const at = pausedSince(run);
	if (!at) return null;
	const when = `${formatDateTimeWithZone(at)} (${formatRelativeTime(at, now)})`;
	return isReviewPause(run.status, run.pause_reason)
		? `${NEEDS_REVIEW} since ${when}. Nothing continues until you approve it or cancel the run.`
		: `${PAUSED} since ${when}. Resume it to continue.`;
}

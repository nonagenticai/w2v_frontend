// One place for how a project status reads and is coloured. The dashboard,
// the project gallery and the child-project list all render the same Pill.
import type { ProjectStatus } from '$lib/types';
import { NEEDS_REVIEW, PAUSED, type PauseReason } from './review-wait';

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
	drafting: 'Draft',
	producing: 'In production',
	completed: 'Completed',
	failed: 'Failed',
	archived: 'Archived'
};

/** A `producing` project whose latest run is paused is not "in production" —
 *  nothing moves. Cards carry `last_run_status` and `last_run_pause_reason`, so they
 *  can say which: parked at a checkpoint ⇒ "Needs review"; anything else (someone
 *  pressed Pause, or a pause 0102 could not classify) ⇒ "Paused". */
function pausedLabel(
	status: string,
	lastRunStatus?: string | null,
	lastRunPauseReason?: PauseReason | null
): string | null {
	if (status !== 'producing' || lastRunStatus !== 'paused') return null;
	return lastRunPauseReason === 'checkpoint' ? NEEDS_REVIEW : PAUSED;
}

/** Human label for a project status; an unknown value is shown as-is, never hidden.
 *  Pass the card's `last_run_status` (+ `last_run_pause_reason`) so a paused run
 *  reads "Needs review" or "Paused". */
export function projectStatusLabel(
	status: string,
	lastRunStatus?: string | null,
	lastRunPauseReason?: PauseReason | null
): string {
	return (
		pausedLabel(status, lastRunStatus, lastRunPauseReason) ??
		PROJECT_STATUS_LABELS[status as ProjectStatus] ??
		status
	);
}

export function projectStatusTone(
	status: string,
	lastRunStatus?: string | null,
	lastRunPauseReason?: PauseReason | null
): PillTone {
	if (pausedLabel(status, lastRunStatus, lastRunPauseReason)) return 'warning';
	switch (status) {
		case 'producing':
			return 'accent';
		case 'completed':
			return 'success';
		case 'failed':
			return 'danger';
		case 'archived':
			return 'warning';
		default:
			return 'neutral';
	}
}

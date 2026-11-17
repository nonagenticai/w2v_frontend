/**
 * Cost display that cannot lie about an unknown cost.
 *
 * The orchestrator reports `cost_status: "unavailable"` (with a
 * `cost_unavailable_reason`) when it could not read a run's cost from billing —
 * e.g. `billing_credential_missing`. Run detail then sends `cost_usd: null`; the
 * admin overview/usage aggregates still send a number, but it is only a LOWER
 * BOUND (the cost already mirrored locally). Either way an unknown cost must
 * render as "Cost unavailable", never as `$0.00` / a partial sum, and a null
 * figure must never reach `.toFixed()`.
 */

export type CostStatus = 'ok' | 'unavailable';

export const COST_UNAVAILABLE_LABEL = 'Cost unavailable';

const REASON_TEXT: Record<string, string> = {
	billing_credential_missing:
		'The billing service could not be queried: no billing credential is configured.'
};

/** Human text for a `cost_unavailable_reason`; unknown codes are shown verbatim. */
export function costUnavailableReasonText(reason: string | null | undefined): string {
	if (!reason) return 'The cost could not be read from billing.';
	return REASON_TEXT[reason] ?? `The cost could not be read from billing (${reason}).`;
}

export interface CostDisplay {
	/** What to render in place of the figure. */
	text: string;
	/** True when the cost is unknown — `text` is the unavailable label. */
	unavailable: boolean;
	/** Tooltip: the reason when unavailable, otherwise undefined. */
	title: string | undefined;
}

/**
 * Render a cost figure honouring `cost_status`.
 *
 * `status === 'unavailable'` OR a null/undefined/non-finite figure ⇒ "Cost
 * unavailable" (a missing number is unknown, not zero). `lowerBound`, when the
 * caller has a partial figure (admin aggregates), is appended to the tooltip.
 */
export function formatCost(
	costUsd: number | null | undefined,
	status: CostStatus | null | undefined = 'ok',
	reason: string | null | undefined = null,
	{ digits = 4, lowerBound }: { digits?: number; lowerBound?: number | null } = {}
): CostDisplay {
	const known = typeof costUsd === 'number' && Number.isFinite(costUsd);
	if (status === 'unavailable' || !known) {
		let title =
			status === 'unavailable' ? costUnavailableReasonText(reason) : 'No cost figure was reported.';
		if (typeof lowerBound === 'number' && Number.isFinite(lowerBound)) {
			title += ` Cost already recorded locally: at least $${lowerBound.toFixed(digits)}.`;
		}
		return { text: COST_UNAVAILABLE_LABEL, unavailable: true, title };
	}
	return { text: `$${costUsd.toFixed(digits)}`, unavailable: false, title: undefined };
}

/**
 * Who served a usage row: a tenant provider connection (pinned version) or the
 * platform path. Both connection fields null/absent = platform.
 */
export function usageAttribution(row: {
	connection_id?: string | null;
	connection_version?: number | null;
}): string {
	if (row.connection_id && typeof row.connection_version === 'number') {
		return `tenant connection v${row.connection_version}`;
	}
	return 'platform';
}

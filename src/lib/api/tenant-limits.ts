/**
 * Tenant limits, read-only (P6 ORCH-3) — `GET /api/tenant/limits`, tenant_admin only.
 *
 * Every limit says whether anything in this deployment actually refuses work on it
 * (`enforced`) and where (`enforced_at`). Licence quotas are reported but NOT
 * enforced by w2v today; the screen must say so rather than imply a cap. There is
 * no write route (limits are operator / super-admin owned).
 *
 * Hand-mirrored from `src/api/schemas/tenant_limits.py` because the pinned OpenAPI
 * package predates the route; names avoid the generated `TenantLimit` /
 * `TenantLimitsView` (type-drift-check rule 2). Alias them on the next codegen bump.
 */

import { api } from './client.js';
import { TENANT_NOT_ONBOARDED_MESSAGE } from './onboarding.js';

export type LicenceLookupState =
	| 'ok'
	| 'no_active_licence'
	| 'multiple_active_licences'
	| 'not_onboarded'
	| 'unavailable';

/** `TenantLimit`. */
export interface TenantLimitRow {
	/** Stable id, e.g. `licence.quota_monthly` / `provider.byo_required`. */
	key: string;
	source: 'licence' | 'provider_policy';
	/** A number, a list of names, or null (unset / unknown). */
	value?: number | string[] | null;
	unit?: string | null;
	/** True only when a code path refuses work on it today. */
	enforced: boolean;
	enforced_at?: string | null;
	note: string;
}

/** `TenantLimitsView`. */
export interface TenantLimitsReport {
	tenant_id: string;
	licence_lookup: LicenceLookupState;
	plan_code?: string | null;
	/** Always false: there is no write route. */
	editable: false;
	limits: TenantLimitRow[];
}

export const tenantLimits = {
	get(): Promise<TenantLimitsReport> {
		return api.get<TenantLimitsReport>('/tenant/limits');
	}
};

const LIMIT_LABELS: Record<string, string> = {
	'licence.quota_monthly': 'Monthly request quota',
	'licence.token_budget_monthly': 'Monthly token budget',
	'provider.byo_required': 'Slots you must bring your own provider for',
	'provider.allowed_kinds': 'Allowed provider kinds',
	'provider.test_rate_limit': 'Provider connection tests'
};

export function limitLabel(key: string): string {
	return LIMIT_LABELS[key] ?? key;
}

/** The limit's value as display text. A `null` licence value is "Unknown" when
 *  the licence could not be read (`licence_lookup !== 'ok'`) — never "Not set". */
export function limitValueText(row: TenantLimitRow, lookup: LicenceLookupState = 'ok'): string {
	const v = row.value;
	if (v == null) return row.source === 'licence' && lookup !== 'ok' ? 'Unknown' : 'Not set';
	if (Array.isArray(v)) return v.length ? v.join(', ') : 'None';
	return v.toLocaleString();
}

export const LICENCE_LOOKUP_TEXT: Record<LicenceLookupState, string> = {
	ok: '',
	no_active_licence: 'No active Studio licence was found for this workspace.',
	multiple_active_licences:
		'More than one active Studio licence exists, so no plan could be chosen.',
	not_onboarded: TENANT_NOT_ONBOARDED_MESSAGE,
	unavailable: 'The licence plan could not be read right now; licence limits are unknown.'
};

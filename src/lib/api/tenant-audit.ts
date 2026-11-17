/**
 * Tenant-scoped audit view (P6 ORCH-5) — `GET /api/tenant/audit`, tenant_admin only.
 *
 * Rows whose TARGET is the effective tenant, newest first, keyset paged
 * (`next_cursor`, opaque). A member of the tenant is named (`actor_kind: member`,
 * `actor_label` = their email); anyone else — a super_admin acting into the
 * tenant, a partner, the platform — is `platform_operator` with no subject id.
 * `detail` is already scrubbed of secret-named keys server-side.
 *
 * Hand-mirrored from `src/api/schemas/tenant_audit.py` (the pinned OpenAPI package
 * predates the route); names avoid the generated `TenantAuditEntry` /
 * `TenantAuditPage` / `AuditAction` / `ActorKind`. Alias them on the next codegen bump.
 */

import { api } from './client.js';
import type { operations } from './types.gen.js';

/** Every `admin_audit_log.action` value (`AuditAction`, = the `ck_admin_audit_action` set), from the generated OpenAPI types. */
export type AuditAction = Exclude<
	NonNullable<NonNullable<operations['tenant.audit.list']['parameters']['query']>['action']>,
	null
>;

/**
 * Human label for every audit action. Typed as a total `Record` over the generated
 * union, so a new backend action fails `svelte-check` until it gets a label here —
 * the action filters can no longer silently drift behind the orchestrator.
 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
	'tenant.update': 'Tenant updated',
	'scope.switch': 'Scope switched',
	'scope.reset': 'Scope reset',
	'member.grant_role': 'Member role granted',
	'member.revoke_role': 'Member role revoked',
	'member.invite': 'Member invited',
	'member.remove': 'Member removed',
	'member.set_role': 'Member role set',
	'invite.revoke': 'Invite revoked',
	'apikey.create': 'API key created',
	'apikey.revoke': 'API key revoked',
	'tenant.create': 'Tenant created',
	'connection.set': 'Connection set',
	'connection.clear_secret': 'Connection secret cleared',
	'connection.delete': 'Connection deleted',
	'connection.test': 'Connection tested',
	'connection.test_failed': 'Connection test failed',
	'connection.bulk_set': 'Connections set (bulk)',
	'youtube.oauth_client.set': 'YouTube OAuth client set',
	'youtube.oauth_client.clear': 'YouTube OAuth client cleared',
	'youtube.platform_channel.set': 'YouTube platform channel set',
	'youtube.tenant_policy.set': 'YouTube tenant policy set',
	'defaults.update': 'Defaults updated',
	'music.upload': 'Music uploaded',
	'music.update': 'Music updated',
	'music.delete': 'Music deleted',
	'offboarding.request': 'Offboarding requested',
	'offboarding.export': 'Offboarding export',
	'offboarding.delete': 'Offboarding delete',
	'offboarding.reject': 'Offboarding rejected',
	'tenant.partner_bind': 'Bound to partner',
	'tenant.licence_token_set': 'Licence token set',
	'run.cancel': 'Run cancelled',
	'signup.remove': 'Early-access workspace removed'
};

/** Every audit action, in label-map order (the filter's option list). */
export const TENANT_AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];

/** Label for a row's action; unknown (newer-than-pin) actions fall back to the raw value. */
export function auditActionLabel(action: string): string {
	return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;
}

export type TenantAuditActionName = AuditAction;
export type AuditActorKind = 'member' | 'platform_operator';

/** `TenantAuditEntry`. */
export interface TenantAuditRow {
	id: string;
	created_at: string;
	/** Withheld (null) for platform-operator rows. */
	actor_subject_id?: string | null;
	action: string;
	target_tenant_id?: string | null;
	detail?: Record<string, unknown>;
	actor_kind: AuditActorKind;
	/** Member email when known; `"platform operator"` otherwise. */
	actor_label?: string | null;
}

/** `TenantAuditPage`. */
export interface TenantAuditRows {
	items: TenantAuditRow[];
	limit: number;
	next_cursor?: string | null;
}

export interface TenantAuditQuery {
	limit?: number;
	cursor?: string | null;
	action?: TenantAuditActionName | null;
	actorKind?: AuditActorKind | null;
	/** A member's subject id. */
	actor?: string | null;
	/** Timezone-aware ISO datetimes; `until` exclusive. */
	since?: string | null;
	until?: string | null;
}

export function tenantAuditQueryString(q: TenantAuditQuery = {}): string {
	const p = new URLSearchParams();
	if (q.limit != null) p.set('limit', String(q.limit));
	if (q.cursor) p.set('cursor', q.cursor);
	if (q.action) p.set('action', q.action);
	if (q.actorKind) p.set('actor_kind', q.actorKind);
	if (q.actor) p.set('actor', q.actor);
	if (q.since) p.set('since', q.since);
	if (q.until) p.set('until', q.until);
	const qs = p.toString();
	return qs ? `?${qs}` : '';
}

export const tenantAudit = {
	list(q: TenantAuditQuery = {}): Promise<TenantAuditRows> {
		return api.get<TenantAuditRows>(`/tenant/audit${tenantAuditQueryString(q)}`);
	}
};

/** One-line rendering of `detail` (`key: value` pairs, nested values as JSON). */
export function auditDetailSummary(detail: Record<string, unknown>): string {
	return Object.entries(detail)
		.map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
		.join(' · ');
}

/**
 * Admin API client — the admin-tier read aggregates (Phase B).
 *
 * Backs the (platform) Tenants screen and the (tenant) Admin home with the two
 * orchestrator endpoints shipped in w2v_orchestrator#241:
 *   - GET /api/admin/tenants  (super_admin)  → tenants the orchestrator knows.
 *   - GET /api/admin/overview (tenant_admin) → the caller's-tenant aggregate.
 *
 * Both are role-gated server-side (403 → ApiError for the screens to render a
 * denied state). Wire keys are snake_case — these response types are declared
 * here because the admin schemas are not in the published orchestrator OpenAPI
 * yet; fold them into types.gen.ts on the next `npm run codegen` republish.
 */

import { api } from './client.js';
import type { components } from './types.gen.js';
import type { LlmAccessMode } from './providers.js';

type Schemas = components['schemas'];

export interface AdminTenantSummary {
	tenant_id: string;
	/** Human label set by a super_admin; null until named (UUID shown instead). */
	name?: string | null;
	/**
	 * 'active' | 'licence_lapsed' | 'suspended' | 'deleted'. Suspended and deleted
	 * (operator holds) block a super-admin scope-switch into it — see `switchable`.
	 */
	status?: string;
	project_count: number;
	last_activity: string | null;
	/** Per-tenant usage rollup (orchestrator#251); absent on the PATCH response. */
	run_count?: number;
	total_cost_usd?: number;
	/**
	 * Can a super_admin scope-switch into this tenant? False for an operator-held
	 * status (suspended / deleted) — the backend refuses the switch, so the
	 * tenant picker must not offer it. Absent on an orchestrator that predates it.
	 */
	switchable?: boolean;
}

export interface AdminTenantUpdate {
	name?: string | null;
	status?: 'active' | 'suspended';
}

export interface AdminTenantListResponse {
	items: AdminTenantSummary[];
	total: number;
}

/**
 * The caller's-tenant aggregate. `cost_status: 'unavailable'` (+
 * `cost_unavailable_reason`) ⇒ billing could not be read for not-yet-mirrored
 * runs and `total_cost_usd` is only a LOWER BOUND — render "Cost unavailable".
 */
export type AdminOverviewResponse = Schemas['AdminOverview'];

/** A persisted deliberate admin action (orchestrator#248). */
export interface AdminAuditEntry {
	id: string;
	created_at: string;
	/** The super_admin who acted; null if it couldn't be resolved. */
	actor_subject_id: string | null;
	/** 'tenant.update' | 'scope.switch' | 'scope.reset'. */
	action: string;
	/** The tenant the action targeted / switched into; null for a reset. */
	target_tenant_id: string | null;
	/** Action-specific payload: {before, after} for an update, {from_tenant} for a switch. */
	detail: Record<string, unknown>;
}

export interface AdminAuditListResponse {
	items: AdminAuditEntry[];
	total: number;
	limit: number;
	offset: number;
}

/**
 * One `request_audit` row — the middleware-wide per-request audit (orchestrator
 * #264, migration 0026): a mutation, an auth failure, or a cross-tenant access.
 * Wire keys are snake_case (the orchestrator schema has no camel alias generator).
 */
export interface RequestAuditEntry {
	id: string;
	created_at: string;
	/** The acting subject (`user.sub`); null if it couldn't be resolved. */
	actor_subject_id: string | null;
	/** The caller's tenant claim. */
	claim_tenant_id: string | null;
	/** The tenant actually operated in (claim, or a super-admin scope switch). */
	effective_tenant_id: string | null;
	/** A super-admin acting into a foreign tenant (even on a GET). */
	cross_tenant: boolean;
	/** 'mutation' | 'auth_failure' | 'read'. */
	event: string;
	method: string;
	path: string;
	resource: string | null;
	status_code: number;
	ip: string | null;
	duration_ms: number | null;
	credential_fingerprint: string | null;
	request_id: string | null;
	detail: Record<string, unknown>;
}

export interface RequestAuditListResponse {
	items: RequestAuditEntry[];
	total: number;
	limit: number;
	offset: number;
}

/** Tenant cost/token totals — the headline figures of the usage drill-down. */
export interface AdminUsageTotals {
	run_count: number;
	project_count: number;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
}

export interface AdminUsageByType {
	type: string;
	run_count: number;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
}

export interface AdminUsageByStage {
	stage_name: string;
	call_count: number;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
}

export interface AdminUsageByModel {
	model: string | null;
	provider: string | null;
	call_count: number;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
}

/** One daily bucket of the usage time-series (sparse — only days with usage). */
export interface AdminUsagePoint {
	/** ISO date, YYYY-MM-DD. */
	bucket: string;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
}

/**
 * Usage attributed to one subject (P6 ORCH-3, `AdminUsageByUser`). `subject_id`
 * null is the `"unattributed"` group (rows the backfill could not attribute);
 * `member_status` null = never a member (e.g. a service account); `removed`
 * members are kept. Named apart from the schema because the pinned OpenAPI
 * package predates it — alias `Schemas['AdminUsageByUser']` on the next bump.
 */
export interface UsageByUserRow {
	subject_id?: string | null;
	email?: string | null;
	member_status?: 'active' | 'removed' | null;
	/** Email, else the subject id, else "unattributed". */
	label: string;
	call_count: number;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
}

/**
 * Usage per provider slot (P6 ORCH-3, `AdminUsageBySlot`). `slot` is the tenant
 * connection's slot for tenant-BYO calls, `"platform"` for billing-mirrored calls
 * and `"unattributed"` otherwise. `units` sums the billable quantity per unit kind
 * (tokens/chars/images/seconds). Alias `Schemas['AdminUsageBySlot']` on the next bump.
 */
export interface UsageBySlotRow {
	slot: string;
	funding: 'local_gpu' | 'platform_external' | 'tenant_byo' | 'unattributed';
	call_count: number;
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
	units: Record<string, number>;
}

/** The cost/token drill-down behind the overview (orchestrator#250, #251). */
export interface AdminUsageDetailResponse {
	tenant_id: string;
	totals: AdminUsageTotals;
	by_type: AdminUsageByType[];
	by_stage: AdminUsageByStage[];
	by_model: AdminUsageByModel[];
	/** P6 ORCH-3; absent from an orchestrator that predates it. */
	by_user?: UsageByUserRow[];
	/** P6 ORCH-3; absent from an orchestrator that predates it. */
	by_slot?: UsageBySlotRow[];
	/** Daily cost/token series, oldest first (orchestrator#251). */
	time_series: AdminUsagePoint[];
	/**
	 * Same contract as `AdminOverviewResponse.cost_status`: 'unavailable' ⇒ every
	 * cost figure here excludes not-yet-mirrored runs whose cost could not be read.
	 */
	cost_status: Schemas['AdminUsageDetail']['cost_status'];
	cost_unavailable_reason?: Schemas['AdminUsageDetail']['cost_unavailable_reason'];
}

/** Super-admin provisioning input (orchestrator#262). `tenant_slug` ^[a-z0-9-]{2,40}$. */
export interface ProvisionUserInput {
	email: string;
	name: string;
	tenant_slug: string;
	workspace_role?: 'member' | 'tenant_admin';
	apps?: string[];
	/** Tenant service access (licences byo_mode); server default `local_allowed`. All three modes accepted. */
	llm_access?: LlmAccessMode;
}

/**
 * A tenant's LLM access (`GET|PUT /admin/tenants/{id}/llm-access`). `source` says
 * where the mode came from: the tenant's own setting, an app override, or the
 * licences default. Hand-written (non-colliding name) until the pinned OpenAPI
 * package carries the route.
 */
export interface TenantLlmAccessSetting {
	mode: LlmAccessMode;
	source?: 'tenant' | 'app_override' | 'default' | null;
}

/**
 * One-time provisioning result (P2 tenancy): licence tokens returned ONCE. There
 * is no temporary password any more — the first user gets a pending workspace
 * invite (`invite_id`) and sets their own credentials through Keycloak.
 * The response carries no account state: provisioning's identity invite API never
 * says whether the account already existed or whether an email was sent.
 */
export type ProvisionUserResult = Schemas['AdminProvisionResult'] & {
	/** Outcome of applying the LLM access after the tenant was created. `failed` = the
	 *  tenant exists but its posture was NOT set — fix it on the tenants page. */
	llm_access?: ProvisionLlmAccessOutcome | null;
};

export interface ProvisionLlmAccessOutcome {
	mode: LlmAccessMode;
	status: 'ok' | 'failed';
	detail?: string | null;
}

/**
 * One run in the cross-tenant operator run pane (orchestrator admin.runs.list) —
 * the GENERATED schema, so `paused_at` / `pause_reason` (orchestrator 0102) and any
 * future field arrive with codegen instead of being hand-typed here.
 */
export type AdminRunListItem = components['schemas']['AdminRunListItem'];

export interface AdminRunListResponse {
	items: AdminRunListItem[];
	total: number;
}

export const admin = {
	/** Platform: every tenant the orchestrator has seen a project from (super_admin). */
	tenants(): Promise<AdminTenantListResponse> {
		return api.get<AdminTenantListResponse>('/admin/tenants');
	},

	/**
	 * Platform: in-flight (pending/running/paused) runs across ALL tenants (super_admin) —
	 * the operator "what is running right now" pane. `status='recent'` lists the
	 * most-recently-updated terminal runs instead (bounded by `limit`).
	 */
	runs({
		status = 'running',
		limit = 100
	}: { status?: 'running' | 'recent'; limit?: number } = {}): Promise<AdminRunListResponse> {
		const params = new URLSearchParams({ status });
		if (status === 'recent') params.set('limit', String(limit));
		return api.get<AdminRunListResponse>(`/admin/runs?${params.toString()}`);
	},

	/** Platform: a tenant's LLM access mode (super_admin). */
	tenantLlmAccess(tenantId: string): Promise<TenantLlmAccessSetting> {
		return api.get<TenantLlmAccessSetting>(
			`/admin/tenants/${encodeURIComponent(tenantId)}/llm-access`
		);
	},

	/** Platform: set a tenant's LLM access mode (super_admin). 502 `licences_refused` is surfaced. */
	setTenantLlmAccess(tenantId: string, mode: LlmAccessMode): Promise<TenantLlmAccessSetting> {
		return api.put<TenantLlmAccessSetting>(
			`/admin/tenants/${encodeURIComponent(tenantId)}/llm-access`,
			{ mode }
		);
	},

	/** Platform: rename a tenant / set its status (super_admin). Upserts the registry row. */
	updateTenant(tenantId: string, body: AdminTenantUpdate): Promise<AdminTenantSummary> {
		return api.patch<AdminTenantSummary>(`/admin/tenants/${tenantId}`, body);
	},

	/** The caller's-tenant aggregate: project/run counts + total cost (tenant_admin). */
	overview(): Promise<AdminOverviewResponse> {
		return api.get<AdminOverviewResponse>('/admin/overview');
	},

	/**
	 * The cost/token drill-down for the effective tenant (tenant_admin): all-time
	 * totals + breakdowns by project type, usage stage, and model/provider.
	 * Honours the super-admin X-Active-Tenant-Id scope-switch server-side.
	 *
	 * `bucket` / `windowDays` reshape ONLY the time_series (a chart-axis zoom);
	 * the totals + breakdowns stay all-time. Both omitted ⇒ bare `/admin/usage`
	 * (server defaults: daily, all-time). `windowDays` null/undefined ⇒ all-time.
	 */
	usage({
		bucket,
		windowDays
	}: {
		bucket?: 'day' | 'week' | 'month';
		windowDays?: number | null;
	} = {}): Promise<AdminUsageDetailResponse> {
		const params = new URLSearchParams();
		if (bucket) params.set('bucket', bucket);
		if (windowDays != null) params.set('window_days', String(windowDays));
		const qs = params.toString();
		return api.get<AdminUsageDetailResponse>(`/admin/usage${qs ? `?${qs}` : ''}`);
	},

	/**
	 * Platform: the admin audit log, newest-first + paginated (super_admin).
	 * Optional filters: `action` (exact), `tenantId` (target tenant), `actorSubjectId`.
	 */
	auditLog({
		limit = 50,
		offset = 0,
		action,
		tenantId,
		actorSubjectId
	}: {
		limit?: number;
		offset?: number;
		action?: string;
		tenantId?: string;
		actorSubjectId?: string;
	} = {}): Promise<AdminAuditListResponse> {
		const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
		if (action) params.set('action', action);
		if (tenantId) params.set('tenant_id', tenantId);
		if (actorSubjectId) params.set('actor_subject_id', actorSubjectId);
		return api.get<AdminAuditListResponse>(`/admin/audit?${params.toString()}`);
	},

	/**
	 * Platform: the middleware-wide per-request audit (super_admin), newest-first +
	 * paginated. One row per mutation / auth-failure / cross-tenant access (#264).
	 * Filters (all optional, AND-ed): `event`, `method`, `crossTenant`,
	 * `effectiveTenantId`, `actorSubjectId`, `since`/`until` (ISO), `minStatus`.
	 */
	requestAudit({
		limit = 50,
		offset = 0,
		event,
		method,
		crossTenant,
		effectiveTenantId,
		actorSubjectId,
		since,
		until,
		minStatus
	}: {
		limit?: number;
		offset?: number;
		event?: string;
		method?: string;
		crossTenant?: boolean;
		effectiveTenantId?: string;
		actorSubjectId?: string;
		since?: string;
		until?: string;
		minStatus?: number;
	} = {}): Promise<RequestAuditListResponse> {
		const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
		if (event) params.set('event', event);
		if (method) params.set('method', method);
		if (crossTenant !== undefined) params.set('cross_tenant', String(crossTenant));
		if (effectiveTenantId) params.set('effective_tenant_id', effectiveTenantId);
		if (actorSubjectId) params.set('actor_subject_id', actorSubjectId);
		if (since) params.set('since', since);
		if (until) params.set('until', until);
		if (minStatus !== undefined) params.set('min_status', String(minStatus));
		return api.get<RequestAuditListResponse>(`/admin/request-audit?${params.toString()}`);
	},

	/**
	 * Record a deliberate super-admin scope switch (super_admin). `toTenantId`
	 * null = reset back to self. Best-effort from the switcher — the row is the
	 * durable record-of-intent.
	 */
	recordScopeSwitch(toTenantId: string | null): Promise<AdminAuditEntry> {
		return api.post<AdminAuditEntry>('/admin/scope-switch', { to_tenant_id: toTenantId });
	},

	/**
	 * Platform: provision a new tenant + its first user (super_admin). Returns
	 * the first user's invite id + per-app licence tokens, shown ONCE.
	 */
	provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
		return api.post<ProvisionUserResult>('/admin/provision', input);
	}
};

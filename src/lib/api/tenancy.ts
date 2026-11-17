/**
 * Tenancy API client (P2) — workspace membership, invites, API keys, rename.
 *
 * Membership is the orchestrator's own `tenant_members` table, not a Keycloak
 * realm role. Every type here is an ALIAS of the generated schema, so a backend
 * rename breaks the call sites instead of drifting silently (type-drift-check).
 *
 * Errors: tenancy routes answer with the canonical envelope and a STABLE
 * `error.code` (`LAST_TENANT_ADMIN`, `INVITE_GONE`, …) which `ApiError.code`
 * carries. Screens branch on the code via `tenancyErrorMessage`, never on the
 * human message text.
 */

import { api, ApiError } from './client.js';
import { TENANT_NOT_ONBOARDED, TENANT_NOT_ONBOARDED_MESSAGE } from './onboarding.js';
import type { components } from './types.gen.js';

type Schemas = components['schemas'];

export type MemberRole = Schemas['TenantMemberOut']['role'];
export type TenantMember = Schemas['TenantMemberOut'];
export type TenantMemberList = Schemas['TenantMemberList'];
export type TenantMemberRemoved = Schemas['TenantMemberRemoved'];
export type Invite = Schemas['InviteOut'];
export type InviteCreated = Schemas['InviteCreated'];
export type InviteList = Schemas['InviteList'];
export type InviteAccepted = Schemas['InviteAccepted'];
export type PendingInvite = Schemas['PendingInvite'];
export type MyTenant = Schemas['MyTenant'];
export type MyTenantList = Schemas['MyTenantList'];
export type TenantOut = Schemas['TenantOut'];
export type ApiKeySummary = Schemas['ApiKeySummary'];
export type ApiKeyList = Schemas['ApiKeyList'];
export type ApiKeyCreated = Schemas['ApiKeyCreated'];
export type ApiKeyCreate = Schemas['ApiKeyCreate'];
/** A grant a key may carry beyond the `member` role (P8). */
export type ApiKeyScope = NonNullable<ApiKeyCreate['scopes']>[number];

/** Every scope the API accepts, with the copy the create dialog shows. `Record` so a
 *  scope added to the schema fails the type check until it is described here. */
const API_KEY_SCOPE_COPY: Record<ApiKeyScope, { label: string; description: string }> = {
	'connections:write': {
		label: 'Write provider connections',
		description:
			"Lets the key replace this workspace's provider connections (PUT /api/tenant/connections), e.g. for a partner app that configures Studio for you."
	}
};
export const API_KEY_SCOPES: readonly ({ value: ApiKeyScope } & {
	label: string;
	description: string;
})[] = (Object.keys(API_KEY_SCOPE_COPY) as ApiKeyScope[]).map((value) => ({
	value,
	...API_KEY_SCOPE_COPY[value]
}));
export const apiKeyScopeLabel = (scope: string): string =>
	API_KEY_SCOPE_COPY[scope as ApiKeyScope]?.label ?? scope;

const seg = (id: string): string => encodeURIComponent(id);

export const tenancy = {
	// ─── Members (tenant_admin) ────────────────────────────────────────
	members({
		status,
		limit = 50,
		offset = 0
	}: {
		status?: 'active' | 'removed';
		limit?: number;
		offset?: number;
	} = {}): Promise<TenantMemberList> {
		const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
		if (status) params.set('status', status);
		return api.get<TenantMemberList>(`/tenant/members?${params.toString()}`);
	},
	setMemberRole(subjectId: string, role: MemberRole): Promise<TenantMember> {
		return api.patch<TenantMember>(`/tenant/members/${seg(subjectId)}`, { role });
	},
	removeMember(subjectId: string): Promise<TenantMemberRemoved> {
		return api.delete<TenantMemberRemoved>(`/tenant/members/${seg(subjectId)}`);
	},

	// ─── Invites (tenant_admin) ────────────────────────────────────────
	/** The returned `invite_url` carries the one-time token — shown only here and on resend. */
	createInvite(email: string, role: MemberRole = 'member'): Promise<InviteCreated> {
		return api.post<InviteCreated>('/tenant/invites', { email, role });
	},
	invites(status?: Invite['status']): Promise<InviteList> {
		const qs = status ? `?status=${encodeURIComponent(status)}` : '';
		return api.get<InviteList>(`/tenant/invites${qs}`);
	},
	resendInvite(inviteId: string): Promise<InviteCreated> {
		return api.post<InviteCreated>(`/tenant/invites/${seg(inviteId)}/resend`);
	},
	revokeInvite(inviteId: string): Promise<void> {
		return api.delete<void>(`/tenant/invites/${seg(inviteId)}`);
	},

	// ─── Invitee surface (any signed-in caller, no membership needed) ──
	acceptInvite(token: string): Promise<InviteAccepted> {
		return api.post<InviteAccepted>('/invites/accept', { token });
	},
	/** Accept an invite listed in `/auth/me.pending_invites` (verified email must match). */
	acceptInviteById(inviteId: string): Promise<InviteAccepted> {
		return api.post<InviteAccepted>(`/invites/${seg(inviteId)}/accept`);
	},
	myTenants(): Promise<MyTenantList> {
		return api.get<MyTenantList>('/me/tenants');
	},

	// ─── The tenant itself (tenant_admin) ──────────────────────────────
	renameTenant(name: string): Promise<TenantOut> {
		return api.patch<TenantOut>('/tenant', { name });
	},

	// ─── API keys (tenant_admin) ───────────────────────────────────────
	apiKeys(): Promise<ApiKeyList> {
		return api.get<ApiKeyList>('/tenant/api-keys');
	},
	/** The ONLY response that carries the secret (`key`, `w2v_sk_…`). Never stored. */
	createApiKey(
		name: string,
		expiresAt?: string | null,
		scopes: readonly ApiKeyScope[] = []
	): Promise<ApiKeyCreated> {
		const body: ApiKeyCreate = { name };
		if (expiresAt) body.expires_at = expiresAt;
		if (scopes.length > 0) body.scopes = [...scopes];
		return api.post<ApiKeyCreated>('/tenant/api-keys', body);
	},
	revokeApiKey(keyId: string): Promise<void> {
		return api.delete<void>(`/tenant/api-keys/${seg(keyId)}`);
	}
};

/** Plain-language copy for the tenancy error codes a user can actually hit. */
const CODE_MESSAGES: Record<string, string> = {
	LAST_TENANT_ADMIN:
		'A workspace needs at least one admin. Make someone else an admin before changing this.',
	MEMBER_NOT_FOUND: 'That person is no longer a member of this workspace.',
	ALREADY_MEMBER: 'That email already belongs to a member of this workspace.',
	INVITE_PENDING: 'An invite is already pending for that email — resend it instead.',
	INVITE_NOT_PENDING: 'That invite is no longer pending.',
	INVITE_NOT_FOUND: 'This invite is not valid any more.',
	INVITE_EMAIL_MISMATCH:
		'This invite was sent to a different email address. Sign in with the invited email to accept it.',
	EMAIL_NOT_VERIFIED: 'Verify your email address first, then try the invite again.',
	INVITE_GONE: 'This invite has expired or was revoked. Ask a workspace admin for a new one.',
	KEYCLOAK_UNAVAILABLE: 'The sign-in service is unreachable right now. Try again in a moment.',
	IDENTITY_PROVIDER_FORBIDDEN:
		"Identity service refused the request — the platform's invite permission is missing; contact the operator",
	NO_MEMBERSHIP: 'You are not a member of that workspace.',
	[TENANT_NOT_ONBOARDED]: TENANT_NOT_ONBOARDED_MESSAGE
};

/** Map an error to user copy: a known tenancy code wins, then the server message. */
export function tenancyErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
	if (err instanceof ApiError) {
		if (err.code && CODE_MESSAGES[err.code]) return CODE_MESSAGES[err.code];
		return err.detail || fallback;
	}
	if (err instanceof Error && err.message) return err.message;
	return fallback;
}

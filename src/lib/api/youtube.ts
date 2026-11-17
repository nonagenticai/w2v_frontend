import type {
	YouTubeAuthStatusResponse,
	YouTubeUploadRequest,
	YouTubeUploadJobResponse
} from '$lib/types';
import { api } from './client.js';

/**
 * Per-tenant YouTube settings — `GET /api/youtube/settings` (any member).
 *
 * Secrets are WRITE-ONLY: no response carries the client secret, only
 * `has_oauth_client_secret`. `platform_channel_allowed` null = follow the
 * platform channel's `default_for_tenants`; `effective_platform_channel_allowed`
 * is the resolved value. Wire keys are snake_case; these types are declared here
 * until the orchestrator schemas land in types.gen.ts.
 */
export interface YouTubeTenantSettings {
	oauth_client_id: string | null;
	has_oauth_client_secret: boolean;
	/** The OAuth redirect URI the tenant must register on its own Google client. */
	redirect_uri: string;
	platform_channel_allowed: boolean | null;
	effective_platform_channel_allowed: boolean;
	platform_channel: { channel_id: string; channel_title: string } | null;
}

/** `PUT /api/youtube/settings/oauth-client` — both fields required. */
export interface YouTubeOAuthClientPut {
	client_id: string;
	client_secret: string;
}

/**
 * The operator's platform channel — `GET /api/admin/youtube/platform-channel`
 * (super_admin). Secrets never come back; the `has_*` flags say whether one is stored.
 */
export interface YouTubePlatformChannel {
	client_id: string;
	channel_id: string;
	channel_title: string;
	default_for_tenants: boolean;
	has_client_secret?: boolean;
	has_refresh_token?: boolean;
	updated_by?: string | null;
	updated_at?: string | null;
}

/**
 * `PUT /api/admin/youtube/platform-channel`. `client_secret` / `refresh_token`
 * are OMITTED to keep the stored value (never sent as null/"").
 */
export interface YouTubePlatformChannelPut {
	client_id: string;
	channel_id: string;
	channel_title: string;
	default_for_tenants: boolean;
	client_secret?: string;
	refresh_token?: string;
}

/**
 * One row of `GET /api/admin/youtube/tenants` (super_admin). Only tenants that
 * have a `tenant_youtube_settings` row or a grant are listed; a tenant ABSENT
 * from the list has `platform_channel_allowed = null` (follows the default).
 */
export interface YouTubeAdminTenantSettings {
	tenant_id: string;
	platform_channel_allowed: boolean | null;
	has_grant: boolean;
	has_oauth_client: boolean;
}

/** `PUT /api/admin/tenants/{id}/youtube` — null = follow the platform default. */
export interface TenantYouTubePolicyPut {
	platform_channel_allowed: boolean | null;
}

export const youtube = {
	authConnect(): Promise<{ authorization_url: string }> {
		return api.post('/youtube/auth/connect');
	},

	authStatus(): Promise<YouTubeAuthStatusResponse> {
		return api.get<YouTubeAuthStatusResponse>('/youtube/auth/status');
	},

	authDisconnect(): Promise<{ message: string }> {
		return api.delete('/youtube/auth/disconnect');
	},

	/** The tenant's YouTube settings (any member). */
	settings(): Promise<YouTubeTenantSettings> {
		return api.get<YouTubeTenantSettings>('/youtube/settings');
	},

	/** Set the tenant's own Google OAuth client (tenant_admin). A grant from another client must reconnect. */
	setOAuthClient(body: YouTubeOAuthClientPut): Promise<YouTubeTenantSettings> {
		return api.put<YouTubeTenantSettings>('/youtube/settings/oauth-client', body);
	},

	/** Remove the tenant's own OAuth client → back to the platform client (tenant_admin). */
	removeOAuthClient(): Promise<YouTubeTenantSettings> {
		return api.delete<YouTubeTenantSettings>('/youtube/settings/oauth-client');
	},

	/** Platform: the operator's platform channel (super_admin). */
	platformChannel(): Promise<YouTubePlatformChannel | null> {
		return api.get<YouTubePlatformChannel | null>('/admin/youtube/platform-channel');
	},

	/** Platform: create/replace the platform channel (super_admin). */
	setPlatformChannel(body: YouTubePlatformChannelPut): Promise<YouTubePlatformChannel> {
		return api.put<YouTubePlatformChannel>('/admin/youtube/platform-channel', body);
	},

	/** Platform: every tenant's YouTube policy/grant summary (super_admin). */
	adminTenantSettings(): Promise<YouTubeAdminTenantSettings[]> {
		return api.get<YouTubeAdminTenantSettings[]>('/admin/youtube/tenants');
	},

	/** Platform: whether one tenant may publish to the platform channel (super_admin). */
	setTenantPlatformChannelAllowed(tenantId: string, allowed: boolean | null): Promise<unknown> {
		const body: TenantYouTubePolicyPut = { platform_channel_allowed: allowed };
		return api.put(`/admin/tenants/${encodeURIComponent(tenantId)}/youtube`, body);
	},

	startUpload(req: YouTubeUploadRequest): Promise<YouTubeUploadJobResponse> {
		return api.post<YouTubeUploadJobResponse>('/youtube/upload', req);
	},

	getJob(jobId: string): Promise<YouTubeUploadJobResponse> {
		return api.get<YouTubeUploadJobResponse>(`/youtube/upload/jobs/${jobId}`);
	},

	listJobs(
		limit: number = 50,
		offset: number = 0
	): Promise<{ jobs: YouTubeUploadJobResponse[]; total: number }> {
		return api.get(`/youtube/upload/jobs?limit=${limit}&offset=${offset}`);
	}
};

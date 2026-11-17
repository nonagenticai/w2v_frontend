import { ApiError } from '$lib/api/client';
import type { YouTubeAuthStatusResponse, YouTubeConnectionState, YouTubeMode } from '$lib/types';

/**
 * The tenant's YouTube connection state, read truthfully.
 *
 * youtube_upload_service reports `status` explicitly. An older backend (pre
 * fix/p1-yt-no-silent-fallback) has no `status`; its `connected` meant "an
 * upload would be attempted", so it maps to `connected` / `not_connected`.
 */
export function youtubeConnectionState(status: YouTubeAuthStatusResponse): YouTubeConnectionState {
	// Per-tenant config backend: `mode` + `needs_reconnect` are authoritative.
	if (status.mode) {
		if (status.needs_reconnect) return 'reconnect_required';
		return status.mode === 'tenant'
			? 'connected'
			: status.mode === 'platform'
				? 'platform_default'
				: 'not_connected';
	}
	return status.status ?? (status.connected ? 'connected' : 'not_connected');
}

/**
 * Which channel an upload would use. `mode` when the backend reports it; else
 * derived from the older `status` (a reconnect-required grant is still the
 * tenant's own channel — it is just unusable until reconnected).
 */
export function youtubeMode(status: YouTubeAuthStatusResponse): YouTubeMode {
	if (status.mode) return status.mode;
	const s = youtubeConnectionState(status);
	if (s === 'connected' || s === 'reconnect_required') return 'tenant';
	return s === 'platform_default' ? 'platform' : 'none';
}

/** The one line the YouTube card states — what a publish would do right now. */
export function youtubeStatusLine(status: YouTubeAuthStatusResponse): string {
	const title = status.channel_title?.trim() ?? '';
	switch (youtubeConnectionState(status)) {
		case 'connected':
			return title ? `Connected: ${title}` : 'Connected to your own channel';
		case 'reconnect_required':
			return `Reconnect required${title ? ` — ${title}` : ''}: the authorization expired, was revoked, or was issued by an OAuth client this workspace no longer uses. Publishing fails until you reconnect.`;
		case 'platform_default':
			return `No channel connected — videos publish to the platform channel${title ? ` ${title}` : ''}`;
		default:
			return 'Not connected — publishing will fail';
	}
}

/** The registry's description of the `publish.youtube` slot, from either API. */
export interface YouTubeSlotDescription {
	/** `GET /api/tenant/connections` entry (`SlotView`). */
	view?: { type?: 'connection' | 'grant'; writable: boolean } | null;
	/** `GET /api/provider-requirements` entry (`SlotRequirement`). */
	requirement?: { type: 'connection' | 'grant' } | null;
}

/**
 * Whether the API lets a tenant connect its own YouTube channel at all, and the
 * reason shown when it does not.
 *
 * `publish.youtube` is written through its OWN OAuth flow when the registry marks
 * it a `grant` slot — then `SlotView.writable` is `false` by construction (the
 * grant is never a `/tenant/connections` row) and must NOT hide Connect. Any other
 * answer means the slot is not tenant-writable: a non-writable `connection` slot is
 * platform provided (the shape the registry used before P5), and a slot neither
 * API lists is not offered on this deployment.
 */
export function youtubeGrantWritability({ view, requirement }: YouTubeSlotDescription): {
	writable: boolean;
	reason: string | null;
} {
	if (requirement?.type === 'grant' || view?.type === 'grant') {
		return { writable: true, reason: null };
	}
	if (view || requirement) {
		return {
			writable: false,
			reason:
				'YouTube publishing is platform provided on this deployment — a workspace cannot connect its own channel.'
		};
	}
	return {
		writable: false,
		reason: 'YouTube publishing is not offered on this deployment, so there is nothing to connect.'
	};
}

/**
 * Which grant actions the card offers — ONE derivation for every button, so
 * the visible controls can never disagree with the status line. The grant is
 * writable when the membership role allows it (`tenant_admin`, enforced
 * server-side) AND the API offers the slot as a grant (`youtubeGrantWritability`;
 * the `/tenant/connections` `writable` flag alone is false for every grant slot).
 *
 * - slot not writable: no Connect / Reconnect (Disconnect stays — revoking is safe).
 * - status unknown (read failed): an admin keeps Connect reachable.
 * - own grant usable: Disconnect only.
 * - own grant unusable: Reconnect + Disconnect.
 * - platform / none: Connect.
 */
export function youtubeGrantActions(
	state: YouTubeConnectionState | null,
	{
		canManage,
		statusFailed,
		slotWritable = true
	}: { canManage: boolean; statusFailed: boolean; slotWritable?: boolean }
): { connect: boolean; reconnect: boolean; disconnect: boolean } {
	if (!canManage) return { connect: false, reconnect: false, disconnect: false };
	if (state === null) {
		return { connect: statusFailed && slotWritable, reconnect: false, disconnect: false };
	}
	return {
		connect: slotWritable && (state === 'platform_default' || state === 'not_connected'),
		reconnect: slotWritable && state === 'reconnect_required',
		disconnect: state === 'connected' || state === 'reconnect_required'
	};
}

/** Tri-state per-tenant platform-channel policy ⇄ a `<select>` value. */
export type PlatformChannelPolicy = 'default' | 'allow' | 'deny';

export function platformPolicyFromAllowed(v: boolean | null | undefined): PlatformChannelPolicy {
	return v === true ? 'allow' : v === false ? 'deny' : 'default';
}

export function allowedFromPlatformPolicy(p: PlatformChannelPolicy): boolean | null {
	return p === 'allow' ? true : p === 'deny' ? false : null;
}

/**
 * Whether a publish to YouTube would be attempted for this tenant.
 *
 * Gate on `can_publish` — `connected` is true only for the tenant's OWN grant,
 * so a platform-default tenant (connected=false, can_publish=true) can still
 * publish and a reconnect-required tenant cannot. Fallback to `connected` for
 * the old backend, where `connected` meant "can publish".
 */
export function canPublishToYouTube(status: YouTubeAuthStatusResponse): boolean {
	return status.can_publish ?? status.connected;
}

/**
 * A readable message for a failed connect/disconnect. Those are tenant_admin-only
 * on youtube_upload_service, so a 403 names the missing role instead of leaking
 * the raw `403 Forbidden: …` string.
 */
export function youtubeActionError(
	e: unknown,
	fallback: string,
	forbidden = 'Only a workspace admin can connect or disconnect YouTube.'
): string {
	if (e instanceof ApiError) {
		if (e.status === 403) {
			// Keep the upstream reason (e.g. a licence gate) — the role copy alone hides it.
			const detail = e.detail?.trim();
			return detail && detail !== e.statusText ? `${forbidden} (${detail})` : forbidden;
		}
		return e.detail || fallback;
	}
	return e instanceof Error ? e.message : fallback;
}

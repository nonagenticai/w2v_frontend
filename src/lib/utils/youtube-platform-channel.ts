import type { YouTubePlatformChannelPut } from '$lib/api/youtube.js';

export interface PlatformChannelForm {
	clientId: string;
	channelId: string;
	channelTitle: string;
	defaultForTenants: boolean;
	clientSecret: string;
	refreshToken: string;
}

export type PlatformChannelDraft =
	| { ok: true; body: YouTubePlatformChannelPut }
	| { ok: false; reason: string };

/**
 * The PUT body for the platform channel form, or why it cannot be sent.
 *
 * Secrets are write-only: a blank secret field is OMITTED (= keep the stored
 * value) — never sent as `""`, which would read as "clear". With no existing
 * row there is nothing to keep, so both secrets are required.
 */
export function buildPlatformChannelPut(
	form: PlatformChannelForm,
	{ exists }: { exists: boolean }
): PlatformChannelDraft {
	const client_id = form.clientId.trim();
	const channel_id = form.channelId.trim();
	const channel_title = form.channelTitle.trim();
	if (!client_id || !channel_id || !channel_title) {
		return { ok: false, reason: 'Channel title, channel ID and client ID are required.' };
	}
	const client_secret = form.clientSecret.trim();
	const refresh_token = form.refreshToken.trim();
	if (!exists && (!client_secret || !refresh_token)) {
		return { ok: false, reason: 'A new platform channel needs a client secret and refresh token.' };
	}
	const body: YouTubePlatformChannelPut = {
		client_id,
		channel_id,
		channel_title,
		default_for_tenants: form.defaultForTenants
	};
	if (client_secret) body.client_secret = client_secret;
	if (refresh_token) body.refresh_token = refresh_token;
	return { ok: true, body };
}

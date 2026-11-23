<script lang="ts">
	// super_admin: the platform YouTube channel — GET|PUT /api/admin/youtube/platform-channel.
	// Tenants without their own grant publish here when allowed (per-tenant policy,
	// or `default_for_tenants` when a tenant has none). Secrets are WRITE-ONLY:
	// blank = keep the stored value (the key is omitted, never sent empty); a first
	// save needs both, since there is nothing to keep.
	import { youtube, type YouTubePlatformChannel } from '$lib/api/youtube.js';
	import { buildPlatformChannelPut } from '$lib/utils/youtube-platform-channel';
	import { Button, Card, Input, Pill, Skeleton, Toggle } from '$lib/components/ui';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { youtubeActionError } from '$lib/utils/youtube-status';

	const FORBIDDEN = 'Only a super admin can change the platform channel.';

	let channel = $state<YouTubePlatformChannel | null>(null);
	let loading = $state(true);
	let loadError = $state('');
	let saving = $state(false);
	let error = $state('');

	let clientId = $state('');
	let channelId = $state('');
	let channelTitle = $state('');
	let defaultForTenants = $state(false);
	let clientSecret = $state('');
	let refreshToken = $state('');

	function fill(c: YouTubePlatformChannel | null): void {
		channel = c;
		clientId = c?.client_id ?? '';
		channelId = c?.channel_id ?? '';
		channelTitle = c?.channel_title ?? '';
		defaultForTenants = c?.default_for_tenants ?? false;
		clientSecret = '';
		refreshToken = '';
	}

	async function load(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			fill(await youtube.platformChannel());
		} catch (e) {
			// "Not configured" is a 200 `null` (contract). A 404 is a missing route,
			// not an unset channel — say so instead of claiming nothing is configured.
			loadError = youtubeActionError(e, "Couldn't load the platform channel", FORBIDDEN);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void load();
	});

	const draft = $derived(
		buildPlatformChannelPut(
			{ clientId, channelId, channelTitle, defaultForTenants, clientSecret, refreshToken },
			{ exists: channel !== null }
		)
	);

	async function save(): Promise<void> {
		if (!draft.ok || saving) return;
		saving = true;
		error = '';
		try {
			fill(await youtube.setPlatformChannel(draft.body));
			toastSuccess('Platform channel saved', channelTitle);
		} catch (e) {
			error = youtubeActionError(e, 'Saving the platform channel failed', FORBIDDEN);
		} finally {
			saving = false;
		}
	}
</script>

<div class="mb-6" data-testid="youtube-platform-channel">
	<Card class="p-5">
		<h2 class="text-sm font-semibold text-[var(--color-text)]">Platform YouTube channel</h2>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Where tenants without their own channel publish — only tenants allowed below (or by the
			default) may use it.
		</p>

		{#if loading}
			<div class="mt-3"><Skeleton variant="text" count={3} height="2rem" /></div>
		{:else if loadError}
			<p
				class="mt-3 text-sm text-[var(--color-danger)]"
				role="alert"
				data-testid="youtube-platform-load-error"
			>
				{loadError}
			</p>
			<div class="mt-2 flex justify-end">
				<Button variant="ghost" size="sm" onclick={load}>Retry</Button>
			</div>
		{:else}
			<div
				class="mt-3 flex flex-wrap items-center gap-2 text-xs"
				data-testid="youtube-platform-current"
			>
				{#if channel}
					<span class="font-medium text-[var(--color-text)]">{channel.channel_title}</span>
					<span class="font-mono text-[var(--color-text-muted)]">{channel.channel_id}</span>
					{#if channel.has_client_secret !== undefined}
						<Pill tone={channel.has_client_secret ? 'success' : 'danger'}>
							{channel.has_client_secret ? 'Client secret set' : 'No client secret'}
						</Pill>
					{/if}
					{#if channel.has_refresh_token !== undefined}
						<Pill tone={channel.has_refresh_token ? 'success' : 'danger'}>
							{channel.has_refresh_token ? 'Refresh token set' : 'No refresh token'}
						</Pill>
					{/if}
				{:else}
					<Pill tone="warning">Not configured — no tenant can fall back to a platform channel</Pill>
				{/if}
			</div>

			<form
				class="mt-4 grid gap-3 sm:grid-cols-2"
				onsubmit={(e) => {
					e.preventDefault();
					void save();
				}}
			>
				<Input name="yt-platform-channel-title" label="Channel title" bind:value={channelTitle} />
				<Input
					name="yt-platform-channel-id"
					label="Channel ID"
					placeholder="UC…"
					spellcheck={false}
					bind:value={channelId}
				/>
				<Input
					name="yt-platform-client-id"
					label="OAuth client ID"
					autocomplete="off"
					spellcheck={false}
					bind:value={clientId}
					class="sm:col-span-2"
				/>
				<Input
					name="yt-platform-client-secret"
					type="password"
					label={channel ? 'Replace client secret (optional)' : 'Client secret'}
					placeholder={channel ? 'Blank keeps the stored secret' : ''}
					autocomplete="new-password"
					spellcheck={false}
					bind:value={clientSecret}
				/>
				<Input
					name="yt-platform-refresh-token"
					type="password"
					label={channel ? 'Replace refresh token (optional)' : 'Refresh token'}
					placeholder={channel ? 'Blank keeps the stored token' : ''}
					autocomplete="new-password"
					spellcheck={false}
					bind:value={refreshToken}
				/>
				<Toggle
					bind:checked={defaultForTenants}
					label="Default for tenants"
					description="Tenants with no explicit Allow/Deny may publish to this channel."
					class="sm:col-span-2"
				/>
				<div class="flex items-center justify-end gap-3 sm:col-span-2">
					{#if !draft.ok}
						<p
							class="text-xs text-[var(--color-text-muted)]"
							data-testid="youtube-platform-invalid"
						>
							{draft.reason}
						</p>
					{/if}
					<Button variant="primary" size="sm" type="submit" loading={saving} disabled={!draft.ok}>
						Save platform channel
					</Button>
				</div>
			</form>

			{#if error}
				<p
					class="mt-2 text-sm text-[var(--color-danger)]"
					role="alert"
					data-testid="youtube-platform-error"
				>
					{error}
				</p>
			{/if}
		{/if}
	</Card>
</div>

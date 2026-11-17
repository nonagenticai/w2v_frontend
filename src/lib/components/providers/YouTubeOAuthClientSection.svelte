<script lang="ts">
	// Tenant admin: "Own Google OAuth client (optional)" — GET /api/youtube/settings,
	// PUT|DELETE /api/youtube/settings/oauth-client. A workspace whose channel is
	// owned by an account the platform client's consent screen does not admit needs
	// its own client. The secret is WRITE-ONLY: never prefilled, never returned —
	// only `has_oauth_client_secret`. Changing the client invalidates a grant issued
	// by the old one, so the card re-reads its status (`onchanged`) after a change.
	import { youtube, type YouTubeTenantSettings } from '$lib/api/youtube.js';
	import { Button, Dialog, Input, Pill } from '$lib/components/ui';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { youtubeActionError } from '$lib/utils/youtube-status';

	let { onchanged }: { onchanged?: () => void } = $props();

	const FORBIDDEN = 'Only a workspace admin can change the OAuth client.';

	let settings = $state<YouTubeTenantSettings | null>(null);
	let loadError = $state('');
	let clientId = $state('');
	let clientSecret = $state('');
	let saving = $state(false);
	let error = $state('');
	let removeOpen = $state(false);

	async function load(): Promise<void> {
		loadError = '';
		try {
			settings = await youtube.settings();
			clientId = settings.oauth_client_id ?? '';
		} catch (e) {
			settings = null;
			loadError = youtubeActionError(e, "Couldn't load the YouTube settings", FORBIDDEN);
		}
	}

	$effect(() => {
		void load();
	});

	const canSave = $derived(clientId.trim().length > 0 && clientSecret.trim().length > 0 && !saving);

	async function save(): Promise<void> {
		if (!canSave) return;
		saving = true;
		error = '';
		try {
			settings = await youtube.setOAuthClient({
				client_id: clientId.trim(),
				client_secret: clientSecret.trim()
			});
			clientId = settings.oauth_client_id ?? clientId.trim();
			clientSecret = '';
			toastSuccess('OAuth client saved', 'Reconnect YouTube to authorize with it.');
			onchanged?.();
		} catch (e) {
			error = youtubeActionError(e, 'Saving the OAuth client failed', FORBIDDEN);
		} finally {
			saving = false;
		}
	}

	async function remove(): Promise<void> {
		removeOpen = false;
		saving = true;
		error = '';
		try {
			// DELETE returns the settings body (contract) — no second GET needed.
			settings = await youtube.removeOAuthClient();
			clientId = settings.oauth_client_id ?? '';
			clientSecret = '';
			toastSuccess('OAuth client removed', 'The platform OAuth client is used again.');
			onchanged?.();
		} catch (e) {
			error = youtubeActionError(e, 'Removing the OAuth client failed', FORBIDDEN);
		} finally {
			saving = false;
		}
	}

	async function copyRedirect(): Promise<void> {
		if (!settings?.redirect_uri) return;
		try {
			await navigator.clipboard.writeText(settings.redirect_uri);
			toastSuccess('Redirect URI copied');
		} catch {
			// Refused on an insecure origin or without focus — the URI stays selectable.
			toastError('Could not copy', 'Your browser blocked clipboard access.');
		}
	}
</script>

<div class="border-t border-[var(--color-border)] pt-4" data-testid="youtube-oauth-client">
	<h3 class="text-sm font-semibold text-text">Own Google OAuth client (optional)</h3>
	<p class="mt-1 text-xs text-text-muted">
		Needed only when the channel's Google account cannot sign in through the platform's OAuth
		client. Without one, Connect uses the platform client.
	</p>

	{#if loadError}
		<p
			class="mt-3 text-sm text-[var(--color-danger)]"
			role="alert"
			data-testid="youtube-oauth-load-error"
		>
			{loadError}
		</p>
		<div class="mt-2 flex justify-end">
			<Button variant="ghost" size="sm" onclick={load}>Retry</Button>
		</div>
	{:else if settings}
		<dl class="mt-3 space-y-2 text-xs">
			<div class="flex flex-wrap items-center gap-2" data-testid="youtube-oauth-current">
				<dt class="text-text-muted">Client:</dt>
				<dd class="min-w-0 break-all font-mono text-text">
					{settings.oauth_client_id ?? 'Platform OAuth client'}
				</dd>
				{#if settings.oauth_client_id}
					<span data-testid="youtube-oauth-secret-state">
						<Pill tone={settings.has_oauth_client_secret ? 'success' : 'danger'}>
							{settings.has_oauth_client_secret ? 'Secret set' : 'No secret'}
						</Pill>
					</span>
				{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<dt class="text-text-muted">Authorized redirect URI to register in Google Cloud:</dt>
				<dd class="flex min-w-0 items-center gap-2">
					<code class="break-all font-mono text-text" data-testid="youtube-redirect-uri"
						>{settings.redirect_uri}</code
					>
					<Button variant="ghost" size="sm" onclick={copyRedirect}>Copy</Button>
				</dd>
			</div>
		</dl>

		<form
			class="mt-4 flex flex-col gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<Input
				name="youtube-oauth-client-id"
				label="Client ID"
				placeholder="1234567890-abc.apps.googleusercontent.com"
				autocomplete="off"
				spellcheck={false}
				bind:value={clientId}
			/>
			<Input
				name="youtube-oauth-client-secret"
				type="password"
				label={settings.has_oauth_client_secret
					? 'Client secret (enter to replace)'
					: 'Client secret'}
				placeholder={settings.has_oauth_client_secret ? '•••••••• stored — never shown' : ''}
				autocomplete="new-password"
				spellcheck={false}
				bind:value={clientSecret}
			/>
			<p class="text-xs text-[var(--color-warning-text)]" data-testid="youtube-oauth-warning">
				Changing or removing the client invalidates the current YouTube authorization — reconnect
				YouTube afterwards.
			</p>
			<div class="flex flex-wrap justify-end gap-2">
				{#if settings.oauth_client_id}
					<Button variant="danger" size="sm" disabled={saving} onclick={() => (removeOpen = true)}
						>Remove client</Button
					>
				{/if}
				<Button variant="primary" size="sm" type="submit" loading={saving} disabled={!canSave}
					>Save client</Button
				>
			</div>
		</form>

		{#if error}
			<p
				class="mt-2 text-sm text-[var(--color-danger)]"
				role="alert"
				data-testid="youtube-oauth-error"
			>
				{error}
			</p>
		{/if}
	{/if}
</div>

<Dialog bind:open={removeOpen} title="Remove the OAuth client?">
	{#if removeOpen}
		<div class="flex flex-col gap-4" data-testid="youtube-oauth-remove-confirm">
			<p class="text-sm text-text">
				Connect goes back to the platform's OAuth client. A YouTube authorization issued by this
				client stops working and must be reconnected.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (removeOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={remove}>Remove client</Button>
			</div>
		</div>
	{/if}
</Dialog>

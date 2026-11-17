<script lang="ts">
	// `publish.youtube` on the Providers page (P5-3). The slot IS the tenant's
	// YouTube OAuth grant — it is not a `/tenant/connections` row and cannot be
	// written there. Status comes from `GET /api/youtube/auth/status` (any member);
	// Connect / Disconnect go through the existing youtube flow functions, which the
	// orchestrator now serves and gates on tenant_admin. The buttons are shown to
	// tenant admins only (membership role, `isTenantAdmin()`); a member sees the
	// status and who can change it. The server stays the authority (403 → copy).
	//
	// ONE source of truth: the status line, badge and every button derive from the
	// same `youtubeConnectionState` + `youtubeGrantActions` — no control is offered
	// that the status says cannot work. Connect / Reconnect also need the API to
	// offer the slot as a grant (`writable` prop, from `youtubeGrantWritability`);
	// when it does not, they are hidden and `notWritableReason` says why.
	// Tenant admins also get the optional own-OAuth-client section beneath.
	import { youtube } from '$lib/api/youtube.js';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import { Badge, Button, Card, Dialog, Spinner } from '$lib/components/ui';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import type { YouTubeConnectionState } from '$lib/types';
	import {
		youtubeActionError,
		youtubeConnectionState,
		youtubeGrantActions,
		youtubeStatusLine
	} from '$lib/utils/youtube-status';
	import YouTubeOAuthClientSection from './YouTubeOAuthClientSection.svelte';

	let {
		writable = true,
		notWritableReason = null
	}: {
		/** The API offers `publish.youtube` as a tenant-connectable grant. */
		writable?: boolean;
		/** Shown instead of Connect when `writable` is false. */
		notWritableReason?: string | null;
	} = $props();

	const canManage = $derived(isTenantAdmin());

	let ytState = $state<YouTubeConnectionState | null>(null);
	let channelTitle = $state('');
	let statusLine = $state('');
	let reconnectReason = $state('');
	let loading = $state(false);
	let error = $state('');
	/** The status read failed: state unknown, but Connect stays reachable for an admin. */
	let statusFailed = $state(false);
	let disconnectOpen = $state(false);

	// Google's raw refresh error can be ~500 chars of provider text — truncated detail only.
	const REASON_MAX = 120;
	const reconnectDetail = $derived(
		reconnectReason.length > REASON_MAX
			? `${reconnectReason.slice(0, REASON_MAX)}…`
			: reconnectReason
	);

	async function refresh(): Promise<void> {
		loading = true;
		error = '';
		statusFailed = false;
		try {
			const status = await youtube.authStatus();
			ytState = youtubeConnectionState(status);
			statusLine = youtubeStatusLine(status);
			channelTitle = status.channel_title ?? '';
			reconnectReason = status.reconnect_reason ?? '';
		} catch (e) {
			ytState = null;
			statusLine = '';
			statusFailed = true;
			error = youtubeActionError(e, 'Failed to check status');
		} finally {
			loading = false;
		}
	}

	async function connect(): Promise<void> {
		if (!canManage || !writable) return;
		loading = true;
		error = '';
		try {
			const result = await youtube.authConnect();
			// Same-tab navigation: a window.open() after the await has lost the click's
			// user gesture and is popup-blocked, so Connect would silently do nothing.
			if (result.authorization_url) window.location.assign(result.authorization_url);
			else error = 'Connection failed: the server returned no Google sign-in URL.';
		} catch (e) {
			error = youtubeActionError(e, 'Connection failed');
		} finally {
			loading = false;
		}
	}

	async function disconnect(): Promise<void> {
		disconnectOpen = false;
		if (!canManage) return;
		loading = true;
		error = '';
		try {
			await youtube.authDisconnect();
			channelTitle = '';
			toastSuccess('YouTube disconnected');
			// Re-read: without the own grant the tenant may fall back to platform_default.
			await refresh();
		} catch (e) {
			error = youtubeActionError(e, 'Disconnect failed');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void refresh();
	});

	const actions = $derived(
		youtubeGrantActions(ytState, { canManage, statusFailed, slotWritable: writable })
	);
	const showConnect = $derived(actions.connect || actions.reconnect);
	const showDisconnect = $derived(actions.disconnect);
</script>

<div data-testid="provider-card-publish.youtube" data-state={ytState ?? 'unknown'}>
	<Card class="p-5">
		<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-text">YouTube publishing</h2>
				<p class="mt-1 text-xs text-text-muted">
					Connected through Google sign-in — no API key is stored here.
				</p>
			</div>
			<span data-testid="youtube-source">
				{#if ytState === 'connected'}
					<Badge variant="info">Your channel</Badge>
				{:else if ytState === 'reconnect_required'}
					<Badge variant="warning">Reconnect required</Badge>
				{:else if ytState === 'platform_default'}
					<Badge>Platform channel</Badge>
				{:else if ytState === 'not_connected'}
					<Badge variant="error">Not connected</Badge>
				{/if}
			</span>
		</div>

		<div class="space-y-3" data-testid="youtube-status">
			{#if ytState !== null}
				<p
					class="text-sm {ytState === 'not_connected' ? 'text-[var(--color-danger)]' : 'text-text'}"
					data-testid={ytState === 'reconnect_required'
						? 'youtube-reconnect-message'
						: 'youtube-status-line'}
				>
					{statusLine}
				</p>
				{#if ytState === 'reconnect_required' && reconnectDetail}
					<details class="text-xs text-text-muted">
						<summary class="cursor-pointer">Details</summary>
						<p class="mt-1 break-words">{reconnectDetail}</p>
					</details>
				{/if}
			{:else if statusFailed}
				<p class="text-sm text-text-muted" data-testid="youtube-status-error">
					Couldn't check the YouTube connection.
				</p>
			{/if}

			{#if !writable}
				<p class="text-xs text-text-muted" data-testid="youtube-not-writable">
					{notWritableReason ?? "This workspace can't connect its own YouTube channel."}
				</p>
			{:else if !canManage}
				<p class="text-xs text-text-muted" data-testid="youtube-admin-only">
					Only a workspace admin can connect or disconnect YouTube.
				</p>
			{/if}

			<div class="flex flex-wrap justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={refresh} disabled={loading}>
					{#if loading}<span class="mr-1.5 inline-block"><Spinner size="sm" /></span>{/if}
					Refresh status
				</Button>
				{#if showDisconnect}
					<Button
						variant="danger"
						size="sm"
						disabled={loading}
						onclick={() => (disconnectOpen = true)}>Disconnect</Button
					>
				{/if}
				{#if showConnect}
					<Button variant="primary" size="sm" disabled={loading} onclick={connect}>
						{actions.reconnect ? 'Reconnect YouTube' : 'Connect YouTube'}
					</Button>
				{/if}
			</div>

			{#if error}
				<p class="text-sm text-[var(--color-danger)]" role="alert" data-testid="youtube-error">
					{error}
				</p>
			{/if}

			{#if canManage && writable}
				<YouTubeOAuthClientSection onchanged={refresh} />
			{/if}
		</div>
	</Card>
</div>

<Dialog bind:open={disconnectOpen} title="Disconnect YouTube?">
	{#if disconnectOpen}
		<div class="flex flex-col gap-4" data-testid="youtube-disconnect-confirm">
			<p class="text-sm text-text">
				This revokes access to the workspace's YouTube channel{channelTitle
					? ` (${channelTitle})`
					: ''}. Publishing falls back to the platform channel if this workspace may use it;
				otherwise it fails. Reconnecting needs a new Google authorization.
			</p>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={() => (disconnectOpen = false)}>Cancel</Button>
				<Button variant="danger" size="sm" onclick={disconnect}>Disconnect</Button>
			</div>
		</div>
	{/if}
</Dialog>

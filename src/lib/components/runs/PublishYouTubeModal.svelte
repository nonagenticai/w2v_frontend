<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	/* eslint-disable svelte/no-navigation-without-resolve -- publishedUrl / publishedCaptionUrl are external URLs (the minted YouTube watch link + soft-CC .srt); the in-app Providers link uses resolve(). */
	import { resolve } from '$app/paths';
	import { Button, Dialog, Input } from '$lib/components/ui';
	import { Loader, MonitorPlay, Download } from '@lucide/svelte';
	import type { YouTubeConnectionState, YouTubePrivacyStatus } from '$lib/types';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';

	let {
		open = $bindable(false),
		connected,
		connectionState = null,
		title = $bindable(''),
		description = $bindable(''),
		privacy = $bindable<YouTubePrivacyStatus>('unlisted'),
		publishing = false,
		error = null,
		jobStatus = null,
		publishedUrl = null,
		publishedCaptionUrl = null,
		captionsFileName = 'captions.srt',
		onsubmit
	}: {
		open?: boolean;
		/** Whether a publish would be attempted (`can_publish`, not own-grant `connected`). */
		connected: boolean | null;
		connectionState?: YouTubeConnectionState | null;
		title?: string;
		description?: string;
		privacy?: YouTubePrivacyStatus;
		publishing?: boolean;
		error?: string | null;
		jobStatus?: string | null;
		publishedUrl?: string | null;
		publishedCaptionUrl?: string | null;
		/** Download name for the caption file — the project-named one the run page uses. */
		captionsFileName?: string;
		onsubmit: () => void;
	} = $props();

	// The YouTube grant is connected ONLY on /providers (YouTubeGrantCard), which is
	// tenant_admin-only — a member gets who-to-ask text, not a link that would 403.
	const canManage = $derived(isTenantAdmin());
</script>

{#snippet whereToConnect(action: string)}
	{#if canManage}
		{action} on the
		<a
			href={resolve('/providers')}
			class="font-semibold text-[var(--color-text)] underline"
			data-testid="youtube-providers-link">Providers</a
		> page
	{:else}
		<span data-testid="youtube-admin-must-connect"
			>A workspace admin must {action.toLowerCase()} on the Providers page</span
		>
	{/if}
{/snippet}

<Dialog bind:open title="Publish to YouTube">
	{#if connected === null}
		<div class="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
			<Loader class="h-4 w-4 animate-spin" />
			Checking YouTube connection…
		</div>
	{:else if connected === false && connectionState === 'reconnect_required'}
		<p class="text-sm text-[var(--color-text-muted)]" data-testid="youtube-reconnect-required">
			Your YouTube connection has expired or was revoked. {@render whereToConnect('Reconnect it')},
			then come back here to publish.
		</p>
	{:else if connected === false}
		<p class="text-sm text-[var(--color-text-muted)]">
			No YouTube account is connected. {@render whereToConnect('Connect one')}, then come back here
			to publish.
		</p>
	{:else if publishedUrl}
		<div class="space-y-2">
			<p class="text-sm text-[var(--color-text-muted)]">Published successfully.</p>
			<a
				href={safeHref(publishedUrl)}
				target="_blank"
				rel="noopener"
				class="text-sm font-semibold text-[var(--color-text)] underline break-all"
			>
				{publishedUrl}
			</a>
			{#if publishedCaptionUrl}
				<a
					href={safeHref(publishedCaptionUrl)}
					download={captionsFileName}
					class="flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"
				>
					<Download class="h-4 w-4" />
					Download captions (.srt)
				</a>
			{/if}
		</div>
	{:else}
		<div class="space-y-3">
			{#if connectionState === 'platform_default'}
				<p
					class="text-xs text-[var(--color-text-muted)]"
					data-testid="youtube-platform-default-note"
				>
					This video will publish to the platform's YouTube channel, not your own. {@render whereToConnect(
						'Connect your own channel'
					)}.
				</p>
			{/if}
			<Input name="yt-title" label="Title" bind:value={title} required />
			<div class="flex flex-col gap-1.5">
				<label for="yt-description" class="text-sm font-medium text-[var(--color-text-muted)]"
					>Description</label
				>
				<textarea
					id="yt-description"
					name="yt-description"
					bind:value={description}
					rows="3"
					class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
				></textarea>
			</div>
			<div class="flex flex-col gap-1.5">
				<label for="yt-privacy" class="text-sm font-medium text-[var(--color-text-muted)]"
					>Visibility</label
				>
				<select
					id="yt-privacy"
					name="yt-privacy"
					bind:value={privacy}
					class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
				>
					<option value="unlisted">Unlisted</option>
					<option value="public">Public</option>
					<option value="private">Private</option>
				</select>
			</div>
			{#if publishing && jobStatus}
				<p class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
					<Loader class="h-3.5 w-3.5 animate-spin" />
					Upload {jobStatus}…
				</p>
			{/if}
		</div>
	{/if}
	{#if error}
		<p class="mt-3 text-xs text-[var(--color-danger-text)]">{error}</p>
	{/if}
	<div class="flex justify-end gap-2 pt-2">
		<Button variant="secondary" onclick={() => (open = false)}>Close</Button>
		{#if connected && !publishedUrl}
			<Button variant="primary" loading={publishing} onclick={onsubmit}>
				<MonitorPlay class="h-4 w-4" />
				Publish
			</Button>
		{/if}
	</div>
</Dialog>

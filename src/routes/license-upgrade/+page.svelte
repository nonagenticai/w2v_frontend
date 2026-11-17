<script lang="ts">
	import { onMount } from 'svelte';
	import { isAuthenticated } from '$lib/stores/auth.svelte.js';
	import { licenseGate } from '$lib/stores/licenseGate.svelte';
	import { Button, Card } from '$lib/components/ui';
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';

	// In-app renewal landing — the DEFAULT VITE_LICENSE_RENEW_URL target. When the
	// customer portal e-commerce ships, point VITE_LICENSE_RENEW_URL at it and this
	// page is bypassed. There is no self-serve purchase yet, so the primary action
	// is to contact sales.
	onMount(() => {
		if (isAuthenticated()) void licenseGate.load();
	});

	const heading = $derived(
		licenseGate.state === 'revoked'
			? 'License revoked'
			: licenseGate.state === 'expired'
				? 'License expired'
				: licenseGate.state === 'none'
					? 'No active license'
					: licenseGate.state === 'expiring_soon'
						? 'License expiring soon'
						: 'License'
	);
</script>

<Page width="narrow" testid="license-upgrade">
	<PageHeader kicker="Workspace" title={heading} subtitle={licenseGate.statusMessage} />

	{#if licenseGate.expiresAt || licenseGate.planCode}
		<dl class="space-y-1 text-sm text-[var(--color-text-muted)]">
			{#if licenseGate.expiresAt}
				<div>
					<dt class="inline">Expiry date:</dt>
					<dd class="inline font-medium text-[var(--color-text)]">
						{new Date(licenseGate.expiresAt).toLocaleDateString()}
					</dd>
				</div>
			{/if}
			{#if licenseGate.planCode}
				<div>
					<dt class="inline">Plan:</dt>
					<dd class="inline font-medium text-[var(--color-text)]">{licenseGate.planCode}</dd>
				</div>
			{/if}
		</dl>
	{/if}

	<Card class="p-6">
		{#if licenseGate.state === 'active'}
			<!-- Reached while entitled (gate ships OFF, so this is the common case, or
			     a user navigated here directly). Don't imply lost access — confirm
			     it's active and offer a way back into the app. -->
			<p class="text-[var(--color-text)]">
				Your workspace license is active — you're all set. To make changes or extend coverage,
				contact our team.
			</p>
			<div class="mt-4 flex flex-wrap gap-3">
				<Button variant="primary" href="/">Back to dashboard</Button>
				<Button variant="secondary" href="mailto:sales@nonagentic.ai?subject=License%20enquiry">
					Contact sales
				</Button>
			</div>
		{:else}
			<p class="text-[var(--color-text)]">
				To {licenseGate.state === 'expiring_soon' ? 'renew' : 'restore'} access for your workspace, contact
				our team and we'll get you set up.
			</p>
			<div class="mt-4">
				<Button variant="primary" href="mailto:sales@nonagentic.ai?subject=License%20renewal">
					Contact sales@nonagentic.ai
				</Button>
			</div>
		{/if}
	</Card>
</Page>

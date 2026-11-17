<script lang="ts">
	// (tenant) route group — tenant-admin scope (super_admin passes too, composite).
	// The server is the real authority (every /api/* call 403s on its own in Phase B);
	// this guard only keeps the shell from flashing an admin screen to a non-admin.
	// Auth is already resolved here: the root +layout awaits ensureAuthReady() and only
	// renders children once authenticated, so the role helpers read populated state.
	//
	// Exception: /providers. A member is linked there by a `byo_provider_required`
	// notice, so the page renders itself read-only for a non-admin instead of
	// "Access denied" (it never asks the admin-only connections API for one).
	import { page } from '$app/state';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import { ErrorState } from '$lib/components/ui';

	let { children } = $props();
	const readOnlyForMembers = $derived(page.url.pathname.startsWith('/providers'));
</script>

{#if isTenantAdmin() || readOnlyForMembers}
	{@render children()}
{:else}
	<ErrorState title="Access denied" error="You need a tenant-admin role to view this area." />
{/if}

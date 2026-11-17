<script lang="ts">
	// (platform) route group — super_admin only (cross-tenant / all-tenants screens).
	// The server is the real authority (every /api/* call 403s on its own in Phase B);
	// this guard only keeps the platform shell from flashing for a non-super_admin.
	// Auth is already resolved here (root +layout awaits ensureAuthReady()).
	import { isSuperAdmin } from '$lib/stores/auth.svelte';
	import { ErrorState } from '$lib/components/ui';

	let { children } = $props();
</script>

{#if isSuperAdmin()}
	{@render children()}
{:else}
	<ErrorState title="Access denied" error="You need a super-admin role to view this area." />
{/if}

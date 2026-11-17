<script lang="ts">
	import { Button } from '$lib/components/ui';
	// (platform) route group boundary — tenants / provision / usage / active-runs /
	// audit / request-audit. Without this, one throwing load() on any cross-tenant
	// screen fell through to the ROOT +error.svelte and blanked the entire platform
	// surface, so the super-admin lost the very screens they would use to diagnose it.
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ErrorBoundary } from '$lib/components/errors';

	const err = $derived.by(() => {
		const e = $page.error;
		if (!e) return new Error('Unknown error');
		const wrapped = new Error(e.message ?? 'Unknown error');
		(wrapped as Error & { raw?: unknown }).raw = e;
		return wrapped;
	});
</script>

<svelte:head>
	<title>Platform — error</title>
</svelte:head>

<div>
	<p class="mb-2 text-sm text-text-muted">Error {$page.status}</p>
	<ErrorBoundary error={err} onRetry={() => invalidateAll()} />
	<div class="mt-4 flex flex-wrap gap-2">
		<Button variant="secondary" size="sm" href={resolve('/')}>Back to dashboard</Button>
	</div>
</div>

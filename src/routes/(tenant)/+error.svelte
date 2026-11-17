<script lang="ts">
	import { Button } from '$lib/components/ui';
	// (tenant) route group boundary — admin / members / usage.
	// Without this, one throwing load() in the tenant-admin group falls all the way
	// through to the ROOT +error.svelte, which replaces the whole administrative
	// surface with a bare status code — including the screens an operator would use
	// to work out what broke. Keep the group's own recovery (retry + back) local.
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
	<title>Administration — error</title>
</svelte:head>

<div>
	<p class="mb-2 text-sm text-text-muted">Error {$page.status}</p>
	<ErrorBoundary error={err} onRetry={() => invalidateAll()} />
	<div class="mt-4 flex flex-wrap gap-2">
		<Button variant="secondary" size="sm" href={resolve('/')}>Back to dashboard</Button>
	</div>
</div>

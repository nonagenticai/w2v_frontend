<script lang="ts">
	import { Button } from '$lib/components/ui';
	// Studio boundary. The parent run boundary already catches this, but its only
	// recovery is "back to project" — from the Studio the operator almost always
	// wants to retry the (heavier, more failure-prone) studio load or drop back to
	// the run monitor, not leave the run entirely.
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

	const runHref = $derived(resolve(`/projects/${$page.params.pid}/runs/${$page.params.id}`));
	const projectHref = $derived(resolve(`/projects/${$page.params.pid}`));
</script>

<svelte:head>
	<title>Studio — error</title>
</svelte:head>

<div>
	<p class="mb-2 text-sm text-text-muted">Error {$page.status}</p>
	<ErrorBoundary error={err} onRetry={() => invalidateAll()} />
	<div class="mt-4 flex gap-4">
		<Button variant="secondary" size="sm" href={runHref}>Back to run</Button>
		<Button variant="secondary" size="sm" href={projectHref}>Back to project</Button>
	</div>
</div>

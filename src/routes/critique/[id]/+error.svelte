<script lang="ts">
	import { Button } from '$lib/components/ui';
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
	<title>Critique — error</title>
</svelte:head>

<div>
	<ErrorBoundary error={err} onRetry={() => invalidateAll()} />
	<div class="mt-4 flex flex-wrap gap-2">
		<Button variant="secondary" size="sm" href={resolve('/critique')}>Back to critiques</Button>
	</div>
</div>

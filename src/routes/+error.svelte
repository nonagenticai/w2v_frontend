<script lang="ts">
	import { page } from '$app/stores';
	import { Button } from '$lib/components/ui';
	import { AlertTriangle } from '@lucide/svelte';
</script>

<!-- data-testid: the E2E harness keys "the route load() threw" off THIS, not off
     the page shape. The status-code h1 below is the page's only h1 (the topbar
     renders no heading), but a page body can still carry its own h1-level
     markdown, so the harness reads the status from inside this element only. -->
<div
	data-testid="route-error"
	class="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center"
>
	<div class="text-status-failed mb-4">
		<AlertTriangle class="h-16 w-16" />
	</div>
	<h1 class="text-6xl font-bold text-text mb-2">{$page.status}</h1>
	<p class="text-lg text-text-secondary mb-8">{$page.error?.message ?? 'Something went wrong'}</p>
	<Button variant="primary" href="/">Back to dashboard</Button>
</div>

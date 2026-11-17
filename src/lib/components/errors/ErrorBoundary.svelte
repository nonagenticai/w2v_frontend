<script lang="ts">
	import { dev } from '$app/environment';

	type Props = {
		error: Error | null;
		onRetry: () => void;
		children?: import('svelte').Snippet;
		/** Offer the JS stack trace. Defaults to dev builds only: a stack is
		 *  meaningless to a customer and leaks internal file layout. */
		showStack?: boolean;
	};
	let { error, onRetry, children, showStack = dev }: Props = $props();
	let showDetails = $state(false);
</script>

{#if error}
	<!-- data-testid: lets the E2E harness distinguish THIS from any other
	     role="alert" (ErrorState defaults to the same words; error toasts live 8s),
	     so a transient banner cannot be read as "the app gave up". -->
	<div
		data-testid="error-boundary"
		role="alert"
		class="flex flex-col gap-3 rounded-xl border border-status-failed/30 bg-status-failed/10 p-4 text-sm text-text"
	>
		<div class="flex items-start justify-between gap-3">
			<div>
				<!-- The page's only h1: ErrorBoundary is rendered solely by the route
				     +error.svelte boundaries, and the topbar renders no heading. -->
				<h1 class="font-semibold">Something went wrong</h1>
				<p class="text-text-secondary mt-0.5">{error.message}</p>
			</div>
			<button
				type="button"
				class="shrink-0 rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-surface-raised"
				onclick={() => onRetry()}
			>
				Retry
			</button>
		</div>

		{#if showStack && error.stack}
			<button
				type="button"
				class="self-start text-xs text-text-muted hover:text-text underline"
				onclick={() => (showDetails = !showDetails)}
			>
				{showDetails ? 'Hide' : 'Show'} details
			</button>
			{#if showDetails}
				<pre class="text-xs bg-surface-raised rounded-lg p-3 overflow-x-auto">{error.stack}</pre>
			{/if}
		{/if}
	</div>
{:else if children}
	{@render children()}
{/if}

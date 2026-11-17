<script lang="ts">
	/**
	 * Contains a render-time throw to ONE panel instead of the whole page.
	 *
	 * The run page composes several independent panels over the same untyped
	 * stage-output JSONB. A single bad payload — a keyed `{#each}` whose key field
	 * is absent for that producer's shape, a renderer reading a field that arrived
	 * as null — used to throw during render and take the ENTIRE document with it:
	 * measured live as `document.body.innerText.length === 0`, no `<main>`, one
	 * console error. A completed run showing nothing at all is far worse than one
	 * panel showing a fault notice next to four working ones.
	 *
	 * Note: `<svelte:boundary>` catches client-side render/effect errors only. It
	 * is a blast-radius limiter and a visible fault signal, NOT a substitute for
	 * fixing the payload handling that threw.
	 */
	import type { Snippet } from 'svelte';

	let { name, children }: { name: string; children: Snippet } = $props();
</script>

<svelte:boundary>
	{@render children()}

	{#snippet failed(error: unknown)}
		<section
			role="alert"
			data-testid="panel-boundary-failed"
			data-panel={name}
			class="rounded-[var(--radius-lg)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4"
		>
			<h3 class="text-sm font-semibold text-[var(--color-danger-text)] mb-1">
				{name} could not be displayed
			</h3>
			<p class="text-sm text-[var(--color-danger-text)]">
				The rest of this run page is unaffected. {error instanceof Error
					? error.message
					: String(error)}
			</p>
		</section>
	{/snippet}
</svelte:boundary>

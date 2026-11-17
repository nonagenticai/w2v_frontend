<script lang="ts">
	// Non-Agentic brand mark — the dot-grid logo shared verbatim with the `fr`
	// app + the nonagentic.ai marketing site so every app reads as one product.
	// The vertical lines use currentColor (set by the parent's text colour) so
	// the mark works on both the light and dark/navy chrome; the teal/coral dots
	// are fixed brand colours.
	interface Props {
		/** Square size of the mark in px. */
		size?: number;
		/** Render the "Non-Agentic" wordmark next to the mark. */
		showWord?: boolean;
		/** Extra classes on the wrapper. */
		class?: string;
	}
	let { size = 28, showWord = false, class: klass = '' }: Props = $props();
</script>

<span class={`inline-flex items-center gap-2 ${klass}`}>
	<svg
		width={size}
		height={size}
		viewBox="0 0 36 36"
		fill="none"
		role="img"
		aria-label="Non-Agentic"
		style="color: var(--color-text-muted)"
	>
		<line x1="6" y1="4" x2="6" y2="32" stroke="currentColor" stroke-width="0.8" opacity="0.55" />
		<line x1="14" y1="4" x2="14" y2="32" stroke="currentColor" stroke-width="0.8" opacity="0.55" />
		<line x1="22" y1="4" x2="22" y2="32" stroke="currentColor" stroke-width="0.8" opacity="0.55" />
		<line x1="30" y1="4" x2="30" y2="32" stroke="currentColor" stroke-width="0.8" opacity="0.55" />
		<circle cx="6" cy="8" r="2.4" fill="#14b8a6" />
		<circle cx="14" cy="14" r="2.4" fill="#14b8a6" />
		<circle cx="22" cy="18" r="2.4" fill="#14b8a6" />
		<circle cx="30" cy="14" r="2.4" fill="#14b8a6" />
		<circle cx="6" cy="28" r="2.4" fill="#f97316" />
		<circle cx="14" cy="22" r="2.4" fill="#f97316" />
		<circle cx="22" cy="18" r="2.4" fill="#f97316" opacity="0.6" />
		<circle cx="30" cy="22" r="2.4" fill="#f97316" />
	</svg>
	{#if showWord}
		<span
			class="font-semibold leading-none text-[var(--color-text)]"
			style="font-family: var(--font-display)"
		>
			Non-Agentic
		</span>
	{/if}
</span>

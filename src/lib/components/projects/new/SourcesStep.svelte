<script lang="ts">
	import { SourceCollector } from '$lib/components/studio';
	import { createWizard as cw } from './create-wizard.svelte.js';
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">{cw.sourcesStepLabel}</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			{#if cw.isCourse}
				Ground the course in anything — one or more websites, PDFs, books, or docs. The pipeline
				scrapes and parses them to ground the outline and every lesson it generates. All optional.
			{:else if cw.usesSingleSource}
				Optional extra material — websites, PDFs, books, or docs — to ground the review script, in
				addition to the target site above. The pipeline scrapes and parses them for accurate facts
				and claims.
			{:else}
				Build this from anything — one or more websites, PDFs, books, or docs. The pipeline scrapes
				and parses them to ground the script (and pull illustrative images). All optional; you can
				also write the brief from scratch.
			{/if}
		</p>
	</div>
	<SourceCollector bind:sources={cw.sources} />
</section>

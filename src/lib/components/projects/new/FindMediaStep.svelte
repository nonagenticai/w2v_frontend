<script lang="ts">
	import { MediaFinder } from '$lib/components/studio';
	import { createWizard as cw } from './create-wizard.svelte.js';
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Find media</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			Search real images & clips and pin the ones you want. Pinned media is added to your sources
			and ingested with the run. {#if cw.pinnedMediaNote}{cw.pinnedMediaNote}{/if}
		</p>
	</div>
	<MediaFinder bind:sources={cw.sources} />
	<label class="flex items-center gap-2 pt-1 text-sm text-[var(--color-text)]">
		<input
			type="checkbox"
			bind:checked={cw.mediaDiscovery}
			class="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
		/>
		Also let the pipeline auto-discover extra media during the run
	</label>
</section>

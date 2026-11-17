<script lang="ts">
	import { resolve } from '$app/paths';
	import { VerbatimItemList } from '$lib/components/studio';
	import type { VerbatimItemCreateRequest, VerbatimItemResponse } from '$lib/types';

	let {
		projectId,
		items,
		loadError = null,
		onCreate,
		onDelete
	}: {
		projectId: string;
		items: VerbatimItemResponse[];
		/** Set when the list FETCH failed. `items` is then an empty fallback, and
		 *  rendering it as "0 total / no items yet" would tell the operator this
		 *  project has no verbatim requirements when we simply do not know. */
		loadError?: unknown;
		onCreate: (body: VerbatimItemCreateRequest) => Promise<void>;
		onDelete: (itemId: string) => Promise<void>;
	} = $props();
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6"
>
	<div class="flex items-center justify-between mb-3 flex-wrap gap-2">
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Verbatim items</h2>
			<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
				Literal text every run of this project must surface. Items added here also appear on the
				dedicated
				<a
					href={resolve(`/projects/${projectId}/verbatim`)}
					class="text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
					>project verbatim</a
				>
				page.
			</p>
		</div>
		<span class="text-xs text-[var(--color-text-muted)]">
			{loadError ? 'unavailable' : `${items.length} total`}
		</span>
	</div>

	{#if loadError}
		<p
			data-testid="verbatim-load-error"
			class="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]"
		>
			Verbatim items could not be loaded — this is not the same as having none. Reload to try again.
		</p>
	{:else}
		<VerbatimItemList {items} {onCreate} {onDelete} />
	{/if}
</section>

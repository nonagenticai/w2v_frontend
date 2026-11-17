<script lang="ts">
	// The honest report of a finished tenant delete. The orchestrator deletes ITS
	// data only; other w2v services keep their own tenant rows until each gains an
	// internal tenant-delete endpoint (`result.complete === false`). This notice is
	// deliberately loud: a "Done" pill alone reads as "everything is gone".
	import type { DeleteOutcome } from '$lib/api/tenant-offboarding.js';

	let { outcome }: { outcome: DeleteOutcome } = $props();
</script>

{#if outcome.complete}
	<p class="mt-2 text-sm text-[var(--color-text)]" data-testid="offboarding-delete-complete">
		All data was deleted.
	</p>
{:else}
	<div
		role="alert"
		class="mt-2 rounded-[var(--radius-md)] border border-[var(--color-danger)] p-3 text-sm text-[var(--color-text)]"
		data-testid="offboarding-delete-incomplete"
	>
		<p class="font-semibold text-[var(--color-danger)]">
			Deletion is NOT complete — data in {outcome.notDeleted.length}
			{outcome.notDeleted.length === 1 ? 'service was' : 'services were'} not deleted.
		</p>
		{#if outcome.note}
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">{outcome.note}</p>
		{/if}
		{#if outcome.notDeleted.length > 0}
			<ul class="mt-2 list-disc pl-5" data-testid="offboarding-not-deleted">
				{#each outcome.notDeleted as d (d.service)}
					<li>
						<span class="font-mono">{d.service}</span>{#if d.data && d.data.length > 0}
							<span class="text-xs text-[var(--color-text-muted)]"> — {d.data.join(', ')}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

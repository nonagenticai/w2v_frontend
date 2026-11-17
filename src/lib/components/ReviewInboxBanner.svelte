<!--
  ReviewInboxBanner — "these runs are waiting for your review", on the dashboard and
  the project list. Reads the shared review-inbox store (the Header owns the poll), so
  it adds no request of its own. Each row links to the checkpoint's review page;
  Dismiss calls POST /api/review-inbox/{run_id}/dismiss. A dismissed notice comes back
  as the server's 24h reminder (flagged `reminder`).
-->
<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- reviewHref() is resolve()d and safeHref()-guarded. */
	import { Bell } from '@lucide/svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { Button } from '$lib/components/ui';
	import { reviewHref, reviewInboxStore, waitingLabel } from '$lib/stores/review-inbox.svelte.js';
	import { safeHref } from '$lib/utils/safe-url';
	import { stageLabel } from '$lib/utils/stage-labels';

	const items = $derived(reviewInboxStore.items);
</script>

{#if items.length > 0}
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-surface)] p-4"
		aria-label="Runs waiting for your review"
		data-testid="review-inbox-banner"
	>
		<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
			<Icon icon={Bell} size={16} class="text-[var(--color-warning)]" />
			{items.length === 1 ? 'A run is' : `${items.length} runs are`} waiting for your review
		</h2>
		<ul class="flex flex-col divide-y divide-[var(--color-border)]">
			{#each items as item (item.run_id)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
					data-testid="review-inbox-banner-item"
				>
					<a
						href={safeHref(reviewHref(item))}
						class="min-w-0 text-[var(--color-text)] hover:underline"
					>
						<strong>{item.project_title}</strong>
						{#if item.deliverable_name}· {item.deliverable_name}{/if}
						{#if item.stage_name}— review {stageLabel(item.stage_name)}{:else}— review checkpoint{/if}
						{#if item.paused_at}
							<span class="text-[var(--color-text-muted)]">
								({waitingLabel(item.paused_at)})
							</span>
						{/if}
						{#if item.reminder}
							<span class="font-medium text-[var(--color-warning-text)]">Reminder</span>
						{/if}
					</a>
					<span class="flex items-center gap-2">
						<Button variant="secondary" size="sm" href={safeHref(reviewHref(item))}>Review</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={reviewInboxStore.dismissing.has(item.run_id)}
							aria-label="Dismiss review reminder for {item.project_title}"
							onclick={() => void reviewInboxStore.dismiss(item.run_id, item.reminder)}
						>
							Dismiss
						</Button>
					</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

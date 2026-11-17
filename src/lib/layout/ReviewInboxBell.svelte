<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- reviewHref() is resolve()d and safeHref()-guarded. */
	import { untrack } from 'svelte';
	import { Bell } from '@lucide/svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { reviewHref, reviewInboxStore, waitingLabel } from '$lib/stores/review-inbox.svelte.js';
	import { safeHref } from '$lib/utils/safe-url';
	import { stageLabel } from '$lib/utils/stage-labels';

	// Top-bar bell for the "needs your review" inbox. This component OWNS the poll: the
	// Header only mounts inside the authenticated app shell, and the effect's cleanup
	// stops it when the shell goes away. The dashboard / project-list banners read the
	// same store.
	$effect(() => untrack(() => reviewInboxStore.startPolling()));

	const items = $derived(reviewInboxStore.items);
	const count = $derived(items.length);

	let open = $state(false);
	let wrapperEl = $state<HTMLElement>();

	// Same outside-click / Escape handling as UserMenu.
	$effect(() => {
		if (!open) return;
		function onDocClick(e: MouseEvent) {
			if (wrapperEl && !wrapperEl.contains(e.target as Node)) open = false;
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') open = false;
		}
		document.addEventListener('click', onDocClick, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onDocClick, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="relative" bind:this={wrapperEl}>
	<button
		type="button"
		onclick={() => (open = !open)}
		class="relative rounded-full p-2 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)]"
		aria-haspopup="true"
		aria-expanded={open}
		aria-label={count > 0
			? `${count} run${count === 1 ? '' : 's'} waiting for your review`
			: 'No runs waiting for your review'}
		data-testid="review-inbox-bell"
	>
		<Icon icon={Bell} size={20} />
		{#if count > 0}
			<span
				class="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-xs font-semibold text-white"
				data-testid="review-inbox-count"
			>
				{count}
			</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute end-0 z-30 mt-2 w-80 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] shadow-soft"
			data-testid="review-inbox-panel"
		>
			<p
				class="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold text-[var(--color-text)]"
			>
				Needs your review
			</p>
			{#if count === 0}
				<p class="px-4 py-3 text-sm text-[var(--color-text-muted)]">Nothing is waiting for you.</p>
			{:else}
				<ul class="max-h-96 overflow-auto py-1">
					{#each items as item (item.run_id)}
						<li class="flex items-start gap-2 px-4 py-2 text-sm hover:bg-[var(--color-surface)]">
							<a
								href={safeHref(reviewHref(item))}
								onclick={() => (open = false)}
								class="min-w-0 flex-1 text-[var(--color-text)]"
							>
								<span class="block truncate font-medium">{item.project_title}</span>
								<span class="block truncate text-xs text-[var(--color-text-muted)]">
									{item.stage_name ? stageLabel(item.stage_name) : 'Checkpoint'}
									{#if item.paused_at}· {waitingLabel(item.paused_at)}{/if}
									{#if item.reminder}· reminder{/if}
								</span>
							</a>
							<button
								type="button"
								class="shrink-0 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
								disabled={reviewInboxStore.dismissing.has(item.run_id)}
								aria-label="Dismiss review reminder for {item.project_title}"
								onclick={() => void reviewInboxStore.dismiss(item.run_id, item.reminder)}
							>
								Dismiss
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<script lang="ts">
	// The ONE page header: optional back link, kicker, the page's single h1, a
	// subtitle, and a right-aligned action slot. The topbar renders no title, so
	// this h1 is the page's only top-level heading.
	/* eslint-disable svelte/no-navigation-without-resolve -- back.href is a caller-provided internal route. */
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';

	let {
		title,
		kicker,
		crumbs,
		subtitle,
		description,
		back,
		actions,
		titleTestid
	}: {
		title: string;
		kicker?: string;
		/** Breadcrumb trail rendered in the kicker slot (deep pages); wins over `kicker`. */
		crumbs?: Snippet;
		/** Plain-text subtitle. Use `description` instead for rich content (links). */
		subtitle?: string;
		description?: Snippet;
		/** Consistent "Back to X" link above the kicker. */
		back?: { href: string; label: string };
		actions?: Snippet;
		titleTestid?: string;
	} = $props();
</script>

<header class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
	<div class="min-w-0">
		{#if back}
			<a
				href={back.href}
				class="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
				data-testid="page-back-link"
			>
				<ArrowLeft class="h-4 w-4" />
				Back to {back.label}
			</a>
		{/if}
		{#if crumbs}
			<nav aria-label="Breadcrumb" class="text-kicker text-[var(--color-text-muted)]">
				{@render crumbs()}
			</nav>
		{:else if kicker}
			<p class="text-kicker text-[var(--color-text-muted)]">{kicker}</p>
		{/if}
		<h1
			class="font-display text-2xl font-bold text-[var(--color-text)] break-words"
			data-testid={titleTestid}
		>
			{title}
		</h1>
		{#if subtitle}
			<p class="mt-1 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
		{/if}
		{#if description}
			<div class="mt-1 text-sm text-[var(--color-text-muted)]">{@render description()}</div>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
</header>

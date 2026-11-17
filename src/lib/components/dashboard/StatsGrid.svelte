<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	import type { DashboardStats } from '$lib/types';
	import { Card } from '$lib/components/ui';
	import { Briefcase, CheckCircle, Play, XCircle } from '@lucide/svelte';

	// Optional per-tile drill-down targets. When a tile has an href it becomes a
	// link into the matching filtered /projects view (e.g. In production →
	// /projects?status=producing); without one it renders as a plain card.
	//
	// A `null` count means "could not be loaded" and renders "—", never a fake 0.
	// There is deliberately no success-rate tile: completed/total counted drafts and
	// archived projects as failures.
	interface Props {
		stats: DashboardStats;
		hrefs?: Partial<Record<keyof DashboardStats, string>>;
	}

	let { stats, hrefs }: Props = $props();

	type Tile = {
		key: keyof DashboardStats;
		label: string;
		value: string;
		icon: typeof Briefcase;
		iconWrap: string;
		iconColor: string;
		href?: string;
	};

	const show = (n: number | null) => (n === null ? '—' : String(n));

	const tiles: Tile[] = $derived([
		{
			key: 'total',
			label: 'Projects',
			value: show(stats.total),
			icon: Briefcase,
			iconWrap: 'bg-primary-500/15 border border-primary-500/30',
			iconColor: 'text-primary-600 dark:text-primary-300',
			href: hrefs?.total
		},
		{
			key: 'producing',
			label: 'In production',
			value: show(stats.producing),
			icon: Play,
			iconWrap: 'bg-status-running/15 border border-status-running/30',
			iconColor: `text-status-running ${(stats.producing ?? 0) > 0 ? 'animate-pulse' : ''}`,
			href: hrefs?.producing
		},
		{
			key: 'completed',
			label: 'Completed',
			value: show(stats.completed),
			icon: CheckCircle,
			iconWrap: 'bg-status-completed/15 border border-status-completed/30',
			iconColor: 'text-status-completed',
			href: hrefs?.completed
		},
		{
			key: 'failed',
			label: 'Failed',
			value: show(stats.failed),
			icon: XCircle,
			iconWrap: 'bg-[var(--color-danger-bg)] border border-[var(--color-danger)]/30',
			iconColor: 'text-[var(--color-danger)]',
			href: hrefs?.failed
		}
	]);
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
	{#each tiles as tile (tile.key)}
		{#snippet body()}
			<div class="p-4 md:p-5 flex items-center gap-4">
				<div class="p-2.5 rounded-xl {tile.iconWrap}">
					<tile.icon class="h-5 w-5 {tile.iconColor}" />
				</div>
				<div>
					<p class="text-xs text-text-secondary">{tile.label}</p>
					<p class="text-2xl font-semibold text-text mt-0.5" data-testid={`stat-${tile.key}`}>
						{tile.value}
					</p>
				</div>
			</div>
		{/snippet}

		{#if tile.href}
			<!-- Caller-provided internal links, incl. query strings like
			     ?status=producing. resolve() only types a static route id, not an
			     arbitrary string, so plain href is correct here (same tolerated
			     pattern as the license banner components). -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -- tile.href is a caller-provided runtime string; resolve() only types static route ids. -->
			<a
				href={safeHref(tile.href)}
				class="block rounded-[var(--radius-lg)] transition hover:shadow-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
				aria-label="{tile.label}: {tile.value}"
			>
				<Card hover>{@render body()}</Card>
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			<Card>{@render body()}</Card>
		{/if}
	{/each}
</div>

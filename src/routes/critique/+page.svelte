<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import PageHeader from '$lib/layout/PageHeader.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { CritiqueResponse } from '$lib/types';
	import { Tabs, Pagination, Button, EmptyState, Card, Input } from '$lib/components/ui';
	import { formatRelativeTime, extractHostname } from '$lib/utils/format.js';
	import { critique } from '$lib/api';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import { ShieldCheck, Globe } from '@lucide/svelte';

	let { data } = $props();

	// New-critique form: submit a URL → start a critique → open its detail page.
	let newUrl = $state('');
	let starting = $state(false);

	function normalizeUrl(raw: string): string {
		const trimmed = raw.trim();
		if (!trimmed) return '';
		return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	}

	async function startCritique() {
		const url = normalizeUrl(newUrl);
		if (!url) return;
		starting = true;
		try {
			const created = await critique.create({ url });
			newUrl = '';
			await goto(resolve(`/critique/${created.id}`));
		} catch (err) {
			toastError('Could not start critique', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			starting = false;
		}
	}

	function onUrlKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			void startCritique();
		}
	}

	let activeTab = $state('');
	let currentPage = $state(1);
	let lastSyncedTab = '';
	let lastSyncedPage = 1;

	// Sync from data when SvelteKit re-runs the load function
	$effect(() => {
		activeTab = data.currentStatus;
		currentPage = data.currentPage;
		lastSyncedTab = data.currentStatus;
		lastSyncedPage = data.currentPage;
	});

	// Navigate when tab changes (via user click, not data sync)
	$effect(() => {
		if (activeTab !== lastSyncedTab) {
			lastSyncedTab = activeTab;
			const params = new SvelteURLSearchParams();
			if (activeTab) params.set('status', activeTab);
			params.set('page', '1');
			goto(resolve(`/critique?${params}`), { replaceState: true, noScroll: true });
		}
	});

	// Navigate when page changes (via user click)
	$effect(() => {
		if (currentPage !== lastSyncedPage) {
			lastSyncedPage = currentPage;
			const params = new SvelteURLSearchParams();
			if (activeTab) params.set('status', activeTab);
			params.set('page', String(currentPage));
			goto(resolve(`/critique?${params}`), { replaceState: true, noScroll: true });
		}
	});

	const statusTabs = [
		{ value: '', label: 'All' },
		{ value: 'pending', label: 'Pending' },
		{ value: 'running', label: 'Running' },
		{ value: 'completed', label: 'Completed' },
		{ value: 'failed', label: 'Failed' }
	];

	function severitySummary(item: CritiqueResponse): string {
		const counts: Record<string, number> = {};
		for (const f of item.findings) {
			counts[f.severity] = (counts[f.severity] ?? 0) + 1;
		}
		return (
			Object.entries(counts)
				.map(([s, c]) => `${c} ${s}`)
				.join(', ') || 'No findings'
		);
	}
</script>

<svelte:head>
	<title>Critique - Studio</title>
</svelte:head>

<Page testid="critique-home">
	<PageHeader
		kicker="Create"
		title="Critique"
		subtitle="Review a website for SEO, accessibility, security, performance and UX — then redesign it."
	/>

	<!-- New critique: submit a URL to start a standalone website review. -->
	<Card class="p-5">
		<form class="flex flex-col gap-3 sm:flex-row sm:items-end" onsubmit={(e) => e.preventDefault()}>
			<div class="flex-1">
				<Input
					name="critique-url"
					label="Website URL"
					placeholder="example.com"
					bind:value={newUrl}
					onkeydown={onUrlKeydown}
					disabled={starting}
				>
					{#snippet icon()}
						<Globe class="h-4 w-4 text-text-muted" />
					{/snippet}
				</Input>
			</div>
			<Button
				variant="primary"
				type="submit"
				loading={starting}
				disabled={!newUrl.trim() || starting}
				onclick={startCritique}
			>
				{starting ? 'Starting...' : 'Run critique'}
			</Button>
		</form>
	</Card>

	<Tabs items={statusTabs} bind:value={activeTab} />

	{#if data.critiqueList.items.length === 0}
		<EmptyState
			title="No critiques found"
			description={activeTab
				? `No ${activeTab} critiques found.`
				: 'Enter a website URL above to run your first critique.'}
		>
			{#snippet icon()}
				<ShieldCheck class="h-12 w-12" />
			{/snippet}
		</EmptyState>
	{:else}
		<div class="space-y-2">
			{#each data.critiqueList.items as item (item.id)}
				<a
					href={resolve(`/critique/${item.id}`)}
					class="flex items-center gap-4 px-4 py-3 bg-surface border border-border rounded-xl hover:border-border-hover hover:bg-surface-raised transition-all duration-200"
				>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium text-text truncate">{extractHostname(item.url)}</p>
						<p class="text-xs text-text-secondary">{formatRelativeTime(item.created_at)}</p>
					</div>
					<p class="text-xs text-text-secondary hidden sm:block">{severitySummary(item)}</p>
					<span
						class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
            {item.status === 'completed'
							? 'bg-status-completed/15 text-status-completed'
							: item.status === 'running'
								? 'bg-status-running/15 text-status-running'
								: item.status === 'failed'
									? 'bg-status-failed/15 text-status-failed'
									: 'bg-status-pending/15 text-status-pending'}"
					>
						{item.status.charAt(0).toUpperCase() + item.status.slice(1)}
					</span>
				</a>
			{/each}
		</div>

		<Pagination bind:page={currentPage} pageSize={20} total={data.critiqueList.total} />
	{/if}
</Page>

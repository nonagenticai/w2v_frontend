<script lang="ts">
	import { Menu } from '@lucide/svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
	import TenantSwitcher from './TenantSwitcher.svelte';
	import UserMenu from './UserMenu.svelte';
	import ReviewInboxBell from './ReviewInboxBell.svelte';
	import { isSuperAdmin } from '$lib/stores/auth.svelte';

	// The page title is owned by each page's <PageHeader> h1 — the topbar renders no
	// heading of its own (two h1s per page that disagreed: "Critiques" vs "Critique",
	// "Dashboard" vs "Studio Workspace").

	let {
		healthStatus = 'unknown',
		onToggleSidebar
	}: {
		healthStatus?: 'healthy' | 'degraded' | 'down' | 'unknown';
		onToggleSidebar?: () => void;
	} = $props();

	const statusDot: Record<string, string> = {
		healthy: 'bg-[var(--color-success)]',
		degraded: 'bg-[var(--color-warning)]',
		down: 'bg-[var(--color-danger)]',
		unknown: 'bg-[var(--color-text-muted)]'
	};

	const statusLabel: Record<string, string> = {
		healthy: 'API healthy',
		degraded: 'API degraded',
		down: 'API unreachable',
		unknown: 'API unknown'
	};
</script>

<header
	class="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 md:px-6"
>
	<div class="flex min-w-0 items-center gap-3">
		<button
			type="button"
			onclick={() => onToggleSidebar?.()}
			class="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)] lg:hidden"
			aria-label="Toggle sidebar"
		>
			<Icon icon={Menu} size={20} />
		</button>
	</div>

	<div class="flex items-center gap-3">
		<!-- API health is operator telemetry: super_admin only. -->
		{#if isSuperAdmin()}
			<div
				data-testid="api-health-pill"
				class="hidden items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] md:flex"
			>
				<span class={`h-2 w-2 rounded-full ${statusDot[healthStatus]}`}></span>
				<span>{statusLabel[healthStatus]}</span>
			</div>
		{/if}
		<ReviewInboxBell />
		<TenantSwitcher />
		<ThemeToggle />
		<UserMenu />
	</div>
</header>

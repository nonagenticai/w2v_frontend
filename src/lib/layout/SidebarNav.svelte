<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- nav hrefs are fixed
     internal routes from navConfig; resolve() is unnecessary here. */
	import { page } from '$app/stores';
	import { PanelLeft, Plus } from '@lucide/svelte';
	import {
		HOME_ITEM,
		NEW_PROJECT_CTA,
		isItemActive,
		visibleSections,
		type NavItem
	} from './navConfig';
	import { sidebar } from '$lib/stores/sidebar.svelte';
	import { isSuperAdmin, isTenantAdmin } from '$lib/stores/auth.svelte';
	import BrandMark from '$lib/components/ui/BrandMark.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	// `forceExpanded` is used by the mobile drawer instance so it always renders
	// full-width labels even when the desktop rail is collapsed. `testidPrefix`
	// keeps the two instances' testids distinct (rail = `sidebar`, drawer = `drawer`).
	let {
		onnavigate,
		forceExpanded = false,
		testidPrefix = 'sidebar'
	}: { onnavigate?: () => void; forceExpanded?: boolean; testidPrefix?: string } = $props();

	const collapsed = $derived(forceExpanded ? false : sidebar.collapsed);
	const currentPath = $derived($page.url.pathname);

	// Role-gated sections/items only show for the matching realm role (super_admin is
	// composite — passes the tenant gate). Gated on ROLE, not tenant.
	const roles = $derived({ isSuperAdmin: isSuperAdmin(), isTenantAdmin: isTenantAdmin() });
	const sections = $derived(visibleSections(roles));

	const ACTIVE_CLS = 'bg-[var(--color-accent-bg)] text-[var(--color-accent-text)] font-medium';
	const INACTIVE_CLS =
		'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)]';
</script>

<nav
	class={`flex h-full w-full flex-col gap-3 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] py-4 ${
		collapsed ? 'px-1.5' : 'px-2'
	}`}
	aria-label="Primary"
>
	<div class={`flex items-center px-1 ${collapsed ? 'flex-col gap-2' : 'gap-2'}`}>
		<a
			href="/"
			onclick={() => onnavigate?.()}
			class="flex items-center rounded-[var(--radius-sm)] transition hover:opacity-80"
			aria-label="Studio — home"
			title="Studio"
		>
			<BrandMark size={26} showWord={!collapsed} />
		</a>
		{#if !forceExpanded}
			<button
				type="button"
				class={`hidden lg:grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-text)] ${
					collapsed ? '' : 'ml-auto'
				}`}
				aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				aria-pressed={collapsed}
				title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				onclick={() => sidebar.toggleCollapsed()}
			>
				<Icon icon={PanelLeft} size={16} />
			</button>
		{/if}
	</div>

	<!-- The primary action is a button, not a nav row: it is something you DO, not
	     somewhere you GO, so it never competes with "Projects" for the highlight. -->
	<a
		href={NEW_PROJECT_CTA.href}
		onclick={() => onnavigate?.()}
		title={collapsed ? NEW_PROJECT_CTA.label : null}
		aria-label={collapsed ? NEW_PROJECT_CTA.label : undefined}
		data-testid={`${testidPrefix}-new-project`}
		class={`flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-sm font-medium text-[var(--color-on-primary)] transition hover:bg-[var(--color-accent-strong)] ${
			collapsed ? 'mx-auto h-10 w-10' : 'mx-1 px-3 py-2'
		}`}
	>
		<Icon icon={Plus} size={16} />
		{#if !collapsed}<span>{NEW_PROJECT_CTA.label}</span>{/if}
	</a>

	<div class="flex flex-col gap-0.5">
		{@render navLink(HOME_ITEM)}
	</div>

	{#each sections as section (section.id)}
		<div
			role="group"
			aria-labelledby={`nav-section-${section.id}`}
			class={`flex flex-col gap-0.5 ${section.divider ? 'border-t border-[var(--color-border)] pt-3' : ''}`}
			data-testid={`nav-section-${section.id}`}
		>
			<!-- The heading stays in the DOM when collapsed (sr-only) so the group keeps
			     its accessible name. -->
			<p
				id={`nav-section-${section.id}`}
				class={collapsed
					? 'sr-only'
					: 'px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]'}
			>
				{section.label}
			</p>
			{#each section.items as item (item.id)}
				{@render navLink(item)}
			{/each}
		</div>
	{/each}

	{#if roles.isSuperAdmin}
		<!-- Operator chrome: the build version is for the platform operator only. -->
		<div class="mt-auto px-3 pt-2">
			{#if !collapsed}
				<p class="text-xs text-[var(--color-text-muted)]" data-testid="app-version">
					v{__APP_VERSION__}
				</p>
			{/if}
		</div>
	{/if}
</nav>

{#snippet navLink(item: NavItem)}
	{@const active = isItemActive(item, currentPath)}
	<a
		href={item.href}
		onclick={() => onnavigate?.()}
		title={collapsed ? item.label : null}
		aria-current={active ? 'page' : undefined}
		class={`flex items-center gap-3 rounded-[var(--radius-md)] text-sm transition ${
			collapsed ? 'h-10 justify-center px-0' : 'px-3 py-1.5'
		} ${active ? ACTIVE_CLS : INACTIVE_CLS}`}
	>
		<span class="flex shrink-0 items-center">
			<Icon icon={item.icon} size={18} />
		</span>
		{#if !collapsed}
			<span class="min-w-0 flex-1 truncate leading-tight">{item.label}</span>
		{/if}
	</a>
{/snippet}

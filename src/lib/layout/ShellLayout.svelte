<script lang="ts">
	import type { Snippet } from 'svelte';
	import SidebarNav from './SidebarNav.svelte';
	import Header from './Header.svelte';
	import { sidebar } from '$lib/stores/sidebar.svelte';

	let {
		children,
		healthStatus = 'unknown'
	}: {
		children: Snippet;
		healthStatus?: 'healthy' | 'degraded' | 'down' | 'unknown';
	} = $props();

	// Mobile off-canvas drawer state (desktop uses the persistent rail instead).
	let mobileOpen = $state(false);

	const sidebarWidth = $derived(sidebar.collapsed ? '64px' : '220px');
</script>

<div class="flex h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
	<!-- Persistent desktop rail; width follows the collapse toggle. -->
	<!-- data-testid: the rail and the drawer below render the SAME <nav
	     aria-label="Primary">, so no role/name query can tell them apart, and
	     the drawer is always in the DOM (translated off-screen, not removed) —
	     before the stylesheet applies both have a bounding box and a `:visible`
	     filter matches two elements. -->
	<div class="hidden shrink-0 lg:block" style:width={sidebarWidth} data-testid="sidebar-rail">
		<SidebarNav />
	</div>

	<!-- Mobile drawer + backdrop. -->
	{#if mobileOpen}
		<button
			type="button"
			class="fixed inset-0 z-20 bg-black/40 lg:hidden"
			aria-label="Close sidebar"
			onclick={() => (mobileOpen = false)}
		></button>
	{/if}
	<div
		class={`fixed inset-y-0 left-0 z-30 w-[240px] transform transition-transform duration-200 lg:hidden ${
			mobileOpen ? 'translate-x-0' : '-translate-x-full'
		}`}
		data-testid="sidebar-drawer"
		inert={!mobileOpen}
	>
		<SidebarNav forceExpanded testidPrefix="drawer" onnavigate={() => (mobileOpen = false)} />
	</div>

	<!-- Main column: sticky header + scrolling content. -->
	<main class="flex min-w-0 flex-1 flex-col overflow-hidden">
		<Header {healthStatus} onToggleSidebar={() => (mobileOpen = !mobileOpen)} />
		<div class="flex-1 overflow-auto">
			<div class="mx-auto max-w-[1500px] px-4 py-6 md:px-7 md:py-8">
				{@render children()}
			</div>
		</div>
	</main>
</div>

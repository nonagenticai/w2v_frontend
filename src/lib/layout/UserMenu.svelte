<script lang="ts">
	import { resolve } from '$app/paths';
	import { getUser, clearUser, canAccessAdmin } from '$lib/stores/auth.svelte.js';
	import { manageAccount } from '$lib/services/keycloak.js';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { accountInitials, accountLabel } from '$lib/utils/display-name';
	import { ChevronDown, LogOut, Settings, Shield, UserCog } from '@lucide/svelte';

	// Account menu in the app header — the standard "who am I / sign out" surface
	// (ported from fr/frontend's Header user menu). The logout machinery already
	// existed in the auth store (clearUser: cookie-delete → cache flush → Keycloak
	// end-session); this just makes it reachable. Self-sources identity from the
	// auth store so the Header stays a dumb container.
	const user = $derived(getUser());
	// No plan pill here, matching fr's Header (name + email only). The plan is a
	// TENANT-level licence (GET /api/license/status → licenseGate.planCode), shown
	// on /license-upgrade — never a user claim (Keycloak emits none, /auth/me has none).

	// Admin-tier entry: visible to tenant_admin / super_admin (composite). Dormant
	// for everyone until a portal-realm role is assigned + roles reach /auth/me.
	const showAdmin = $derived(canAccessAdmin());

	// The licence-token path's /auth/me `name` is the bare subject UUID — a
	// placeholder, skipped for a real name / handle / email (display-name.ts).
	const displayName = $derived(accountLabel(user).label);
	const initials = $derived(accountInitials(user));

	let open = $state(false);
	let wrapperEl = $state<HTMLElement>();
	let signingOut = $state(false);

	// Close on outside click (capture phase, registered only while open so the
	// opening click itself doesn't immediately dismiss) and on Escape.
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

	async function handleManageAccount() {
		open = false;
		try {
			await manageAccount();
		} catch (err) {
			toastError('Could not open account', err instanceof Error ? err.message : 'Unknown error');
		}
	}

	async function handleSignOut() {
		signingOut = true;
		try {
			// clearUser() flushes cookies + per-user caches, then redirects to the
			// Keycloak end-session endpoint — the page navigates away on success.
			await clearUser();
		} catch (err) {
			signingOut = false;
			toastError('Sign out failed', err instanceof Error ? err.message : 'Unknown error');
		}
	}
</script>

<div class="relative" bind:this={wrapperEl}>
	<button
		type="button"
		onclick={() => (open = !open)}
		class="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] py-1 pe-2 ps-1 text-sm text-[var(--color-text)] transition hover:bg-[var(--color-surface-strong)]"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="Account menu"
		data-testid="user-menu"
	>
		<span
			class="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent-text)]"
			aria-hidden="true"
		>
			{initials}
		</span>
		<span class="hidden max-w-[10rem] truncate font-medium md:inline">{displayName}</span>
		<Icon icon={ChevronDown} size={16} class="text-[var(--color-text-muted)]" />
	</button>

	{#if open}
		<div
			role="menu"
			class="absolute end-0 z-30 mt-2 w-64 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] shadow-soft"
			data-testid="user-menu-panel"
		>
			<div class="border-b border-[var(--color-border)] px-4 py-3">
				<p class="truncate text-sm font-semibold text-[var(--color-text)]">{displayName}</p>
				{#if user?.email && user.email !== displayName}
					<p class="truncate text-xs text-[var(--color-text-muted)]">{user.email}</p>
				{/if}
			</div>

			<div class="py-1">
				{#if showAdmin}
					<a
						href={resolve('/admin')}
						role="menuitem"
						onclick={() => (open = false)}
						class="flex items-center gap-2.5 px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]"
						data-testid="admin-link"
					>
						<Icon icon={Shield} size={16} class="text-[var(--color-text-muted)]" />
						Workspace overview
					</a>
				{/if}
				<a
					href={resolve('/settings')}
					role="menuitem"
					onclick={() => (open = false)}
					class="flex items-center gap-2.5 px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]"
					data-testid="user-menu-settings"
				>
					<Icon icon={Settings} size={16} class="text-[var(--color-text-muted)]" />
					Settings
				</a>
				<button
					type="button"
					role="menuitem"
					onclick={handleManageAccount}
					class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]"
					data-testid="user-menu-account"
				>
					<Icon icon={UserCog} size={16} class="text-[var(--color-text-muted)]" />
					Manage account
				</button>
			</div>

			<div class="border-t border-[var(--color-border)] py-1">
				<button
					type="button"
					role="menuitem"
					onclick={handleSignOut}
					disabled={signingOut}
					class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)] disabled:opacity-60"
					data-testid="user-menu-signout"
				>
					<Icon icon={LogOut} size={16} />
					{signingOut ? 'Signing out…' : 'Sign out'}
				</button>
			</div>
		</div>
	{/if}
</div>

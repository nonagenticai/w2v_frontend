<script lang="ts">
	import '../app.css';
	// Side-effect import: constructs the tenant-switcher singleton early so its
	// persisted `X-Active-Tenant-Id` is hydrated onto the API client before any
	// page fetch fires (a super_admin reload resumes acting as the saved tenant).
	import '$lib/stores/tenant-switcher.svelte.js';
	import { navigating, page } from '$app/stores';
	import { ShellLayout } from '$lib/layout';
	import { ToastContainer } from '$lib/components/ui';
	import {
		getHealthStatus,
		recheckHealth,
		startHealthPolling,
		stopHealthPolling
	} from '$lib/stores/health.svelte.js';
	import { onMount } from 'svelte';
	import { isLoading, isAuthenticated, hasNoWorkspace } from '$lib/stores/auth.svelte.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { login as keycloakLogin } from '$lib/services/keycloak.js';
	import { licenseGate, LICENSE_RENEW_URL } from '$lib/stores/licenseGate.svelte.js';
	import LicenseBlocked from '$lib/components/LicenseBlocked.svelte';
	import LicenseExpiringBanner from '$lib/components/LicenseExpiringBanner.svelte';
	import PendingInvites from '$lib/components/PendingInvites.svelte';
	import { installChunkReloadRecovery } from '$lib/chunk-reload.js';
	import { getThemeName } from '$lib/stores/settings.svelte.js';
	import { resolveTheme, applyTheme } from '$lib/styles/themeLogic.js';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const healthStatus = $derived(getHealthStatus());
	const authLoading = $derived(isLoading());
	const authenticated = $derived(isAuthenticated());
	const themeName = $derived(getThemeName());
	const backendDown = $derived(healthStatus === 'down');

	// The health poll starts HERE, not at health.svelte.ts module scope. A
	// module-load probe made the first status depend on ESM evaluation order,
	// which under `vite dev` intermittently resolved to 'down' against a healthy
	// backend. onMount is client-only, so the SSR pass is unaffected.
	onMount(() => {
		startHealthPolling();
		return stopHealthPolling;
	});

	// License gate (ships gate-OFF: the backend returns state:'active' until
	// W2V_LICENSE_GATE_ENABLED is flipped on, so this is inert in prod today).
	// Load the authoritative status the moment auth flips authenticated — don't
	// wait for the first poll interval — then refresh on an interval + on tab
	// focus, mirroring fr.
	const LICENSE_POLL_MS = 15 * 60 * 1000;
	let lastAuthed = false;
	$effect(() => {
		if (authenticated && !lastAuthed) {
			void licenseGate.load();
		}
		lastAuthed = authenticated;
	});
	$effect(() => {
		if (!authenticated || typeof window === 'undefined') return;
		const interval = setInterval(() => void licenseGate.load(), LICENSE_POLL_MS);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void licenseGate.load();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// SPA chunk-load resilience across a deploy — see `$lib/chunk-reload` for the one-shot
	// stale-chunk recovery reload and why it refuses to reload when sessionStorage is unavailable.
	$effect(() => {
		if (typeof window === 'undefined') return;
		return installChunkReloadRecovery();
	});

	// Treat the renew route as exempt so a blocked user can still reach renewal.
	const onRenewRoute = $derived(
		!/^https?:\/\/|^\/\//i.test(LICENSE_RENEW_URL) &&
			$page.url.pathname.startsWith(LICENSE_RENEW_URL)
	);
	const licenseBlocked = $derived(licenseGate.isBlocked && !onRenewRoute);

	// P2 tenancy: routes that work WITHOUT a workspace render outside the app
	// shell (whose nav + data fetches all need one). /invite/accept is how a
	// workspace-less user gets one; /no-workspace explains how to.
	const bareRoute = $derived(
		$page.url.pathname === '/no-workspace' || $page.url.pathname.startsWith('/invite/')
	);
	// `/auth/me` answered `tenant_id: null`: every tenant-scoped call would 403
	// NO_MEMBERSHIP, so send the user to the screen that explains why.
	const noWorkspace = $derived(authenticated && hasNoWorkspace());
	$effect(() => {
		if (noWorkspace && !bareRoute) void goto(resolve('/no-workspace'), { replaceState: true });
	});

	let retrying = $state(false);
	async function retryBackend() {
		if (retrying) return;
		retrying = true;
		try {
			const next = await recheckHealth();
			// On recovery, a full reload re-runs initAuth() (which re-fetches
			// /auth/me, re-plants the license token + cookies) and re-runs every
			// +page.ts load — the simplest way to recover all the state that was
			// skipped during the outage without trying to selectively invalidate.
			if (next !== 'down' && typeof window !== 'undefined') {
				window.location.reload();
			}
		} finally {
			retrying = false;
		}
	}

	// Resolve system dark preference for "default" theme
	let systemPrefersDark = $state(
		typeof window !== 'undefined'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
			: false
	);

	// Listen for OS-level theme changes
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = (e: MediaQueryListEvent) => {
			systemPrefersDark = e.matches;
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	// Apply the resolved theme to <html>. applyTheme dual-writes BOTH the fr
	// `.dark` class (ported tokens.css) AND the legacy `data-theme` attribute
	// (old warm-orange tokens) so new shell chrome and un-rebuilt pages theme
	// together during the rearchitecture.
	$effect(() => {
		if (typeof document === 'undefined') return;
		applyTheme(document.documentElement, resolveTheme(themeName, systemPrefersDark));
	});
</script>

<!-- Navigation loading indicator -->
{#if $navigating}
	<div class="fixed top-0 right-0 left-0 z-50 h-0.5">
		<div
			class="h-full bg-[var(--color-accent)]"
			style="animation: nav-progress 1s ease-in-out infinite; width: 100%;"
		></div>
	</div>
{/if}

{#if authLoading}
	<!-- Show loading while checking auth state -->
	<div class="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
		<div class="text-center">
			<div
				class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
			></div>
			<p class="mt-4 text-sm text-[var(--color-text-muted)]">Loading…</p>
		</div>
	</div>
{:else if !authenticated}
	<!-- Login prompt for unauthenticated users -->
	<div class="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
		<div class="max-w-md px-6 text-center">
			<h1 class="mb-2 text-2xl font-bold text-[var(--color-text)]">Studio</h1>
			<p class="mb-8 text-[var(--color-text-muted)]">
				Sign in to create demo videos from any website.
			</p>
			<button
				onclick={() => keycloakLogin()}
				class="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-6 py-3 font-medium text-[var(--color-on-primary)] transition-colors hover:bg-[var(--color-accent-strong)]"
			>
				Sign in
			</button>
		</div>
	</div>
{:else if backendDown}
	<!-- Backend unreachable: Keycloak session is valid, but /auth/me + /health
	     returned 5xx/network-error. Don't pretend the app is functional. -->
	<div class="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
		<div class="max-w-md px-6 text-center">
			<div
				class="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-danger-bg)]"
			>
				<span class="h-3 w-3 rounded-full bg-[var(--color-danger)]"></span>
			</div>
			<h1 class="mb-2 text-2xl font-bold text-[var(--color-text)]">Backend unavailable</h1>
			<p class="mb-8 text-[var(--color-text-muted)]">
				Studio isn't reachable right now. Your sign-in is fine — this is a server-side outage. Try
				again in a moment.
			</p>
			<button
				onclick={retryBackend}
				disabled={retrying}
				class="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-6 py-3 font-medium text-[var(--color-on-primary)] transition-colors hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
			>
				{retrying ? 'Checking…' : 'Retry'}
			</button>
		</div>
	</div>
{:else if bareRoute}
	{@render children()}
	<ToastContainer />
{:else if noWorkspace}
	<!-- Redirecting to /no-workspace (see the effect above); never flash the shell. -->
	<div class="min-h-screen bg-[var(--color-bg)]" data-testid="no-workspace-redirect"></div>
{:else if licenseBlocked}
	<!-- License expired / revoked / none (or a live license-required 402/403):
	     hard-block the whole app shell. Inert until W2V_LICENSE_GATE_ENABLED. -->
	<LicenseBlocked />
{:else}
	<LicenseExpiringBanner />
	<PendingInvites />
	<ShellLayout {healthStatus}>
		{@render children()}
	</ShellLayout>

	<ToastContainer />
{/if}

<style>
	@keyframes nav-progress {
		0% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0.6;
		}
	}
</style>

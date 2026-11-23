<!--
  LicenseBlocked — full-screen hard block shown when the workspace has no usable
  license (expired / revoked / none, or a live license-required 402/403). Only
  two actions: Renew (→ LICENSE_RENEW_URL) and Log out. A workspace that is not
  onboarded to w2v (`not_onboarded` / 403 TENANT_NOT_ONBOARDED) gets Log out only. Rendered by the root
  +layout in place of the app shell, so no licensed surface is reachable.
  Ported from fr; inert in prod until W2V_LICENSE_GATE_ENABLED is flipped on.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { logout } from '$lib/services/keycloak';
	import { licenseGate, LICENSE_RENEW_URL } from '$lib/stores/licenseGate.svelte';

	// not_onboarded is not a purchasable state: the workspace's owning app never
	// set it up for w2v, so there is nothing to renew — only an administrator can fix it.
	const notOnboarded = $derived(licenseGate.state === 'not_onboarded');

	const heading = $derived(
		notOnboarded
			? 'Workspace not set up'
			: licenseGate.state === 'revoked'
				? 'License revoked'
				: licenseGate.state === 'none'
					? 'No active license'
					: 'License expired'
	);

	function renew() {
		// Relative path → in-app navigation; absolute / protocol-relative URL →
		// full redirect (e.g. the customer portal). Single VITE_LICENSE_RENEW_URL knob.
		if (/^https?:\/\/|^\/\//i.test(LICENSE_RENEW_URL)) {
			window.location.href = LICENSE_RENEW_URL;
		} else {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- LICENSE_RENEW_URL is a runtime-config string; resolve() only types static route ids.
			void goto(LICENSE_RENEW_URL);
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
	<div
		class="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-lg"
	>
		<div
			class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-bg)]"
			aria-hidden="true"
		>
			<svg
				class="h-6 w-6 text-[var(--color-danger-text)]"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
				/>
			</svg>
		</div>

		<h1 class="mb-2 text-2xl font-semibold text-[var(--color-text)]">{heading}</h1>
		<p class="mb-6 text-[var(--color-text-muted)]">
			{licenseGate.statusMessage}{notOnboarded
				? ''
				: ' Renew to restore access for your workspace.'}
		</p>

		<div class="flex flex-col gap-3">
			{#if !notOnboarded}
				<button
					type="button"
					onclick={renew}
					class="w-full rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2.5 font-semibold text-[var(--color-on-primary)] transition-colors hover:bg-[var(--color-accent-strong)]"
				>
					Renew license
				</button>
			{/if}
			<button
				type="button"
				onclick={() => logout()}
				class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-2.5 font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
			>
				Log out
			</button>
		</div>

		<p class="mt-6 text-xs text-[var(--color-text-muted)]">
			Need help? Contact
			<a class="text-[var(--color-accent)] underline" href="mailto:sales@nonagentic.ai">
				sales@nonagentic.ai
			</a>.
		</p>
	</div>
</div>

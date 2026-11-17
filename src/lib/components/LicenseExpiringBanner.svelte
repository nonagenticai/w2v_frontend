<!--
  LicenseExpiringBanner — non-blocking top banner shown when the license is
  valid but expiring within the warning window. Dismissible for the session;
  the app stays fully usable. Rendered by the root +layout above the shell.
  Ported from fr; inert in prod until W2V_LICENSE_GATE_ENABLED is flipped on.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { licenseGate, LICENSE_RENEW_URL } from '$lib/stores/licenseGate.svelte';

	let dismissed = $state(false);

	const show = $derived(licenseGate.isExpiringSoon && !dismissed);

	const message = $derived(
		licenseGate.daysRemaining != null
			? `Your license expires in ${licenseGate.daysRemaining} day${licenseGate.daysRemaining === 1 ? '' : 's'}.`
			: 'Your license is expiring soon.'
	);

	function renew() {
		if (/^https?:\/\/|^\/\//i.test(LICENSE_RENEW_URL)) {
			window.location.href = LICENSE_RENEW_URL;
		} else {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- LICENSE_RENEW_URL is a runtime-config string; resolve() only types static route ids.
			void goto(LICENSE_RENEW_URL);
		}
	}
</script>

{#if show}
	<div
		class="flex items-center justify-between gap-4 border-b border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-2 text-sm text-[var(--color-warning-text)]"
		role="status"
	>
		<span>⚠ {message} Renew to avoid interruption.</span>
		<span class="flex items-center gap-3">
			<button type="button" onclick={renew} class="font-semibold underline hover:opacity-80">
				Renew
			</button>
			<button
				type="button"
				onclick={() => (dismissed = true)}
				class="opacity-70 hover:opacity-100"
				aria-label="Dismiss"
			>
				✕
			</button>
		</span>
	</div>
{/if}

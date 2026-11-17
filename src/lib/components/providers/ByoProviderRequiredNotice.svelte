<script lang="ts">
	// "Configure your own LLM, TTS and image providers to continue" + the way to fix it
	// (w2v_orchestrator#1106). Rendered wherever the orchestrator refused because a
	// `byo_required` tenant has no provider of its own: a failed run, a 402 from the
	// voice preview, a refused run start / regenerate / resume. The link carries
	// `?missing=<slots>` so the Providers page highlights every slot to fill. The Providers page is tenant_admin-only, so a member gets
	// who-to-ask text instead of a link that would land on "Access denied" — the
	// same split PublishYouTubeModal makes.
	import { resolve } from '$app/paths';
	import { isTenantAdmin } from '$lib/stores/auth.svelte';
	import type { ByoProviderRequired } from '$lib/api/byo-provider.js';

	let { required, compact = false }: { required: ByoProviderRequired; compact?: boolean } =
		$props();

	const canManage = $derived(isTenantAdmin());
</script>

<div
	role="alert"
	data-testid="byo-provider-required"
	data-modality={required.modality ?? ''}
	data-slots={required.slots.join(',')}
	class={compact
		? 'text-xs text-[var(--color-danger-text)]'
		: 'rounded-[var(--radius-lg)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4 text-sm text-[var(--color-danger-text)]'}
>
	<p class={compact ? '' : 'font-semibold'} data-testid="byo-provider-required-message">
		{required.message}
	</p>
	<p class={compact ? 'mt-0.5' : 'mt-1'}>
		{#if canManage}
			<a
				href="{resolve('/providers')}{required.settingsSuffix}"
				class="font-semibold underline"
				data-testid="byo-provider-settings-link">Open provider settings</a
			>
		{:else}
			<span data-testid="byo-provider-ask-admin"
				>Ask a workspace admin to configure it on the Providers page.</span
			>
		{/if}
	</p>
</div>

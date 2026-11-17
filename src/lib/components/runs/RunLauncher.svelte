<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { runs, ApiError } from '$lib/api';
	import { Button } from '$lib/components/ui';
	import { Play } from '@lucide/svelte';
	import { toastError } from '$lib/stores/toast.svelte.js';
	import type { DeliverableStatus } from '$lib/types';
	import { byoProviderRequiredFromError, type ByoProviderRequired } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';

	let {
		deliverableId,
		deliverableStatus = null,
		blockedReason = null,
		label = 'Start run'
	}: {
		deliverableId: string;
		/** A caller-known reason this launch would produce the wrong thing (e.g. a
		 *  demo video with storyboard panels but no recording package). Refused
		 *  with this text, same as the in-flight guard. */
		blockedReason?: string | null;
		/** Button text, e.g. "Start course run". */
		label?: string;
		/** Current status of THIS deliverable. Without it the in-flight guard
		 *  cannot fire — see the note on `IN_FLIGHT_STATUSES`. */
		deliverableStatus?: DeliverableStatus | null;
	} = $props();

	// A run that is `running` (executing), `awaiting_review` (paused at a
	// checkpoint) or `paused` (someone pressed Pause) still holds the deliverable:
	// it is IN FLIGHT. Starting another
	// one bills a second concurrent paid run against the same deliverable — the
	// local `starting` flag only ever guarded a double-click within one mount,
	// not a second launch from a re-rendered row or a second tab.
	const IN_FLIGHT_STATUSES: readonly DeliverableStatus[] = ['running', 'awaiting_review', 'paused'];

	const inFlight = $derived(
		deliverableStatus !== null && IN_FLIGHT_STATUSES.includes(deliverableStatus)
	);

	let starting = $state(false);
	let lastError = $state<string | null>(null);
	let blocked = $state<string | null>(null);
	// The start-run preflight's 402 `byo_provider_required` (w2v_orchestrator#1108):
	// a what-to-do notice with a provider-settings link, not a "Failed to start" toast.
	let byoRequired = $state<ByoProviderRequired | null>(null);

	async function startRun(): Promise<void> {
		if (starting) return;
		if (blockedReason) {
			blocked = blockedReason;
			return;
		}
		// Refuse rather than disable: a disabled button with no explanation reads
		// as a broken UI, so say WHY the launch was refused.
		if (inFlight) {
			blocked =
				deliverableStatus === 'awaiting_review'
					? 'This deliverable already has a run that needs review. Approve or cancel it before starting another.'
					: deliverableStatus === 'paused'
						? 'This deliverable already has a run that is paused. Resume or cancel it before starting another.'
						: 'This deliverable already has a run in progress. Wait for it to finish, or cancel it, before starting another.';
			return;
		}
		blocked = null;
		starting = true;
		lastError = null;
		byoRequired = null;
		try {
			const summary = await runs.start(deliverableId);
			await goto(resolve(`/runs/${summary.id}`));
		} catch (err) {
			byoRequired = byoProviderRequiredFromError(err);
			if (byoRequired) return;
			const message =
				err instanceof ApiError ? `${err.status}: ${err.detail}` : (err as Error).message;
			lastError = message;
			toastError(`Failed to start run: ${message}`);
		} finally {
			starting = false;
		}
	}
</script>

<div class="flex flex-col items-end gap-1.5">
	<Button onclick={startRun} loading={starting} disabled={starting}>
		<Play class="h-4 w-4" />
		{label}
	</Button>
	{#if blocked}
		<p class="text-xs text-[var(--color-text-muted)]" data-testid="run-launcher-blocked">
			{blocked}
		</p>
	{/if}
	{#if byoRequired}
		<ByoProviderRequiredNotice required={byoRequired} compact />
	{:else if lastError}
		<p class="text-xs text-[var(--color-danger)]" data-testid="run-launcher-error">{lastError}</p>
	{/if}
</div>

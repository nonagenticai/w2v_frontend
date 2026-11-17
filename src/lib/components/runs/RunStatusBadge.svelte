<script lang="ts">
	import type { RunStatus } from '$lib/types/runs';
	import { runStatusLabel, type PauseReason } from '$lib/utils/review-wait';

	let {
		status,
		degraded = false,
		pauseReason = null
	}: {
		status: RunStatus;
		degraded?: boolean;
		/** Why a paused run is paused — "Needs review" only for `checkpoint`. */
		pauseReason?: PauseReason | null;
	} = $props();

	const tone: Record<RunStatus, string> = {
		pending: 'bg-status-pending/15 text-status-pending border-status-pending/30',
		running: 'bg-primary-500/15 text-primary-500 border-primary-500/30',
		paused: 'bg-status-paused/15 text-status-paused border-status-paused/30',
		completed: 'bg-status-completed/15 text-status-completed border-status-completed/30',
		failed: 'bg-status-failed/15 text-status-failed border-status-failed/30',
		cancelled: 'bg-status-cancelled/15 text-status-cancelled border-status-cancelled/30'
	};

	// A completed-but-degraded run finished green while soft-failing a step
	// (non-empty stage notes) — surface it as a warning, mirroring
	// JobStatusBadge.svelte so the two badges agree.
	const isDegraded = $derived(degraded && status === 'completed');
	const degradedTone = 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]';
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium {isDegraded
		? `${degradedTone} border-transparent`
		: tone[status]}"
	data-testid="run-status-badge"
	data-status={status}
	title={isDegraded
		? 'Finished, but one or more steps soft-failed — check the stage notes'
		: undefined}
>
	<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
	{isDegraded ? 'Completed with warnings' : runStatusLabel(status, pauseReason)}
</span>

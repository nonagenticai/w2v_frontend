<script lang="ts">
	import type { PipelineStatus, StageStatus } from '$lib/types';
	import type { RunStatus } from '$lib/types/runs';
	import { runStatusLabel, type PauseReason } from '$lib/utils/review-wait';

	let {
		status,
		degraded = false,
		pauseReason = null
	}: {
		status: RunStatus | PipelineStatus | StageStatus;
		degraded?: boolean;
		/** Why a paused run is paused — "Needs review" only for `checkpoint`. */
		pauseReason?: PauseReason | null;
	} = $props();

	const config: Record<string, { classes: string; pulse: boolean }> = {
		pending: {
			classes: 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]',
			pulse: false
		},
		running: {
			classes: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]',
			pulse: true
		},
		processing: {
			classes: 'bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]',
			pulse: true
		},
		completed: {
			classes: 'bg-[var(--color-success-bg)] text-[var(--color-success-text)]',
			pulse: false
		},
		failed: {
			classes: 'bg-[var(--color-danger-bg)] text-[var(--color-danger-text)]',
			pulse: false
		},
		cancelled: {
			classes: 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]',
			pulse: false
		},
		skipped: {
			classes: 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]',
			pulse: false
		},
		paused: {
			classes: 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]',
			pulse: false
		}
	};

	const fallback = {
		classes: 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]',
		pulse: false
	};
	// A completed-but-degraded run/stage finished green while soft-failing a
	// downstream step (e.g. missing AI image, empty prompts) — surface it as a
	// warning instead of a clean success so the green isn't silently misleading.
	const isDegraded = $derived(degraded && status === 'completed');
	const degradedConfig = {
		classes: 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]',
		pulse: false
	};
	const current = $derived(isDegraded ? degradedConfig : (config[status] ?? fallback));
	const label = $derived(
		isDegraded ? 'Completed with warnings' : runStatusLabel(status, pauseReason)
	);
</script>

<span
	class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium {current.classes}"
	title={isDegraded
		? 'Finished, but one or more steps soft-failed — check the stage notes'
		: undefined}
>
	{#if current.pulse}
		<span class="h-1.5 w-1.5 rounded-full bg-current animate-pulse"></span>
	{/if}
	{label}
</span>

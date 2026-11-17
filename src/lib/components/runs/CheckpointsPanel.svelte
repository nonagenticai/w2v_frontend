<script lang="ts">
	import { CheckpointPicker } from '$lib/components/studio';

	let {
		value,
		availableStages,
		onChange,
		busy = false,
		presets,
		error = null,
		readFailed = false,
		readOnly = false
	}: {
		value: string[];
		availableStages: string[];
		onChange: (next: string[]) => void;
		busy?: boolean;
		presets: { label: string; stages: string[] }[];
		error?: string | null;
		/**
		 * The checkpoints GET failed, so `value` is the empty FALLBACK and not the
		 * run's real gate list. Two things follow, and both matter:
		 *  - we must not print "Autopilot — no checkpoints", a confident product
		 *    claim about a request that never answered;
		 *  - editing must be disabled, because `onChange` PATCHes a full
		 *    replacement — one toggle against an unknown baseline deletes every
		 *    gate the user cannot currently see.
		 */
		readFailed?: boolean;
		/**
		 * The run is finished (completed / failed / cancelled): it can no longer
		 * pause, and the backend 409s every checkpoint change. Show the list, but
		 * do not offer to edit it.
		 */
		readOnly?: boolean;
	} = $props();
</script>

<section
	class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6"
>
	<div class="flex items-center justify-between mb-3 flex-wrap gap-2">
		<div>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Checkpoints</h2>
			<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
				Stages selected here will pause for review after they complete. Edit any time; changes apply
				to remaining stages of the run.
			</p>
		</div>
		{#if readFailed}
			<span data-testid="checkpoints-unknown" class="text-xs text-[var(--color-text-muted)]"
				>Checkpoints unavailable</span
			>
		{:else if value.length === 0}
			<span class="text-xs text-[var(--color-text-muted)]">Autopilot — no checkpoints</span>
		{:else}
			<span class="text-xs text-[var(--color-text-muted)]">{value.length} selected</span>
		{/if}
	</div>
	<CheckpointPicker
		{value}
		{availableStages}
		{onChange}
		disabled={busy || readFailed || readOnly}
		{presets}
	/>
	{#if readOnly && !readFailed}
		<p data-testid="checkpoints-read-only" class="mt-2 text-xs text-[var(--color-text-muted)]">
			This run has finished, so its checkpoints can no longer be changed.
		</p>
	{/if}
	{#if readFailed}
		<p data-testid="checkpoints-read-failed" class="mt-2 text-xs text-[var(--color-text-muted)]">
			Could not load this run's checkpoints, so they cannot be edited right now — saving would
			replace gates that are not shown. Reload to try again.
		</p>
	{/if}
	{#if error}
		<p class="mt-2 text-xs text-[var(--color-danger-text)]">{error}</p>
	{/if}
</section>

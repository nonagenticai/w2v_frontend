<script lang="ts">
	// Multi-select for pause_after_stages.
	//
	// Two modes:
	//   - Pre-flight (no jobId): pure local state via bind:value. The chosen
	//     list is applied via PATCH /checkpoints right after a deliverable is
	//     started. This is what the deliverable detail page uses.
	//   - Live (jobId provided): each toggle calls onChange, which the parent
	//     wires straight to checkpoints.patch(jobId, ...). The component is
	//     a controlled multi-select; the parent owns the source of truth.
	//
	// `availableStages` is the run's actual stages (per-type blueprint); the
	// caller passes them off the run. There is no static stage enum anymore —
	// each project type runs a different stage set.

	import { Check, Circle, Sparkles } from '@lucide/svelte';

	interface Props {
		/** Currently-selected pause-after stage names. */
		value: string[];
		/** Available stages to choose from — the run's actual blueprint stages. */
		availableStages?: readonly string[];
		/**
		 * Pre-defined sets that map a label → stage list. Clicking applies the
		 * preset wholesale. Examples: "Narrative only" = [storyline, shotlist],
		 * "Every checkpoint" = entire list, "None" = []. Provided by parent.
		 */
		presets?: { label: string; stages: string[] }[];
		/** Called whenever the selection changes. Parent decides what to do. */
		onChange: (next: string[]) => void;
		/** Disable interaction (e.g. while a PATCH is in flight). */
		disabled?: boolean;
	}

	let { value, availableStages = [], presets = [], onChange, disabled = false }: Props = $props();

	function toggle(stage: string) {
		if (disabled) return;
		const next = value.includes(stage) ? value.filter((s) => s !== stage) : [...value, stage];
		onChange(next);
	}

	function applyPreset(stages: string[]) {
		if (disabled) return;
		onChange([...stages]);
	}

	function stageDisplay(name: string): string {
		return name.replace(/_/g, ' ');
	}

	// One group holding the run's actual stages in execution order. Stage names
	// are blueprint-defined per project type, so there is nothing meaningful to
	// pre-group them by here; the run monitor already shows their topology.
	const grouped = $derived(
		availableStages.length > 0
			? [{ id: 'stages', title: 'Pipeline stages', stages: [...availableStages] }]
			: []
	);
</script>

{#if presets.length > 0}
	<div class="flex flex-wrap items-center gap-2 mb-3">
		<Sparkles class="h-3.5 w-3.5 text-text-muted" />
		<span class="text-xs text-text-muted">Quick presets:</span>
		{#each presets as preset (preset.label)}
			<button
				type="button"
				onclick={() => applyPreset(preset.stages)}
				class="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-surface-raised text-text-secondary hover:text-text disabled:opacity-50"
				{disabled}
			>
				{preset.label}
			</button>
		{/each}
	</div>
{/if}

<div class="space-y-4">
	{#each grouped as group (group.id)}
		<div class="rounded-lg border border-border/60 bg-surface-raised/30 p-3">
			<p class="text-xs font-semibold text-text-secondary mb-2">{group.title}</p>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
				{#each group.stages as stage (stage)}
					{@const selected = value.includes(stage)}
					<button
						type="button"
						onclick={() => toggle(stage)}
						class="flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-sm hover:bg-surface disabled:opacity-50 {selected
							? 'bg-primary-500/10'
							: ''}"
						{disabled}
						aria-pressed={selected}
					>
						{#if selected}
							<Check class="h-4 w-4 text-primary-500" />
						{:else}
							<Circle class="h-4 w-4 text-text-muted" />
						{/if}
						<span class="capitalize {selected ? 'text-text font-medium' : 'text-text-secondary'}">
							{stageDisplay(stage)}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>

<p class="text-xs text-text-muted mt-3">
	Selected stages will pause for review after they complete. Resume from the run monitor once you're
	satisfied with the draft.
</p>

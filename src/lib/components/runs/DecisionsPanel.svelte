<script lang="ts">
	// "Editorial decisions" — a prominent, top-of-page surface for the
	// great-video AI's editorial decisions. The rich decision renderers
	// (ScriptPacingTimeline for retention_plan / cold_open / script_doctor pacing,
	// RenderManifestCard for the render-manifest override ledger) already exist and
	// resolve by OUTPUT SHAPE via the registry; they were previously reachable only
	// by manually expanding the matching stage in the technical inspector. This
	// panel lifts them out: it asks the SAME shape registry which stages carry a
	// decision payload and renders each via the shared StageOutputView — no renderer
	// logic is duplicated here. Self-gates to nothing when the run has no decisions.
	import { Card } from '$lib/components/ui';
	import StageOutputView from './StageOutputView.svelte';
	import { resolveRenderer } from './renderers/registry';
	import type { RunDetail } from '$lib/types/runs';

	let { run }: { run: RunDetail } = $props();

	// The two decision-bearing renderer ids this panel surfaces. Selection is by
	// shape (via resolveRenderer), never by stage name — the per-type blueprints
	// emit different stage names but stable payload shapes.
	const DECISION_RENDERER_IDS = new Set(['script-pacing', 'render-manifest']);
	// Sort key: the pacing timeline ("how it was paced", always has data) reads
	// first, the render manifest ("how it was configured") second. Array.sort is
	// stable, so multiple pacing stages (retention_plan + script_doctor) keep their
	// execution order within the group.
	const rank = (id: string): number => (id === 'script-pacing' ? 0 : 1);

	const decisions = $derived.by((): { name: string; output: Record<string, unknown> }[] => {
		const selected: { name: string; output: Record<string, unknown>; rank: number }[] = [];
		for (const stage of run.stage_outputs ?? []) {
			const output = (stage.output ?? {}) as Record<string, unknown>;
			const renderer = resolveRenderer(output);
			if (renderer && DECISION_RENDERER_IDS.has(renderer.id)) {
				selected.push({ name: stage.stage_name, output, rank: rank(renderer.id) });
			}
		}
		selected.sort((a, b) => a.rank - b.rank);
		return selected.map(({ name, output }) => ({ name, output }));
	});
</script>

{#if decisions.length}
	<section data-testid="decisions-panel">
		<Card class="p-5 md:p-6 space-y-4">
			<div class="space-y-1">
				<h2 class="text-base font-semibold text-[var(--color-text)]">Editorial decisions</h2>
				<p class="text-sm text-[var(--color-text-muted)]">
					The pacing, hooks, and configuration the AI chose for this video.
				</p>
			</div>

			<div class="space-y-6">
				{#each decisions as decision (decision.name)}
					<div class="space-y-1.5">
						<p class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
							{decision.name.replace(/_/g, ' ')}
						</p>
						<StageOutputView output={decision.output} runId={run.id} />
					</div>
				{/each}
			</div>
		</Card>
	</section>
{/if}

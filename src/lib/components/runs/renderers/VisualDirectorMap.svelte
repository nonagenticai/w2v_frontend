<script lang="ts">
	// Visual director (PromoVisualDirectorOutput.assignments[]{line_id, screen_id})
	// → the line→screen mapping as connector rows: which narration line shows
	// which captured screen/asset.
	import LineChip from './_shared/LineChip.svelte';
	import { Pill } from '$lib/components/ui';
	import { MoveRight } from '@lucide/svelte';
	import type { RendererProps } from './registry';
	import type { VisualDirectorOutput, VisualDirectorAssignment } from './stage-outputs';

	let { output }: RendererProps = $props();

	const data = $derived(output as unknown as VisualDirectorOutput);
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	const assignments = $derived<VisualDirectorAssignment[]>(
		Array.isArray(data.assignments) ? data.assignments : []
	);
</script>

<ul class="space-y-1.5" data-testid="visual-director-map">
	{#each assignments as a, i (str(a.id) ?? i)}
		<li
			class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
			data-line-id={str(a.line_id) ?? undefined}
		>
			<LineChip lineId={str(a.line_id)} />
			<MoveRight class="h-4 w-4 text-[var(--color-text-muted)]" />
			{#if str(a.screen_id)}<Pill tone="neutral">Screen {str(a.screen_id)?.slice(0, 8)}</Pill>{/if}
		</li>
	{/each}
</ul>

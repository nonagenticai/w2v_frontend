<script lang="ts">
	// The recurring "Line N" badge. Every renderer that keys items by `line_id`
	// uses this so a line is visually identifiable across stages (script → shot →
	// narration → slide). Exposes `data-line-id` as the cross-stage hover/join
	// anchor the storyline relies on.
	import { Pill } from '$lib/components/ui';

	let {
		lineId,
		index,
		tone = 'accent',
		class: className = ''
	}: {
		lineId?: string | number | null;
		index?: number | null;
		tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
		class?: string;
	} = $props();

	const label = $derived(
		index != null
			? `Line ${index + 1}`
			: lineId != null
				? `Line ${String(lineId).slice(0, 6)}`
				: 'Line'
	);
</script>

<span data-line-id={lineId ?? undefined} class={className}>
	<Pill {tone}>{label}</Pill>
</span>

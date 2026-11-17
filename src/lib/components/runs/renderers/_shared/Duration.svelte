<script lang="ts">
	// Consistent duration chip: "4.2s" under a minute, "1:24" at/over a minute.
	// Wraps formatTimestamp so the storyboard, narration track and script
	// transcript all read identically.
	import { formatTimestamp } from '$lib/utils/format';

	let { seconds, class: className = '' }: { seconds: number | null | undefined; class?: string } =
		$props();

	const label = $derived.by(() => {
		const s = seconds;
		if (s == null || !Number.isFinite(s)) return '';
		if (s >= 60) return formatTimestamp(s);
		return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
	});
</script>

{#if label}
	<span class="tabular-nums text-[var(--color-text-muted)] {className}">{label}</span>
{/if}

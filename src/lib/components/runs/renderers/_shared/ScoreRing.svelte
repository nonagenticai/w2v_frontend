<script lang="ts">
	// A tone-colored radial score. Used by the critique scorecard (overall +
	// per-category) and the redesign accessibility score. `max` defaults to 1 so
	// 0–1 fractions render as a percentage; pass max=5/10 etc. for rubric scores,
	// in which case the centre shows the raw value.
	let {
		value,
		max = 1,
		size = 72,
		caption,
		class: className = ''
	}: { value: number; max?: number; size?: number; caption?: string; class?: string } = $props();

	const frac = $derived(
		max > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0
	);
	const tone = $derived(
		frac >= 0.8
			? 'var(--color-success)'
			: frac >= 0.5
				? 'var(--color-warning)'
				: 'var(--color-danger)'
	);
	const stroke = 6;
	const r = $derived((size - stroke) / 2);
	const circ = $derived(2 * Math.PI * r);
	const centre = $derived(
		max === 1
			? `${Math.round(frac * 100)}`
			: `${Number.isInteger(value) ? value : value.toFixed(1)}`
	);
	const unit = $derived(max === 1 ? '%' : `/${max}`);
</script>

<div class={`inline-flex flex-col items-center gap-1 ${className}`}>
	<div class="relative" style={`width:${size}px;height:${size}px`}>
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="-rotate-90">
			<circle
				cx={size / 2}
				cy={size / 2}
				{r}
				fill="none"
				stroke="var(--color-border)"
				stroke-width={stroke}
			/>
			<circle
				cx={size / 2}
				cy={size / 2}
				{r}
				fill="none"
				stroke={tone}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-dasharray={circ}
				stroke-dashoffset={circ * (1 - frac)}
			/>
		</svg>
		<div class="absolute inset-0 flex items-center justify-center">
			<span class="text-[var(--color-text)] font-semibold tabular-nums" style="font-size:0.95rem">
				{centre}<span class="text-[0.7em] text-[var(--color-text-muted)]">{unit}</span>
			</span>
		</div>
	</div>
	{#if caption}
		<span class="text-xs text-[var(--color-text-muted)] text-center">{caption}</span>
	{/if}
</div>

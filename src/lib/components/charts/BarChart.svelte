<script lang="ts">
	// Dependency-free SVG bar chart — consistent with the hand-rolled-primitive
	// ethos (no chart library). The SVG draws one full-width bar per point
	// (scaled to the max value) with a per-bar <title> for the exact value on
	// hover; axis labels render as HTML below it so they are never distorted by
	// the non-uniform viewBox stretch. Used by the tenant Usage screen.
	interface Point {
		label: string;
		value: number;
	}

	interface Props {
		points: Point[];
		/** Format a value for the peak caption + per-bar tooltip (default: as-is). */
		formatValue?: (v: number) => string;
		/** Accessible name for the whole chart. */
		ariaLabel?: string;
		/** Empty-state caption when there are no points. */
		emptyLabel?: string;
	}

	const {
		points,
		formatValue = (v: number) => String(v),
		ariaLabel = 'Bar chart',
		emptyLabel = 'No data in range'
	}: Props = $props();

	// Coordinate space (the svg scales to its container via viewBox; bars stretch
	// to fill the width — text lives in HTML below, so the stretch is harmless).
	const W = 600;
	const H = 150;

	const max = $derived(Math.max(0, ...points.map((p) => p.value)));

	const bars = $derived.by(() => {
		const n = points.length;
		if (n === 0) return [];
		const slot = W / n;
		const barW = Math.max(1, slot * 0.7);
		return points.map((p, i) => {
			// Scale to max; a zero (or all-zero) series renders flush to the axis.
			const h = max > 0 ? (p.value / max) * H : 0;
			return { ...p, x: i * slot + (slot - barW) / 2, y: H - h, w: barW, h };
		});
	});
</script>

{#if points.length === 0}
	<p class="py-6 text-center text-sm text-[var(--color-text-muted)]" data-testid="usage-bars-empty">
		{emptyLabel}
	</p>
{:else}
	<div class="text-[var(--color-accent)]">
		<svg
			viewBox="0 0 {W} {H}"
			class="h-36 w-full"
			preserveAspectRatio="none"
			role="img"
			aria-label={ariaLabel}
			data-testid="usage-bars"
		>
			{#each bars as bar (bar.label)}
				<rect
					x={bar.x}
					y={bar.y}
					width={bar.w}
					height={bar.h}
					fill="currentColor"
					data-testid="usage-bar"
				>
					<title>{bar.label}: {formatValue(bar.value)}</title>
				</rect>
			{/each}
		</svg>
		<div
			class="mt-1 flex items-center justify-between border-t border-[var(--color-border)] pt-1 text-xs text-[var(--color-text-muted)]"
		>
			<span data-testid="usage-bars-first">{points[0].label}</span>
			<span data-testid="usage-bars-peak">Peak {formatValue(max)}</span>
			<span data-testid="usage-bars-last">{points[points.length - 1].label}</span>
		</div>
	</div>
{/if}

<script lang="ts">
	type Variant = 'box' | 'circle' | 'text';

	let {
		variant = 'box',
		width = '100%',
		height = '1rem',
		count = 1,
		class: className = ''
	}: {
		variant?: Variant;
		width?: string;
		height?: string;
		count?: number;
		class?: string;
	} = $props();

	const radiusClass = $derived(
		{
			box: 'rounded-md',
			circle: 'rounded-full',
			text: 'rounded-sm'
		}[variant]
	);

	// For `text` variant with count > 1, rotate widths for visual variety.
	const TEXT_WIDTHS = ['60%', '90%', '70%'];

	function widthFor(i: number): string {
		if (variant === 'text' && count > 1) {
			return TEXT_WIDTHS[i % TEXT_WIDTHS.length] ?? width;
		}
		return width;
	}

	// Circle forces a square box; use the larger of width/height to keep it crisp.
	function dimsFor(i: number): { width: string; height: string } {
		if (variant === 'circle') {
			const dim = width !== '100%' ? width : height;
			return { width: dim, height: dim };
		}
		return { width: widthFor(i), height };
	}

	const items = $derived(
		Array.from({ length: Math.max(1, count) }, (_, i) => ({ i, ...dimsFor(i) }))
	);
</script>

<div class={`flex flex-col gap-2 ${className}`} data-testid="skeleton-root">
	{#each items as item (item.i)}
		<div
			data-testid="skeleton-item"
			class={`block bg-[var(--color-surface-strong)] motion-safe:animate-pulse ${radiusClass}`}
			style="width: {item.width}; height: {item.height};"
			aria-hidden="true"
		></div>
	{/each}
</div>

<script lang="ts">
	// Thin wrapper around a lucide icon component so call sites pass a consistent
	// size/strokeWidth/class surface. w2v uses `@lucide/svelte`; icons accept
	// size/strokeWidth/class props.
	type AnyComponent = any;

	let {
		icon,
		size = 18,
		strokeWidth = 2,
		class: className = ''
	}: {
		icon: AnyComponent;
		size?: number;
		strokeWidth?: number;
		class?: string;
	} = $props();

	const Comp = $derived(icon);
</script>

<Comp {size} {strokeWidth} class={className} />

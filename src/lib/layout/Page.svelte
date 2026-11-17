<script lang="ts">
	// The ONE page container rule. ShellLayout already owns the outer padding and the
	// 1500px cap, so a page adds NO padding of its own (the old per-page `p-6` stacked
	// on top of the shell's). A page picks one of two widths:
	//   - `wide` (default): lists, galleries, workspaces — the full shell width.
	//   - `narrow`: forms, settings and admin screens — a readable 56rem column.
	import type { Snippet } from 'svelte';

	let {
		width = 'wide',
		testid,
		children
	}: {
		width?: 'wide' | 'narrow';
		testid?: string;
		children: Snippet;
	} = $props();
</script>

<div
	class={`mx-auto w-full space-y-6 ${width === 'narrow' ? 'max-w-4xl' : ''}`}
	data-testid={testid}
>
	{@render children()}
</div>

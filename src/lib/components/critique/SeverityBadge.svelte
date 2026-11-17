<script lang="ts">
	import type { CritiqueSeverity } from '$lib/types';

	let { severity }: { severity: CritiqueSeverity } = $props();

	const config: Record<CritiqueSeverity, { classes: string; pulse: boolean }> = {
		critical: { classes: 'bg-severity-critical/15 text-severity-critical', pulse: true },
		high: { classes: 'bg-severity-high/15 text-severity-high', pulse: false },
		medium: { classes: 'bg-severity-medium/15 text-severity-medium', pulse: false },
		low: { classes: 'bg-severity-low/15 text-severity-low', pulse: false },
		info: { classes: 'bg-severity-info/15 text-severity-info', pulse: false }
	};
</script>

<span
	class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium {config[
		severity
	].classes}"
>
	{#if config[severity].pulse}
		<span class="h-1.5 w-1.5 rounded-full bg-current animate-pulse"></span>
	{/if}
	{severity.charAt(0).toUpperCase() + severity.slice(1)}
</span>

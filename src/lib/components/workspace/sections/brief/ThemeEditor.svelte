<script lang="ts">
	import ColorField from './ColorField.svelte';
	import type { ThemeConfig } from '$lib/types';

	let { value = $bindable({} as ThemeConfig) }: { value?: ThemeConfig } = $props();

	function strVal(key: keyof ThemeConfig): string {
		const v = value[key];
		return typeof v === 'string' ? v : '';
	}
	function setField(key: string, v: string) {
		const next = { ...value };
		if (v.trim() === '') delete next[key];
		else next[key] = v;
		value = next;
	}
</script>

<div class="space-y-4">
	<p class="text-xs text-[var(--color-text-muted)]">
		Background and accent color hints used when composing promo storyboards.
	</p>
	<div class="grid gap-4 sm:grid-cols-2">
		<ColorField
			label="Background"
			name="theme-background"
			value={strVal('background')}
			onchange={(v) => setField('background', v)}
		/>
		<ColorField
			label="Accent"
			name="theme-accent"
			value={strVal('accent')}
			onchange={(v) => setField('accent', v)}
		/>
	</div>
</div>

<script lang="ts">
	// Theme selector wired to w2v's settings store (NOT fr's theme store). The
	// persisted name is 'default' | 'light' | 'dark' where 'default' follows the
	// OS. The root layout reacts to the change and applies it to <html> (both the
	// .dark class and the data-theme attribute) via applyTheme().
	import { getThemeName, updateTheme } from '$lib/stores/settings.svelte.js';

	const themeName = $derived(getThemeName());

	const options = [
		{ value: 'default', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	] as const;

	function onChange(e: Event) {
		updateTheme({ name: (e.currentTarget as HTMLSelectElement).value });
	}
</script>

<select
	aria-label="Interface theme"
	title="Interface theme (this browser)"
	onchange={onChange}
	class="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
>
	{#each options as opt (opt.value)}
		<option value={opt.value} selected={opt.value === themeName}>{opt.label}</option>
	{/each}
</select>

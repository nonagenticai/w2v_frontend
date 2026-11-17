<script lang="ts">
	import { Input } from '$lib/components/ui';
	import ColorField from './ColorField.svelte';
	import type { BrandConfig } from '$lib/types';

	let { value = $bindable({} as BrandConfig) }: { value?: BrandConfig } = $props();

	function strVal(key: keyof BrandConfig): string {
		const v = value[key];
		return typeof v === 'string' ? v : '';
	}
	// Spread-merge so keys we don't surface (e.g. the palette/fonts auto-extracted
	// by the backend's resolve_brand_context) survive untouched; drop a key when
	// the field is cleared rather than persisting an empty string.
	function setField(key: string, v: string) {
		const next = { ...value };
		if (v.trim() === '') delete next[key];
		else next[key] = v;
		value = next;
	}
</script>

<div class="space-y-4">
	<p class="text-xs text-[var(--color-text-muted)]">
		Colors and typography applied to generated slides and website redesigns. Leave blank to fall
		back to the auto-extracted brand defaults.
	</p>
	<div class="grid gap-4 sm:grid-cols-3">
		<ColorField
			label="Primary"
			name="brand-primary-color"
			value={strVal('primary_color')}
			onchange={(v) => setField('primary_color', v)}
		/>
		<ColorField
			label="Secondary"
			name="brand-secondary-color"
			value={strVal('secondary_color')}
			onchange={(v) => setField('secondary_color', v)}
		/>
		<ColorField
			label="Accent"
			name="brand-accent-color"
			value={strVal('accent_color')}
			onchange={(v) => setField('accent_color', v)}
		/>
	</div>
	<div class="grid gap-4 sm:grid-cols-2">
		<Input
			label="Display font"
			name="brand-display-font"
			placeholder="Fraunces"
			value={strVal('display_font')}
			oninput={(e) => setField('display_font', (e.currentTarget as HTMLInputElement).value)}
		/>
		<Input
			label="Body font"
			name="brand-body-font"
			placeholder="IBM Plex Sans"
			value={strVal('body_font')}
			oninput={(e) => setField('body_font', (e.currentTarget as HTMLInputElement).value)}
		/>
	</div>
	<Input
		label="Logo URL"
		name="brand-logo-url"
		type="url"
		placeholder="https://…/logo.svg"
		value={strVal('logo_url')}
		oninput={(e) => setField('logo_url', (e.currentTarget as HTMLInputElement).value)}
	/>
</div>

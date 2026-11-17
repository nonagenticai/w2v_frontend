<script lang="ts">
	import { Input } from '$lib/components/ui';

	let {
		label,
		name,
		value = '',
		onchange
	}: {
		label: string;
		name: string;
		value?: string;
		onchange: (v: string) => void;
	} = $props();

	// The native swatch only renders #rrggbb; when the stored value is empty or a
	// non-hex string we still keep it in the text field but show black on the
	// swatch so it doesn't error.
	const HEX = /^#[0-9a-fA-F]{6}$/;
	const swatch = $derived(HEX.test(value) ? value : '#000000');
</script>

<div class="flex flex-col gap-1.5">
	<label for={name} class="text-sm font-medium text-[var(--color-text-muted)]">{label}</label>
	<div class="flex items-center gap-2">
		<input
			type="color"
			aria-label="{label} swatch"
			value={swatch}
			oninput={(e) => onchange((e.currentTarget as HTMLInputElement).value)}
			class="h-9 w-10 shrink-0 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
		/>
		<Input
			{name}
			placeholder="#0d9488"
			{value}
			oninput={(e) => onchange((e.currentTarget as HTMLInputElement).value)}
			class="flex-1"
		/>
	</div>
</div>

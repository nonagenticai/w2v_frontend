<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		label,
		name,
		type = 'text',
		placeholder = '',
		autocomplete,
		spellcheck,
		value = $bindable(''),
		error,
		required = false,
		disabled = false,
		min,
		max,
		step,
		list,
		icon,
		onblur,
		oninput,
		onkeydown,
		class: className = ''
	}: {
		label?: string;
		name: string;
		type?: string;
		placeholder?: string;
		/** Pass-through `autocomplete` attribute (omitted when unset). */
		autocomplete?: HTMLInputAttributes['autocomplete'];
		/** Pass-through `spellcheck` attribute (omitted when unset). */
		spellcheck?: boolean;
		value?: string;
		error?: string;
		required?: boolean;
		disabled?: boolean;
		min?: string;
		max?: string;
		step?: string;
		/** Id of a `<datalist>` offering suggestions; free text stays allowed. */
		list?: string;
		icon?: Snippet;
		onblur?: (e: FocusEvent) => void;
		oninput?: (e: Event) => void;
		onkeydown?: (e: KeyboardEvent) => void;
		class?: string;
	} = $props();
</script>

<div class="flex flex-col gap-1.5 {className}">
	{#if label}
		<label
			for={name}
			class="text-sm font-medium {error
				? 'text-[var(--color-danger)]'
				: 'text-[var(--color-text-muted)]'}">{label}</label
		>
	{/if}
	<div class="relative">
		{#if icon}
			<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
				{@render icon()}
			</div>
		{/if}
		<input
			{name}
			id={name}
			{type}
			{placeholder}
			{autocomplete}
			{spellcheck}
			bind:value
			{required}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${name}-error` : undefined}
			{disabled}
			{min}
			{max}
			{step}
			{list}
			{onblur}
			{oninput}
			{onkeydown}
			class="w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] transition-all duration-200 {error
				? 'border-[var(--color-danger)] focus:ring-[var(--color-danger)]/20'
				: 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-accent)] focus:ring-[var(--color-accent)]/20'} {icon
				? 'pl-9'
				: ''} {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
		/>
	</div>
	{#if error}
		<!-- Associated with the input via aria-describedby + aria-invalid, so the
		     message is announced with the field rather than floating unlabelled.
		     Deliberately NOT role="alert": toasts already own that role and a second
		     one would make `getByRole('alert')` ambiguous.
		     The `{name}-error` testid exists so callers get a stable hook without
		     rendering their own copy of the message — which is how a duplicated
		     "Target URL is required" briefly shipped. -->
		<p
			id="{name}-error"
			data-testid="{name}-error"
			class="text-xs text-[var(--color-danger)] mt-0.5"
		>
			{error}
		</p>
	{/if}
</div>

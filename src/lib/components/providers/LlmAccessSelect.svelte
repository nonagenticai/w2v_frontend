<script lang="ts">
	// Reusable tenant "Service access" selector (licences byo_mode, app w2v). Used by the
	// platform tenants list, the provision form and the early-access approve +
	// invite flows; all of them offer every mode (`allowed` can still narrow it).
	//
	// `value` is bindable. `onchange` may return `false` (or a Promise of it) to
	// reject the choice — e.g. a failed PUT — and the control reverts to the
	// previous value; anything else keeps the new one.
	import { Select } from '$lib/components/ui';
	import type { LlmAccessMode } from '$lib/api/providers.js';
	import {
		LLM_ACCESS_HINTS,
		LLM_ACCESS_LABELS,
		LLM_ACCESS_MODES,
		isLlmAccessMode
	} from './llm-access.js';

	let {
		name,
		value = $bindable(''),
		allowed = LLM_ACCESS_MODES,
		label = 'Service access',
		placeholder = '',
		disabled = false,
		showHint = true,
		onchange,
		class: className = ''
	}: {
		name: string;
		/** The current mode; '' = unknown (shows `placeholder` when one is given). */
		value?: LlmAccessMode | '';
		/** Modes offered, in this order. */
		allowed?: readonly LlmAccessMode[];
		label?: string;
		placeholder?: string;
		disabled?: boolean;
		/** One-line hint under the select for the chosen mode. */
		showHint?: boolean;
		onchange?: (mode: LlmAccessMode) => boolean | void | Promise<boolean | void>;
		class?: string;
	} = $props();

	const options = $derived(
		LLM_ACCESS_MODES.filter((m) => allowed.includes(m)).map((m) => ({
			value: m,
			label: LLM_ACCESS_LABELS[m]
		}))
	);
	const hint = $derived(isLlmAccessMode(value) ? LLM_ACCESS_HINTS[value] : null);

	async function handle(e: Event): Promise<void> {
		const select = e.currentTarget as HTMLSelectElement;
		const next = select.value;
		const previous = value;
		if (!isLlmAccessMode(next) || !allowed.includes(next)) {
			select.value = previous;
			return;
		}
		value = next;
		const accepted = await onchange?.(next);
		if (accepted === false) {
			value = previous;
			select.value = previous;
		}
	}
</script>

<div class="flex min-w-0 flex-col gap-1 {className}" data-testid="llm-access-select">
	<Select
		{name}
		{label}
		{value}
		{options}
		{placeholder}
		{disabled}
		onchange={handle}
		class="max-w-full"
	/>
	{#if showHint && hint}
		<p class="text-xs text-[var(--color-text-muted)]" data-testid="llm-access-hint">{hint}</p>
	{/if}
</div>

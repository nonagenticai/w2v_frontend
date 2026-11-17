<script lang="ts">
	import { createWizard as cw } from './create-wizard.svelte.js';
</script>

<!-- Step rail: vertical on md+, horizontal scroll strip on mobile -->
<nav
	class="flex min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-1 md:sticky md:top-6 md:flex-col md:overflow-visible md:pb-0"
	aria-label="Wizard steps"
>
	{#each cw.steps as key, i (key)}
		{@const isCompleted = cw.stepIndex > i}
		{@const isCurrent = cw.stepIndex === i}
		{@const reachable = cw.stepReachable(i)}
		<button
			type="button"
			onclick={() => cw.goToStep(i)}
			disabled={!reachable && !isCompleted}
			aria-current={isCurrent ? 'step' : undefined}
			class="flex shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40
				{isCurrent
				? 'bg-[var(--color-surface)] md:border-l-2 md:border-[var(--color-accent)]'
				: 'hover:bg-[var(--color-surface)]'}"
		>
			<span
				class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition
					{isCompleted ? 'bg-[var(--color-accent)] text-[var(--color-on-primary)]' : ''}
					{isCurrent ? 'border-2 border-[var(--color-accent)] text-[var(--color-accent)]' : ''}
					{!isCompleted && !isCurrent
					? 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]'
					: ''}"
			>
				{#if isCompleted}
					<svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
						<path
							d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"
						/>
					</svg>
				{:else}
					{i + 1}
				{/if}
			</span>
			<span
				class="text-sm {isCurrent
					? 'font-semibold text-[var(--color-text)]'
					: 'text-[var(--color-text-muted)]'}"
			>
				{cw.stepLabels[key]}
			</span>
		</button>
	{/each}
</nav>

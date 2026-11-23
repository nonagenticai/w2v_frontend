<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { Pill } from '$lib/components/ui';
	import type { SectionId, WorkspaceSection } from './workspace-sections';

	let {
		sections,
		active,
		onSelect
	}: {
		sections: WorkspaceSection[];
		active: SectionId;
		onSelect: (id: SectionId) => void;
	} = $props();
</script>

<!-- Desktop: vertical rail.
     `data-testid` because BOTH navs below carry aria-label="Project sections", so
     `getByRole('navigation', { name: 'Project sections' })` is a strict-mode
     violation. Hiding is done with `hidden md:block` / `md:hidden`, so before the
     stylesheet applies both still have a bounding box and a `:visible` filter
     resolves to two — same trap as `data-testid="sidebar-rail"` in the shell. -->
<nav class="hidden md:block space-y-1" aria-label="Project sections" data-testid="workspace-nav">
	{#each sections as section (section.id)}
		{@const isActive = section.id === active}
		<button
			type="button"
			onclick={() => onSelect(section.id)}
			aria-current={isActive ? 'page' : undefined}
			class="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border-l-2 px-3 py-2 text-sm font-medium transition {isActive
				? 'border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-accent)]'
				: 'border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'}"
		>
			<Icon icon={section.icon} size={16} />
			<span class="flex-1 text-left">{section.label}</span>
			{#if section.count !== undefined}
				<Pill tone={isActive ? 'accent' : 'neutral'}>{section.count}</Pill>
			{/if}
		</button>
	{/each}
</nav>

<!-- Mobile: horizontal tab strip -->
<nav
	class="md:hidden -mx-1 flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)]"
	aria-label="Project sections"
>
	{#each sections as section (section.id)}
		{@const isActive = section.id === active}
		<button
			type="button"
			onclick={() => onSelect(section.id)}
			aria-current={isActive ? 'page' : undefined}
			class="-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition {isActive
				? 'border-[var(--color-accent)] text-[var(--color-accent)]'
				: 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
		>
			<Icon icon={section.icon} size={15} />
			{section.label}
			{#if section.count !== undefined}
				<span
					class="ml-0.5 inline-flex items-center rounded-full px-1.5 text-xs {isActive
						? 'bg-[var(--color-accent-bg)] text-[var(--color-accent-text)]'
						: 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]'}"
				>
					{section.count}
				</span>
			{/if}
		</button>
	{/each}
</nav>

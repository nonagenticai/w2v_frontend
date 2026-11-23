<script lang="ts">
	import { Button, Pill } from '$lib/components/ui';
	import { resolve } from '$app/paths';
	import { PROJECT_TYPE_LABELS, type ProjectResponse } from '$lib/types';

	type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
	function statusTone(status: string): PillTone {
		switch (status) {
			case 'producing':
				return 'accent';
			case 'completed':
				return 'success';
			case 'failed':
				return 'danger';
			default:
				return 'neutral';
		}
	}
	import { ChevronRight, Play, GripVertical } from '@lucide/svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';

	interface Props {
		children: ProjectResponse[];
		busy?: boolean;
		busyId?: string | null;
		/** Called when a row's [Start] button is clicked. Parent decides what "start" means. */
		onStart?: (childId: string) => void;
		/** Called after a drag drop with the new id ordering. Omit to disable drag. */
		onReorder?: (order: string[]) => void;
	}

	let { children, busy = false, busyId = null, onStart, onReorder }: Props = $props();

	// svelte-dnd-action mutates a local copy on consider/finalize.
	let working: ProjectResponse[] = $derived(
		[...children].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
	);

	function handleConsider(e: CustomEvent<DndEvent<ProjectResponse>>) {
		working = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<ProjectResponse>>) {
		working = e.detail.items;
		if (!onReorder) return;
		const ids = working.map((c) => c.id);
		const current = children
			.slice()
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
			.map((c) => c.id)
			.join('|');
		if (ids.join('|') === current) return;
		onReorder(ids);
	}

	/**
	 * Strict-ordering gate: a row's Start is only enabled when the row before
	 * it is `completed` (mirrors the legacy curriculum-lesson rule). Status
	 * 'producing' rows show a non-clickable badge instead of Start.
	 */
	function canStart(child: ProjectResponse, idx: number): boolean {
		if (child.status !== 'drafting') return false;
		if (idx === 0) return true;
		return working[idx - 1]?.status === 'completed';
	}
</script>

{#if working.length === 0}
	<p class="text-sm text-[var(--color-text-muted)]">No children yet.</p>
{:else}
	<ul
		class="space-y-2"
		use:dndzone={{
			items: working,
			flipDurationMs: 180,
			dropTargetStyle: {},
			dragDisabled: busy || !onReorder
		}}
		onconsider={handleConsider}
		onfinalize={handleFinalize}
	>
		{#each working as child, idx (child.id)}
			<li
				class="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
			>
				{#if onReorder}
					<span class="cursor-grab text-[var(--color-text-muted)]" aria-label="Drag to reorder">
						<GripVertical class="h-4 w-4" />
					</span>
				{/if}
				<span class="text-xs text-[var(--color-text-muted)] w-8 text-right tabular-nums">
					#{idx + 1}
				</span>
				<div class="flex-1 min-w-0">
					<a
						href={resolve(`/projects/${child.id}`)}
						class="block truncate text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
					>
						{child.title}
					</a>
					<p class="text-xs text-[var(--color-text-muted)]">{PROJECT_TYPE_LABELS[child.type]}</p>
				</div>
				<Pill tone={statusTone(child.status)}>{child.status}</Pill>
				{#if child.status === 'drafting' && onStart}
					<Button
						size="sm"
						variant="primary"
						disabled={!canStart(child, idx) || busy}
						loading={busyId === child.id}
						onclick={() => onStart(child.id)}
					>
						{#if busyId !== child.id}
							<Play class="h-3.5 w-3.5" />
						{/if}
						Start
					</Button>
				{:else}
					<Button href={`/projects/${child.id}`} size="sm" variant="ghost">
						Open <ChevronRight class="h-3.5 w-3.5" />
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

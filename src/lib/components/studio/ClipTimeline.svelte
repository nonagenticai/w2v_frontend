<script lang="ts">
	// Horizontal, drag-reorderable clip strip for the video studio. Each card is
	// one clip from the run's spine stage; dragging reorders (svelte-dnd-action,
	// same pattern as ChildProjectList), clicking selects + seeks the player, and
	// the active card (playhead) gets an accent ring. Keyboard ←/→ move a focused
	// card as a drag-free a11y fallback.
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		GripVertical,
		Film,
		LayoutTemplate,
		Code2,
		Sparkles,
		Image as ImageIcon,
		MessageSquare,
		Play
	} from '@lucide/svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import Duration from '$lib/components/runs/renderers/_shared/Duration.svelte';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import type { Clip } from '$lib/utils/timeline';

	interface Props {
		clips: Clip[];
		/** The clip under the playhead — gets the accent ring. */
		activeClipId?: string | null;
		/** The clip open in the inspector — gets a stronger border. */
		selectedClipId?: string | null;
		/** Count of open notes per clip id, for the badge. */
		noteCounts?: Record<string, number>;
		onSelect?: (clipId: string) => void;
		/** Called after a drag/keyboard move with the new id order. Omit to lock order. */
		onReorder?: (orderedIds: string[]) => void;
		disabled?: boolean;
	}

	let {
		clips: clipsProp,
		activeClipId = null,
		selectedClipId = null,
		noteCounts = {},
		onSelect,
		onReorder,
		disabled = false
	}: Props = $props();

	// Defensive: the caller's contract is `Clip[]`, but a run whose spine hasn't
	// loaded yet (or a malformed spine) can hand this an undefined/null value at
	// runtime. Spreading that directly (`[...clips]`) throws "is not iterable"
	// during init, which aborts the WHOLE component render — the {#if} below
	// never runs, so neither the empty-state text nor `clip-timeline` ever
	// mounts. Normalize once here so every downstream read sees a real array and
	// falls through to the explicit empty state instead of crashing silently.
	const clips = $derived(Array.isArray(clipsProp) ? clipsProp : []);

	// svelte-dnd-action mutates a local working copy on consider/finalize. The
	// initial seed reads `clips` once (untracked); the $effect below keeps it in
	// sync when a new run's clips arrive.
	let working = $state<Clip[]>(untrack(() => [...clips]));
	// Re-seed when the source list MEMBERSHIP changes (a new run loaded with a
	// different set of clips), but never on a pure reorder. Compare by SORTED id
	// SET, not sequence: a local reorder keeps the same ids in a new order, so a
	// sequence compare would (once `dragging` clears on finalize) revert `working`
	// back to `clips` — snapping the timeline to its original order and making
	// multi-step reordering impossible. A set compare only fires on genuine
	// add/remove of clips, leaving a user's reorder intact until they save it.
	$effect(() => {
		const incoming = [...clips]
			.map((c) => c.id)
			.sort()
			.join('|');
		const current = [...working]
			.map((c) => c.id)
			.sort()
			.join('|');
		if (incoming !== current && !dragging) working = [...clips];
	});

	let dragging = $state(false);

	// Thumbnail stills are proxied `/api/runs/.../artifact/...` URLs that can 404
	// (expired/purged artifact). Without an onerror fallback the card shows the
	// browser's broken-image glyph; track failures so the render falls through to
	// the poster video / icon placeholder instead.
	const failedThumbs = new SvelteSet<string>();

	function iconFor(t: string | null) {
		return t === 'footage'
			? Film
			: t === 'slide'
				? LayoutTemplate
				: t === 'html'
					? Code2
					: t === 'ai_image'
						? Sparkles
						: ImageIcon;
	}

	function handleConsider(e: CustomEvent<DndEvent<Clip>>) {
		dragging = true;
		working = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<Clip>>) {
		dragging = false;
		working = e.detail.items;
		emitIfChanged();
	}

	function emitIfChanged() {
		if (!onReorder) return;
		const next = working.map((c) => c.id);
		const base = clips.map((c) => c.id);
		if (next.join('|') !== base.join('|')) onReorder(next);
	}

	// Screen-reader feedback after a keyboard move — the visual reorder is silent
	// to AT, so announce the new slot via a polite live region.
	let moveAnnouncement = $state('');

	// Keyboard reorder fallback: ←/→ move the focused clip one slot.
	function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= working.length) return;
		const copy = [...working];
		[copy[index], copy[target]] = [copy[target], copy[index]];
		working = copy;
		moveAnnouncement = `Clip moved to position ${target + 1} of ${working.length}`;
		emitIfChanged();
	}

	function onKeydown(e: KeyboardEvent, index: number) {
		if (disabled || !onReorder) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			move(index, -1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			move(index, 1);
		}
	}
</script>

{#if working.length === 0}
	<p class="text-sm text-[var(--color-text-muted)]">This run has no clip timeline.</p>
{:else}
	<p class="sr-only" aria-live="polite" data-testid="clip-move-announcer">{moveAnnouncement}</p>
	<div
		class="flex gap-3 overflow-x-auto pb-2 snap-x"
		data-testid="clip-timeline"
		use:dndzone={{
			items: working,
			flipDurationMs: 180,
			dropTargetStyle: {},
			dragDisabled: disabled || !onReorder,
			type: 'clip-timeline'
		}}
		onconsider={handleConsider}
		onfinalize={handleFinalize}
	>
		{#each working as clip, i (clip.id)}
			{@const Icon = iconFor(clip.visualType)}
			{@const notes = noteCounts[clip.id] ?? 0}
			<div
				class="w-56 shrink-0 snap-start rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-3 space-y-2 transition-shadow
					{selectedClipId === clip.id
					? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
					: activeClipId === clip.id
						? 'border-[var(--color-accent)]'
						: 'border-[var(--color-border)]'}"
				data-testid="clip-card"
				data-clip-id={clip.id}
				data-active={activeClipId === clip.id ? 'true' : undefined}
			>
				<div class="flex items-center justify-between gap-2">
					<span class="inline-flex items-center gap-1.5 text-[var(--color-accent)]">
						{#if onReorder}
							<span
								class="cursor-grab text-[var(--color-text-muted)]"
								aria-label={`Reorder clip ${i + 1}: drag, or press left/right arrow keys to move it`}
								aria-keyshortcuts="ArrowLeft ArrowRight"
								data-testid="clip-drag-handle"
								onkeydown={(e) => onKeydown(e, i)}
								role="button"
								tabindex="0"
							>
								<GripVertical class="h-4 w-4" />
							</span>
						{/if}
						<Icon class="h-4 w-4" />
						<span class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
							{clip.visualType ?? 'clip'}
						</span>
					</span>
					<span class="text-[10px] tabular-nums text-[var(--color-text-muted)]">#{i + 1}</span>
				</div>

				<!-- Decorative preview: same select action as the label button below, so
				     it's kept out of the tab order (tabindex/-1 + aria-hidden) to leave a
				     single select tab stop per card. -->
				<button
					type="button"
					class="group relative block aspect-video w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-strong)]"
					onclick={() => onSelect?.(clip.id)}
					data-testid="clip-thumb"
					tabindex={-1}
					aria-hidden="true"
				>
					<!-- scopedMediaUrl: the browser fetches these itself and can't send the
					     X-Active-Tenant-Id header a super-admin's tenant switch needs.
					     failedThumbs still keys off the raw URL, which never changes. -->
					{#if clip.thumbnailUrl && !failedThumbs.has(clip.thumbnailUrl)}
						<img
							src={scopedMediaUrl(clip.thumbnailUrl)}
							alt={clip.description || `Clip ${i + 1}`}
							loading="lazy"
							class="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
							data-testid="clip-thumb-img"
							onerror={() => failedThumbs.add(clip.thumbnailUrl!)}
						/>
					{:else if clip.posterVideoUrl}
						<video
							src={scopedMediaUrl(clip.posterVideoUrl)}
							preload="none"
							muted
							class="h-full w-full object-cover"
							data-testid="clip-thumb-video"
						></video>
						<span class="absolute inset-0 flex items-center justify-center bg-black/15">
							<span class="rounded-full bg-black/55 p-1.5 text-white">
								<Play class="h-4 w-4" />
							</span>
						</span>
					{:else}
						<span
							class="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]"
							data-testid="clip-thumb-placeholder"
						>
							<Icon class="h-6 w-6" />
						</span>
					{/if}
				</button>

				<button
					type="button"
					class="block w-full text-left"
					onclick={() => onSelect?.(clip.id)}
					data-testid="clip-select"
				>
					{#if clip.description}
						<p class="text-sm text-[var(--color-text)] line-clamp-2">{clip.description}</p>
					{:else}
						<p class="text-sm italic text-[var(--color-text-muted)]">Untitled clip</p>
					{/if}
				</button>

				<div class="flex flex-wrap items-center gap-2">
					{#if clip.seconds > 0}<Duration seconds={clip.seconds} class="text-xs" />{/if}
					{#if notes > 0}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]"
							data-testid="clip-note-badge"
						>
							<MessageSquare class="h-3 w-3" />
							{notes}
						</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

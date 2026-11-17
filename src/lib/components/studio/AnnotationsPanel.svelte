<script lang="ts">
	// Right-rail Notes tab. Bucketed by status (open / applied / dismissed) and
	// ordered by created_at ASC within a bucket. Owns the add-note form for
	// BOTH stage-level pins and element-level pins. The element pin button on
	// a structured editor sets `pinningElementId` on this panel; the form's
	// submit then calls `onAddElementNote(elementId, text)` instead of
	// `onAddStageNote(text)`. A "Clear pin" affordance reverts to stage mode.

	import { Plus, X } from '@lucide/svelte';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { Button, ErrorState } from '$lib/components/ui';
	import AnnotationItem from './AnnotationItem.svelte';
	import type { AnnotationResponse, AnnotationStatus } from '$lib/types';

	interface Props {
		items: AnnotationResponse[];
		selectedIds: Set<string>;
		onToggle?: (id: string) => void;
		onJumpToElement?: (id: string) => void;
		onAddStageNote?: (text: string) => Promise<void>;
		onSaveNote?: (id: string, text: string) => Promise<void>;
		onDismissNote?: (id: string) => Promise<void>;
		/**
		 * Element id the next-added note should pin to. When set, the add-note
		 * form switches to element-pin mode and submit calls
		 * `onAddElementNote(elementId, text)`. Set back to `null` from the
		 * parent (typically after a successful submit) to return to stage mode.
		 */
		pinningElementId?: string | null;
		/** Human label shown next to the element id in the pinning indicator. */
		pinningElementLabel?: string;
		/**
		 * Submit a note pinned to `pinningElementId`. Required when the parent
		 * sets `pinningElementId`. The parent is expected to clear the pinning
		 * state once the note resolves.
		 */
		onAddElementNote?: (elementId: string, text: string) => Promise<void>;
		/** Cancel element-pin mode without submitting. The parent should null out `pinningElementId`. */
		onClearPinning?: () => void;
		/**
		 * Why a new note cannot be added here. When set, the add-note form is
		 * replaced by this reason — a composer whose submit the server would refuse
		 * (or that silently no-ops) is worse than no composer.
		 */
		addDisabledReason?: string | null;
	}

	let {
		items,
		selectedIds,
		onToggle,
		onJumpToElement,
		onAddStageNote,
		onSaveNote,
		onDismissNote,
		pinningElementId = null,
		pinningElementLabel,
		onAddElementNote,
		onClearPinning,
		addDisabledReason = null
	}: Props = $props();

	const BUCKETS: AnnotationStatus[] = ['open', 'applied', 'dismissed'];

	// `items` is `[]` for BOTH "this stage has no notes" and "the annotations
	// fetch failed", and this panel states the first one out loud ("No open
	// notes.") plus a zero count on every bucket tab. A tester who reloads after
	// filing a note reads that as "my note was never saved".
	//
	// Both routes that mount this panel — the stage editor rail and the Studio
	// clip inspector — publish the same sibling key from their loader, so the
	// panel reads it off `page.data` instead of demanding a prop from two
	// unrelated parents. Optional-chained so a test stubbing `$app/state` with a
	// partial object cannot crash it.
	const loadError = $derived(
		(page.data as { annotationsError?: unknown } | undefined)?.annotationsError ?? null
	);

	let bucket = $state<AnnotationStatus>('open');

	let counts = $derived({
		open: items.filter((a) => a.status === 'open').length,
		applied: items.filter((a) => a.status === 'applied').length,
		dismissed: items.filter((a) => a.status === 'dismissed').length
	});

	let filtered = $derived(
		items
			.filter((a) => a.status === bucket)
			.slice()
			.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
	);

	let addDraft = $state('');
	let adding = $state(false);
	let addError = $state<string | null>(null);

	let pinLabel = $derived(pinningElementId ? (pinningElementLabel ?? pinningElementId) : null);

	async function addNote() {
		addError = null;
		const stripped = addDraft.trim();
		if (!stripped) return;
		adding = true;
		try {
			if (pinningElementId && onAddElementNote) {
				await onAddElementNote(pinningElementId, stripped);
			} else {
				await onAddStageNote?.(stripped);
			}
			addDraft = '';
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Add failed';
		} finally {
			adding = false;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div role="tablist" class="flex gap-1 text-xs">
		{#each BUCKETS as b (b)}
			<button
				role="tab"
				aria-selected={bucket === b}
				class="rounded px-2 py-1 transition-colors {bucket === b
					? 'bg-primary-500 text-text-on-primary'
					: 'bg-surface-raised text-text-secondary hover:bg-surface-overlay'}"
				onclick={() => (bucket = b)}
			>
				{b}
				<!-- A count of 0 is a claim about the stage. When the fetch failed we
				     do not know the count, so show "?" rather than a confident zero. -->
				<span class="ml-1 text-[10px] opacity-80">{loadError ? '?' : counts[b]}</span>
			</button>
		{/each}
	</div>

	{#if loadError}
		<div data-testid="annotations-unavailable">
			<ErrorState
				error={loadError}
				title="Notes could not be loaded"
				onRetry={() => void invalidateAll()}
				class="!py-6"
			/>
		</div>
	{/if}

	<ul class="space-y-2" data-testid="annotations-list">
		{#each filtered as ann (ann.id)}
			<AnnotationItem
				annotation={ann}
				selected={selectedIds.has(ann.id)}
				onToggle={() => onToggle?.(ann.id)}
				{onJumpToElement}
				onSave={onSaveNote ? (text) => onSaveNote(ann.id, text) : undefined}
				onDismiss={onDismissNote ? () => onDismissNote(ann.id) : undefined}
			/>
		{/each}
		{#if filtered.length === 0 && !loadError}
			<li class="text-xs text-text-muted italic">No {bucket} notes.</li>
		{/if}
	</ul>

	{#if bucket === 'open' && addDisabledReason}
		<p
			class="rounded-lg border border-dashed border-border p-2 text-xs text-text-muted"
			data-testid="annotations-add-blocked"
			role="status"
		>
			{addDisabledReason}
		</p>
	{:else if bucket === 'open'}
		<div class="rounded-lg border border-dashed border-border p-2 space-y-2">
			{#if pinLabel}
				<div
					class="flex items-center justify-between rounded bg-primary-500/10 px-2 py-1 text-[11px] text-primary-600"
					data-testid="annotations-pin-indicator"
				>
					<span>Adding note pinned to <span class="font-mono">{pinLabel}</span></span>
					<button
						type="button"
						class="flex items-center gap-0.5 hover:underline"
						onclick={() => onClearPinning?.()}
						aria-label="Clear pin and return to stage-note mode"
					>
						<X class="h-3 w-3" />
						Clear pin
					</button>
				</div>
			{/if}
			<!-- data-testid: the clip inspector now hosts several textareas (caption,
			     re-narrate text, and this note), so E2E must target this one explicitly.
			     A bare getByRole('textbox') is ambiguous and fails Playwright strict mode. -->
			<textarea
				data-testid="annotation-draft"
				class="w-full min-h-16 rounded border border-border bg-surface-raised px-2 py-1 text-xs resize-y focus:outline-none focus:border-primary-500"
				bind:value={addDraft}
				placeholder={pinLabel
					? `Note pinned to ${pinLabel}`
					: 'Stage-level note (applies to the whole stage)'}
				disabled={adding}
				spellcheck
			></textarea>
			{#if addError}
				<p class="text-[11px] text-status-failed">{addError}</p>
			{/if}
			<Button
				size="sm"
				variant="secondary"
				onclick={addNote}
				loading={adding}
				disabled={!addDraft.trim()}
			>
				<Plus class="h-3 w-3" />
				{pinLabel ? 'Add element note' : 'Add stage note'}
			</Button>
		</div>
	{/if}
</div>

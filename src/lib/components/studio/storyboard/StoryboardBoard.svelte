<script lang="ts">
	// Drag-orderable grid of storyboard panels (structured authoring + the
	// generated panel image). Dual-mode, cloning the ClipTimeline dnd idiom:
	//   • wizard mode  (no callbacks) → mutates the $bindable `panels` array
	//     in place; buildBrief later serialises them into `brief.storyboard`.
	//   • section mode (callbacks)    → delegates add/update/delete/reorder to
	//     the store via the injected callbacks.
	// `working` is the editable rendered list (svelte-dnd-action mutates it on
	// drag); it re-seeds from `panels` only when the membership (id SET) changes,
	// never on a pure reorder — otherwise finalize would snap the order back.
	import { untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { GripVertical, Plus, Trash2 } from '@lucide/svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { StoryboardPanelDraft } from '$lib/types';
	import { loadProject } from '$lib/stores/storyboard.svelte.js';
	import StoryboardPanelCard from './StoryboardPanelCard.svelte';

	interface Props {
		panels?: StoryboardPanelDraft[];
		onReorder?: (orderedIds: string[]) => void;
		onAdd?: () => void;
		/** Section mode returns the store write's promise so the board can revert its
		 *  optimistic edit if the PATCH is rejected (archived-409, network, timeout).
		 *  Wizard mode returns nothing (in-memory only). */
		onUpdate?: (id: string, patch: Partial<StoryboardPanelDraft>) => void | Promise<unknown>;
		onDelete?: (id: string) => void;
		/** Section-only: AI-rewrite a panel. Undefined in wizard mode ⇒ each card
		 *  hides its Rewrite affordance. Does NOT affect wizardMode detection. */
		onRewrite?: (id: string, instruction: string, fields?: string[]) => void;
		/** Section-only: true while a given panel has an in-flight store mutation. */
		isBusy?: (id: string) => boolean;
		disabled?: boolean;
		/** Header title (default "Storyboard"). */
		title?: string;
		/** Hide the header row (title + Add shot) — e.g. when embedded per-scene. */
		hideHeader?: boolean;
		/** svelte-dnd-action drag `type`; override to isolate drag to a subset
		 *  (e.g. per-scene groups) so drops can't cross into another zone. */
		dndType?: string;
	}

	let {
		panels = $bindable<StoryboardPanelDraft[]>([]),
		onReorder,
		onAdd,
		onUpdate,
		onDelete,
		onRewrite,
		isBusy,
		disabled = false,
		title = 'Storyboard',
		hideHeader = false,
		dndType = 'storyboard'
	}: Props = $props();

	// No persistence callbacks ⇒ wizard mode (in-memory bound array).
	const wizardMode = $derived(!onReorder && !onAdd && !onUpdate && !onDelete);

	// svelte-dnd-action requires a stable, unique `id` on every item; the rendered
	// working list therefore uses a required-id shape (wizard drafts get synthetic).
	type BoardPanel = StoryboardPanelDraft & { id: string };

	let draftSeq = 0;
	function ensureId(p: StoryboardPanelDraft): BoardPanel {
		return { ...p, id: p.id ?? `sb-${++draftSeq}` };
	}

	let working = $state<BoardPanel[]>(untrack(() => panels.map(ensureId)));
	let dragging = $state(false);

	// Panel ids with an in-flight section-mode PATCH, ref-counted (fast typing fires
	// several before the first lands). A panel is "pending" while its store write is
	// unresolved: the pessimistic store hasn't echoed the edit yet, so `panels` is
	// deliberately behind `working` and the content-reconcile below must NOT clobber
	// the live optimistic value. SvelteMap so settle → effect re-run → reconcile.
	const pendingWrites = new SvelteMap<string, number>();
	function isPending(id: string): boolean {
		return (pendingWrites.get(id) ?? 0) > 0;
	}
	function markPending(id: string): void {
		pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
	}
	function unmarkPending(id: string): void {
		const n = (pendingWrites.get(id) ?? 1) - 1;
		if (n <= 0) pendingWrites.delete(id);
		else pendingWrites.set(id, n);
	}

	// The user-visible/editable fields a card renders. Content reconciliation compares
	// only these — never volatile server bookkeeping (lock_version/revision/updated_at)
	// — so a successful write's echo (which bumps lock_version but not content) is a
	// no-op and never triggers an extra re-render.
	const CONTENT_FIELDS = [
		'shot_key',
		'action_description',
		'dialogue',
		'vo_text',
		'shot_size',
		'angle',
		'movement',
		'transition_out',
		'duration_seconds',
		'shot_number',
		'status',
		'scene_id',
		'approved_at',
		'approved_by',
		// The image fields MUST be reconciled here. A completed generation lands in the
		// store as a board refetch that changes neither the id set nor the order, so if
		// `media_ref` were not part of the signature the rendered row would keep its
		// pre-generation copy and the picture would never appear — the card would sit on
		// "Image ready" with an empty thumbnail slot.
		'media_ref',
		'gen'
	] as const;
	function contentSig(p: StoryboardPanelDraft): string {
		return CONTENT_FIELDS.map((f) => JSON.stringify(p[f] ?? null)).join('');
	}

	$effect(() => {
		if (dragging) return;
		// Sequence keys (order-sensitive) and set keys (membership only).
		const incomingSeq = panels.map((p) => p.id ?? p.shot_key).join('|');
		const currentSeq = working.map((p) => p.id).join('|');
		const incomingSet = [...panels]
			.map((p) => p.id ?? p.shot_key)
			.sort()
			.join('|');
		const currentSet = [...working]
			.map((p) => p.id)
			.sort()
			.join('|');
		// Re-seed on a MEMBERSHIP change in either mode (add/remove/load). Re-seed on
		// an ORDER-only change only in section mode, where the store is authoritative
		// for order — so a failed optimistic reorder (store reverted) re-syncs the
		// board instead of leaving it ahead. Wizard mode owns its order locally, and
		// its own commits keep `panels` in step, so a pure reorder never snaps back.
		if (incomingSet !== currentSet || (!wizardMode && incomingSeq !== currentSeq)) {
			working = panels.map(ensureId);
			return;
		}
		// Same ids + order. Wizard mode owns content locally (its own commits keep
		// `panels` in step), so nothing more to do.
		if (wizardMode) return;
		// Section mode: the store is authoritative for CONTENT too. Reconcile any panel
		// whose server content diverges from the rendered row — EXCEPT ones with an
		// in-flight optimistic edit (skipped above via isPending). This is what stops a
		// REJECTED field edit's phantom value from surviving as if it were saved without
		// waiting for a membership change or a full board reload; on the happy path the
		// echo matches the optimistic value, so it is a no-op.
		let changed = false;
		const next = working.map((w) => {
			if (isPending(w.id)) return w;
			const server = panels.find((p) => (p.id ?? p.shot_key) === w.id);
			if (!server || contentSig(server) === contentSig(w)) return w;
			changed = true;
			return ensureId(server);
		});
		if (changed) working = next;
	});

	const reorderEnabled = $derived(!disabled && (!!onReorder || wizardMode));

	function idOf(p: BoardPanel): string {
		return p.id;
	}

	function handleConsider(e: CustomEvent<DndEvent<BoardPanel>>) {
		dragging = true;
		working = e.detail.items;
	}
	function handleFinalize(e: CustomEvent<DndEvent<BoardPanel>>) {
		dragging = false;
		working = e.detail.items;
		commitOrder();
	}
	function commitOrder() {
		const next = working.map(idOf);
		const base = panels.map((p) => p.id ?? p.shot_key);
		if (next.join('|') === base.join('|')) return;
		if (onReorder) onReorder(next);
		else if (wizardMode) panels = [...working];
	}

	let moveAnnouncement = $state('');
	function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= working.length) return;
		const copy = [...working];
		[copy[index], copy[target]] = [copy[target], copy[index]];
		working = copy;
		moveAnnouncement = `Shot moved to position ${target + 1} of ${working.length}`;
		commitOrder();
	}
	function onKeydown(e: KeyboardEvent, index: number) {
		if (!reorderEnabled) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			move(index, -1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			move(index, 1);
		}
	}

	function add() {
		if (onAdd) {
			onAdd();
			return;
		}
		const draft: BoardPanel = {
			id: `sb-${++draftSeq}`,
			shot_key: `clip-${working.length + 1}`,
			status: 'draft'
		};
		working = [...working, draft];
		panels = [...working];
	}
	function remove(panel: BoardPanel, index: number) {
		if (onDelete) {
			onDelete(idOf(panel));
			return;
		}
		working = working.filter((_, i) => i !== index);
		panels = [...working];
	}
	function update(panel: BoardPanel, index: number, patch: Partial<StoryboardPanelDraft>) {
		// Mutate the rendered list in place so the edit shows regardless of mode
		// (a content edit never changes the id SET, so the $effect won't re-seed).
		working = working.map((p, i) => (i === index ? { ...p, ...patch } : p));
		if (onUpdate) {
			const id = idOf(panel);
			const result = onUpdate(id, patch);
			// Section mode returns the store write's promise. The store is pessimistic
			// (it caches only on success), so a REJECTED write leaves nothing to re-seed
			// from — revert the optimistic edit here or the board shows unsaved text as
			// if it were saved. Revert only the fields THIS write carried, back to the
			// server/cache value, so a concurrent edit on another field is untouched.
			if (result && typeof (result as unknown as { then?: unknown }).then === 'function') {
				markPending(id);
				Promise.resolve(result)
					.catch(() => {
						const server = panels.find((p) => (p.id ?? p.shot_key) === id);
						working = working.map((p) => {
							if (p.id !== id) return p;
							const restored: BoardPanel = { ...p };
							for (const key of Object.keys(patch)) {
								(restored as unknown as Record<string, unknown>)[key] = server
									? (server as unknown as Record<string, unknown>)[key]
									: undefined;
							}
							return restored;
						});
					})
					.finally(() => unmarkPending(id));
			}
		} else if (wizardMode) panels = [...working];
	}
	// ── The generated panel image ──────────────────────────────────────────────
	//
	// The src is read straight off the panel on every render and NEVER copied into
	// state: `media_ref.url` is a presign that expires in about an hour, and only
	// the panel read path mints a fresh one. A cached copy is how every frame of a
	// PDF export once degraded to a placeholder.
	//
	// An expired url therefore fails to load rather than 404ing at fetch time, so
	// `onerror` gets ONE refetch of the board (which re-signs it) per distinct url.
	// Keying the guards on the url itself makes them self-resetting: a regenerate
	// mints a new url, which is a new key, which gets its own single attempt.
	const refreshedUrls = new SvelteSet<string>();
	const brokenUrls = new SvelteSet<string>();

	function mediaUrl(p: BoardPanel): string | null {
		const url = p.media_ref?.url;
		return typeof url === 'string' && url !== '' ? url : null;
	}
	/** Non-empty `gen` ⇒ this shot WAS generated, whatever the url says now. */
	function everGenerated(p: BoardPanel): boolean {
		return p.gen != null && Object.keys(p.gen).length > 0;
	}
	function imageAlt(p: BoardPanel, index: number): string {
		const action = p.action_description?.trim();
		const label = p.shot_key ?? `clip-${index + 1}`;
		return action ? `Generated frame for ${label}: ${action}` : `Generated frame for ${label}`;
	}
	async function handleImageError(p: BoardPanel, url: string): Promise<void> {
		const projectId = p.project_id;
		if (!projectId || refreshedUrls.has(url)) {
			// Already spent this url's one refresh (or there is no project to refetch
			// from): say the image is gone rather than leaving a blank slot.
			brokenUrls.add(url);
			return;
		}
		refreshedUrls.add(url);
		try {
			await loadProject(projectId);
		} catch {
			brokenUrls.add(url);
			return;
		}
		// A refetch that hands back the SAME url has not fixed anything, and the
		// browser will not re-fire `onerror` for an unchanged `src` — so the failure
		// has to be declared here or the card keeps a permanently blank slot.
		const fresh = panels.find((row) => (row.id ?? row.shot_key) === p.id);
		const freshUrl = fresh?.media_ref?.url;
		if (typeof freshUrl !== 'string' || freshUrl === '' || freshUrl === url) brokenUrls.add(url);
	}

	function applyApproval(index: number, patch: Partial<StoryboardPanelDraft>) {
		// Approve/unapprove already persisted through the store; patch the rendered
		// row so the card flips to its approved/draft state immediately (the id SET
		// is unchanged, so the re-seed $effect won't fire on its own). No persist.
		working = working.map((p, i) => (i === index ? { ...p, ...patch } : p));
	}
</script>

<div class="space-y-4">
	{#if !hideHeader}
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
			<button
				type="button"
				class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
				{disabled}
				onclick={add}
				data-testid="add-shot"
			>
				<Plus class="h-4 w-4" />
				Add shot
			</button>
		</div>
	{/if}

	<p class="sr-only" aria-live="polite" data-testid="panel-move-announcer">{moveAnnouncement}</p>

	{#if working.length === 0}
		<p
			class="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]"
		>
			No shots yet. Add a shot to start the storyboard.
		</p>
	{:else}
		<div
			class="grid grid-cols-1 gap-3"
			use:dndzone={{
				items: working,
				flipDurationMs: 180,
				dropTargetStyle: {},
				dragDisabled: !reorderEnabled,
				type: dndType
			}}
			onconsider={handleConsider}
			onfinalize={handleFinalize}
		>
			{#each working as panel, i (idOf(panel))}
				{@const imageUrl = mediaUrl(panel)}
				<div
					class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
					data-testid="panel-card"
					data-panel-id={idOf(panel)}
				>
					<!-- The generated frame. `src` is read from the panel every render — see
					     the mediaUrl comment; it must never be cached in local state. -->
					{#if imageUrl && !brokenUrls.has(imageUrl)}
						<img
							src={imageUrl}
							alt={imageAlt(panel, i)}
							loading="lazy"
							class="mb-2 max-h-64 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] object-cover"
							data-testid="panel-image-thumb"
							onerror={() => void handleImageError(panel, imageUrl)}
						/>
					{:else if imageUrl}
						<p
							class="mb-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
							data-testid="panel-image-broken"
						>
							Image expired and could not be refreshed
						</p>
					{:else if everGenerated(panel)}
						<!-- Generated, but the panel carries no url: an empty slot here would
						     read as "never generated", which is not what we know. -->
						<p
							class="mb-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
							data-testid="panel-image-missing"
						>
							This shot was generated, but its image is no longer available
						</p>
					{/if}
					<div class="mb-2 flex items-center justify-between gap-2">
						<span class="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
							{#if reorderEnabled}
								<span
									class="cursor-grab"
									role="button"
									tabindex="0"
									aria-label={`Reorder shot ${i + 1}: drag, or press left/right arrow keys to move it`}
									aria-keyshortcuts="ArrowLeft ArrowRight"
									data-testid="panel-drag-handle"
									onkeydown={(e) => onKeydown(e, i)}
								>
									<GripVertical class="h-4 w-4" />
								</span>
							{/if}
							<span class="text-[10px] tabular-nums">#{i + 1}</span>
						</span>
						<button
							type="button"
							class="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] disabled:opacity-50"
							{disabled}
							aria-label={`Delete shot ${i + 1}`}
							data-testid="panel-delete"
							onclick={() => remove(panel, i)}
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
					<StoryboardPanelCard
						{panel}
						shotLabel={wizardMode ? `clip-${i + 1}` : (panel.shot_key ?? `clip-${i + 1}`)}
						{disabled}
						onUpdate={(patch) => update(panel, i, patch)}
						onApproved={(patch) => applyApproval(i, patch)}
						{onRewrite}
						{isBusy}
					/>
				</div>
			{/each}
		</div>
	{/if}
</div>

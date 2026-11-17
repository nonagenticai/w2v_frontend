<script lang="ts">
	// Verbatim items list with inline add / edit / reorder / delete + status pills.
	//
	// Used in three places:
	//   1. /projects/[pid]/verbatim — project-scoped manager (full list).
	//   2. Run-monitor verbatim card — job-scoped manager (full list).
	//   3. Slide / Narrate stage editors — kind-filtered overlay (only items
	//      that consumer stage cares about; project + job rows merged).
	//
	// The component is presentational — the parent owns the data and the
	// mutators (calls into verbatim.svelte.ts). This way one component
	// covers project, job, and overlay surfaces with no scope ambiguity:
	// each call site decides which list to feed in and which create/delete
	// function to wire to onCreate / onDelete.

	import { Button, Input, Select } from '$lib/components/ui';
	import {
		type VerbatimItemCreateRequest,
		type VerbatimItemResponse,
		type VerbatimItemUpdateRequest,
		type VerbatimKind,
		type VerbatimScope,
		VERBATIM_KIND_LABELS,
		VERBATIM_SCOPE_LABELS,
		VERBATIM_STATUS_LABELS
	} from '$lib/types';
	import {
		Plus,
		Sparkles,
		Trash2,
		X,
		AlertTriangle,
		CheckCircle2,
		Pencil,
		ArrowUp,
		ArrowDown,
		MinusCircle
	} from '@lucide/svelte';

	/** How to name a verbatim track inside a sentence. `VERBATIM_KIND_LABELS`
	 *  ("On a slide" / "Spoken aloud") reads as a badge, not as a noun, so it
	 *  cannot be dropped into the `rejected` explanation below. Local because it
	 *  is presentation wording, not part of the API contract. */
	const KIND_NOUN: Record<VerbatimKind, string> = {
		slide: 'on-slide',
		tts: 'spoken'
	};
	import { untrack } from 'svelte';

	interface Props {
		/** The list to render. The parent filters by kind / scope as needed. */
		items: VerbatimItemResponse[];
		/** Restrict the kind dropdown in the add-form to a single kind. */
		fixedKind?: VerbatimKind;
		/** Optional banner copy shown above the list (e.g. "Slide-only items"). */
		description?: string;
		/** Project-scoped overlay rows are read-only here; pass true to lock. */
		readOnly?: boolean;
		/** Default scope for the add-form. */
		defaultScope?: VerbatimScope;
		/** Submit a new item. Promise rejects on failure → inline error. */
		onCreate?: (body: VerbatimItemCreateRequest) => Promise<void>;
		/** Delete an item by id. Promise rejects on failure → inline error. */
		onDelete?: (itemId: string) => Promise<void>;
		/**
		 * Patch an item. Only `text` is ever sent from here — hint / scope /
		 * scope_target stay create-time decisions. Omit the prop and the whole
		 * edit affordance disappears (call sites that only manage a read-only
		 * overlay are unaffected).
		 */
		onUpdate?: (itemId: string, body: VerbatimItemUpdateRequest) => Promise<void>;
		/**
		 * Move an item one step within its track. -1 = up (earlier), +1 = down.
		 * The parent owns the position arithmetic; this component only knows
		 * which row and which direction. Omit to hide the move controls.
		 */
		onMove?: (itemId: string, dir: -1 | 1) => Promise<void>;
		/**
		 * Optional click handler for the placement pill, fired with the
		 * placed_in_element_id when the row was placed. Used by the stage
		 * editor to navigate / scroll to the carrier element.
		 */
		onPlacedClick?: (elementId: string) => void;
	}

	let {
		items,
		fixedKind,
		description,
		readOnly = false,
		defaultScope = 'pipeline',
		onCreate,
		onDelete,
		onUpdate,
		onMove,
		onPlacedClick
	}: Props = $props();

	// ----- Add-form local state ---------------------------------------------
	// Initial-only capture of fixedKind / defaultScope is intentional: the
	// form is a transient sub-surface; props change via remount, not in-place.
	let formOpen = $state(false);
	let formKind = $state<VerbatimKind>(untrack(() => fixedKind ?? 'slide'));
	let formText = $state('');
	let formHint = $state('');
	let formScope = $state<VerbatimScope>(untrack(() => defaultScope));
	let formScopeTarget = $state('');
	let submitting = $state(false);
	let formError = $state<string | null>(null);
	let busyDeleteId = $state<string | null>(null);
	let deleteError = $state<string | null>(null);

	function resetForm() {
		formText = '';
		formHint = '';
		formScopeTarget = '';
		formError = null;
		formScope = defaultScope;
		if (!fixedKind) formKind = 'slide';
	}

	async function submit() {
		if (!onCreate) return;
		const trimmed = formText.trim();
		if (!trimmed) {
			formError = 'Text is required.';
			return;
		}
		submitting = true;
		formError = null;
		try {
			await onCreate({
				kind: fixedKind ?? formKind,
				text: trimmed,
				hint: formHint.trim() || null,
				scope: formScope,
				scope_target: formScopeTarget.trim() || null
			});
			resetForm();
			formOpen = false;
		} catch (err) {
			formError = err instanceof Error ? err.message : String(err);
		} finally {
			submitting = false;
		}
	}

	// ----- Inline edit / reorder local state --------------------------------
	// At most one row is in edit mode at a time; `editingId` doubles as the
	// mode flag and the identity of the row being edited.
	let editingId = $state<string | null>(null);
	let draftText = $state('');
	let savingId = $state<string | null>(null);
	let editError = $state<string | null>(null);
	let movingId = $state<string | null>(null);
	let moveError = $state<string | null>(null);

	function startEdit(item: VerbatimItemResponse) {
		editingId = item.id;
		draftText = item.text;
		editError = null;
	}

	function cancelEdit() {
		editingId = null;
		draftText = '';
		editError = null;
	}

	async function saveEdit(item: VerbatimItemResponse) {
		if (!onUpdate) return;
		const trimmed = draftText.trim();
		if (!trimmed) {
			editError = 'Text is required.';
			return;
		}
		// No-op edits close the editor without a request — the PATCH would be a
		// pointless write and, on a placed item, a pointless re-verification.
		if (trimmed === item.text) {
			cancelEdit();
			return;
		}
		savingId = item.id;
		editError = null;
		try {
			await onUpdate(item.id, { text: trimmed });
			editingId = null;
			draftText = '';
		} catch (err) {
			// Keep the editor open on failure so the user's draft isn't lost.
			editError = err instanceof Error ? err.message : String(err);
		} finally {
			savingId = null;
		}
	}

	function onEditKeydown(event: KeyboardEvent, item: VerbatimItemResponse) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelEdit();
		} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void saveEdit(item);
		}
	}

	async function move(id: string, dir: -1 | 1) {
		if (!onMove) return;
		movingId = id;
		moveError = null;
		try {
			await onMove(id, dir);
		} catch (err) {
			moveError = err instanceof Error ? err.message : String(err);
		} finally {
			movingId = null;
		}
	}

	async function remove(id: string) {
		if (!onDelete) return;
		busyDeleteId = id;
		deleteError = null;
		try {
			await onDelete(id);
		} catch (err) {
			deleteError = err instanceof Error ? err.message : String(err);
		} finally {
			busyDeleteId = null;
		}
	}

	const kindOptions = [
		{ value: 'slide', label: VERBATIM_KIND_LABELS.slide },
		{ value: 'tts', label: VERBATIM_KIND_LABELS.tts }
	];
	const scopeOptions = [
		{ value: 'pipeline', label: VERBATIM_SCOPE_LABELS.pipeline },
		{ value: 'chapter', label: VERBATIM_SCOPE_LABELS.chapter },
		{ value: 'scene', label: VERBATIM_SCOPE_LABELS.scene },
		{ value: 'shot', label: VERBATIM_SCOPE_LABELS.shot },
		{ value: 'slide', label: VERBATIM_SCOPE_LABELS.slide }
	];
</script>

<div class="space-y-3" aria-label="Verbatim items">
	{#if description}
		<p class="text-xs text-[var(--color-text-muted)]">{description}</p>
	{/if}

	{#if items.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]">
			No verbatim items yet. Add literal text the pipeline must surface verbatim — slides will show
			it; narration will say it.
		</p>
	{:else}
		<ul class="space-y-2">
			{#each items as item, index (item.id)}
				{@const isBusy = busyDeleteId === item.id}
				{@const isEditing = editingId === item.id}
				<li
					class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2"
					data-testid="verbatim-item"
					data-item-id={item.id}
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1 space-y-1">
							<div class="flex items-center gap-2 flex-wrap text-[11px]">
								<span
									class="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)]"
								>
									{VERBATIM_KIND_LABELS[item.kind]}
								</span>
								<span
									class="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)]"
								>
									{VERBATIM_SCOPE_LABELS[item.scope]}
								</span>
								{#if item.status === 'placed'}
									{@const targetId = item.placed_in_element_id}
									{#if targetId && onPlacedClick}
										<button
											type="button"
											onclick={() => onPlacedClick(targetId)}
											class="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-bg)] border border-[var(--color-success-border)] px-2 py-0.5 text-[var(--color-success-text)] hover:opacity-80"
											title="Placed — jump to carrier element"
										>
											<CheckCircle2 class="h-3 w-3" />
											{VERBATIM_STATUS_LABELS.placed}
										</button>
									{:else}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-bg)] border border-[var(--color-success-border)] px-2 py-0.5 text-[var(--color-success-text)]"
										>
											<CheckCircle2 class="h-3 w-3" />
											{VERBATIM_STATUS_LABELS.placed}
										</span>
									{/if}
								{:else if item.status === 'pending'}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 text-[var(--color-warning-text)]"
									>
										<Sparkles class="h-3 w-3" />
										{VERBATIM_STATUS_LABELS.pending}
									</span>
								{:else}
									<!-- `rejected` is NOT a verdict on the user's wording, and must not
									     look like one. The server's claim is narrow and mechanical:
									     every stage that ran in this run is forbidden from consuming
									     this item's kind. So this renders MUTED, not danger-coloured,
									     and the explanation below restates exactly that claim and
									     nothing more. -->
									<span
										class="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)]"
									>
										<MinusCircle class="h-3 w-3" />
										{VERBATIM_STATUS_LABELS[item.status]}
									</span>
								{/if}
								{#if item.retry_count > 0}
									<span
										class="inline-flex items-center gap-1 text-[10px] text-[var(--color-warning-text)]"
										title={`Retried ${item.retry_count} time${item.retry_count === 1 ? '' : 's'}`}
									>
										<AlertTriangle class="h-3 w-3" />
										retry {item.retry_count}
									</span>
								{/if}
								{#if item.placed_in_stage}
									<span class="text-[10px] text-[var(--color-text-muted)]">
										in {item.placed_in_stage.replace(/_/g, ' ')}
									</span>
								{/if}
								{#if item.status === 'rejected'}
									<span
										class="text-[10px] text-[var(--color-text-muted)]"
										data-testid="verbatim-item-unused-reason"
									>
										no stage in this run takes {KIND_NOUN[item.kind]} verbatim
									</span>
								{/if}
							</div>
							{#if isEditing}
								<div class="space-y-2">
									<textarea
										class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-sm text-[var(--color-text)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] min-h-[5rem]"
										aria-label="Verbatim text"
										data-testid="verbatim-item-text-input"
										bind:value={draftText}
										onkeydown={(e) => onEditKeydown(e, item)}
										disabled={savingId === item.id}
									></textarea>
									{#if item.status === 'placed'}
										<p class="text-[11px] text-[var(--color-text-muted)]">
											Already placed by a run — editing changes future runs only.
										</p>
									{/if}
									{#if editError}
										<p
											class="text-xs text-[var(--color-danger)]"
											data-testid="verbatim-item-edit-error"
										>
											{editError}
										</p>
									{/if}
									<!-- Button.svelte does not forward rest props to its <button> (same as
									     Card.svelte), so the test hooks hang on wrapper spans. -->
									<div class="flex justify-end gap-2">
										<span class="inline-flex" data-testid="verbatim-item-cancel-btn">
											<Button
												variant="secondary"
												size="sm"
												onclick={cancelEdit}
												disabled={savingId === item.id}>Cancel</Button
											>
										</span>
										<span class="inline-flex" data-testid="verbatim-item-save-btn">
											<Button
												variant="primary"
												size="sm"
												loading={savingId === item.id}
												onclick={() => saveEdit(item)}>Save</Button
											>
										</span>
									</div>
								</div>
							{:else}
								<!-- Stays a plain <p> outside edit mode on purpose: a textarea's value
								     is not DOM text, so the e2e text filter can only see the item once
								     the row has collapsed back to this branch. -->
								<p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">
									{item.text}
								</p>
							{/if}
							{#if item.hint}
								<p class="text-xs text-[var(--color-text-muted)] italic">Hint: {item.hint}</p>
							{/if}
							{#if item.scope_target}
								<p class="text-[11px] text-[var(--color-text-muted)] font-mono truncate">
									target: {item.scope_target.slice(0, 12)}
								</p>
							{/if}
						</div>
						{#if !readOnly && (onUpdate || onMove || onDelete)}
							<div class="shrink-0 flex items-start gap-0.5">
								{#if onUpdate}
									<button
										type="button"
										onclick={() => startEdit(item)}
										aria-label="Edit verbatim item"
										data-testid="verbatim-item-edit-btn"
										disabled={isEditing || isBusy}
										class="p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
									>
										<Pencil class="h-4 w-4" />
									</button>
								{/if}
								{#if onMove}
									<button
										type="button"
										onclick={() => move(item.id, -1)}
										aria-label="Move verbatim item up"
										data-testid="verbatim-item-move-up-btn"
										disabled={index === 0 || movingId !== null}
										class="p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
									>
										<ArrowUp class="h-4 w-4" />
									</button>
									<button
										type="button"
										onclick={() => move(item.id, 1)}
										aria-label="Move verbatim item down"
										data-testid="verbatim-item-move-down-btn"
										disabled={index === items.length - 1 || movingId !== null}
										class="p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
									>
										<ArrowDown class="h-4 w-4" />
									</button>
								{/if}
								{#if onDelete}
									<button
										type="button"
										onclick={() => remove(item.id)}
										aria-label="Remove verbatim item"
										disabled={isBusy}
										class="p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] disabled:opacity-50"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if deleteError}
		<p class="text-xs text-[var(--color-danger)]">{deleteError}</p>
	{/if}

	{#if moveError}
		<p class="text-xs text-[var(--color-danger)]" data-testid="verbatim-item-move-error">
			{moveError}
		</p>
	{/if}

	{#if !readOnly && onCreate}
		{#if !formOpen}
			<button
				type="button"
				onclick={() => (formOpen = true)}
				class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
			>
				<Plus class="h-3.5 w-3.5" />
				Add verbatim item
			</button>
		{:else}
			<div
				class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-xs font-semibold text-[var(--color-text)]">New verbatim item</h3>
					<button
						type="button"
						onclick={() => {
							resetForm();
							formOpen = false;
						}}
						aria-label="Close form"
						class="p-1 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{#if !fixedKind}
						<Select name="verbatim-kind" label="Kind" options={kindOptions} bind:value={formKind} />
					{/if}
					<Select
						name="verbatim-scope"
						label="Scope"
						options={scopeOptions}
						bind:value={formScope}
					/>
				</div>
				<label class="block">
					<span class="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">
						Text <span class="text-[var(--color-danger)]">*</span>
					</span>
					<textarea
						class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-sm text-[var(--color-text)] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] min-h-[5rem]"
						placeholder="The exact text the pipeline must surface verbatim."
						bind:value={formText}
						disabled={submitting}
					></textarea>
				</label>
				<Input
					name="verbatim-hint"
					label="Hint (optional)"
					placeholder="e.g. &quot;place near the closing line&quot;"
					bind:value={formHint}
				/>
				{#if formScope !== 'pipeline'}
					<Input
						name="verbatim-scope-target"
						label={`${formScope.charAt(0).toUpperCase() + formScope.slice(1)} ID (optional)`}
						placeholder="Stable id of the chapter / scene / shot / slide"
						bind:value={formScopeTarget}
					/>
				{/if}
				{#if formError}
					<p class="text-xs text-[var(--color-danger)]">{formError}</p>
				{/if}
				<div class="flex justify-end gap-2">
					<Button
						variant="secondary"
						size="sm"
						onclick={() => {
							resetForm();
							formOpen = false;
						}}
						disabled={submitting}>Cancel</Button
					>
					<Button variant="primary" size="sm" loading={submitting} onclick={submit}>
						<Plus class="h-3.5 w-3.5" />
						Add
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>

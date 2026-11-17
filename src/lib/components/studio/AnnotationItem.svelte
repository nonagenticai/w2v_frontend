<script lang="ts">
	// One annotation row in the right-rail Notes panel.
	//
	// States:
	//   - open: editable + dismissable; selectable via checkbox for apply-N flow.
	//   - applied / dismissed: read-only; applied shows the resulting draft id.
	//
	// The pin button on each ElementCard creates element-targeted annotations;
	// a stage-level "Add stage note" lives in AnnotationsPanel below the list.

	import { Edit2, Save, Trash2, X } from '@lucide/svelte';
	import { Badge, Button } from '$lib/components/ui';
	import type { AnnotationResponse } from '$lib/types';

	interface Props {
		annotation: AnnotationResponse;
		selected?: boolean;
		onToggle?: () => void;
		onJumpToElement?: (id: string) => void;
		onSave?: (text: string) => Promise<void>;
		onDismiss?: () => Promise<void>;
	}

	let {
		annotation,
		selected = false,
		onToggle,
		onJumpToElement,
		onSave,
		onDismiss
	}: Props = $props();

	let editing = $state(false);
	// The draft buffer mirrors the annotation text whenever we are NOT editing
	// (e.g. WS update from another client comes in). The effect runs on mount
	// too so the initial sync also lands here, avoiding a state_referenced_locally
	// warning from initialising directly off the prop.
	let draft = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (!editing) draft = annotation.text;
	});

	async function save() {
		error = null;
		const stripped = draft.trim();
		if (!stripped) {
			error = 'Note must not be empty.';
			return;
		}
		busy = true;
		try {
			await onSave?.(stripped);
			editing = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Save failed';
		} finally {
			busy = false;
		}
	}

	async function dismiss() {
		busy = true;
		try {
			await onDismiss?.();
		} finally {
			busy = false;
		}
	}

	const badgeVariant: 'warning' | 'success' | 'default' = $derived(
		annotation.status === 'open'
			? 'warning'
			: annotation.status === 'applied'
				? 'success'
				: 'default'
	);
</script>

<li class="rounded-lg border border-border bg-surface p-3 text-sm space-y-2">
	<header class="flex items-center gap-2">
		{#if annotation.status === 'open' && onToggle}
			<input
				type="checkbox"
				checked={selected}
				onchange={onToggle}
				aria-label="Select annotation for apply-N"
				class="h-3.5 w-3.5"
			/>
		{/if}
		<Badge variant={badgeVariant}>{annotation.status}</Badge>
		{#if annotation.element_id}
			<button
				type="button"
				class="text-xs text-primary-500 underline-offset-2 hover:underline font-mono"
				onclick={() => onJumpToElement?.(annotation.element_id!)}
				title="Jump to element"
			>
				{annotation.element_id}
			</button>
		{:else}
			<span class="text-xs text-text-muted italic">stage</span>
		{/if}
	</header>

	{#if editing}
		<textarea
			class="w-full min-h-20 rounded border border-border bg-surface-raised px-2 py-1 text-xs resize-y focus:outline-none focus:border-primary-500"
			bind:value={draft}
			disabled={busy}
			spellcheck
		></textarea>
		{#if error}
			<p class="text-[11px] text-status-failed">{error}</p>
		{/if}
		<div class="flex gap-1">
			<Button size="sm" variant="primary" onclick={save} loading={busy} disabled={!draft.trim()}>
				<Save class="h-3 w-3" />
				Save
			</Button>
			<Button
				size="sm"
				variant="ghost"
				onclick={() => {
					editing = false;
					draft = annotation.text;
					error = null;
				}}
				disabled={busy}
			>
				<X class="h-3 w-3" />
			</Button>
		</div>
	{:else}
		<p class="text-text whitespace-pre-wrap break-words">{annotation.text}</p>
		{#if annotation.status === 'open'}
			<div class="flex gap-1">
				<Button size="sm" variant="ghost" onclick={() => (editing = true)} disabled={busy}>
					<Edit2 class="h-3 w-3" />
					Edit
				</Button>
				<Button size="sm" variant="ghost" onclick={dismiss} disabled={busy}>
					<Trash2 class="h-3 w-3" />
					Dismiss
				</Button>
			</div>
		{/if}
		{#if annotation.applied_in_run_id}
			<p class="text-xs text-text-muted">
				applied → run <span class="font-mono">{annotation.applied_in_run_id.slice(0, 8)}</span>
			</p>
		{/if}
	{/if}
</li>

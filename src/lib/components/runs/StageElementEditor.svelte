<script lang="ts">
	// Edit what a finished step produced — the script's lines, a storyboard's shots,
	// a lesson's paragraphs — in place, before restarting the run.
	//
	// Why: people cancel a run to fix something and run it again. Saving here
	// (`PATCH /runs/{id}/stages/{stage}/elements/{element}`) marks the step edited;
	// a Restart then KEEPS the edited step and re-runs only the steps that build on
	// it. Which arrays are editable is the server's answer (`element_paths`), never a
	// guess about the output's shape.
	//
	// Only the plain-text fields of each element are offered (ids, URLs, refs and
	// keys stay as they are). The server refuses an edit while the run is still
	// executing; this component says so instead of offering the form.
	import { Button } from '$lib/components/ui';
	import { ApiError, runs } from '$lib/api';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import {
		editableElements,
		changedFields,
		type EditableElement
	} from '$lib/utils/stage-element-edit';

	let {
		runId,
		stageName,
		output,
		elementPaths,
		blockedReason = null,
		onsaved
	}: {
		runId: string;
		stageName: string;
		output: Record<string, unknown> | null;
		elementPaths: readonly string[];
		/** Why editing is unavailable right now (e.g. the run is still running). */
		blockedReason?: string | null;
		onsaved?: () => void | Promise<void>;
	} = $props();

	const elements = $derived<EditableElement[]>(editableElements(output, elementPaths));

	// Drafts keyed by element id → field → text. Seeded lazily from the current
	// value so a refetch after a save shows the saved text.
	let drafts = $state<Record<string, Record<string, string>>>({});
	let saving = $state<string | null>(null);
	let errors = $state<Record<string, string>>({});

	function draftValue(el: EditableElement, field: string): string {
		return drafts[el.id]?.[field] ?? el.fields[field] ?? '';
	}

	function setDraft(el: EditableElement, field: string, value: string) {
		drafts = { ...drafts, [el.id]: { ...(drafts[el.id] ?? {}), [field]: value } };
	}

	async function save(el: EditableElement) {
		const patch = changedFields(el, drafts[el.id] ?? {});
		if (Object.keys(patch).length === 0) return;
		saving = el.id;
		errors = { ...errors, [el.id]: '' };
		try {
			await runs.stages.patchElement(runId, stageName, el.id, { patch });
			const { [el.id]: _saved, ...rest } = drafts;
			drafts = rest;
			toastSuccess('Saved', 'Restart the run to rebuild the steps that use this.');
			await onsaved?.();
		} catch (err) {
			const message = err instanceof ApiError ? err.detail : 'The change could not be saved.';
			errors = { ...errors, [el.id]: message };
			toastError('Could not save', message);
		} finally {
			saving = null;
		}
	}
</script>

{#if elements.length > 0}
	<section class="space-y-3" data-testid="stage-element-editor">
		{#if blockedReason}
			<p class="text-xs text-text-muted" data-testid="stage-element-editor-blocked">
				{blockedReason}
			</p>
		{/if}
		{#each elements as el (el.id)}
			{@const dirty = Object.keys(changedFields(el, drafts[el.id] ?? {})).length > 0}
			<div
				class="rounded-[var(--radius-md)] border border-border/40 p-3 space-y-2"
				data-testid="stage-element"
			>
				<p class="text-xs text-text-muted">{el.label}</p>
				{#each Object.keys(el.fields) as field (field)}
					<label class="block text-xs text-text-secondary">
						<span class="mb-1 block capitalize">{field.replace(/_/g, ' ')}</span>
						<textarea
							class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
							rows={Math.min(6, Math.max(2, Math.ceil(draftValue(el, field).length / 70)))}
							disabled={Boolean(blockedReason) || saving === el.id}
							value={draftValue(el, field)}
							oninput={(e) => setDraft(el, field, (e.currentTarget as HTMLTextAreaElement).value)}
						></textarea>
					</label>
				{/each}
				{#if errors[el.id]}
					<p role="alert" class="text-xs text-[var(--color-danger-text)]">{errors[el.id]}</p>
				{/if}
				<div class="flex justify-end">
					<Button
						variant="primary"
						size="sm"
						disabled={!dirty || Boolean(blockedReason)}
						loading={saving === el.id}
						onclick={() => void save(el)}
					>
						Save
					</Button>
				</div>
			</div>
		{/each}
	</section>
{/if}

<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui';
	import { Save } from '@lucide/svelte';
	import type { ProjectBrief } from '$lib/types';

	interface Props {
		brief: ProjectBrief;
		saving?: boolean;
		onSave?: (next: ProjectBrief) => void | Promise<void>;
		/** Told whenever the buffer gains or loses unsaved edits, so the parent
		 *  can guard navigation away from them. */
		onDirtyChange?: (dirty: boolean) => void;
	}

	let { brief, saving = false, onSave, onDirtyChange }: Props = $props();

	// Edit-buffer detached from the prop. Initial-only capture is intentional
	// — the $effect below pulls subsequent prop changes (post-PATCH refresh,
	// WS reconcile) without taking the prop as a tracked dependency.
	//
	// brief arrives as a deep-reactive $state proxy (its provenance is the
	// projects store's byId, which is $state<...>). structuredClone throws
	// DataCloneError on Svelte reactive proxies — use $state.snapshot to
	// strip the proxy into a plain JSON object.
	let working = $state<ProjectBrief>(untrack(() => $state.snapshot(brief) as ProjectBrief));
	let dirty = $derived(JSON.stringify(working) !== JSON.stringify(brief));

	$effect(() => {
		onDirtyChange?.(dirty);
	});

	$effect(() => {
		// External brief changed (e.g. WS reconcile); reset the buffer if the
		// user hasn't edited (dirty=false) — otherwise leave their work alone.
		if (!dirty) working = $state.snapshot(brief) as ProjectBrief;
	});

	async function handleSave() {
		if (!onSave) return;
		await onSave(working);
	}

	// Prefer the canonical `outcome`; fall back to a legacy `learning_outcome`
	// so a value saved by the old editor is shown (and migrated on next save).
	let outcome = $derived(
		typeof working.outcome === 'string'
			? working.outcome
			: typeof working.learning_outcome === 'string'
				? working.learning_outcome
				: ''
	);
</script>

<!-- `brief-fields`: for a course this editor IS the brief body, so it carries the
     same hook as BriefSection's non-course <section>. -->
<section
	class="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6"
	data-testid="brief-fields"
>
	<h2 class="text-base font-semibold text-[var(--color-text)]">Syllabus</h2>

	<label class="block">
		<span class="text-xs font-medium text-[var(--color-text-muted)]">Audience</span>
		<textarea
			rows="2"
			class="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			placeholder="Who is this course for?"
			value={(typeof working.audience === 'string' ? working.audience : '') as string}
			oninput={(e) => {
				const v = (e.currentTarget as HTMLTextAreaElement).value;
				working = { ...working, audience: v };
			}}
		></textarea>
	</label>

	<label class="block space-y-1">
		<span class="text-xs font-medium text-[var(--color-text-muted)]"
			>Learning outcome (one sentence)</span
		>
		<input
			type="text"
			class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
			placeholder="By the end of this course, the learner will be able to…"
			value={outcome}
			oninput={(e) => {
				const v = (e.currentTarget as HTMLInputElement).value;
				// `outcome` is the key the wizard writes and the course outline
				// stage reads (orchestrator stages/course/outline.py). Drop the
				// legacy `learning_outcome` key this editor used to write, which
				// nothing on the backend reads.
				const { learning_outcome: _legacy, ...rest } = working;
				void _legacy;
				working = { ...rest, outcome: v };
			}}
		/>
	</label>

	<!-- No topic-outline editor: no course stage reads brief.outline — the
	     course_outline stage derives the flow from audience + outcome + the
	     lessons list (orchestrator services/stages/course/outline.py). An
	     existing brief.outline value is kept untouched in the buffer. -->

	<div class="flex justify-end">
		<Button variant="primary" disabled={!dirty || saving} loading={saving} onclick={handleSave}>
			<Save class="h-3.5 w-3.5" />
			Save syllabus
		</Button>
	</div>
</section>

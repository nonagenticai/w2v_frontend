<script lang="ts">
	import { Button, Input } from '$lib/components/ui';
	import { course } from '$lib/api';
	import { ApiError } from '$lib/api';
	import type { CourseChapter } from '$lib/types';
	import { formatTimestamp } from '$lib/utils/format.js';
	import { Eye, EyeOff } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { untrack } from 'svelte';

	let {
		runId,
		chapters,
		onSaved,
		onClose
	}: {
		runId: string;
		chapters: CourseChapter[];
		onSaved: (output: Record<string, unknown>) => void;
		onClose: () => void;
	} = $props();

	// Both lesson (level-0) and slide (level-1) markers are editable, keyed by the
	// chapter's stable `chapter_key` the override map uses — the bare
	// lesson_project_id at level 0, `${lesson_project_id}#${ordinal}` at level 1.
	// Old runs stitched before chapter_key existed fall back to lesson_project_id
	// at level 0 only (their slides aren't individually addressable).
	const keyOf = (c: CourseChapter): string | undefined =>
		c.chapter_key ?? ((c.level ?? 0) === 0 ? (c.lesson_project_id ?? undefined) : undefined);

	// The editor is mounted fresh each time editing starts, so the chapters prop
	// is stable for its lifetime — seed the edit buffer eagerly (every key present
	// before the first render, so `bind:value` never binds undefined). `untrack`
	// signals that capturing the initial value here is intentional (not a missed
	// reactive read), since the buffer is deliberately not meant to re-derive.
	const editable = untrack(() => chapters).filter((c) => keyOf(c));
	const initialTitles: Record<string, string> = {};
	for (const c of editable) {
		const k = keyOf(c);
		if (k) initialTitles[k] = c.title;
	}
	let titles = $state<Record<string, string>>(initialTitles);

	// Only level-1 sub-chapters can be hidden; the lesson backbone never. Seed the
	// hide set from the denormalized `hidden` flag so toggles round-trip on reload.
	const isSub = (c: CourseChapter): boolean => (c.level ?? 0) === 1;
	const initialHidden = new Set(
		editable.filter((c) => isSub(c) && c.hidden).map((c) => keyOf(c) as string)
	);
	const hidden = new SvelteSet<string>(initialHidden);

	const toggleHidden = (key: string) => {
		if (hidden.has(key)) hidden.delete(key);
		else hidden.add(key);
	};

	const hiddenChanged = (): boolean =>
		hidden.size !== initialHidden.size || [...hidden].some((k) => !initialHidden.has(k));

	let saving = $state(false);
	let error = $state<string | null>(null);

	async function save() {
		error = null;
		// Only send genuinely-changed, non-blank titles.
		const overrides: Record<string, string> = {};
		for (const c of editable) {
			const k = keyOf(c);
			if (!k) continue;
			const next = (titles[k] ?? '').trim();
			if (next && next !== c.title) overrides[k] = next;
		}
		const hidChanged = hiddenChanged();
		if (Object.keys(overrides).length === 0 && !hidChanged) {
			onClose();
			return;
		}
		saving = true;
		try {
			// Pass `hidden` (full replacement) only when it changed, so a title-only
			// edit leaves the stored hide set untouched server-side.
			const updated = hidChanged
				? await course.patchChapters(runId, overrides, [...hidden])
				: await course.patchChapters(runId, overrides);
			onSaved(updated.output ?? {});
			onClose();
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Could not save chapter titles.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-2">
	{#each editable as c (c.sequence)}
		{@const sub = isSub(c)}
		{@const key = keyOf(c) as string}
		{@const isHidden = sub && hidden.has(key)}
		<div class="flex items-center gap-2 {sub ? 'pl-6' : ''} {isHidden ? 'opacity-50' : ''}">
			{#if sub}
				<span class="text-text-muted shrink-0" aria-hidden="true">↳</span>
			{/if}
			<span class="text-xs font-mono tabular-nums text-text-muted w-12 shrink-0">
				{formatTimestamp(c.start_seconds)}
			</span>
			<Input
				name={`chapter-title-${c.sequence}`}
				bind:value={titles[key]}
				disabled={isHidden}
				class="flex-1"
			/>
			{#if sub}
				<button
					type="button"
					onclick={() => toggleHidden(key)}
					class="shrink-0 p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-raised transition-colors"
					aria-label={isHidden ? 'Show sub-chapter' : 'Hide sub-chapter'}
					title={isHidden ? 'Show sub-chapter' : 'Hide sub-chapter'}
				>
					{#if isHidden}
						<EyeOff class="h-4 w-4" />
					{:else}
						<Eye class="h-4 w-4" />
					{/if}
				</button>
			{/if}
		</div>
	{/each}

	{#if error}
		<p class="text-xs text-red-400" role="alert">{error}</p>
	{/if}

	<div class="flex gap-2 pt-1">
		<Button size="sm" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : 'Save titles'}
		</Button>
		<Button size="sm" variant="ghost" onclick={onClose} disabled={saving}>Cancel</Button>
	</div>
</div>

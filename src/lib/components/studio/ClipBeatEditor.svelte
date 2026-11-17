<script lang="ts">
	import {
		Trash2,
		ChevronUp,
		ChevronDown,
		GripVertical,
		Plus,
		Upload,
		AlertCircle
	} from '@lucide/svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import type { ShowcaseLine } from '$lib/types';

	// The authored clip↔beat spine for a showcase project: an ordered list of
	// narration beats, each optionally bound to a recorded `@clip-<n>` footage tag.
	// Bindable so the wizard owns the array (flows through brief.lines → buildBrief);
	// add/remove/move/drag reassign the array (so $bindable propagates), while field
	// edits mutate the proxied entries in place. Pruning happens in cleanLines at
	// submit — no in-component validation (mirrors ShotlistEditor).
	// `clipRoster` is the set of real footage-clip join keys (`clip-<n>`) parsed from
	// the uploaded package's `@clip-<n>` scenario tags (RecordingPackageSource →
	// wizard → here). When present the clip field is a <select> of actual clips;
	// when empty (no package yet, or an untagged package) it degrades to free-text.
	// `cast` is the named voice cast (role → voice) authored in the Beats step. When
	// non-empty the per-beat Speaker <select> lists the role names (Mark/Lisa/…) instead
	// of the fixed a/b toggle, so `line.speaker` carries a real cast key the dialogue
	// stage resolves via `voice.cast`. Empty ⇒ the legacy a/b narrator/newcomer options.
	let {
		lines = $bindable<ShowcaseLine[]>([]),
		clipRoster = [],
		cast = []
	}: {
		lines?: ShowcaseLine[];
		clipRoster?: string[];
		cast?: { name: string; voice: string }[];
	} = $props();

	// DEDUPED, and that is load-bearing twice over. `cast` is the free-text
	// "Voice cast" rows the user types on this same wizard step, so two rows
	// holding the same name is a keystroke away (rename, typo, paste). Undeduped
	// this list feeds a KEYED `{#each … (role)}` below, and Svelte throws
	// `each_key_duplicate` in a PRODUCTION build the moment the second row's name
	// equals the first — tearing the whole Beats step down to a blank panel while
	// a dev build renders it fine. Deduping is also the right UI: two identical
	// <option>s set the same value, so the second was never meaningful.
	const castRoles = $derived([...new Set(cast.map((c) => c.name.trim()).filter(Boolean))]);

	// Options for one beat's speaker: the cast roles, plus the beat's current speaker if
	// it's not a current role (an imported lines.json or a since-renamed role) so the
	// select never silently blanks a set value.
	function speakerOptions(current: string | null | undefined): string[] {
		const cur = (current ?? '').trim();
		return cur && !castRoles.includes(cur) ? [cur, ...castRoles] : castRoles;
	}

	let importError = $state('');

	// Free-text fallback hints, used only when no roster was parsed. Values are the
	// `clip-<n>` JOIN KEY (no leading `@`) — the record stage keys footage by the
	// tag with the `@` stripped, so `@clip-1` in the field would never join.
	const CLIP_HINTS = Array.from({ length: 8 }, (_, i) => `clip-${i + 1}`);
	const LINES_ACCEPT = '.json,application/json';

	// The <select> options for one beat: the parsed roster, plus the beat's current
	// clip if it isn't in the roster (an imported lines.json, or a value carried over
	// from another package) — so rendering the select never silently blanks it.
	function clipOptions(current: string | null | undefined): string[] {
		const cur = (current ?? '').trim();
		return cur && !clipRoster.includes(cur) ? [cur, ...clipRoster] : clipRoster;
	}

	// A stable, collision-free id so svelte-dnd-action (keyed on line.id) never sees
	// dupes after removes/reorders.
	function nextClipId(): string {
		const used = new Set(lines.map((l) => l.id));
		let n = 1;
		while (used.has(`clip-${n}`)) n += 1;
		return `clip-${n}`;
	}

	function addBeat() {
		lines = [...lines, { id: nextClipId(), text: '', seconds: 0 }];
	}
	function remove(i: number) {
		lines = lines.filter((_, j) => j !== i);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= lines.length) return;
		const next = [...lines];
		[next[i], next[j]] = [next[j], next[i]];
		lines = next;
	}

	function handleConsider(e: CustomEvent<DndEvent<ShowcaseLine>>) {
		lines = e.detail.items;
	}
	function handleFinalize(e: CustomEvent<DndEvent<ShowcaseLine>>) {
		lines = e.detail.items;
	}

	// Import a lines.json — subsumes the old RecordingPackageSource upload so an
	// authored spine can still arrive as a file AND then be edited. Accepts a bare
	// array or a { lines: [...] } wrapper; ensures each beat has a stable id so dnd
	// keys never collide.
	async function onImport(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importError = '';
		try {
			const parsed: unknown = JSON.parse(await file.text());
			const arr =
				Array.isArray(parsed) && parsed.length
					? parsed
					: parsed &&
						  typeof parsed === 'object' &&
						  Array.isArray((parsed as { lines?: unknown }).lines)
						? (parsed as { lines: unknown[] }).lines
						: null;
			if (!arr || arr.length === 0) throw new Error('Expected a non-empty JSON array of lines.');
			const used: string[] = [];
			lines = (arr as ShowcaseLine[]).map((raw, idx) => {
				let id = (raw.id ?? '').trim() || `clip-${idx + 1}`;
				while (used.includes(id)) id = `${id}-${idx}`;
				used.push(id);
				return { ...raw, id, text: raw.text ?? '', seconds: Number(raw.seconds) || 0 };
			});
		} catch (err) {
			importError = err instanceof Error ? err.message : 'Could not read lines.json';
		} finally {
			input.value = '';
		}
	}

	const textareaClass =
		'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]';
	const inputClass = textareaClass;
	const selectClass =
		'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
	const iconBtn =
		'p-1.5 rounded hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed';
	const labelClass = 'block text-xs font-medium text-[var(--color-text-muted)] mb-1';
</script>

<div class="space-y-3" data-testid="clip-beat-editor">
	{#if lines.length === 0}
		<div
			class="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center space-y-1"
		>
			<p class="text-sm text-[var(--color-text)]">No beats yet</p>
			<p class="text-xs text-[var(--color-text-muted)]">
				Add narration beats and bind each to a recorded <code>@clip-&lt;n&gt;</code> tag from your package.
				Leave empty to let the pipeline auto-narrate the package's scenarios.
			</p>
		</div>
	{/if}

	<ul
		class="space-y-3"
		use:dndzone={{ items: lines, flipDurationMs: 180, dropTargetStyle: {} }}
		onconsider={handleConsider}
		onfinalize={handleFinalize}
	>
		{#each lines as line, i (line.id)}
			<li
				class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
				data-testid={`beat-${i}`}
			>
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="cursor-grab text-[var(--color-text-muted)]" aria-label="Drag to reorder">
							<GripVertical class="h-4 w-4" />
						</span>
						<span class="text-xs font-semibold tabular-nums text-[var(--color-text-muted)]"
							>#{i + 1}</span
						>
						<span class="text-xs text-[var(--color-text-muted)]">{line.id}</span>
					</div>
					<div class="flex items-center gap-0.5">
						<button
							type="button"
							class={iconBtn}
							onclick={() => move(i, -1)}
							disabled={i === 0}
							aria-label="Move beat up"
							data-testid={`beat-${i}-move-up`}
						>
							<ChevronUp class="h-4 w-4" />
						</button>
						<button
							type="button"
							class={iconBtn}
							onclick={() => move(i, 1)}
							disabled={i === lines.length - 1}
							aria-label="Move beat down"
							data-testid={`beat-${i}-move-down`}
						>
							<ChevronDown class="h-4 w-4" />
						</button>
						<button
							type="button"
							class="{iconBtn} hover:text-[var(--color-danger)]"
							onclick={() => remove(i)}
							aria-label="Remove beat"
							data-testid={`beat-${i}-remove`}
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				</div>

				<div>
					<label class={labelClass} for={`beat-${i}-text`}>Narration (verbatim)</label>
					<textarea
						id={`beat-${i}-text`}
						rows="2"
						class={textareaClass}
						placeholder="What the voiceover says over this beat, word for word."
						bind:value={line.text}
						data-testid={`beat-${i}-text`}
					></textarea>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class={labelClass} for={`beat-${i}-clip`}>Footage clip</label>
						{#if clipRoster.length > 0}
							<!-- Real clips parsed from the uploaded package. Controlled (value= +
							     onchange, not bind:value) so an unset/none clip maps to `undefined`
							     and the option value attributes reflect for a11y + testability. -->
							<select
								id={`beat-${i}-clip`}
								class="{selectClass} w-full"
								value={line.clip ?? ''}
								onchange={(e) =>
									(line.clip = (e.currentTarget as HTMLSelectElement).value || undefined)}
								data-testid={`beat-${i}-clip`}
							>
								<option value="">— none —</option>
								{#each clipOptions(line.clip) as opt (opt)}
									<option value={opt}
										>{clipRoster.includes(opt) ? opt : `${opt} (not in package)`}</option
									>
								{/each}
							</select>
						{:else}
							<!-- No package parsed yet — free-text with `clip-<n>` hints. -->
							<input
								id={`beat-${i}-clip`}
								type="text"
								class={inputClass}
								list={`beat-${i}-clip-list`}
								placeholder="clip-1"
								bind:value={line.clip}
								data-testid={`beat-${i}-clip`}
							/>
							<datalist id={`beat-${i}-clip-list`}>
								{#each CLIP_HINTS as hint (hint)}
									<option value={hint}></option>
								{/each}
							</datalist>
						{/if}
					</div>
					<div>
						<label class={labelClass} for={`beat-${i}-speaker`}>Speaker</label>
						<select
							id={`beat-${i}-speaker`}
							class="{selectClass} w-full"
							bind:value={line.speaker}
							data-testid={`beat-${i}-speaker`}
						>
							<option value={undefined}>— none —</option>
							{#if castRoles.length > 0}
								{#each speakerOptions(line.speaker) as role (role)}
									<option value={role}>{role}</option>
								{/each}
							{:else}
								<option value="a">Narrator · a</option>
								<option value="b">Newcomer · b</option>
							{/if}
						</select>
					</div>
					<div>
						<label class={labelClass} for={`beat-${i}-anchor`}>Clip window</label>
						<select
							id={`beat-${i}-anchor`}
							class="{selectClass} w-full"
							bind:value={line.clip_anchor}
							data-testid={`beat-${i}-anchor`}
						>
							<option value={undefined}>From start</option>
							<option value="end">Settled tail</option>
						</select>
					</div>
					{#if line.clip_anchor !== 'end'}
						<div>
							<label class={labelClass} for={`beat-${i}-lead`}>Skip head (s)</label>
							<input
								id={`beat-${i}-lead`}
								type="number"
								min="0"
								step="0.5"
								class={inputClass}
								bind:value={line.clip_lead_seconds}
								data-testid={`beat-${i}-lead`}
							/>
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			onclick={addBeat}
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
			data-testid="add-beat"
		>
			<Plus class="h-3.5 w-3.5" /> Add beat
		</button>
		<label
			class="inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
		>
			<Upload class="h-3.5 w-3.5" /> Import lines.json
			<input
				type="file"
				accept={LINES_ACCEPT}
				class="sr-only"
				data-testid="import-lines-input"
				onchange={onImport}
			/>
		</label>
	</div>
	{#if importError}
		<p class="flex items-center gap-1 text-xs text-[var(--color-danger)]">
			<AlertCircle class="h-3.5 w-3.5" />
			{importError}
		</p>
	{/if}
</div>

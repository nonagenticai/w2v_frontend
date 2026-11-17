<script lang="ts">
	import { Upload, FileCheck, Loader, AlertCircle, Plus, Trash2 } from '@lucide/svelte';
	import { uploads } from '$lib/api';
	import type { ProjectBrief } from '$lib/types';
	import { KOKORO_VOICE_GROUPS, NARRATOR_DEFAULT_VOICE } from '$lib/studio/kokoro-voices';

	let { brief = $bindable<ProjectBrief>({}) }: { brief?: ProjectBrief } = $props();

	let uploading = $state(false);
	let uploadError = $state('');

	const ACCEPT = '.txt,.docx,.epub';

	const chapterMode = $derived((brief.chapter_mode ?? 'auto') as 'auto' | 'single');
	const outputFormat = $derived((brief.audiobook?.output_format ?? 'mp3') as 'mp3' | 'wav');
	const voiceActing = $derived(brief.voice_acting === true);
	// PR-8c one-command-lift opt-ins (free-form brief.audiobook.*). Both toggles
	// default OFF. Backend semantics (orchestrator _seed_pause_after_stages): the
	// two review gates (chapter review after ingest, casting review after cast)
	// pause by default; ONLY an explicit pause_for_review=false skips them. So the
	// "skip review" toggle sets pause_for_review=false when on, and drops the key
	// when off (absent ⇒ the backend keeps today's review pauses). direction is
	// optional free text.
	const proposePronunciations = $derived(brief.audiobook?.propose_pronunciations === true);
	const skipReview = $derived(brief.audiobook?.pause_for_review === false);
	const direction = $derived(brief.audiobook?.direction ?? '');

	// Per-character voice pins are edited as an ordered list (a Record's key
	// order is not a stable editing surface), seeded once from brief.voice_cast
	// and re-serialized into it on every edit — blank names dropped.
	let castRows = $state<{ name: string; voice: string }[]>(
		Object.entries(brief.voice_cast ?? {}).map(([name, voice]) => ({
			name,
			voice: String(voice)
		}))
	);

	function setVoiceActing(on: boolean) {
		if (on) {
			brief = { ...brief, voice_acting: true };
		} else {
			// Off-pattern: drop BOTH keys so the backend sees the feature absent
			// (mirrors AiVisualsConfig dropping ai_image_gen on un-toggle).
			const { voice_acting: _va, voice_cast: _vc, ...rest } = brief;
			brief = rest;
			castRows = [];
		}
	}

	function syncCast() {
		const map: Record<string, string> = {};
		for (const row of castRows) {
			const name = row.name.trim();
			if (name) map[name] = row.voice; // last write wins on duplicate names
		}
		if (Object.keys(map).length > 0) {
			brief = { ...brief, voice_cast: map };
		} else {
			const { voice_cast: _vc, ...rest } = brief;
			brief = rest;
		}
	}

	function addRow() {
		castRows = [...castRows, { name: '', voice: NARRATOR_DEFAULT_VOICE }];
	}
	function removeRow(i: number) {
		castRows = castRows.filter((_, idx) => idx !== i);
		syncCast();
	}
	function setRowName(i: number, name: string) {
		castRows = castRows.map((r, idx) => (idx === i ? { ...r, name } : r));
		syncCast();
	}
	function setRowVoice(i: number, voice: string) {
		castRows = castRows.map((r, idx) => (idx === i ? { ...r, voice } : r));
		syncCast();
	}

	async function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		uploadError = '';
		try {
			const res = await uploads.manuscript(file);
			brief = {
				...brief,
				manuscript_ref: res.manuscript_ref,
				manuscript_name: res.manuscript_name
			};
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed';
			// Drop any stale ref so the step stays invalid until a good upload.
			const { manuscript_ref: _r, manuscript_name: _n, ...rest } = brief;
			brief = rest;
		} finally {
			uploading = false;
		}
	}

	function setChapterMode(mode: 'auto' | 'single') {
		brief = { ...brief, chapter_mode: mode };
	}

	function setOutputFormat(fmt: 'mp3' | 'wav') {
		brief = { ...brief, audiobook: { ...(brief.audiobook ?? {}), output_format: fmt } };
	}

	// PR-8c write-handlers. Booleans use the off-pattern (drop the key when off, so
	// the backend sees the feature absent — mirrors setVoiceActing); direction stores
	// the raw value while typing and drops the key when it trims to empty (no noise).
	function setProposePronunciations(on: boolean) {
		const ab = { ...(brief.audiobook ?? {}) };
		if (on) ab.propose_pronunciations = true;
		else delete ab.propose_pronunciations;
		brief = { ...brief, audiobook: ab };
	}

	// "Skip review" writes the explicit false the backend needs to autopilot;
	// dropping the key (off) leaves the default review pauses in place.
	function setSkipReview(on: boolean) {
		const ab = { ...(brief.audiobook ?? {}) };
		if (on) ab.pause_for_review = false;
		else delete ab.pause_for_review;
		brief = { ...brief, audiobook: ab };
	}

	function setDirection(text: string) {
		const ab = { ...(brief.audiobook ?? {}) };
		if (text.trim()) ab.direction = text;
		else delete ab.direction;
		brief = { ...brief, audiobook: ab };
	}
</script>

<div class="space-y-5">
	<div>
		<p class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5">Manuscript</p>
		<label
			class="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:border-[var(--color-accent)]"
		>
			{#if uploading}
				<Loader class="h-5 w-5 animate-spin text-[var(--color-accent)]" />
				<span class="text-sm text-[var(--color-text-muted)]">Uploading…</span>
			{:else if brief.manuscript_ref}
				<FileCheck class="h-5 w-5 text-[var(--color-success)]" />
				<span class="text-sm text-[var(--color-text)]" data-testid="manuscript-name"
					>{brief.manuscript_name}</span
				>
				<span class="ml-auto text-xs text-[var(--color-text-muted)]">Replace</span>
			{:else}
				<Upload class="h-5 w-5 text-[var(--color-text-muted)]" />
				<span class="text-sm text-[var(--color-text-muted)]"
					>Upload a .txt, .docx, or .epub manuscript</span
				>
			{/if}
			<input
				type="file"
				accept={ACCEPT}
				class="sr-only"
				data-testid="manuscript-input"
				onchange={onFileChange}
			/>
		</label>
		{#if uploadError}
			<p class="mt-1 flex items-center gap-1 text-xs text-[var(--color-danger)]">
				<AlertCircle class="h-3.5 w-3.5" />
				{uploadError}
			</p>
		{:else}
			<p class="mt-1 text-xs text-[var(--color-text-muted)]">
				The pipeline narrates this text exactly, chapter by chapter.
			</p>
		{/if}
	</div>

	<div>
		<label
			for="chapter-mode"
			class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
		>
			Chapters
		</label>
		<select
			id="chapter-mode"
			data-testid="chapter-mode-select"
			value={chapterMode}
			onchange={(e) =>
				setChapterMode((e.currentTarget as HTMLSelectElement).value as 'auto' | 'single')}
			class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
		>
			<option value="auto">Auto-detect chapters (headings / EPUB spine)</option>
			<option value="single">Single chapter (narrate the whole text as one)</option>
		</select>
	</div>

	<div>
		<label
			for="output-format"
			class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
		>
			Output format
		</label>
		<select
			id="output-format"
			data-testid="output-format-select"
			value={outputFormat}
			onchange={(e) =>
				setOutputFormat((e.currentTarget as HTMLSelectElement).value as 'mp3' | 'wav')}
			class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
		>
			<option value="mp3">MP3 (compact, recommended)</option>
			<option value="wav">WAV (lossless, larger files)</option>
		</select>
	</div>

	<div>
		<label
			for="narration-direction"
			class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
		>
			Narration direction <span class="font-normal">(optional)</span>
		</label>
		<textarea
			id="narration-direction"
			name="narration-direction"
			data-testid="narration-direction"
			rows="3"
			placeholder="Tone, pace, delivery notes — e.g. warm and unhurried; let the dialogue breathe."
			value={direction}
			oninput={(e) => setDirection((e.currentTarget as HTMLTextAreaElement).value)}
			class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
		></textarea>
		<p class="mt-1 text-xs text-[var(--color-text-muted)]">
			Free-text guidance passed to the narration director. Leave blank for a neutral read.
		</p>
	</div>

	<div>
		<label class="flex cursor-pointer items-start gap-2.5">
			<input
				type="checkbox"
				name="propose-pronunciations"
				data-testid="propose-pronunciations"
				checked={proposePronunciations}
				onchange={(e) => setProposePronunciations((e.currentTarget as HTMLInputElement).checked)}
				class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
			/>
			<span>
				<span class="block text-sm font-medium text-[var(--color-text-muted)]"
					>Auto-suggest pronunciations</span
				>
				<span class="block text-xs text-[var(--color-text-muted)]">
					During ingest, propose pronunciations for names and invented words so the narration says
					them correctly. Off = narrate as written.
				</span>
			</span>
		</label>
	</div>

	<div>
		<label class="flex cursor-pointer items-start gap-2.5">
			<input
				type="checkbox"
				name="skip-review"
				data-testid="skip-review"
				checked={skipReview}
				onchange={(e) => setSkipReview((e.currentTarget as HTMLInputElement).checked)}
				class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
			/>
			<span>
				<span class="block text-sm font-medium text-[var(--color-text-muted)]"
					>Skip review — render straight through</span
				>
				<span class="block text-xs text-[var(--color-text-muted)]">
					Render the whole book from this brief without stopping. By default the run pauses after
					ingest and casting so you can review chapters, pronunciations, and voices before paid
					narration.
				</span>
			</span>
		</label>
	</div>

	<div>
		<label class="flex cursor-pointer items-start gap-2.5">
			<input
				type="checkbox"
				name="voice-acting-enabled"
				checked={voiceActing}
				onchange={(e) => setVoiceActing((e.currentTarget as HTMLInputElement).checked)}
				class="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]"
			/>
			<span>
				<span class="block text-sm font-medium text-[var(--color-text-muted)]">Voice acting</span>
				<span class="block text-xs text-[var(--color-text-muted)]">
					Cast a distinct voice per character. Off = the whole book is read in the single narration
					voice.
				</span>
			</span>
		</label>

		{#if voiceActing}
			<div class="mt-3 space-y-2 border-l border-[var(--color-border)] pl-4">
				<p class="text-xs text-[var(--color-text-muted)]">
					Optionally pin specific characters to a voice; the rest are cast automatically. Names must
					match how the speaker appears in the manuscript.
				</p>
				{#each castRows as row, i (i)}
					<div class="flex items-center gap-2">
						<input
							type="text"
							name="cast-name"
							placeholder="Character name"
							value={row.name}
							oninput={(e) => setRowName(i, (e.currentTarget as HTMLInputElement).value)}
							class="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
						/>
						<select
							name="cast-voice"
							value={row.voice}
							onchange={(e) => setRowVoice(i, (e.currentTarget as HTMLSelectElement).value)}
							class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
						>
							{#each KOKORO_VOICE_GROUPS as group (group.language)}
								<optgroup label={group.language}>
									{#each group.voices as voice (voice.value)}
										<option value={voice.value}>{voice.label}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<button
							type="button"
							onclick={() => removeRow(i)}
							aria-label="Remove character"
							class="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
				<button
					type="button"
					onclick={addRow}
					class="flex items-center gap-1 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent)]"
				>
					<Plus class="h-3.5 w-3.5" /> Add character
				</button>
			</div>
		{/if}
	</div>
</div>

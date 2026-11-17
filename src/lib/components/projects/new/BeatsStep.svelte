<script lang="ts">
	import { Plus, Trash2 } from '@lucide/svelte';
	import { ClipBeatEditor } from '$lib/components/studio';
	import { KOKORO_VOICE_GROUPS, NARRATOR_DEFAULT_VOICE } from '$lib/studio/kokoro-voices';
	import { createWizard as cw } from './create-wizard.svelte.js';

	// Named voice cast (optional): each row maps a character name to a kokoro voice.
	// The names populate the Speaker dropdown on every beat below, and the map is
	// serialized into voice.cast at submit. Empty ⇒ single-voice narration.
	function addRole() {
		cw.cast = [...cw.cast, { name: '', voice: NARRATOR_DEFAULT_VOICE }];
	}
	function removeRole(i: number) {
		cw.cast = cw.cast.filter((_, j) => j !== i);
	}
	function setName(i: number, name: string) {
		cw.cast = cw.cast.map((r, j) => (j === i ? { ...r, name } : r));
	}
	function setVoice(i: number, voice: string) {
		cw.cast = cw.cast.map((r, j) => (j === i ? { ...r, voice } : r));
	}
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Voice cast</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			Optional. Name each character and pick its voice, then assign a speaker to each beat below.
			Leave empty for single-voice narration (the voice from Settings).
		</p>
	</div>
	<div class="space-y-2">
		{#each cw.cast as row, i (i)}
			<div class="flex items-center gap-2" data-testid={`cast-row-${i}`}>
				<input
					type="text"
					name="cast-name"
					placeholder="Character name (e.g. Mark)"
					value={row.name}
					oninput={(e) => setName(i, (e.currentTarget as HTMLInputElement).value)}
					data-testid={`cast-name-${i}`}
					class="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
				/>
				<select
					name="cast-voice"
					value={row.voice}
					onchange={(e) => setVoice(i, (e.currentTarget as HTMLSelectElement).value)}
					data-testid={`cast-voice-${i}`}
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
					onclick={() => removeRole(i)}
					aria-label="Remove character"
					class="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
				>
					<Trash2 class="h-4 w-4" />
				</button>
			</div>
		{/each}
		<button
			type="button"
			onclick={addRole}
			data-testid="add-cast-role"
			class="flex items-center gap-1 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent)]"
		>
			<Plus class="h-3.5 w-3.5" /> Add character
		</button>
	</div>
</section>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Clip↔beat spine</h2>
		<p class="text-xs text-[var(--color-text-muted)] mt-1">
			Author the narration beat by beat and bind each to a recorded
			<code>@clip-&lt;n&gt;</code> tag from your package — drag to reorder. Several beats can share
			one clip (an exchange over a single moment). Leave it empty to let the pipeline auto-narrate
			the package's scenarios, or import an existing
			<code>lines.json</code>.
		</p>
	</div>
	<ClipBeatEditor bind:lines={cw.brief.lines} clipRoster={cw.clipRoster} cast={cw.cast} />
</section>

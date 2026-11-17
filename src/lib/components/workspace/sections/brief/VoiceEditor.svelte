<script lang="ts">
	import { Input, Button } from '$lib/components/ui';
	import { Play } from '@lucide/svelte';
	import { tts, ApiError } from '$lib/api';
	import { KOKORO_VOICE_GROUPS, NARRATOR_DEFAULT_VOICE } from '$lib/studio/kokoro-voices';
	import type { VoiceConfig } from '$lib/types';
	import { byoProviderRequiredFromError, type ByoProviderRequired } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';

	let { value = $bindable({} as VoiceConfig) }: { value?: VoiceConfig } = $props();

	const voiceId = $derived(typeof value.voice_id === 'string' ? value.voice_id : '');
	const speed = $derived(typeof value.speed === 'number' ? value.speed : 1.0);
	const descriptor = $derived(typeof value.descriptor === 'string' ? value.descriptor : '');

	// Spread-merge keeps unsurfaced keys (e.g. the dialogue `cast` map) untouched.
	function setVoiceId(v: string) {
		const next = { ...value };
		if (v === '') delete next.voice_id;
		else next.voice_id = v;
		value = next;
	}
	function setSpeed(v: number) {
		value = { ...value, speed: v };
	}
	function setDescriptor(v: string) {
		const next = { ...value };
		if (v.trim() === '') delete next.descriptor;
		else next.descriptor = v;
		value = next;
	}

	// Audition the currently-selected (possibly unsaved) voice. Preview NEVER
	// saves — the operator selects + saves separately (spec scenario 3).
	let previewing = $state(false);
	let previewError = $state<string | null>(null);
	// A 402 `byo_provider_required`: the tenant must configure its own TTS provider.
	// Shown INSTEAD of `previewError` — it says what to do and links to it.
	let previewByo = $state<ByoProviderRequired | null>(null);
	let previewAudio: HTMLAudioElement | null = null;

	function stopPreview() {
		if (previewAudio) {
			previewAudio.pause();
			if (previewAudio.src) URL.revokeObjectURL(previewAudio.src);
			previewAudio = null;
		}
	}

	async function preview() {
		if (previewing) return;
		stopPreview();
		previewError = null;
		previewByo = null;
		previewing = true;
		try {
			const blob = await tts.previewVoice({ voice: voiceId || NARRATOR_DEFAULT_VOICE, speed });
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			previewAudio = audio;
			audio.onended = () => {
				URL.revokeObjectURL(url);
				if (previewAudio === audio) previewAudio = null;
			};
			await audio.play();
		} catch (e: unknown) {
			// The template shows `previewByo` in place of `previewError` when set.
			previewByo = byoProviderRequiredFromError(e);
			previewError =
				e instanceof ApiError ? e.detail : e instanceof Error ? e.message : 'Voice preview failed';
		} finally {
			previewing = false;
		}
	}
</script>

<div class="space-y-4">
	<div class="flex items-end gap-2">
		<div class="flex flex-1 flex-col gap-1.5">
			<label for="voice-id" class="text-sm font-medium text-[var(--color-text-muted)]">
				Narration voice
			</label>
			<select
				id="voice-id"
				name="voice-id"
				value={voiceId}
				onchange={(e) => setVoiceId((e.currentTarget as HTMLSelectElement).value)}
				class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
			>
				<option value="">Default ({NARRATOR_DEFAULT_VOICE})</option>
				{#each KOKORO_VOICE_GROUPS as group (group.language)}
					<optgroup label={group.language}>
						{#each group.voices as v (v.value)}
							<option value={v.value}>{v.label}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</div>
		<Button
			variant="secondary"
			size="md"
			onclick={preview}
			loading={previewing}
			disabled={previewing}
		>
			<Play class="h-3.5 w-3.5" /> Preview
		</Button>
	</div>
	{#if previewByo}
		<ByoProviderRequiredNotice required={previewByo} compact />
	{:else if previewError}
		<p data-testid="voice-preview-error" class="text-xs text-[var(--color-danger)]">
			{previewError}
		</p>
	{/if}
	<div class="flex flex-col gap-1.5">
		<label for="voice-speed" class="text-sm font-medium text-[var(--color-text-muted)]">
			Speed <span class="text-[var(--color-text)]">{speed.toFixed(1)}×</span>
		</label>
		<input
			id="voice-speed"
			name="voice-speed"
			type="range"
			min="0.5"
			max="2"
			step="0.1"
			value={speed}
			oninput={(e) => setSpeed(Number((e.currentTarget as HTMLInputElement).value))}
			class="w-full accent-[var(--color-accent)]"
		/>
	</div>
	<Input
		label="Tone hint"
		name="voice-descriptor"
		placeholder="warm, professional, energetic…"
		value={descriptor}
		oninput={(e) => setDescriptor((e.currentTarget as HTMLInputElement).value)}
	/>
</div>

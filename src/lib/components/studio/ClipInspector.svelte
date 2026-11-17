<script lang="ts">
	// Right-rail inspector for one selected clip: its details + a notes panel
	// pinned to the clip (feedback), and a "Regenerate this clip" action that
	// re-runs the spine stage onward with the open notes folded into the prompt.
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui';
	import { Wand2, Play, Mic } from '@lucide/svelte';
	import AnnotationsPanel from './AnnotationsPanel.svelte';
	import Waveform from '$lib/components/audio/Waveform.svelte';
	import { uploads, ApiError } from '$lib/api';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { byoProviderRequiredFromError, type ByoProviderRequired } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';
	import { KOKORO_VOICE_GROUPS } from '$lib/studio/kokoro-voices';
	import type { Clip } from '$lib/utils/timeline';
	import type { AnnotationResponse } from '$lib/types';
	import type {
		ClipTransition,
		ClipAdjust,
		ClipAnchor,
		ClipOverlay,
		ClipAudio,
		OverlayPosition
	} from '$lib/api/runs';

	interface Props {
		clip: Clip;
		/** All annotations for the spine stage; filtered to this clip here. */
		annotations: AnnotationResponse[];
		/** Omitted → adding feedback is unavailable (see `clipActionsBlockedReason`). */
		onAddNote?: (elementId: string, text: string) => Promise<void>;
		onDismissNote?: (id: string) => Promise<void>;
		/** Re-run the spine stage onward, folding this clip's open notes into the prompt.
		 *  Omitted → the button renders DISABLED with `clipActionsBlockedReason`. */
		onRegenerate?: () => void;
		/** Why feedback / regenerate / re-narrate are unavailable on this clip — the
		 *  server named no clip-spine stage to send them to. Shown in place of the
		 *  controls so a disabled button never reads as a bug. */
		clipActionsBlockedReason?: string | null;
		regenerating?: boolean;
		/** Effective edit values (pending edit ?? spine base), owned by the parent. */
		leadSeconds?: number;
		anchor?: ClipAnchor;
		caption?: string;
		fit?: 'contain' | 'cover' | 'scroll';
		/** Effective playback rate (1 = real time). */
		speed?: number;
		/** Effective entering transition, `null` = default hard cut. */
		transition?: ClipTransition | null;
		/** Effective color grade; `{}` = no grade. */
		adjust?: ClipAdjust;
		/** Effective burned-in text overlays; `[]` = none. */
		overlays?: ClipOverlay[];
		/** Effective per-clip primary-audio level/mute/fade; `{}` = no-op. */
		audio?: ClipAudio;
		/** Effective replacement-voiceover URL; `null` = the shot keeps its TTS narration. */
		audioUrl?: string | null;
		/** Server-probed duration of `audioUrl` — this becomes the shot's length. */
		audioSeconds?: number | null;
		/** The line this clip currently speaks — pre-fills the re-narrate box. */
		narrationText?: string;
		/** Re-synthesize THIS ONE line (new text and/or voice) and re-stitch as a new
		 *  child run. The payload's `elementId` is latched at request time, so the
		 *  parent must address the call by it and never by its live selection.
		 *  Rejects with an `ApiError` whose `detail` is surfaced inline (the route
		 *  422s on an uploaded voiceover). Omitted → the control is hidden. */
		onRenarrate?: (payload: {
			elementId: string;
			narrationText?: string;
			voice?: string;
		}) => Promise<void>;
		/** Report a per-clip edit; the parent merges it into its clipEdits map and
		 *  handles dirty/collapse. Omitted → all edit controls are hidden. */
		onEditChange?: (
			field:
				| 'clip_lead_seconds'
				| 'clip_anchor'
				| 'caption'
				| 'fit'
				| 'speed'
				| 'transition'
				| 'adjust'
				| 'overlays'
				| 'audio'
				| 'audio_url'
				| 'audio_seconds',
			value: number | string | ClipTransition | null | ClipAdjust | ClipOverlay[] | ClipAudio,
			/** Address the edit to a specific clip instead of the currently-selected
			 *  one. Set by async emitters (the voiceover upload) that latch their
			 *  target at request time — the selection can change before they resolve. */
			targetClipId?: string
		) => void;
	}

	let {
		clip,
		annotations,
		onAddNote,
		onDismissNote,
		onRegenerate,
		regenerating = false,
		leadSeconds = 0,
		anchor = 'start',
		caption = '',
		fit = 'contain',
		speed = 1,
		transition = null,
		adjust = {},
		overlays = [],
		audio = {},
		audioUrl = null,
		audioSeconds = null,
		narrationText = '',
		onRenarrate,
		onEditChange,
		clipActionsBlockedReason = null
	}: Props = $props();

	// Grade sliders show a neutral default when the clip carries no grade for that
	// channel (brightness 0, the rest 1×) so the thumb starts at "no change".
	// `value` is typed to the generated server enum, so an anchor the orchestrator
	// rejects (this list used to offer 'center', which the server calls
	// 'middle-center' → a 422 that silently killed the whole apply-edits) is now a
	// COMPILE error, not a runtime surprise.
	const OVERLAY_POSITIONS: { value: OverlayPosition; label: string }[] = [
		{ value: 'top-left', label: 'Top left' },
		{ value: 'top-center', label: 'Top center' },
		{ value: 'top-right', label: 'Top right' },
		{ value: 'middle-left', label: 'Middle left' },
		{ value: 'middle-center', label: 'Center' },
		{ value: 'middle-right', label: 'Middle right' },
		{ value: 'bottom-left', label: 'Bottom left' },
		{ value: 'bottom-center', label: 'Bottom center' },
		{ value: 'bottom-right', label: 'Bottom right' }
	];

	// Merge one grade channel onto the current grade and report it. A preset pick
	// replaces the whole grade (its curve is fixed backend-side).
	function setAdjust(patch: Partial<ClipAdjust>) {
		onEditChange?.('adjust', { ...adjust, ...patch });
	}
	function setPreset(preset: string) {
		onEditChange?.('adjust', preset ? { preset: preset as ClipAdjust['preset'] } : {});
	}

	// Merge one audio field onto the current audio block and report it.
	function setAudio(patch: Partial<ClipAudio>) {
		onEditChange?.('audio', { ...audio, ...patch });
	}

	// ── Voiceover replace (upload) ─────────────────────────────────────────
	// Uploading an audio file REPLACES this shot's TTS narration (the `audio`
	// block above only levels whatever the primary audio is). The server probes
	// the file and returns its duration, which DECLARES the shot's new length —
	// the compiler holds the last frame over a longer file and never clamps, so
	// the reflow is surfaced to the user below.
	// Every piece of upload state is clip-keyed: this inspector instance is REUSED
	// across clip selections, so an unkeyed value leaks onto the next clip (an
	// unkeyed `uploading` makes clip B show a phantom "Uploading…" and disables
	// its file input while A's upload is still in flight).
	let uploadingFor = $state<string | null>(null);
	let uploadedName = $state<{ clipId: string; name: string } | null>(null);
	let uploadError = $state<{ clipId: string; message: string } | null>(null);
	const uploading = $derived(uploadingFor === clip.id);
	const voiceoverName = $derived(
		uploadedName && uploadedName.clipId === clip.id ? uploadedName.name : null
	);
	const voiceoverError = $derived(
		uploadError && uploadError.clipId === clip.id ? uploadError.message : null
	);
	// The reflow warning: the uploaded length against the shot's current length.
	const voiceoverReflow = $derived.by(() => {
		if (audioSeconds == null) return null;
		const delta = audioSeconds - clip.seconds;
		const verb =
			Math.abs(delta) < 0.05
				? 'clip length unchanged'
				: delta > 0
					? 'clip will lengthen'
					: 'clip will shorten';
		return {
			text: `${audioSeconds.toFixed(1)}s — shot was ${clip.seconds.toFixed(1)}s, ${verb}`,
			lengthens: delta >= 0.05
		};
	});

	async function uploadVoiceover(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// Latched at REQUEST time. The user can select another clip while the upload
		// is in flight, and `clip` is a live prop on a reused instance — so resolving
		// against it would write A's voiceover onto whichever clip is selected when
		// the response lands. Every write below is addressed to `clipId` explicitly.
		const clipId = clip.id;
		uploadingFor = clipId;
		uploadError = null;
		try {
			const res = await uploads.voiceover(file);
			uploadedName = { clipId, name: file.name };
			// Both fields are set together — the url replaces the narration, the
			// probed duration declares the shot's length.
			onEditChange?.('audio_url', res.audio_url, clipId);
			onEditChange?.('audio_seconds', res.seconds, clipId);
		} catch (err) {
			uploadError = {
				clipId,
				message: err instanceof ApiError ? err.detail : 'Could not upload that audio file.'
			};
		} finally {
			if (uploadingFor === clipId) uploadingFor = null;
			// Let the same file be picked again after a failure.
			input.value = '';
		}
	}

	// Explicit `null` is a field DELETE backend-side → the shot falls back to TTS.
	function removeVoiceover() {
		uploadedName = null;
		uploadError = null;
		onEditChange?.('audio_url', null);
	}

	// ── Re-narrate this line (TTS) ─────────────────────────────────────────
	// Re-synthesizes EXACTLY this clip's narration with new text and/or a new
	// voice and re-stitches as a child run. An UPLOADED voiceover wins over the
	// TTS at compile time, so re-narrating a clip that has one is a guaranteed
	// no-op — the backend 422s on it and so do we, inline, before firing.
	//
	// Every piece of state here is clip-keyed for the same reason the upload's is:
	// this inspector instance is REUSED across selections, so an unkeyed draft /
	// busy / error leaks onto the next clip (and an unkeyed in-flight action would
	// land clip A's re-narrate on clip B).
	const showRenarrate = $derived(onRenarrate !== undefined);
	let renarrateFor = $state<string | null>(null);
	// `byo`: the run-start preflight's 402 byo_provider_required (#1150) — shown as
	// the shared notice (message + /providers?missing= link) instead of bare text.
	let renarrateError = $state<{
		clipId: string;
		message: string;
		byo: ByoProviderRequired | null;
	} | null>(null);
	let textDraft = $state<{ clipId: string; text: string } | null>(null);
	let voiceDraft = $state<{ clipId: string; voice: string } | null>(null);

	const renarrating = $derived(renarrateFor === clip.id);
	const renarrateErrorForClip = $derived(
		renarrateError && renarrateError.clipId === clip.id ? renarrateError : null
	);
	// A draft only ever applies to the clip it was typed on; any other clip falls
	// back to its own spine line / the run's configured voice ('' = keep).
	const draftText = $derived(
		textDraft && textDraft.clipId === clip.id ? textDraft.text : narrationText
	);
	const draftVoice = $derived(voiceDraft && voiceDraft.clipId === clip.id ? voiceDraft.voice : '');
	// An empty line would synthesize silence — treat it as "no change".
	const textChanged = $derived(
		draftText.trim().length > 0 && draftText.trim() !== narrationText.trim()
	);
	// There is no per-line voice on the spine: '' means "the run's configured
	// voice" (what the original narrate pass used), so any pick IS a change.
	const voiceChanged = $derived(draftVoice !== '');
	// An uploaded voiceover would silently win over the new TTS at compile.
	const renarrateBlocked = $derived(audioUrl != null && audioUrl !== '');
	const canRenarrate = $derived(!renarrateBlocked && !renarrating && (textChanged || voiceChanged));

	async function renarrate() {
		if (!onRenarrate || !canRenarrate) return;
		// Latched at REQUEST time (see `uploadVoiceover`): spawning the child run is
		// async and the user can select another clip while it is in flight. The
		// request is addressed to `clipId`, and every write below is keyed by it —
		// never resolved against the live `clip` prop at RESPONSE time.
		const clipId = clip.id;
		const payload: { elementId: string; narrationText?: string; voice?: string } = {
			elementId: clipId
		};
		if (textChanged) payload.narrationText = draftText.trim();
		if (voiceChanged) payload.voice = draftVoice;
		renarrateFor = clipId;
		renarrateError = null;
		try {
			await onRenarrate(payload);
		} catch (err) {
			const byo = byoProviderRequiredFromError(err);
			renarrateError = {
				clipId,
				byo,
				message:
					byo?.message ?? (err instanceof ApiError ? err.detail : 'Could not re-narrate this line.')
			};
		} finally {
			if (renarrateFor === clipId) renarrateFor = null;
		}
	}

	function addOverlay() {
		onEditChange?.('overlays', [
			...overlays,
			{ text: '', position: 'bottom-center', font_size: 48, color: '#ffffff' }
		]);
	}
	function patchOverlay(i: number, patch: Partial<ClipOverlay>) {
		onEditChange?.(
			'overlays',
			overlays.map((o, idx) => (idx === i ? { ...o, ...patch } : o))
		);
	}
	function removeOverlay(i: number) {
		onEditChange?.(
			'overlays',
			overlays.filter((_, idx) => idx !== i)
		);
	}

	// Caption + fit apply to any shot; the parent gates whole editing by wiring
	// (or not) `onEditChange`.
	const showEdit = $derived(onEditChange !== undefined);
	// Trim/anchor only affect footage-backed clips (the compositor's
	// clip_lead_seconds/clip_anchor framing is a no-op on image/text shots).
	const showTrim = $derived(showEdit && clip.isFootage);

	const forClip = $derived(annotations.filter((a) => a.element_id === clip.id));
	const openCount = $derived(forClip.filter((a) => a.status === 'open').length);
	const noSelection = new Set<string>();

	// The studio loader used to coerce a failed annotations fetch to `[]`, so every
	// feedback marker vanished and this panel told the reviewer to "Add a note
	// above, then regenerate to apply it" — about notes that already exist. The
	// loader now publishes `annotationsError` alongside `annotations`; when it is
	// set, `openCount === 0` means "unknown", not "none", and the regenerate hint
	// must not claim otherwise. (AnnotationsPanel renders the error itself, so
	// this surface deliberately adds no second ErrorState.)
	const annotationsError = $derived(
		(page.data as { annotationsError?: unknown } | undefined)?.annotationsError ?? null
	);

	// Fall through to the poster/placeholder when a proxied still 404s, rather
	// than rendering the browser's broken-image glyph.
	const failedThumbs = new SvelteSet<string>();
</script>

<div class="flex flex-col gap-4" data-testid="clip-inspector">
	<!-- scopedMediaUrl on every media URL below: the browser fetches these directly
	     (<img>/<video>/audio) and cannot send the X-Active-Tenant-Id header, so a
	     super-admin's tenant switch has to travel in the query string instead. -->
	{#if clip.thumbnailUrl && !failedThumbs.has(clip.thumbnailUrl)}
		<img
			src={scopedMediaUrl(clip.thumbnailUrl)}
			alt={clip.description || `Clip ${clip.index + 1}`}
			loading="lazy"
			class="aspect-video w-full rounded-[var(--radius-md)] border border-[var(--color-border)] object-cover"
			data-testid="inspector-thumb"
			onerror={() => failedThumbs.add(clip.thumbnailUrl!)}
		/>
	{:else if clip.posterVideoUrl}
		<div
			class="relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
		>
			<video
				src={scopedMediaUrl(clip.posterVideoUrl)}
				preload="metadata"
				muted
				class="h-full w-full object-cover"
			></video>
			<span class="absolute inset-0 flex items-center justify-center bg-black/15">
				<span class="rounded-full bg-black/55 p-2 text-white"><Play class="h-5 w-5" /></span>
			</span>
		</div>
	{/if}

	<div class="space-y-1">
		<p class="text-kicker text-[var(--color-text-muted)]">
			Clip #{clip.index + 1}{clip.visualType ? ` · ${clip.visualType}` : ''}
		</p>
		<p class="text-sm text-[var(--color-text)]">
			{clip.description || 'Untitled clip'}
		</p>
		<p class="text-xs text-[var(--color-text-muted)] font-mono">{clip.id}</p>
	</div>

	{#if showEdit}
		<div class="border-t border-[var(--color-border)] pt-3" data-testid="clip-edit">
			<h3 class="text-sm font-semibold text-[var(--color-text)] mb-2">Edit clip</h3>
			<div class="flex flex-col gap-3">
				<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
					Caption
					<textarea
						rows="2"
						maxlength="500"
						value={caption}
						placeholder="Burned-in caption (leave blank for none)"
						data-testid="edit-caption"
						class="resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
						oninput={(e) => onEditChange?.('caption', e.currentTarget.value)}
					></textarea>
				</label>
				<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
					Framing
					<select
						value={fit}
						data-testid="edit-fit"
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
						onchange={(e) => onEditChange?.('fit', e.currentTarget.value)}
					>
						<option value="contain">Fit (letterbox)</option>
						<option value="cover">Fill (crop)</option>
						<option value="scroll">Scroll (tall)</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
					Speed
					<select
						value={String(speed)}
						data-testid="clip-speed"
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
						onchange={(e) => onEditChange?.('speed', Number(e.currentTarget.value))}
					>
						<option value="0.25">0.25× (super slow-mo)</option>
						<option value="0.5">0.5× (slow-mo)</option>
						<option value="1">1× (real time)</option>
						<option value="1.5">1.5×</option>
						<option value="2">2× (fast)</option>
						<option value="3">3×</option>
						<option value="4">4× (hyper)</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
					Transition in
					<select
						value={transition?.type ?? ''}
						data-testid="clip-transition"
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
						onchange={(e) => {
							const t = e.currentTarget.value;
							onEditChange?.(
								'transition',
								t
									? { type: t as ClipTransition['type'], duration: transition?.duration ?? 0.5 }
									: null
							);
						}}
					>
						<option value="">None (cut)</option>
						<option value="fade">Fade</option>
						<option value="dissolve">Dissolve</option>
						<option value="wipeleft">Wipe left</option>
						<option value="slideright">Slide right</option>
					</select>
				</label>
				{#if transition}
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Transition duration (seconds)
						<input
							type="number"
							min="0.1"
							max="5"
							step="0.1"
							value={transition.duration}
							data-testid="clip-transition-duration"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
							oninput={(e) =>
								onEditChange?.('transition', {
									type: transition!.type,
									duration: Math.min(5, Math.max(0.1, Number(e.currentTarget.value) || 0.5))
								})}
						/>
					</label>
				{/if}
				{#if showTrim}
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Skip at start (seconds)
						<input
							type="number"
							min="0"
							step="0.5"
							value={leadSeconds}
							data-testid="trim-lead"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
							oninput={(e) =>
								onEditChange?.(
									'clip_lead_seconds',
									Math.max(0, Number(e.currentTarget.value) || 0)
								)}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Show
						<select
							value={anchor}
							data-testid="trim-anchor"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
							onchange={(e) => onEditChange?.('clip_anchor', e.currentTarget.value)}
						>
							<option value="start">Start of recording</option>
							<option value="end">Settled end</option>
							<!-- The backend has always accepted `auto`; the hand-written
							     anchor union omitted it, so this select could neither offer
							     it nor display it if a run already carried that value. -->
							<option value="auto">Auto</option>
						</select>
					</label>
				{/if}

				<!-- Look (color grade): a named preset OR a manual grade. -->
				<div class="flex flex-col gap-2" data-testid="clip-look">
					<span class="text-xs font-semibold text-[var(--color-text)]">Look</span>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Preset
						<select
							value={adjust.preset ?? ''}
							data-testid="clip-preset"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
							onchange={(e) => setPreset(e.currentTarget.value)}
						>
							<option value="">(none)</option>
							<option value="warm">Warm</option>
							<option value="cool">Cool</option>
							<option value="bw">Black &amp; white</option>
							<option value="vivid">Vivid</option>
							<option value="cinematic">Cinematic</option>
						</select>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Brightness ({(adjust.brightness ?? 0).toFixed(2)})
						<input
							type="range"
							min="-1"
							max="1"
							step="0.05"
							value={adjust.brightness ?? 0}
							data-testid="clip-brightness"
							oninput={(e) => setAdjust({ brightness: Number(e.currentTarget.value) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Contrast ({(adjust.contrast ?? 1).toFixed(2)})
						<input
							type="range"
							min="0"
							max="2"
							step="0.05"
							value={adjust.contrast ?? 1}
							data-testid="clip-contrast"
							oninput={(e) => setAdjust({ contrast: Number(e.currentTarget.value) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Saturation ({(adjust.saturation ?? 1).toFixed(2)})
						<input
							type="range"
							min="0"
							max="3"
							step="0.05"
							value={adjust.saturation ?? 1}
							data-testid="clip-saturation"
							oninput={(e) => setAdjust({ saturation: Number(e.currentTarget.value) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Gamma ({(adjust.gamma ?? 1).toFixed(2)})
						<input
							type="range"
							min="0.1"
							max="10"
							step="0.05"
							value={adjust.gamma ?? 1}
							data-testid="clip-gamma"
							oninput={(e) => setAdjust({ gamma: Number(e.currentTarget.value) })}
						/>
					</label>
				</div>

				<!-- Burned-in text overlays (titles / lower-thirds). -->
				<div class="flex flex-col gap-2" data-testid="clip-overlays">
					<div class="flex items-center justify-between">
						<span class="text-xs font-semibold text-[var(--color-text)]">Text overlays</span>
						<button
							type="button"
							data-testid="clip-overlay-add"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface)]"
							onclick={addOverlay}
						>
							+ Add overlay
						</button>
					</div>
					{#each overlays as ov, i (i)}
						<div
							class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2"
							data-testid={`clip-overlay-row-${i}`}
						>
							<input
								type="text"
								value={ov.text}
								maxlength="200"
								placeholder="Overlay text"
								data-testid={`clip-overlay-text-${i}`}
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
								oninput={(e) => patchOverlay(i, { text: e.currentTarget.value })}
							/>
							<div class="flex gap-1.5">
								<select
									value={ov.position ?? 'bottom-center'}
									data-testid={`clip-overlay-pos-${i}`}
									class="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
									onchange={(e) =>
										patchOverlay(i, { position: e.currentTarget.value as OverlayPosition })}
								>
									{#each OVERLAY_POSITIONS as p (p.value)}
										<option value={p.value}>{p.label}</option>
									{/each}
								</select>
								<input
									type="number"
									min="8"
									max="200"
									value={ov.font_size ?? 48}
									data-testid={`clip-overlay-size-${i}`}
									aria-label="Font size"
									class="w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
									oninput={(e) =>
										patchOverlay(i, {
											font_size: Math.min(200, Math.max(8, Number(e.currentTarget.value) || 8))
										})}
								/>
							</div>
							<div class="flex items-center gap-1.5">
								<input
									type="text"
									value={ov.color ?? '#ffffff'}
									placeholder="#ffffff"
									data-testid={`clip-overlay-color-${i}`}
									aria-label="Overlay color"
									class="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
									oninput={(e) => patchOverlay(i, { color: e.currentTarget.value })}
								/>
								<button
									type="button"
									data-testid={`clip-overlay-remove-${i}`}
									class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
									onclick={() => removeOverlay(i)}
								>
									Remove
								</button>
							</div>
						</div>
					{/each}
				</div>

				<!-- Voiceover: replace this shot's TTS narration with an uploaded file. -->
				<div class="flex flex-col gap-2" data-testid="clip-voiceover">
					<span class="text-xs font-semibold text-[var(--color-text)]">Voiceover</span>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Replace narration (audio file)
						<input
							type="file"
							accept="audio/*"
							disabled={uploading}
							data-testid="clip-voiceover-file"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] disabled:opacity-50"
							onchange={uploadVoiceover}
						/>
					</label>
					<div class="flex items-center justify-between gap-2">
						<span
							class="text-xs text-[var(--color-text-muted)]"
							data-testid="clip-voiceover-status"
						>
							{#if uploading}
								Uploading…
							{:else if audioUrl}
								{voiceoverName ?? 'Custom voiceover'}
							{:else}
								TTS narration
							{/if}
						</span>
						{#if audioUrl}
							<button
								type="button"
								data-testid="clip-voiceover-remove"
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
								onclick={removeVoiceover}
							>
								Remove
							</button>
						{/if}
					</div>
					{#if audioUrl}
						<!-- Hear (and see) the take that will replace the narration. Keyed on
						     the clip so switching selection rebuilds the player rather than
						     leaving the previous clip's audio mounted. -->
						<div data-testid="clip-waveform">
							{#key clip.id}
								<Waveform src={scopedMediaUrl(audioUrl)} height={48} />
							{/key}
						</div>
					{/if}
					{#if voiceoverError}
						<p class="text-xs text-[var(--color-danger)]" data-testid="clip-voiceover-error">
							{voiceoverError}
						</p>
					{/if}
					{#if voiceoverReflow}
						<p class="text-xs text-[var(--color-text-muted)]" data-testid="clip-voiceover-reflow">
							{voiceoverReflow.text}
							{#if voiceoverReflow.lengthens}
								· the picture holds on its last frame for the extra time.
							{/if}
						</p>
					{/if}
				</div>

				<!-- Audio (primary narration/clip audio): mute + volume + fades. -->
				<div class="flex flex-col gap-2" data-testid="clip-audio">
					<span class="text-xs font-semibold text-[var(--color-text)]">Audio</span>
					<label class="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
						Mute
						<input
							type="checkbox"
							role="switch"
							checked={audio.mute ?? false}
							data-testid="clip-audio-mute"
							onchange={(e) => setAudio({ mute: e.currentTarget.checked })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Volume ({(audio.gain_db ?? 0).toFixed(0)} dB)
						<input
							type="range"
							min="-60"
							max="12"
							step="1"
							value={audio.gain_db ?? 0}
							data-testid="clip-audio-gain"
							oninput={(e) => setAudio({ gain_db: Number(e.currentTarget.value) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Fade in ({(audio.fade_in_s ?? 0).toFixed(1)}s)
						<input
							type="range"
							min="0"
							max="30"
							step="0.5"
							value={audio.fade_in_s ?? 0}
							data-testid="clip-audio-fade-in"
							oninput={(e) => setAudio({ fade_in_s: Number(e.currentTarget.value) })}
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
						Fade out ({(audio.fade_out_s ?? 0).toFixed(1)}s)
						<input
							type="range"
							min="0"
							max="30"
							step="0.5"
							value={audio.fade_out_s ?? 0}
							data-testid="clip-audio-fade-out"
							oninput={(e) => setAudio({ fade_out_s: Number(e.currentTarget.value) })}
						/>
					</label>
				</div>

				<p class="text-xs text-[var(--color-text-muted)]">
					Apply below to re-stitch as a new version.
				</p>
			</div>
		</div>
	{/if}

	{#if showRenarrate}
		<!-- Re-narrate: re-synthesize THIS line only (new text and/or voice) and
		     re-stitch as a new version. Disabled — with the reason inline — when an
		     uploaded voiceover already owns this clip's audio. -->
		<div class="border-t border-[var(--color-border)] pt-3" data-testid="renarrate-clip">
			<h3 class="text-sm font-semibold text-[var(--color-text)] mb-2">Narration</h3>
			<div class="flex flex-col gap-3">
				<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
					Spoken line
					<textarea
						rows="3"
						maxlength="2000"
						value={draftText}
						disabled={renarrateBlocked || renarrating}
						placeholder="What this clip says"
						data-testid="renarrate-text"
						class="resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)] disabled:opacity-50"
						oninput={(e) => (textDraft = { clipId: clip.id, text: e.currentTarget.value })}
					></textarea>
				</label>
				<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
					Voice
					<select
						value={draftVoice}
						disabled={renarrateBlocked || renarrating}
						data-testid="renarrate-voice"
						class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)] disabled:opacity-50"
						onchange={(e) => (voiceDraft = { clipId: clip.id, voice: e.currentTarget.value })}
					>
						<option value="">Keep the current voice</option>
						{#each KOKORO_VOICE_GROUPS as g (g.language)}
							<optgroup label={g.language}>
								{#each g.voices as v (v.value)}
									<option value={v.value}>{v.label}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				</label>
				<div>
					<Button
						variant="secondary"
						size="sm"
						loading={renarrating}
						disabled={!canRenarrate}
						onclick={renarrate}
					>
						<Mic class="h-4 w-4" />
						Re-narrate
					</Button>
				</div>
				{#if renarrateBlocked}
					<p class="text-xs text-[var(--color-warning)]" data-testid="renarrate-blocked">
						Remove the uploaded voiceover before re-narrating this line.
					</p>
				{:else if !textChanged && !voiceChanged}
					<p class="text-xs text-[var(--color-text-muted)]">
						Edit the line or pick a voice, then re-narrate to re-synthesize just this clip.
					</p>
				{:else}
					<p class="text-xs text-[var(--color-text-muted)]">
						Re-voices this clip only — every other clip's audio is reused — and re-stitches as a new
						version.
					</p>
				{/if}
				{#if renarrateErrorForClip?.byo}
					<div data-testid="renarrate-error">
						<ByoProviderRequiredNotice required={renarrateErrorForClip.byo} compact />
					</div>
				{:else if renarrateErrorForClip}
					<p class="text-xs text-[var(--color-danger)]" data-testid="renarrate-error">
						{renarrateErrorForClip.message}
					</p>
				{/if}
			</div>
		</div>
	{/if}

	<div class="border-t border-[var(--color-border)] pt-3">
		<h3 class="text-sm font-semibold text-[var(--color-text)] mb-2">Feedback</h3>
		<AnnotationsPanel
			items={forClip}
			selectedIds={noSelection}
			pinningElementId={clip.id}
			pinningElementLabel={`clip #${clip.index + 1}`}
			onAddElementNote={onAddNote}
			{onDismissNote}
			addDisabledReason={onAddNote
				? null
				: (clipActionsBlockedReason ?? 'Feedback is unavailable.')}
		/>
	</div>

	<div class="border-t border-[var(--color-border)] pt-3" data-testid="regenerate-clip">
		<Button
			variant="primary"
			size="sm"
			loading={regenerating}
			disabled={!onRegenerate || openCount === 0 || regenerating}
			onclick={() => onRegenerate?.()}
		>
			<Wand2 class="h-4 w-4" />
			Regenerate this clip
		</Button>
		<p class="mt-1.5 text-xs text-[var(--color-text-muted)]">
			{#if !onRegenerate}
				<span data-testid="regenerate-clip-blocked">
					{clipActionsBlockedReason ?? 'Regenerating this clip is unavailable.'}
				</span>
			{:else if annotationsError}
				<span data-testid="regenerate-notes-unknown" class="text-[var(--color-danger)]">
					This clip's notes could not be loaded, so we cannot tell whether it has any. Reload before
					regenerating — otherwise existing feedback would be dropped.
				</span>
			{:else if openCount === 0}
				Add a note above, then regenerate to apply it.
			{:else}
				Re-runs this clip with your {openCount}
				{openCount === 1 ? 'note' : 'notes'} and re-stitches as a new version.
			{/if}
		</p>
	</div>
</div>

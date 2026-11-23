<script lang="ts">
	import Page from '$lib/layout/Page.svelte';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { spawnChildRun } from '$lib/api/spawn-child-run';
	import { byoProviderRequiredFromError, type ByoProviderRequired } from '$lib/api/byo-provider.js';
	import ByoProviderRequiredNotice from '$lib/components/providers/ByoProviderRequiredNotice.svelte';
	import { resolve } from '$app/paths';
	import { runs, annotations as annotationsApi, ApiError, listMusicTracks } from '$lib/api';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';
	import { JobProgressState } from '$lib/stores/job-progress';
	import VideoPlayer from '$lib/components/video/VideoPlayer.svelte';
	import { ClipTimeline, ClipInspector } from '$lib/components/studio';
	import { Sheet, Button } from '$lib/components/ui';
	import { RunStatusBadge, RegenerateRunModal, RestartRunModal } from '$lib/components/runs';
	import { resolveVideoStage, resolveClipSpine, activeClipAt } from '$lib/utils/timeline';
	import type { Clip } from '$lib/utils/timeline';
	import type {
		ClipEdit,
		MusicEdit,
		ClipTransition,
		ClipAdjust,
		ClipOverlay,
		ClipAudio
	} from '$lib/api/runs';
	import {
		DUCK_PRESETS,
		DEFAULT_DUCK_DB,
		readCurrentMusic,
		musicTracksToOptions,
		resolveMusicTrack,
		pickableMusicOptions,
		type MusicOption
	} from '$lib/studio/music';
	import { studioEditGates, isNoPerClipStageError } from '$lib/studio/edit-gates';
	import type { AnnotationResponse } from '$lib/types';
	import type { RunDetail } from '$lib/types/runs';
	import { NEEDS_REVIEW, PAUSED } from '$lib/utils/review-wait';
	import { ArrowLeft, ChevronRight, Save, Loader, RotateCcw, MonitorPlay } from '@lucide/svelte';

	let { data } = $props();

	const projectId = $derived(data.project.id);
	const projectTitle = $derived(data.project.title);
	const runId = $derived(data.run.id);

	// Video + timeline resolved by output shape (works for every video blueprint).
	const videoStage = $derived(resolveVideoStage(data.run));
	// scopedMediaUrl: <video> pulls this itself, and a browser-initiated fetch can't
	// send the X-Active-Tenant-Id header a super-admin's tenant switch relies on.
	const videoSrc = $derived.by(() => {
		const o = (videoStage?.output ?? {}) as Record<string, unknown>;
		const url = o.video_url ?? o.artifact_url;
		return typeof url === 'string' ? (scopedMediaUrl(url) ?? '') : '';
	});
	const spine = $derived(resolveClipSpine(data.run));
	const clips = $derived(spine?.clips ?? []);
	const spineStage = $derived(data.spineStageName);
	// Whether the SERVER will accept a reorder of that stage (see `+page.ts`).
	// Display and reorder-eligibility are separate: most blueprints render a real
	// timeline whose order the reorder route refuses.
	const spineReorderable = $derived(data.spineReorderable);

	// Live run status. The Studio is often opened on a freshly-spawned child run
	// that is still compiling (saveOrder / regenerateClip goto here right after
	// creating it), so binding the frozen loader snapshot `data.run.status` would
	// leave the badge + "still rendering" state stuck forever. Track the run live
	// (SSE/poll) instead; SSE carries STATUS only, so when the run first reaches a
	// terminal state, refetch the loader ONCE to pull in the compiled video +
	// timeline (mirrors the run-detail page's one-shot reveal).
	function connectProgress(run: RunDetail): JobProgressState {
		const jp = new JobProgressState(run.id);
		jp.hydrateFromDetail(run);
		// `paused` too: a paused run is alive, and the reviewer approving its gate
		// (via the link this page offers, or anywhere else) must move this page on.
		if (run.status === 'running' || run.status === 'pending' || run.status === 'paused') {
			jp.connect();
		}
		return jp;
	}
	const isTerminal = (s: string) => ['completed', 'failed', 'cancelled'].includes(s);

	let jobProgress = $state<JobProgressState>(untrack(() => connectProgress(data.run)));
	let trackedRunId = untrack(() => data.run.id);
	let refreshedOnTerminal = untrack(() => isTerminal(data.run.status));

	// Pending per-clip edits (trim / anchor) keyed by clip-<n> spine id. Declared
	// here so the run-change effect below can clear it; the handlers are further
	// down with the rest of the edit flow.
	let clipEdits = $state<Record<string, ClipEdit>>({});

	// Re-point the tracker when navigating to a DIFFERENT run within this same
	// route (reorder / regenerate goto the child → SvelteKit reuses the component,
	// so the untrack-seeded tracker would otherwise stay on the parent run).
	$effect(() => {
		const id = data.run.id;
		if (id === trackedRunId) return;
		trackedRunId = id;
		untrack(() => jobProgress.disconnect());
		jobProgress = connectProgress(data.run);
		refreshedOnTerminal = isTerminal(data.run.status);
		// A new run's spine has its own base values — drop any pending edits so
		// they can't leak onto the wrong clips.
		clipEdits = {};
		musicOverride = null;
	});

	$effect(() => {
		if (jobProgress.isTerminal && !refreshedOnTerminal) {
			refreshedOnTerminal = true;
			void invalidateAll();
		}
	});
	onDestroy(() => jobProgress.disconnect());

	// Annotations seeded from the loader; a writable $derived so local add/dismiss
	// can reassign it optimistically while a new run's load resets it.
	let annList = $derived<AnnotationResponse[]>([...data.annotations]);
	const noteCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const a of annList) {
			if (a.status === 'open' && a.element_id) {
				counts[a.element_id] = (counts[a.element_id] ?? 0) + 1;
			}
		}
		return counts;
	});

	// Playhead → active clip.
	let currentTime = $state(0);
	const activeClipId = $derived(activeClipAt(clips, currentTime));

	// Selection + player instance (for seek-on-select).
	let selectedClipId = $state<string | null>(null);
	let player = $state<ReturnType<typeof VideoPlayer> | undefined>();
	const selectedClip = $derived(clips.find((c) => c.id === selectedClipId) ?? null);

	// Effective trim values shown in the inspector = pending edit, else the spine
	// base. Nullish coalescing keeps an explicit 0 (not falling through to base).
	const selectedEdit = $derived(selectedClipId ? clipEdits[selectedClipId] : undefined);
	const selectedLead = $derived(
		selectedEdit?.clip_lead_seconds ?? selectedClip?.clipLeadSeconds ?? 0
	);
	const selectedAnchor = $derived(selectedEdit?.clip_anchor ?? selectedClip?.clipAnchor ?? 'start');
	const selectedCaption = $derived(selectedEdit?.caption ?? selectedClip?.caption ?? '');
	const selectedFit = $derived(selectedEdit?.fit ?? selectedClip?.fit ?? 'contain');
	// These have a spine base too, for exactly the same reason the four above do:
	// `POST /api/runs/{id}/apply-edits` shallow-merges every editable field of the
	// edit onto the CHILD run's spine element, so a re-stitched run's spine really
	// does carry its speed / transition / grade / overlays / audio / voiceover.
	// Reading only the pending edit here made the inspector report 1×, no
	// transition, no grade and default audio on a clip that had all of them — and
	// nudging one control then silently overwrote a value the user could not see.
	// Order is fixed: pending edit ▸ spine base ▸ documented default.
	//
	// The pending edit wins by KEY PRESENCE, not by nullishness. `handleEditChange`
	// writes an explicit `null` to CLEAR a spine-authored value (the orchestrator
	// pops a field whose value is null), so a plain `edit?.x ?? spine.x` chain
	// would fall straight back through the clear onto the very value it clears —
	// the control would snap back to the old fade / grade / voiceover while the
	// payload said otherwise.
	function effective<K extends keyof ClipEdit, T>(
		edit: ClipEdit | undefined,
		key: K,
		base: T | null | undefined,
		fallback: T
	): T {
		if (edit && key in edit) return (edit[key] as unknown as T | null) ?? fallback;
		return base ?? fallback;
	}
	const selectedSpeed = $derived(
		effective<'speed', number>(selectedEdit, 'speed', selectedClip?.speed, 1)
	);
	const selectedTransition = $derived(
		effective<'transition', ClipTransition | null>(
			selectedEdit,
			'transition',
			selectedClip?.transition,
			null
		)
	);
	const selectedAdjust = $derived<ClipAdjust>(
		effective<'adjust', ClipAdjust>(selectedEdit, 'adjust', selectedClip?.adjust, {})
	);
	const selectedOverlays = $derived<ClipOverlay[]>(
		effective<'overlays', ClipOverlay[]>(selectedEdit, 'overlays', selectedClip?.overlays, [])
	);
	const selectedAudio = $derived<ClipAudio>(
		effective<'audio', ClipAudio>(selectedEdit, 'audio', selectedClip?.audio, {})
	);
	// Voiceover override: an uploaded replacement is merged onto the child spine
	// as well, so a re-stitched run shows the take it is actually playing.
	const selectedAudioUrl = $derived<string | null>(
		effective<'audio_url', string | null>(selectedEdit, 'audio_url', selectedClip?.audioUrl, null)
	);
	const selectedAudioSeconds = $derived<number | null>(
		effective<'audio_seconds', number | null>(
			selectedEdit,
			'audio_seconds',
			selectedClip?.audioSeconds,
			null
		)
	);

	function selectClip(id: string) {
		selectedClipId = id;
		const clip = clips.find((c) => c.id === id);
		if (clip && player) player.seekTo(clip.startSec);
	}

	// ── Reorder → re-stitch ────────────────────────────────────────────────
	// The reorder-clips route 422s unless the parent run has fully finished
	// ('completed'): re-stitching needs every clip asset in place. Since the
	// Studio can be opened on a still-compiling child, gate the whole reorder
	// affordance on the LIVE status (not the frozen loader snapshot) so users
	// never build an order that the backend will reject.
	let pendingOrder = $state<string[] | null>(null);
	const isDirty = $derived(pendingOrder !== null);
	let saving = $state(false);
	const canReorder = $derived(jobProgress.jobStatus === 'completed');
	// Reorder needs BOTH halves: a finished run AND a spine the server named.
	// A completed run is NOT sufficient — 9 of 16 blueprints display a timeline
	// the reorder route 422s, and status alone offered the button on every one.
	const canReorderClips = $derived(canReorder && spineReorderable);
	// Clip edits / re-narrate / music save go to `apply-edits` & `renarrate-clip`,
	// which 422 on any stage the server did not name as the clip spine — the same
	// gate as reorder. So they target ONLY `clip_spine_stage`; with none, they are
	// disabled with a reason (see `studio/edit-gates.ts`). Display is unaffected.
	const editGates = $derived.by(() =>
		studioEditGates({
			completed: canReorder,
			// The loader's resolution (same source the reorder gate reads), so the
			// two gates can never disagree about what the server named.
			spine: spineStage ? { stageName: spineStage, reorderable: spineReorderable } : null,
			stageNames: (data.run.stage_outputs ?? []).map((s) => s.stage_name)
		})
	);

	// The stage every per-CLIP server call (feedback note, dismiss, regenerate
	// clip, re-narrate) is addressed to. These went to `spineStage` — the loader's
	// DISPLAY spine, which on most blueprints is a shape GUESS — and the server
	// refuses a guess: annotation create 400s on a stage without element pinning,
	// and regenerate-clip / renarrate-clip 422 on anything that is not a clip
	// spine. Only the stage the server itself named is a valid target, which is
	// `editGates.saveStageName` when clip edits are savable. (When only MUSIC is
	// savable, `saveStageName` is the beat-grid owner `music_select` — never a
	// clip target — hence the `canSaveClipEdits` half.)
	const clipStage = $derived(editGates.canSaveClipEdits ? editGates.saveStageName : null);
	const clipActionsBlockedReason = $derived(
		clipStage
			? null
			: (editGates.clipEditsBlockedReason ??
					'Feedback and clip regeneration unlock once this run has finished rendering.')
	);

	// ── Per-clip edits (trim / anchor / caption / fit) ─────────────────────
	// `clipEdits` (declared above) accumulates pending edits keyed by clip id,
	// mirroring the reorder dirty-state flow. Each ClipEdit is a partial patch;
	// setting a field back to the clip's spine base collapses it out (like
	// handleReorder), and an empty patch drops the whole entry — so `editsDirty`
	// is true only when something genuinely differs. Applying re-stitches as a
	// child run (same completed-only gate as reorder), then navigates to it.
	const clipEditsDirty = $derived(Object.keys(clipEdits).length > 0);
	let savingEdits = $state(false);
	// A PERSISTENT failure surface for the apply. A toast was the only one, and a
	// toast is not a surface you can rely on: `toastError` itself throws on a
	// non-secure origin, so the save failed, the catch failed, `finally` re-enabled
	// the button, and the page looked exactly like nothing had happened. This
	// stays on screen until the next attempt clears it.
	let editsSaveError = $state('');

	// ── Run-level music bed ────────────────────────────────────────────────
	// The run's current music, read from its config snapshot (the sound_effects
	// block). This is the base a change collapses back to. It is never re-sent: an
	// apply without `music` keeps the parent run's music (orchestrator contract).
	// Normalized against the catalog: a stored LABEL ("smooth lounge jazz background
	// bed") resolves to its id (`jazz_lounge`) so the select matches and a save
	// sends the id the backend's `sound_effects.music` requires. A value that is
	// NEITHER a catalog id nor a catalog label is dropped to "no music" and named in
	// `droppedMusicTrack` — it cannot be saved by anyone (the orchestrator 422s at
	// lifecycle.py:734), so carrying it forward only defers the failure to the save.
	// Resolution only runs once the live catalog is in: while it is loading or has
	// failed, every value would "miss" and we would drop a perfectly good bed.
	const musicResolution = $derived.by(() => {
		const stored = readCurrentMusic(data.run.config_snapshot).track;
		if (musicTracksState !== 'ready') return { track: null, dropped: null };
		return resolveMusicTrack(stored, musicOptions);
	});
	const droppedMusicTrack = $derived(musicResolution.dropped);
	const currentMusic = $derived.by<MusicEdit>(() => {
		const m = readCurrentMusic(data.run.config_snapshot);
		return { ...m, track: musicResolution.track };
	});
	// `null` until the user changes music; effective value falls back to current.
	let musicOverride = $state<MusicEdit | null>(null);
	const effectiveMusic = $derived<MusicEdit>(musicOverride ?? currentMusic);
	const musicDirty = $derived(
		musicOverride !== null &&
			((musicOverride.track ?? null) !== currentMusic.track ||
				(musicOverride.duck_db ?? null) !== (currentMusic.duck_db ?? null))
	);
	const anyEditsDirty = $derived(clipEditsDirty || musicDirty);
	// The ducking depth shown/sent — the effective value, defaulting to the
	// backend default when the run has never set one.
	const effectiveDuckDb = $derived(effectiveMusic.duck_db ?? DEFAULT_DUCK_DB);

	// Selectable music beds: ONLY the live tenant-aware list from
	// `GET /api/music/tracks`. The server validates `music.track` against that same
	// tenant library (`_require_known_music_track`), so the built-in fallback ids
	// this used to offer on a failed fetch were ids the save could 422 on. Until
	// the list loads the picker is disabled; if it fails, it stays disabled and
	// says why. Clip edits are unaffected — they do not send music unless it
	// changed (see `saveEdits`).
	let musicOptions = $state<MusicOption[]>(musicTracksToOptions([]));
	let musicTracksState = $state<'loading' | 'ready' | 'error'>('loading');
	let musicTracksError = $state<string | null>(null);
	onMount(async () => {
		try {
			musicOptions = musicTracksToOptions(await listMusicTracks());
			musicTracksState = 'ready';
		} catch (err) {
			musicTracksState = 'error';
			musicTracksError = err instanceof ApiError ? err.detail : 'the track list did not load';
		}
	});
	const canPickMusic = $derived(editGates.canSaveMusic && musicTracksState === 'ready');
	// The catalog ERRORED (not merely "not ready"): `musicResolution` correctly skips
	// resolution — that guard is load-bearing — but the side effect is that a run WITH
	// a bed renders as "No music" and `droppedMusicTrack`, which only fires on a
	// resolved-but-unknown value, explains nothing. Name the stored bed so the
	// operator knows the soundtrack is intact and merely unreadable. Display only:
	// `musicForSave` still sends nothing, so the run keeps the bed it has.
	const unloadedMusicTrack = $derived(
		musicTracksState === 'error' ? readCurrentMusic(data.run.config_snapshot).track : null
	);
	// The select offers CATALOG IDS ONLY. It used to append the run's stored value as
	// a synthetic `{id: track, label: track}` option so an unknown bed stayed visible
	// — but that made the unknown value PICKABLE, so it round-tripped straight back
	// into `music.track` and 422'd the save. An unresolvable bed is dropped to "no
	// music" by `musicResolution` and explained by the `music-track-dropped` notice.
	const musicSelectOptions = $derived<MusicOption[]>(
		pickableMusicOptions(musicOptions, effectiveMusic.track)
	);

	function handleMusicTrackChange(track: string) {
		// Empty select value ('') → no music (null track).
		musicOverride = { ...effectiveMusic, track: track || null };
	}

	function handleMusicDuckChange(duckDb: number) {
		musicOverride = { ...effectiveMusic, duck_db: duckDb };
	}

	type EditField =
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
		| 'audio_seconds';

	// A color grade is "no grade" (→ collapse out) when it has no preset and every
	// scalar is at its neutral value (brightness 0, contrast/saturation/gamma 1).
	function isDefaultAdjust(a: ClipAdjust): boolean {
		return (
			!a.preset &&
			(a.brightness ?? 0) === 0 &&
			(a.contrast ?? 1) === 1 &&
			(a.saturation ?? 1) === 1 &&
			(a.gamma ?? 1) === 1
		);
	}

	// An audio block is a no-op (→ collapse out) at 0 dB gain, not muted, no fades.
	function isDefaultAudio(a: ClipAudio): boolean {
		return (
			(a.gain_db ?? 0) === 0 && !a.mute && (a.fade_in_s ?? 0) === 0 && (a.fade_out_s ?? 0) === 0
		);
	}

	// ── Spine-base comparison for the seven merged-edit fields ─────────────
	// Every value the inspector reports is a FRESHLY CONSTRUCTED object, so a
	// reference compare could never see "back to exactly what the run already
	// contains". These normalise the optional keys (each scalar against its own
	// documented default) so the comparison is by MEANING — unlike
	// `JSON.stringify`, which is key-order sensitive and would call
	// `{gain_db:-6, mute:false}` different from `{mute:false, gain_db:-6}`.
	function sameAdjust(a: ClipAdjust, b: ClipAdjust): boolean {
		return (
			(a.preset ?? null) === (b.preset ?? null) &&
			(a.brightness ?? 0) === (b.brightness ?? 0) &&
			(a.contrast ?? 1) === (b.contrast ?? 1) &&
			(a.saturation ?? 1) === (b.saturation ?? 1) &&
			(a.gamma ?? 1) === (b.gamma ?? 1)
		);
	}

	function sameAudio(a: ClipAudio, b: ClipAudio): boolean {
		return (
			(a.gain_db ?? 0) === (b.gain_db ?? 0) &&
			(a.mute ?? false) === (b.mute ?? false) &&
			(a.fade_in_s ?? 0) === (b.fade_in_s ?? 0) &&
			(a.fade_out_s ?? 0) === (b.fade_out_s ?? 0)
		);
	}

	function sameTransition(a: ClipTransition | null, b: ClipTransition | null): boolean {
		if (a === null || b === null) return a === b;
		return a.type === b.type && a.duration === b.duration;
	}

	function sameOverlays(a: ClipOverlay[], b: ClipOverlay[]): boolean {
		if (a.length !== b.length) return false;
		return a.every((o, i) => {
			const p = b[i];
			return (
				o.text === p.text &&
				(o.position ?? null) === (p.position ?? null) &&
				(o.x ?? null) === (p.x ?? null) &&
				(o.y ?? null) === (p.y ?? null) &&
				(o.font_size ?? null) === (p.font_size ?? null) &&
				(o.color ?? null) === (p.color ?? null) &&
				(o.start ?? null) === (p.start ?? null) &&
				(o.end ?? null) === (p.end ?? null)
			);
		});
	}

	// The four fields whose only base is the spine element itself (they are never
	// "cleared" — a caption is '' , a fit is 'contain', both are real values).
	type SpineOnlyField = 'clip_lead_seconds' | 'clip_anchor' | 'caption' | 'fit';

	// The clip's current spine value for a field — what a change collapses back to.
	// The other SEVEN fields (speed / transition / adjust / overlays / audio /
	// audio_url / audio_seconds) have a THREE-state base on a re-stitched run —
	// spine-authored, spine-unauthored, or a pending edit — so they are resolved
	// inline in handleEditChange below rather than through this helper: choosing
	// the default on a clip whose spine ALREADY carries a value has to send an
	// explicit CLEAR, not omit the field.
	function editBase(clip: Clip, field: SpineOnlyField): number | string {
		switch (field) {
			case 'clip_lead_seconds':
				return clip.clipLeadSeconds;
			case 'clip_anchor':
				return clip.clipAnchor;
			case 'caption':
				return clip.caption;
			case 'fit':
				return clip.fit ?? 'contain';
		}
	}

	function handleEditChange(
		clip: Clip,
		field: EditField,
		value: number | string | ClipTransition | null | ClipAdjust | ClipOverlay[] | ClipAudio
	) {
		const next: ClipEdit = { ...(clipEdits[clip.id] ?? {}) };
		// The seven merged-edit fields below all follow ONE rule, because on a
		// re-stitched run the spine genuinely carries them (apply-edits merges the
		// edit onto the child's spine element):
		//   • new value == the SPINE BASE      → drop the key (nothing to send; a
		//     pointless re-stitch costs a real render, so a round trip back to what
		//     the run already contains must leave it clean)
		//   • spine unauthored + default value → drop the key (a first-generation
		//     run behaves exactly as before)
		//   • spine AUTHORED + default value   → send an EXPLICIT CLEAR. The
		//     orchestrator's ClipEdit documents `null` as "clear a previously
		//     authored override" (`if value is None: merged.pop(field)`), and the
		//     route's `model_dump(exclude_unset=True)` means an omitted key is left
		//     untouched. Omitting here is what made a spine-authored value
		//     UNCLEARABLE: the control snapped straight back to the old value.
		if (field === 'speed') {
			const v = value as number;
			// `speed` is the one field that is NOT nullable in ClipEdit (float,
			// 0.25–4.0) — a null 422s. The compiler emits no speed filter at 1.0,
			// so an explicit 1 is byte-identical to absence and IS the clear.
			if (v === (clip.speed ?? 1)) delete next.speed;
			else next.speed = v;
		} else if (field === 'transition') {
			const t = value as ClipTransition | null;
			if (sameTransition(t, clip.transition)) delete next.transition;
			else next.transition = t;
		} else if (field === 'adjust') {
			const a = value as ClipAdjust;
			const base = clip.adjust;
			if (base !== null && sameAdjust(a, base)) delete next.adjust;
			else if (!isDefaultAdjust(a)) next.adjust = a;
			else if (base === null) delete next.adjust;
			else next.adjust = null; // clear a spine-authored grade back to no grade
		} else if (field === 'audio') {
			const a = value as ClipAudio;
			const base = clip.audio;
			if (base !== null && sameAudio(a, base)) delete next.audio;
			else if (!isDefaultAudio(a)) next.audio = a;
			else if (base === null) delete next.audio;
			else next.audio = null; // clear a spine-authored level/mute/fade block
		} else if (field === 'audio_url') {
			// An uploaded voiceover REPLACES the shot's TTS narration; Remove (null)
			// must take the declared duration with it — a stale `audio_seconds`
			// would keep re-declaring the shot's length. That pairing holds on both
			// paths: dropped together when nothing is authored, cleared together
			// (null, null) when the spine carries the voiceover.
			const url = value as string | null;
			if (url === null) {
				if (clip.audioUrl === null) {
					delete next.audio_url;
					delete next.audio_seconds;
				} else {
					next.audio_url = null;
					next.audio_seconds = null;
				}
			} else if (url === clip.audioUrl) {
				delete next.audio_url;
			} else {
				next.audio_url = url;
			}
		} else if (field === 'audio_seconds') {
			// Server-probed duration of the upload; only ever set alongside audio_url.
			const s = value as number | null;
			if (s === clip.audioSeconds) delete next.audio_seconds;
			else next.audio_seconds = s;
		} else if (field === 'overlays') {
			const list = value as ClipOverlay[];
			const base = clip.overlays;
			if (base !== null && sameOverlays(list, base)) delete next.overlays;
			else if (list.length > 0) next.overlays = list;
			else if (base === null) delete next.overlays;
			else next.overlays = null; // clear spine-authored overlays
		} else if (value === editBase(clip, field)) {
			delete next[field];
		} else if (field === 'clip_lead_seconds') {
			next.clip_lead_seconds = value as number;
		} else if (field === 'clip_anchor') {
			next.clip_anchor = value as 'start' | 'end';
		} else if (field === 'caption') {
			next.caption = value as string;
		} else {
			next.fit = value as 'contain' | 'cover' | 'scroll';
		}
		if (Object.keys(next).length === 0) {
			const { [clip.id]: _drop, ...rest } = clipEdits;
			clipEdits = rest;
		} else {
			clipEdits = { ...clipEdits, [clip.id]: next };
		}
	}

	// What `music` to send with an apply-edits: ONLY a change the user made in
	// this session (`track: null` = explicit OFF). Anything unchanged is omitted,
	// and the orchestrator's apply-edits contract carries the PARENT run's music
	// forward into the child when `music` is absent. Re-sending the stored value
	// was wrong both ways: an unmatched stored value (a label, a retired id) 422'd
	// a plain trim, and filtering it through the loaded catalog silently DROPPED
	// an earlier Studio music choice whenever the list failed or lacked the track.
	function musicForSave(): MusicEdit | undefined {
		return musicDirty ? effectiveMusic : undefined;
	}

	async function saveEdits() {
		if (!anyEditsDirty) return;
		if (!canReorder) {
			toastError('Run is still rendering', 'Wait for the video to finish before editing clips.');
			return;
		}
		// Guard at the request, not only the button: never POST a guessed stage.
		if (clipEditsDirty && !editGates.canSaveClipEdits) {
			toastError('Clip edits cannot be saved', editGates.clipEditsBlockedReason ?? '');
			return;
		}
		if (musicDirty && !editGates.canSaveMusic) {
			toastError('Soundtrack cannot be changed', editGates.musicBlockedReason ?? '');
			return;
		}
		const stageToSave = editGates.saveStageName;
		if (!stageToSave) return;
		// Latched for the same reason as `orderToSave` in `saveOrder`: a retry must
		// re-send the IDENTICAL body or the idempotency key stops protecting it.
		const editsToSave = clipEdits;
		const musicToSave = musicForSave();
		savingEdits = true;
		editsSaveError = '';
		try {
			const child = await spawnChildRun((idempotencyKey) =>
				runs.applyClipEdits(runId, stageToSave, editsToSave, musicToSave, { idempotencyKey })
			);
			clipEdits = {};
			musicOverride = null;
			toastSuccess('Re-rendering with your edits', 'Opening the new version…');
			await goto(resolve(`/projects/${projectId}/runs/${child.id}/studio`));
		} catch (err) {
			if (handleByoRefusal(err)) return;
			const detail = err instanceof ApiError ? err.detail : 'Unknown error';
			// Write the persistent surface FIRST: `toastError` can itself throw, and
			// when it does the user must still be told the save did not happen.
			editsSaveError = detail;
			// A broken NOTIFIER must never become a second, louder failure: a throw
			// here escapes `saveEdits` as an unhandled rejection and takes the rest of
			// the handler with it. The inline surface above is already written.
			try {
				toastError('Could not apply edits', detail);
			} catch {
				/* the inline error is the surface that matters */
			}
		} finally {
			savingEdits = false;
		}
	}

	function handleReorder(order: string[]) {
		const base = clips.map((c) => c.id).join('|');
		pendingOrder = order.join('|') === base ? null : order;
	}

	async function saveOrder() {
		if (!pendingOrder || !spineStage) return;
		if (!canReorder) {
			toastError('Run is still rendering', 'Wait for the video to finish before reordering clips.');
			return;
		}
		// Unreachable while the drag handle is gated on `canReorderClips`, but the
		// POST is the thing that 422s — guard it where the request is made, not
		// only where the affordance is drawn.
		if (!spineReorderable) {
			toastError(
				'This timeline cannot be reordered',
				'The server does not accept a clip reorder for this deliverable.'
			);
			return;
		}
		// Latched outside the retry closure. Required: `pendingOrder` is a `let`, so
		// the null-narrowing above does not survive into a closure. It is also the
		// safe shape — a retry MUST re-send the identical body, since the idempotency
		// key only protects a create when tenant|path|key|BODY all match.
		const orderToSave = pendingOrder;
		saving = true;
		try {
			const child = await spawnChildRun((idempotencyKey) =>
				runs.reorderClips(runId, spineStage, orderToSave, { idempotencyKey })
			);
			pendingOrder = null;
			toastSuccess('Re-rendering with the new clip order', 'Opening the new version…');
			await goto(resolve(`/projects/${projectId}/runs/${child.id}/studio`));
			// The route 422s for three distinct reasons (stage is not a clip spine /
			// parent run not completed / no downstream compile stage) — the server's
			// `detail` is the only accurate diagnosis and must not be replaced with a guess.
		} catch (err) {
			if (handleByoRefusal(err)) return;
			toastError('Could not reorder clips', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			saving = false;
		}
	}

	// ── Per-clip feedback ──────────────────────────────────────────────────
	async function addNote(elementId: string, text: string) {
		const stage = clipStage;
		if (!stage) return;
		const created = await annotationsApi.create(runId, stage, {
			text,
			element_id: elementId
		});
		annList = [...annList, created];
		toastSuccess('Feedback saved', 'Regenerate the clip to apply it.');
	}

	async function dismissNote(id: string) {
		const stage = clipStage;
		if (!stage) return;
		try {
			await annotationsApi.dismiss(runId, stage, id);
			annList = annList.map((a) => (a.id === id ? { ...a, status: 'dismissed' as const } : a));
		} catch (err) {
			toastError(
				'Could not dismiss feedback',
				err instanceof ApiError ? err.detail : 'Unknown error'
			);
		}
	}

	// ── Regenerate the selected clip ───────────────────────────────────────
	// The surgical single-clip path: preserve the spine + sibling clips verbatim
	// and re-render only this clip's image with its feedback folded in.
	//
	// It used to fall back to `runs.regenerate(runId, {})` — a FULL paid re-run —
	// on ANY 422, silently. `regenerate-clip` 422s for reasons a full re-run does
	// not fix (no open feedback on the clip, run not completed, no line_id, …); a
	// user who clicked "Regenerate this clip" got a whole new render, its review
	// pauses, and its bill. Now only the case a full run genuinely answers — the
	// pipeline has no per-clip stage to target — offers it, and only behind a
	// confirmation that says what it costs. Every other 422 shows the server's
	// own reason.
	let regenerating = $state(false);
	let showFullRerunConfirm = $state(false);
	// The run-start preflight's 402 `byo_provider_required` (#1150) on ANY child-run
	// spawn here: no child exists, and the fix is on /providers, so it is a
	// persistent notice with the link — a toast cannot carry it.
	let startRefusal = $state<ByoProviderRequired | null>(null);
	function handleByoRefusal(err: unknown): boolean {
		const byo = byoProviderRequiredFromError(err);
		if (!byo) return false;
		startRefusal = byo;
		showRegenerateModal = false;
		showFullRerunConfirm = false;
		return true;
	}
	async function regenerateClip() {
		const stage = clipStage;
		if (!selectedClip || !stage) return;
		regenerating = true;
		try {
			const clipId = selectedClip.id;
			const child = await spawnChildRun((idempotencyKey) =>
				runs.regenerateClip(runId, stage, clipId, { idempotencyKey })
			);
			toastSuccess('Regenerating the clip', 'Opening the new version…');
			await goto(resolve(`/projects/${projectId}/runs/${child.id}/studio`));
		} catch (err) {
			if (handleByoRefusal(err)) return;
			if (isNoPerClipStageError(err)) {
				showFullRerunConfirm = true;
			} else {
				toastError('Could not regenerate', err instanceof ApiError ? err.detail : 'Unknown error');
			}
		} finally {
			regenerating = false;
		}
	}

	// ── Re-narrate one line ────────────────────────────────────────────────
	// The narration counterpart to regenerateClip: re-synthesizes EXACTLY this
	// clip's TTS with new text and/or a new voice (siblings' audio is reused
	// verbatim) and re-stitches as a child run. The inspector latches its target
	// clip at request time and hands it over as `elementId` — resolving against
	// `selectedClip` here would land clip A's re-narrate on clip B if the user
	// switched while the child run was being spawned. Errors are re-thrown so the
	// inspector can surface the 422 `detail` (e.g. the uploaded-voiceover conflict)
	// inline on the clip it started on.
	async function renarrateClip(payload: {
		elementId: string;
		narrationText?: string;
		voice?: string;
	}) {
		const stage = clipStage;
		if (!stage) return;
		const child = await spawnChildRun((idempotencyKey) =>
			runs.renarrateClip(
				runId,
				stage,
				payload.elementId,
				{ narrationText: payload.narrationText, voice: payload.voice },
				{ idempotencyKey }
			)
		);
		toastSuccess('Re-narrating the line', 'Opening the new version…');
		await goto(resolve(`/projects/${projectId}/runs/${child.id}/studio`));
	}

	// ── Regenerate the whole run ────────────────────────────────────────────
	// The whole-run counterpart to per-clip regenerate: re-runs the steps with
	// feedback, edits or changed settings (and everything built on them), folding
	// in feedback across every clip, and keeps the rest. Previously this path was
	// only reachable as the single-clip 422 fallback (regenerateClip), so a user
	// who wanted to re-render everything after leaving notes on several clips had
	// no direct button.
	let regeneratingRun = $state(false);
	// A whole-run regenerate is a new paid run and navigates the user off this
	// page, so it is CONFIRMED — with the same restart-plan preview the run page's
	// Restart shows (`RestartRunModal`), because it posts the same body. The same
	// money must not have two safety postures.
	let showRegenerateModal = $state(false);
	async function regenerateRun() {
		regeneratingRun = true;
		try {
			const child = await spawnChildRun((idempotencyKey) =>
				runs.regenerate(runId, {}, { idempotencyKey })
			);
			showRegenerateModal = false;
			showFullRerunConfirm = false;
			toastSuccess('Re-rendering the full video…', 'Opening the new version…');
			await goto(resolve(`/projects/${projectId}/runs/${child.id}/studio`));
		} catch (err) {
			if (handleByoRefusal(err)) return;
			toastError('Could not regenerate', err instanceof ApiError ? err.detail : 'Unknown error');
		} finally {
			regeneratingRun = false;
		}
	}

	const isRendering = $derived(
		!videoSrc && (jobProgress.jobStatus === 'running' || jobProgress.jobStatus === 'pending')
	);
	// A run waiting at a review checkpoint has no compiled video yet and is NOT
	// rendering: nothing happens until a human approves the gate. It used to fall
	// through to "This run has no compiled video to edit." — a dead end that read
	// as a broken run. Say it is paused and send the reviewer to the gate.
	// Only a CHECKPOINT pause has something to review. A run someone paused, or one
	// paused before the reason was recorded, gets the plain paused state instead.
	const isManuallyPaused = $derived(
		!videoSrc &&
			jobProgress.jobStatus === 'paused' &&
			data.run.status === 'paused' &&
			data.run.pause_reason !== 'checkpoint'
	);
	const isPausedForReview = $derived(
		!videoSrc && jobProgress.jobStatus === 'paused' && !isManuallyPaused
	);
	// Straight to the gate only when the snapshot names a COMPLETED declared
	// checkpoint (the gate page's own Approve precondition); otherwise the run
	// monitor, which resolves the open gate from live state.
	const reviewHref = $derived.by(() => {
		const current = jobProgress.currentStage ?? data.run.current_stage;
		const gates = new Set(data.run.pause_after_stages ?? []);
		const done = (data.run.stage_outputs ?? []).some(
			(s) => s.stage_name === current && s.status === 'completed'
		);
		return current && gates.has(current) && done
			? `/projects/${projectId}/runs/${runId}/stages/${current}`
			: `/projects/${projectId}/runs/${runId}`;
	});

	// `canReorder` means "the run has FINISHED, so the backend will accept a
	// re-stitch of it", and it keeps that meaning — do not overload it. Its
	// consumers are the save-edits guard + button, the soundtrack selects and the
	// inspector's re-narrate + edit callbacks. None of those were broken on the
	// blueprints with no reorderable spine and none must become broken.
	//
	// REORDER is the one affordance that needs the second half — `canReorderClips`
	// (= `canReorder && spineReorderable`) — and it is the only thing that gates
	// the drag handle, its hint, the save-order button and the reorder POST.
	//
	// Note :696 is in the HEADER, not inside the `{:else}` video branch — so "every
	// other consumer is inside the video branch" would be wrong. It is safe for a
	// different reason: `anyEditsDirty` starts false, resets on run change, and can
	// only be set by controls that live in the video branch, so the button cannot
	// appear without a video. That is a reachability argument, not a structural one.
	//
	// The whole-run regenerate is different: it renders unconditionally in the
	// header, which is how an enabled "Regenerate video" ended up sitting next to
	// "This run has no compiled video to edit." (a completed run whose compile stage
	// was skipped or failed). It needs its own condition: a video must exist before
	// offering to re-render one.
	const canRegenerateRun = $derived(canReorder && videoSrc !== '');
</script>

<svelte:head>
	<title>Studio · {projectTitle}</title>
</svelte:head>

<Page testid="run-studio">
	<!-- Header -->
	<div class="flex items-center justify-between gap-4 flex-wrap">
		<div class="min-w-0">
			<p class="text-kicker text-[var(--color-text-muted)] flex items-center gap-1.5">
				<a href={resolve('/projects')} class="hover:text-[var(--color-text)]">Projects</a>
				<ChevronRight class="h-3 w-3" />
				<a href={resolve(`/projects/${projectId}`)} class="hover:text-[var(--color-text)]">
					{projectTitle}
				</a>
				<ChevronRight class="h-3 w-3" />
				<span>Studio</span>
			</p>
			<div class="flex items-center gap-2 mt-1">
				<h1 class="text-xl font-bold text-[var(--color-text)]">Video Studio</h1>
				<RunStatusBadge
					status={jobProgress.jobStatus}
					pauseReason={data.run.status === 'paused' ? data.run.pause_reason : null}
				/>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if isDirty && canReorderClips}
				<div data-testid="save-order">
					<Button variant="primary" size="sm" loading={saving} onclick={saveOrder}>
						<Save class="h-4 w-4" />
						Save order &amp; re-render
					</Button>
				</div>
			{/if}
			{#if anyEditsDirty && canReorder && (clipEditsDirty ? editGates.canSaveClipEdits : editGates.canSaveMusic)}
				<div data-testid="save-edits">
					<Button variant="primary" size="sm" loading={savingEdits} onclick={saveEdits}>
						<Save class="h-4 w-4" />
						Apply edits &amp; re-render
					</Button>
				</div>
			{/if}
			{#if canRegenerateRun}
				<div data-testid="regenerate-run">
					<Button
						variant="secondary"
						size="sm"
						loading={regeneratingRun}
						onclick={() => (showRegenerateModal = true)}
					>
						<RotateCcw class="h-4 w-4" />
						Regenerate video
					</Button>
				</div>
			{/if}
			<Button variant="secondary" size="sm" href={`/projects/${projectId}/runs/${runId}`}>
				<ArrowLeft class="h-4 w-4" />
				Run details
			</Button>
		</div>
	</div>

	<!-- Persistent apply-edits failure. Sits directly under the "Apply edits &
	     re-render" control so the failure is attached to the thing that failed,
	     and does NOT depend on the toast mechanism being usable. -->
	{#if editsSaveError}
		<p
			class="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger-text)]"
			data-testid="edits-save-error"
			role="alert"
		>
			Your edits were NOT applied — {editsSaveError} Nothing was re-rendered and your changes are still
			pending, so you can try again.
		</p>
	{/if}

	{#if startRefusal}
		<ByoProviderRequiredNotice required={startRefusal} />
	{/if}

	{#if isManuallyPaused}
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center"
			data-testid="studio-manually-paused"
		>
			<p class="text-sm text-[var(--color-text)]">{PAUSED}: this run was paused.</p>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				Nothing runs until it is resumed. Open the run to resume or cancel it.
			</p>
			<div class="mt-4 flex items-center justify-center gap-2">
				<Button variant="primary" size="sm" href={`/projects/${projectId}/runs/${runId}`}>
					<MonitorPlay class="h-4 w-4" />
					Open the run
				</Button>
			</div>
		</section>
	{:else if isPausedForReview}
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center"
			data-testid="studio-paused"
		>
			<p class="text-sm text-[var(--color-text)]">{NEEDS_REVIEW}: this run is waiting for you.</p>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				The video is not rendered yet — the pipeline continues once you approve the checkpoint, and
				the timeline opens here when the compiled video is ready.
			</p>
			<div class="mt-4 flex items-center justify-center gap-2">
				<Button variant="primary" size="sm" href={reviewHref}>
					<MonitorPlay class="h-4 w-4" />
					Review checkpoint
				</Button>
			</div>
		</section>
	{:else if isRendering}
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center"
			data-testid="studio-rendering"
		>
			<Loader class="mx-auto h-6 w-6 animate-spin text-[var(--color-accent)]" />
			<p class="mt-3 text-sm text-[var(--color-text)]">Your video is still rendering.</p>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				The timeline opens as soon as the compiled video is ready.
			</p>
			<div class="mt-4 flex items-center justify-center gap-2">
				<Button variant="secondary" size="sm" onclick={() => invalidateAll()}>
					<RotateCcw class="h-4 w-4" />
					Refresh
				</Button>
				<Button variant="ghost" size="sm" href={`/projects/${projectId}/runs/${runId}`}>
					<MonitorPlay class="h-4 w-4" />
					Live progress
				</Button>
			</div>
		</section>
	{:else if !videoSrc}
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center"
			data-testid="studio-no-video"
		>
			<p class="text-sm text-[var(--color-text)]">This run has no compiled video to edit.</p>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				The Studio opens on runs that produced a video.
			</p>
		</section>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4 items-start">
			<div class="space-y-4">
				<!-- Preview -->
				<div class="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
					<VideoPlayer
						bind:this={player}
						src={videoSrc}
						title={projectTitle}
						onTimeUpdate={(t) => (currentTime = t)}
					/>
				</div>

				<!-- Timeline -->
				<section
					class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
				>
					<div class="flex items-center justify-between mb-3">
						<div>
							<h2 class="text-sm font-semibold text-[var(--color-text)]">Timeline</h2>
							<p class="text-xs text-[var(--color-text-muted)]">
								{#if canReorderClips}
									Drag clips to reorder · click a clip to seek and give feedback.
								{:else if canReorder}
									<!-- Completed, but the server named no reorderable spine. The
									     "unlocks once the video finishes rendering" line below is a
									     LIE here — the video has finished and it never unlocks. -->
									Click a clip to seek and give feedback · this deliverable's timeline cannot be reordered.
								{:else}
									Click a clip to seek and give feedback · reordering unlocks once the video
									finishes rendering.
								{/if}
							</p>
						</div>
						<span class="text-xs text-[var(--color-text-muted)]">{clips.length} clips</span>
					</div>
					{#if editGates.clipEditsBlockedReason}
						<p
							class="mb-3 rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]"
							data-testid="clip-edits-blocked"
							role="status"
						>
							Clip editing is off · {editGates.clipEditsBlockedReason} You can still review clips and
							leave feedback.
						</p>
					{/if}
					<ClipTimeline
						{clips}
						{activeClipId}
						{selectedClipId}
						{noteCounts}
						onSelect={selectClip}
						onReorder={spineStage && canReorderClips ? handleReorder : undefined}
						disabled={saving}
					/>
				</section>

				<!-- Soundtrack (run-level music bed) -->
				<section
					class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
					data-testid="soundtrack"
				>
					<h2 class="text-sm font-semibold text-[var(--color-text)] mb-2">Soundtrack</h2>
					<label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)] max-w-xs">
						Background music
						<select
							value={effectiveMusic.track ?? ''}
							disabled={!canPickMusic}
							data-testid="music-track"
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] disabled:opacity-50"
							onchange={(e) => handleMusicTrackChange(e.currentTarget.value)}
						>
							{#each musicSelectOptions as t (t.id)}
								<option value={t.id}>{t.label}</option>
							{/each}
						</select>
					</label>
					{#if effectiveMusic.track}
						<label class="mt-3 flex flex-col gap-1 text-xs text-[var(--color-text-muted)] max-w-xs">
							Ducking under narration
							<select
								value={effectiveDuckDb}
								disabled={!canPickMusic}
								data-testid="music-duck"
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] disabled:opacity-50"
								onchange={(e) => handleMusicDuckChange(Number(e.currentTarget.value))}
							>
								{#each DUCK_PRESETS as d (d.db)}
									<option value={d.db}>{d.label} ({d.db} dB)</option>
								{/each}
							</select>
						</label>
					{/if}
					{#if droppedMusicTrack}
						<p
							class="mt-1.5 text-xs text-[var(--color-warning-text)]"
							data-testid="music-track-dropped"
							role="status"
						>
							This run's soundtrack (“{droppedMusicTrack}”) isn't in your music library, so it's
							shown as “No music”. Pick a bed above to set one — saving it as-is would be rejected.
						</p>
					{/if}
					{#if unloadedMusicTrack}
						<p
							class="mt-1.5 text-xs text-[var(--color-warning-text)]"
							data-testid="music-track-unloaded"
							role="status"
						>
							This run's soundtrack (“{unloadedMusicTrack}”) couldn't be loaded, so it's shown as
							“No music” above. The run still has it — nothing is changed unless you save a new bed.
						</p>
					{/if}
					{#if musicTracksState === 'error'}
						<p
							class="mt-1.5 text-xs text-[var(--color-warning-text)]"
							data-testid="music-tracks-error"
							role="status"
						>
							Couldn't load the music library ({musicTracksError}), so the soundtrack can't be
							changed right now. Reload to try again — clip edits still save.
						</p>
					{:else if editGates.musicBlockedReason}
						<p
							class="mt-1.5 text-xs text-[var(--color-warning-text)]"
							data-testid="music-blocked"
							role="status"
						>
							{editGates.musicBlockedReason}
						</p>
					{:else}
						<p class="mt-1.5 text-xs text-[var(--color-text-muted)]">
							Music dips under narration automatically · apply above to re-stitch as a new version.
						</p>
					{/if}
				</section>
			</div>

			<!-- Inspector -->
			<div class="lg:sticky lg:top-4">
				{#if selectedClip}
					<Sheet
						open
						title={`Clip #${selectedClip.index + 1}`}
						class="rounded-[var(--radius-lg)] border !border-[var(--color-border)]"
					>
						<ClipInspector
							clip={selectedClip}
							annotations={annList}
							onAddNote={clipStage ? addNote : undefined}
							onDismissNote={clipStage ? dismissNote : undefined}
							onRegenerate={clipStage ? regenerateClip : undefined}
							{clipActionsBlockedReason}
							{regenerating}
							leadSeconds={selectedLead}
							anchor={selectedAnchor}
							caption={selectedCaption}
							fit={selectedFit}
							speed={selectedSpeed}
							transition={selectedTransition}
							adjust={selectedAdjust}
							overlays={selectedOverlays}
							audio={selectedAudio}
							audioUrl={selectedAudioUrl}
							audioSeconds={selectedAudioSeconds}
							narrationText={selectedClip.narration}
							onRenarrate={clipStage ? renarrateClip : undefined}
							onEditChange={editGates.canSaveClipEdits
								? (field, value, targetClipId) =>
										handleEditChange(
											// An async emitter (the voiceover upload) addresses its edit to the
											// clip it STARTED on. Resolving against the live `selectedClip` would
											// land clip A's upload on clip B if the user switched while it was
											// in flight — silently replacing B's narration with A's audio.
											(targetClipId ? clips.find((c) => c.id === targetClipId) : null) ??
												selectedClip,
											field,
											value
										)
								: undefined}
						/>
					</Sheet>
				{:else}
					<div
						class="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]"
					>
						Select a clip to review it and leave feedback.
					</div>
				{/if}
			</div>
		</div>
	{/if}
</Page>

<!-- The whole-run regenerate posts `regenerate {}` — the body the restart plan
     previews — so the person sees which finished steps are kept (unchanged ones)
     and which run again (edited, fed back, or affected by a changed setting). -->
<RestartRunModal
	bind:open={showRegenerateModal}
	{runId}
	loading={regeneratingRun}
	onconfirm={regenerateRun}
	title="Make a new version?"
	intro="Starts a new paid run of this video. Finished steps that your changes don't affect are kept; the rest run again."
	confirmLabel="Make new version"
/>

<RegenerateRunModal
	bind:open={showFullRerunConfirm}
	loading={regeneratingRun}
	onconfirm={regenerateRun}
	title="This pipeline can't regenerate a single clip"
	description="Applying your feedback here re-renders the WHOLE video as a new version. That is a full paid run: every stage from the first one with feedback onward runs again, and the new run stops at its review checkpoints for your approval before it finishes."
	confirmLabel="Re-render full video"
/>

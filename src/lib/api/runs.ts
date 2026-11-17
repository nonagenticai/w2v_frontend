import type { components } from './types.gen';
import type {
	RunDetail,
	RunStart,
	RunStatusLite,
	RunSummary,
	StageOutputResponse
} from '$lib/types/runs';
import { api } from './client.js';

type Schemas = components['schemas'];
export type CheckpointsResponse = Schemas['CheckpointsResponse'];
export type CheckpointsUpdate = Schemas['CheckpointsUpdate'];
export type RegenerateClip = Schemas['RegenerateClip'];
export type RegenerateRequest = Schemas['RegenerateRequest'];
export type RestartPlanResponse = Schemas['RestartPlanResponse'];
export type RestartPlanStage = Schemas['RestartPlanStage'];
export type RestartPlanReason = Schemas['RestartPlanReason'];
export type Renarrate = Schemas['Renarrate'];
export type ReorderClips = Schemas['ReorderClips'];
export type StageElementPatch = Schemas['StageElementPatch'];
export type StageElementRestamp = Schemas['StageElementRestamp'];

// Per-clip edit overrides, DERIVED from the generated OpenAPI schema.
//
// These were hand-mirrored, with a comment saying so "until `bun run codegen`
// bumps `types.gen.ts`". That bump has since happened, and the mirror was never
// reconciled, so it had drifted from the contract it claims to mirror: it was
// missing `clip_out_seconds` entirely, its `clip_anchor` lacked the `'auto'`
// variant the backend accepts, and it referenced `ClipAdjust`/`ClipOverlay`
// where the wire types are `ColorAdjust`/`TextOverlay`. `type-drift-check.ts`
// could not see any of that — it compares NAMES, not shapes, and these sat in
// its allowlist.
//
// Deriving is what makes the drift impossible rather than merely fixed.
// `OverlayPosition` below already used this pattern for exactly that reason.
//
// `Partial<>` is deliberate throughout, and is the one place these types should
// NOT match the wire types exactly. Everything here is a PATCH payload: omitting
// a field means "leave unchanged", an explicit `null` clears an override. The
// generated schemas mark `speed`, the four grade scalars, the four ClipAudio
// knobs and `TextOverlay.position` as required because each carries a
// SERVER-SIDE default — so requiring them here would force every caller to
// restate values it does not mean to change. `text` is the one genuinely
// required overlay field: an overlay without text is not an overlay.
export type ClipTransition = Schemas['ClipTransition'];
export type ClipAdjust = Partial<Schemas['ColorAdjust']>;
export type ClipOverlay = Partial<Schemas['TextOverlay']> & { text: string };
export type ClipAudio = Partial<Schemas['ClipAudio']>;

// The nine-grid anchor for a text overlay. Sourced from the generated OpenAPI type
// so it can NEVER drift from the orchestrator's strict `TextOverlay.position`
// Literal — a mismatch (e.g. the old UI value 'center' vs the server's
// 'middle-center') is a 422 at apply-edits time, so it must be a COMPILE error here.
export type OverlayPosition = NonNullable<Schemas['TextOverlay']['position']>;

// The nested overrides re-state `adjust` / `overlays` / `audio` as the partial
// patch shapes above. `Partial<>` alone makes the KEYS optional but leaves each
// VALUE as the strict generated schema, so `{ contrast: 1.1 }` — a user nudging
// one slider — would not type-check even though it is exactly what the wire
// accepts (every one of those fields has a server-side default).
export type ClipEdit = Omit<Partial<Schemas['ClipEdit']>, 'adjust' | 'overlays' | 'audio'> & {
	adjust?: ClipAdjust | null;
	overlays?: ClipOverlay[] | null;
	audio?: ClipAudio | null;
};

/** The anchor a clip's lead-in is measured from. Includes `'auto'`, which the
 *  backend has accepted since the ApplyClipEdits contract landed — the previous
 *  hand-written union omitted it, so the UI could not express it at all. */
export type ClipAnchor = NonNullable<Schemas['ClipEdit']['clip_anchor']>;

// Run-level music-bed override. `track` is a sound-catalog music id (or null/'' =
// music off). Merged into the run's sound_effects on the re-stitch.
export interface MusicEdit {
	track: string | null;
	gain_db?: number | null;
	fade_in_s?: number | null;
	fade_out_s?: number | null;
	// How deep the music dips under narration (dB, <= 0). 0 = no duck.
	duck_db?: number | null;
}
export interface ApplyClipEdits {
	stage_name: string;
	edits: Record<string, ClipEdit>;
	music?: MusicEdit;
}

export const runs = {
	start(
		deliverableId: string,
		body: RunStart = {},
		opts?: { idempotencyKey?: string }
	): Promise<RunSummary> {
		return api.post<RunSummary>(`/deliverables/${deliverableId}/runs`, body, opts);
	},

	get(runId: string, opts?: { signal?: AbortSignal }): Promise<RunDetail> {
		return api.get<RunDetail>(`/runs/${runId}`, opts);
	},

	// Lightweight status projection for the live-monitor safety-net poll:
	// run status + per-stage lifecycle state, WITHOUT the heavy stage `output`
	// blobs / config_snapshot / usage that `get()` ships. Polling the full
	// detail every few seconds grew with each completed stage and froze the
	// browser on long runs; this stays flat regardless of run length.
	getStatus(runId: string, opts?: { signal?: AbortSignal }): Promise<RunStatusLite> {
		return api.get<RunStatusLite>(`/runs/${runId}/status`, opts);
	},

	cancel(runId: string): Promise<void> {
		return api.post<void>(`/runs/${runId}/cancel`);
	},

	pause(runId: string): Promise<void> {
		return api.post<void>(`/runs/${runId}/pause`);
	},

	resume(runId: string): Promise<void> {
		return api.post<void>(`/runs/${runId}/resume`);
	},

	ancestors(runId: string): Promise<RunSummary[]> {
		return api.get<RunSummary[]>(`/runs/${runId}/ancestors`);
	},

	/** Newest-first. The backend pages this list (default 50, max 200), so a
	 *  caller that needs more than one page must pass `offset`. `onTotal` receives
	 *  the project's TOTAL run count from the `X-Total-Count` header
	 *  (w2v_orchestrator#1116), or null when the header is absent/unparseable — the
	 *  body stays a bare array, so the count can only ride a header. */
	listForProject(
		projectId: string,
		page?: { limit?: number; offset?: number; onTotal?: (total: number | null) => void }
	): Promise<RunSummary[]> {
		const qs = new URLSearchParams();
		if (page?.limit !== undefined) qs.set('limit', String(page.limit));
		if (page?.offset) qs.set('offset', String(page.offset));
		const q = qs.toString();
		const onTotal = page?.onTotal;
		return api.get<RunSummary[]>(
			`/projects/${projectId}/runs${q ? `?${q}` : ''}`,
			onTotal ? { onHeaders: (h) => onTotal(parseTotalCount(h.get('X-Total-Count'))) } : undefined
		);
	},

	// What `regenerate(runId, {})` (Restart / Rerun) — or, with `fromStage`,
	// `regenerate(runId, {from_stage})` ("Rerun from here") — would reuse and re-run
	// RIGHT NOW, per stage, with the reasons. Read-only; 409
	// `restart_plan_unavailable` for a run that is still active (and, without
	// `fromStage`, for a paused one: resume it).
	restartPlan(runId: string, fromStage?: string | null): Promise<RestartPlanResponse> {
		const q = fromStage ? `?from_stage=${encodeURIComponent(fromStage)}` : '';
		return api.get<RestartPlanResponse>(`/runs/${runId}/restart-plan${q}`);
	},

	regenerate(
		runId: string,
		body: RegenerateRequest = {},
		opts?: { idempotencyKey?: string }
	): Promise<RunSummary> {
		return api.post<RunSummary>(`/runs/${runId}/regenerate`, body, opts);
	},

	// Rearrange the clip timeline and re-stitch the video as a new child run.
	// `stageName` is the run's clip-spine stage; `orderedElementIds` is the full
	// set of that stage's clip ids in the desired new order. The child re-runs
	// only the compile stage, reusing every generated clip asset.
	reorderClips(
		runId: string,
		stageName: string,
		orderedElementIds: string[],
		opts?: { idempotencyKey?: string }
	): Promise<RunSummary> {
		const body: ReorderClips = {
			stage_name: stageName,
			ordered_element_ids: orderedElementIds
		};
		return api.post<RunSummary>(`/runs/${runId}/reorder-clips`, body, opts);
	},

	// Apply per-clip edits (trim / anchor) and re-stitch the video as a new child
	// run. `stageName` is the run's clip-spine stage; `edits` maps clip id → the
	// override fields to merge onto that clip. The child re-runs only the compile
	// stage, reusing every generated clip asset — same machinery as `reorderClips`.
	applyClipEdits(
		runId: string,
		stageName: string,
		edits: Record<string, ClipEdit>,
		music?: MusicEdit,
		opts?: { idempotencyKey?: string }
	): Promise<RunSummary> {
		const body: ApplyClipEdits = { stage_name: stageName, edits };
		if (music) body.music = music;
		return api.post<RunSummary>(`/runs/${runId}/apply-edits`, body, opts);
	},

	// Regenerate a SINGLE clip's image and re-stitch as a new child run. Preserves
	// the spine verbatim (siblings untouched) and re-runs only the per-clip image
	// stage onward, folding this clip's open feedback into just its prompt. The
	// route 422s when the pipeline can't target one clip surgically (no per-clip
	// image stage, static prompts, no line_id, or no open feedback) — callers fall
	// back to `regenerate`.
	regenerateClip(
		runId: string,
		stageName: string,
		elementId: string,
		opts?: { idempotencyKey?: string }
	): Promise<RunSummary> {
		const body: RegenerateClip = {
			stage_name: stageName,
			element_id: elementId
		};
		return api.post<RunSummary>(`/runs/${runId}/regenerate-clip`, body, opts);
	},

	// Re-narrate a SINGLE line — new text and/or a new voice — and re-stitch as a
	// new child run. Same shape as `regenerateClip`: it re-synthesizes EXACTLY that
	// one TTS clip (every sibling clip's audio is reused verbatim) and re-runs only
	// the compile stage. At least one of `narrationText` / `voice` must be given or
	// the route 422s (a no-op that would still burn a TTS call); it also 422s when
	// the clip already carries an uploaded voiceover, which would win over the new
	// TTS at compile time and make the re-narrate silently inaudible.
	renarrateClip(
		runId: string,
		stageName: string,
		elementId: string,
		change: { narrationText?: string | null; voice?: string | null },
		opts?: { idempotencyKey?: string }
	): Promise<RunSummary> {
		const body: Renarrate = {
			stage_name: stageName,
			element_id: elementId
		};
		// Omitted (not null): the backend reads an omitted field as "keep the
		// current line / the run's configured voice".
		if (change.narrationText != null) body.narration_text = change.narrationText;
		if (change.voice) body.voice = change.voice;
		return api.post<RunSummary>(`/runs/${runId}/renarrate-clip`, body, opts);
	},

	stages: {
		output(runId: string, stageName: string): Promise<StageOutputResponse> {
			return api.get<StageOutputResponse>(`/runs/${runId}/stages/${stageName}/output`);
		},
		patchElement(
			runId: string,
			stageName: string,
			elementId: string,
			body: StageElementPatch
		): Promise<StageOutputResponse> {
			return api.patch<StageOutputResponse>(
				`/runs/${runId}/stages/${stageName}/elements/${elementId}`,
				body
			);
		},
		restampElement(
			runId: string,
			stageName: string,
			elementId: string,
			body: StageElementRestamp
		): Promise<StageOutputResponse> {
			return api.post<StageOutputResponse>(
				`/runs/${runId}/stages/${stageName}/elements/${elementId}/restamp`,
				body
			);
		}
	},

	checkpoints: {
		get(runId: string): Promise<CheckpointsResponse> {
			return api.get<CheckpointsResponse>(`/runs/${runId}/checkpoints`);
		},
		patch(runId: string, pauseAfterStages: string[] | null): Promise<CheckpointsResponse> {
			const body: CheckpointsUpdate = { pause_after_stages: pauseAfterStages ?? [] };
			return api.patch<CheckpointsResponse>(`/runs/${runId}/checkpoints`, body);
		}
	}
};

/** `X-Total-Count` → a non-negative integer, or null when absent/garbage. */
export function parseTotalCount(raw: string | null | undefined): number | null {
	if (raw == null || !/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw.trim());
	return Number.isSafeInteger(n) ? n : null;
}

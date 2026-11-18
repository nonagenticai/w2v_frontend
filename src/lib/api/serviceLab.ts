/**
 * Service test bench API client — `/api/services/*`.
 *
 * The types below are ALIASES of the published contract, not hand-written
 * copies: `ServiceRunView` / `ServiceRunHistory` / `ServiceProviderView` /
 * `ServiceErrorView` have been in the orchestrator's OpenAPI since the bench
 * shipped (verified against `@nonagentic/w2v-orchestrator-openapi@latest`,
 * 11 `/api/services/*` paths), so a backend rename fails `bun run check`
 * instead of at runtime. That runtime failure is not hypothetical here — this
 * repo has already eaten one `job_id` vs `run_id` drift.
 *
 * Endpoints (client prefixes `/api`):
 *   POST /services/{slot}            JSON for image/tts/llm/video,
 *                                    multipart for asr/vlm/ocr
 *   POST /services/enhance           {prompt, target} -> {prompt}   (60 s)
 *   GET  /services/{slot}/history?limit=24 -> { items: ServiceRun[] }
 *   GET  /services/{slot}/history/{id}     -> ServiceRun
 *   GET  /services/{slot}/history/{id}/media -> bytes
 */
import { ApiError, api, scopedMediaUrl } from './client.js';
import { parseByoProviderRequired } from './byo-provider.js';
import type { components } from './types.gen.js';
import type { EnhanceTarget, OutputKind, SlotId } from '$lib/services/slots.js';

type Schemas = components['schemas'];

export type ServiceProvider = Schemas['ServiceProviderView'];
export type ServiceRunFailure = Schemas['ServiceErrorView'];

/** One transcript segment. OPTIONAL: the wire schema does not carry it yet (the
 *  ASR segment half has not landed), so the renderer draws segments when
 *  present and the plain `text` otherwise. */
export interface TranscriptSegment {
	start: number;
	end: number;
	text: string;
}

/**
 * `ServiceRunView`, with the three fields this client narrows.
 *
 * The generated schema types `slot` / `status` / `output_kind` as plain
 * `string` (the backend's response models do not declare enums), so aliasing it
 * directly would break every `seg(run.slot)` and `run.status === 'failed'` call
 * site. `Omit` + re-declare keeps every OTHER field tied to the contract while
 * restoring the narrowing the UI needs. `segments` is a frontend-only extension
 * and is marked as such.
 */
export type ServiceRun = Omit<Schemas['ServiceRunView'], 'slot' | 'status' | 'output_kind'> & {
	slot: SlotId;
	status: 'succeeded' | 'failed';
	output_kind: OutputKind | null;
	segments?: TranscriptSegment[] | null;
};

/** `ServiceRunHistory` with its `items` narrowed to {@link ServiceRun}. */
export type ServiceRunHistoryPage = Omit<Schemas['ServiceRunHistory'], 'items'> & {
	items: ServiceRun[];
};

/**
 * Wall-clock budget per slot. The client default is 30 s, which a real image
 * render already outgrows; a video render can run for minutes.
 *
 * Each value sits ABOVE the orchestrator's own budget for the same route
 * (`service_lab.py::_TIMEOUT_SECONDS`: image 180 s, video 300 s, the rest
 * 120 s) plus its store-and-persist tail, so the backend's answer — 200, or
 * its mapped 502/503/504 — always arrives before the browser gives up. Equal
 * values (the old image 180/180 and 120/120) raced: the client could abort at
 * the exact instant the server was about to answer.
 */
export const RUN_TIMEOUT_MS: Record<SlotId, number> = {
	image: 240_000,
	video: 600_000,
	tts: 180_000,
	asr: 180_000,
	llm: 180_000,
	vlm: 180_000,
	ocr: 180_000
};

/** Enhancing is one fast text call — deliberately much shorter than a run. */
export const ENHANCE_TIMEOUT_MS = 60_000;

/** How many past runs the history list asks for. */
export const HISTORY_LIMIT = 24;

const seg = (slot: SlotId): string => encodeURIComponent(slot);

export const serviceLab = {
	/** A JSON-body run (image, tts, llm, video). */
	run(slot: SlotId, body: Record<string, unknown>): Promise<ServiceRun> {
		return api.post<ServiceRun>(`/services/${seg(slot)}`, body, {
			timeoutMs: RUN_TIMEOUT_MS[slot]
		});
	},
	/** A multipart run (asr, vlm, ocr). */
	runForm(slot: SlotId, form: FormData): Promise<ServiceRun> {
		return api.postForm<ServiceRun>(`/services/${seg(slot)}`, form, RUN_TIMEOUT_MS[slot]);
	},
	history(slot: SlotId, limit: number = HISTORY_LIMIT): Promise<ServiceRunHistoryPage> {
		return api.get<ServiceRunHistoryPage>(`/services/${seg(slot)}/history?limit=${limit}`);
	},
	historyRun(slot: SlotId, id: string): Promise<ServiceRun> {
		return api.get<ServiceRun>(`/services/${seg(slot)}/history/${encodeURIComponent(id)}`);
	},
	/** Rewrite a prompt. Never starts a run — the user still presses submit. */
	enhance(prompt: string, target: EnhanceTarget): Promise<{ prompt: string }> {
		return api.post<{ prompt: string }>(
			'/services/enhance',
			{ prompt, target },
			{ timeoutMs: ENHANCE_TIMEOUT_MS }
		);
	}
};

/**
 * Same-origin URL for a run's output bytes. Browser-initiated, so the super-admin
 * tenant switch rides the `active_tenant` query param via `scopedMediaUrl`.
 * Falls back to the media route when a run omits `media_url`.
 */
export function runMediaUrl(run: ServiceRun): string | null {
	const path = run.media_url ?? `/api/services/${seg(run.slot)}/history/${run.id}/media`;
	const scoped = scopedMediaUrl(path);
	return typeof scoped === 'string' ? scoped : null;
}

/** "Platform default · stub" — who actually served the run. */
export function providerLabel(provider: ServiceProvider | null | undefined): string {
	if (!provider) return 'Provider unknown';
	const source = provider.source === 'tenant' ? 'Your connection' : 'Platform default';
	return [source, provider.kind, provider.model].filter(Boolean).join(' · ');
}

/**
 * True when the serving provider is a stub — the platform's current video path
 * (`VIDEO_PROVIDER=stub`) returns a placeholder render, and the page must say so
 * rather than present it as a real generation.
 */
export function isStubProvider(provider: ServiceProvider | null | undefined): boolean {
	if (!provider) return false;
	const marks = [provider.kind, provider.model];
	return marks.some((m) => typeof m === 'string' && m.toLowerCase().includes('stub'));
}

/** The prompt (or narration) a run was asked for, for the result + history rows. */
export function runPrompt(run: ServiceRun): string {
	const value = run.request?.prompt ?? run.request?.text;
	return typeof value === 'string' && value.trim() ? value.trim() : '—';
}

export type ServiceErrorKind =
	'byo' | 'unavailable' | 'invalid' | 'rate_limited' | 'upstream' | 'busy' | 'timeout' | 'other';

export interface ServiceLabError {
	kind: ServiceErrorKind;
	/** Sentence to render as-is. */
	message: string;
	status: number | null;
	code: string | undefined;
	/** Seconds the server asked us to wait (429/503), else null. */
	retryAfterSeconds: number | null;
	/** 402 `byo_provider_required` and "no provider configured" refusals link to /providers. */
	showProviders: boolean;
}

function retryAfterOf(err: unknown): number | null {
	if (!err || typeof err !== 'object') return null;
	const rec = err as { retryAfter?: unknown; details?: Record<string, unknown> };
	const fromDetails = rec.details?.retry_after;
	if (typeof fromDetails === 'number' && Number.isFinite(fromDetails) && fromDetails >= 0) {
		return Math.ceil(fromDetails);
	}
	if (
		typeof rec.retryAfter === 'number' &&
		Number.isFinite(rec.retryAfter) &&
		rec.retryAfter >= 0
	) {
		return Math.ceil(rec.retryAfter);
	}
	return null;
}

function retryCopy(lead: string, seconds: number | null): string {
	return seconds !== null ? `${lead} — try again in ${seconds} s.` : `${lead} — try again shortly.`;
}

/**
 * Map a refused/failed service call to copy a human can act on. Screens render
 * `message` verbatim and show the Providers link when `showProviders` is true.
 * A 409 on the video slot is the documented "no renderer on this deployment"
 * answer, and is worded as such instead of as a generic upstream fault.
 */
export function serviceLabError(
	err: unknown,
	opts: { slot?: SlotId; fallback?: string } = {}
): ServiceLabError {
	const fallback = opts.fallback ?? 'The service call failed.';
	const apiError = err instanceof ApiError ? err : null;
	const status =
		apiError?.status ??
		(err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
			? (err as { status: number }).status
			: null);
	const code = apiError?.code;
	const detail = apiError?.detail || (err instanceof Error ? err.message : '');
	const retryAfterSeconds = retryAfterOf(err);
	const base = { status, code, retryAfterSeconds, showProviders: false };

	if (status === 402) {
		const required = apiError ? parseByoProviderRequired(apiError.details) : null;
		return {
			...base,
			kind: 'byo',
			showProviders: true,
			message:
				required?.message ??
				detail ??
				'This workspace must configure its own provider for this service.'
		};
	}
	if (status === 409) {
		// One code for both cases: the edge answers 409 `provider_unavailable` when a
		// slot has no usable provider — for `video` that is ACG having registered no
		// renderer, which deserves the explicit sentence below.
		const noVideo = opts.slot === 'video';
		return {
			...base,
			kind: 'unavailable',
			showProviders: true,
			message: noVideo
				? 'No video renderer is configured on this deployment.'
				: detail || 'No provider is configured for this service on this deployment.'
		};
	}
	if (status === 422) {
		// Two shapes land here: the orchestrator's own `invalid_service_input`
		// refusal (a PNG posted to /asr, a blank prompt) and FastAPI's request
		// validation. `detail` is already reduced to a sentence by the client, so
		// the same copy serves both — and neither is an "internal error".
		return {
			...base,
			kind: 'invalid',
			message: detail
				? `The service rejected these inputs: ${detail}`
				: 'The service rejected these inputs.'
		};
	}
	if (status === 429) {
		return {
			...base,
			kind: 'rate_limited',
			message: retryCopy('Too many requests', retryAfterSeconds)
		};
	}
	if (status === 502) {
		return {
			...base,
			kind: 'upstream',
			message: detail ? `The provider failed: ${detail}` : 'The provider failed to answer.'
		};
	}
	if (status === 503) {
		return { ...base, kind: 'busy', message: retryCopy('The service is busy', retryAfterSeconds) };
	}
	if (status === 504 || detail === 'request_timeout') {
		return {
			...base,
			kind: 'timeout',
			message: 'The provider took too long to answer. Try again, or ask for a smaller job.'
		};
	}
	return { ...base, kind: 'other', message: detail || fallback };
}

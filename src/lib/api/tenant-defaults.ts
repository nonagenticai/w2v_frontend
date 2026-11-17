/**
 * Tenant production defaults (P6 FE-1) — `/api/tenant/defaults`.
 *
 * GET is open to every MEMBER (the create-project wizard prefills from it); PUT is
 * tenant_admin only and REPLACES the whole document, guarded by `expected_version`
 * (`0` = never saved) → 409 `VERSION_CONFLICT` on a stale editor. Every field is
 * nullable: `null` = "use the deployment default", and `deployment` says what that
 * default is. A run pins the defaults at creation, so a save never changes a run
 * that already exists.
 *
 * There is NO logo field: the API refuses `brand.logo_key` (`extra="forbid"`) — no
 * stage draws a logo. `voice.voice_id` must be a voice the tenant's narration path
 * accepts (kokoro `VOICE_CATALOG` unless the tenant has an active `tts` connection),
 * else 422 `UNKNOWN_VOICE`.
 *
 * TYPES LEAD THE BACKEND BY ONE CODEGEN CYCLE: the then-pinned
 * `@nonagentic/w2v-orchestrator-openapi` package predates these routes, so the wire
 * shapes are hand-mirrored here from the orchestrator schemas
 * (`src/api/schemas/tenant_defaults.py`, P6 ORCH-1) under names that do NOT collide
 * with the generated ones (type-drift-check rule 2). On the next codegen bump, replace
 * each with an alias: `TenantDefaultsWire` → `Schemas['TenantDefaultsView']`,
 * `TenantDefaultsWrite` → `Schemas['TenantDefaultsPut']`, `DeploymentFallbacks` →
 * `Schemas['DeploymentDefaults']`, `DefaultVoice` → `Schemas['VoiceDefaults']`, etc.
 */

import { api, ApiError } from './client.js';

export type CaptionsModeValue = 'none' | 'burned_in' | 'overlay';
export type RetentionModeValue = 'auto' | 'critique_only' | 'off';
/** The inference-router tier aliases the API accepts (`TimingDirectorTier`). */
export type TimingDirectorTierValue = 'tier-flash' | 'tier-medium' | 'tier-high';

export const RETENTION_MODES: readonly RetentionModeValue[] = ['auto', 'critique_only', 'off'];
export const TIMING_DIRECTOR_TIERS: readonly TimingDirectorTierValue[] = [
	'tier-flash',
	'tier-medium',
	'tier-high'
];
export const CAPTIONS_MODES: readonly CaptionsModeValue[] = ['none', 'burned_in', 'overlay'];

/** `VoiceDefaults`. `speed` 0.5–2.0; `voice_id` 1–128 chars. */
export interface DefaultVoice {
	voice_id?: string | null;
	speed?: number | null;
}
/** `BrandDefaults`. Colors are `#rgb` / `#rrggbb`. No logo (refused by the API). */
export interface DefaultBrand {
	primary_color?: string | null;
	secondary_color?: string | null;
	font_family?: string | null;
}
/** `CaptionsDefaults`. */
export interface DefaultCaptions {
	mode?: CaptionsModeValue | null;
	karaoke?: boolean | null;
}
/** `VoiceDirectionDefaults`. `tone` 1–64 chars. */
export interface DefaultVoiceDirection {
	tone?: string | null;
}
/** `ModelTierDefaults`. */
export interface DefaultModelTier {
	timing_director?: TimingDirectorTierValue | null;
}

/** `TenantDefaultsDocument` — the settings document (GET view and PUT body share it). */
export interface TenantDefaultsFields {
	voice?: DefaultVoice | null;
	brand?: DefaultBrand | null;
	captions?: DefaultCaptions | null;
	voice_direction?: DefaultVoiceDirection | null;
	retention_mode?: RetentionModeValue | null;
	model_tier?: DefaultModelTier | null;
}

/** `DeploymentDefaults` — what applies where the tenant leaves a field null (read-only). */
export interface DeploymentFallbacks {
	voice_id?: string | null;
	captions_mode: CaptionsModeValue;
	captions_karaoke: boolean;
	voice_direction_tone: string | null;
	retention_mode: RetentionModeValue | null;
	timing_director_model_tier: string | null;
}

/** `TenantDefaultsView` — GET / PUT response. `version` 0 = never saved. */
export interface TenantDefaultsWire extends TenantDefaultsFields {
	version: number;
	updated_at?: string | null;
	updated_by?: string | null;
	deployment: DeploymentFallbacks;
}

/** `TenantDefaultsPut` — the whole document + the version the editor loaded. */
export interface TenantDefaultsWrite extends TenantDefaultsFields {
	expected_version: number;
}

export const tenantDefaults = {
	/** Any member. */
	get(): Promise<TenantDefaultsWire> {
		return api.get<TenantDefaultsWire>('/tenant/defaults');
	},
	/** tenant_admin. Replaces the document; 409 VERSION_CONFLICT on a stale version. */
	put(body: TenantDefaultsWrite): Promise<TenantDefaultsWire> {
		return api.put<TenantDefaultsWire>('/tenant/defaults', body);
	}
};

// ---------------------------------------------------------------------------
// Form model — every control is a string; '' means "deployment default" (null).
// ---------------------------------------------------------------------------

export interface TenantDefaultsForm {
	voiceId: string;
	speed: string;
	primaryColor: string;
	secondaryColor: string;
	fontFamily: string;
	captionsMode: '' | CaptionsModeValue;
	/** '' = deployment default, 'on' / 'off' = explicit. */
	karaoke: '' | 'on' | 'off';
	tone: string;
	retentionMode: '' | RetentionModeValue;
	timingDirector: '' | TimingDirectorTierValue;
}

const s = (v: string | number | null | undefined): string => (v == null ? '' : String(v));

export function formFromDefaults(view: TenantDefaultsFields): TenantDefaultsForm {
	const karaoke = view.captions?.karaoke;
	return {
		voiceId: s(view.voice?.voice_id),
		speed: s(view.voice?.speed),
		primaryColor: s(view.brand?.primary_color),
		secondaryColor: s(view.brand?.secondary_color),
		fontFamily: s(view.brand?.font_family),
		captionsMode: view.captions?.mode ?? '',
		karaoke: karaoke == null ? '' : karaoke ? 'on' : 'off',
		tone: s(view.voice_direction?.tone),
		retentionMode: view.retention_mode ?? '',
		timingDirector: view.model_tier?.timing_director ?? ''
	};
}

// `v` is typed string, but a Svelte `bind:value` on `<input type="number">` writes a
// NUMBER (or null when cleared) — coerce instead of trusting the type.
const blank = (v: string | number | null | undefined): string | null => {
	const t = v == null ? '' : String(v).trim();
	return t === '' ? null : t;
};

/** A block with every field null is sent as `null` (the API stores "all null" as no default). */
function block<T extends object>(fields: T): T | null {
	return Object.values(fields).every((v) => v === null) ? null : fields;
}

export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Client-side checks that mirror the API's schema rules (the API stays the authority). */
export function validateDefaultsForm(form: TenantDefaultsForm): Record<string, string> {
	const errors: Record<string, string> = {};
	const speed = blank(form.speed);
	if (speed !== null) {
		const n = Number(speed);
		if (!Number.isFinite(n) || n < 0.5 || n > 2) errors.speed = 'Speed must be 0.5 – 2.0.';
	}
	for (const key of ['primaryColor', 'secondaryColor'] as const) {
		const c = blank(form[key]);
		if (c !== null && !HEX_COLOR.test(c)) errors[key] = 'Use a hex color like #4F46E5.';
	}
	if ((blank(form.voiceId) ?? '').length > 128) errors.voiceId = 'At most 128 characters.';
	if ((blank(form.fontFamily) ?? '').length > 128) errors.fontFamily = 'At most 128 characters.';
	if ((blank(form.tone) ?? '').length > 64) errors.tone = 'At most 64 characters.';
	return errors;
}

export function bodyFromForm(
	form: TenantDefaultsForm,
	expectedVersion: number
): TenantDefaultsWrite {
	const speed = blank(form.speed);
	return {
		expected_version: expectedVersion,
		voice: block({ voice_id: blank(form.voiceId), speed: speed === null ? null : Number(speed) }),
		brand: block({
			primary_color: blank(form.primaryColor),
			secondary_color: blank(form.secondaryColor),
			font_family: blank(form.fontFamily)
		}),
		captions: block({
			mode: form.captionsMode === '' ? null : form.captionsMode,
			karaoke: form.karaoke === '' ? null : form.karaoke === 'on'
		}),
		voice_direction: block({ tone: blank(form.tone) }),
		retention_mode: form.retentionMode === '' ? null : form.retentionMode,
		model_tier: block({ timing_director: form.timingDirector === '' ? null : form.timingDirector })
	};
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface DefaultsErrorInfo {
	code: string | undefined;
	message: string;
	/** `reload`: the stored version moved on (409) — re-read before editing again. */
	action: 'reload' | null;
	/** The form field the error belongs to, when it is about one field. */
	field: keyof TenantDefaultsForm | null;
}

export function tenantDefaultsError(err: unknown): DefaultsErrorInfo {
	if (!(err instanceof ApiError)) {
		return {
			code: undefined,
			message: err instanceof Error ? err.message : 'Something went wrong.',
			action: null,
			field: null
		};
	}
	if (err.code === 'VERSION_CONFLICT' || err.status === 409) {
		return {
			code: err.code,
			message:
				'Someone else changed these defaults while you were editing. The latest values have been loaded — re-apply your change and save again.',
			action: 'reload',
			field: null
		};
	}
	if (err.status === 403) {
		return {
			code: err.code,
			message: 'Only a workspace admin can change the defaults.',
			action: null,
			field: null
		};
	}
	// UNKNOWN_VOICE: show the API's own wording — it names the rule (catalog vs tenant TTS).
	return {
		code: err.code,
		message: err.detail,
		action: null,
		field: err.code === 'UNKNOWN_VOICE' ? 'voiceId' : null
	};
}

// ---------------------------------------------------------------------------
// Wizard prefill
// ---------------------------------------------------------------------------

export interface WizardPrefill {
	voiceId: string | null;
	speed: number | null;
	brandColor: string | null;
	/** The captions mode a deliverable gets when the user does not pick one. */
	captionsMode: CaptionsModeValue;
}

/** What the New Project wizard should start from: the tenant value, else null
 *  (keep the wizard's own default) — captions resolve to the deployment default. */
export function wizardPrefill(view: TenantDefaultsWire): WizardPrefill {
	return {
		voiceId: view.voice?.voice_id ?? null,
		speed: view.voice?.speed ?? null,
		brandColor: view.brand?.primary_color ?? null,
		captionsMode: view.captions?.mode ?? view.deployment.captions_mode
	};
}

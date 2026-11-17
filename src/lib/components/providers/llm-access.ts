/**
 * Tenant LLM access (licences `byo_mode`, app `w2v`) + per-slot "Used by"
 * presentation for the Providers page and the platform screens.
 *
 * Every model / GPU service (llm, vlm, tts, asr, image, ocr, video_gen) is a web
 * provider a tenant admin registers per service type. The mode — decided when the
 * tenant is provisioned (CommonPractice-style) — says whether the PLATFORM's own
 * providers may serve a slot the tenant has not registered. It applies to every
 * GPU / model slot alike.
 *
 * Pure module: no Svelte, no I/O — unit-tested in `llm-access.test.ts`.
 */
import type { LlmAccessMode, ProviderSlot, TenantLlmAccessView } from '$lib/api/providers.js';
import { ApiError } from '$lib/api/client.js';
import { GPU_SLOTS, isGpuSlot } from './provider-groups.js';

/** Every mode, in display order. All three are accepted by provision, approve and invite. */
export const LLM_ACCESS_MODES: readonly LlmAccessMode[] = [
	'local_allowed',
	'byo_required',
	'platform_only'
];

/** The one label per mode, shared by the banner and the super_admin selects. */
export const LLM_ACCESS_LABELS: Readonly<Record<LlmAccessMode, string>> = {
	local_allowed: 'Platform services allowed',
	byo_required: 'Own providers required',
	platform_only: 'Platform services only'
};

/** One-line hint per mode, shown under the selector. */
export const LLM_ACCESS_HINTS: Readonly<Record<LlmAccessMode, string>> = {
	local_allowed:
		'Falls back to the platform GPU / model services when the tenant has none registered.',
	byo_required:
		'The tenant must register every GPU / model service it uses; runs needing a missing one do not start.',
	platform_only: 'Tenant providers are disabled; every GPU / model service is the platform’s.'
};

/** Select options for the platform screens (tenants list, provision form). */
export const LLM_ACCESS_OPTIONS: ReadonlyArray<{ value: LlmAccessMode; label: string }> =
	LLM_ACCESS_MODES.map((m) => ({ value: m, label: LLM_ACCESS_LABELS[m] }));

/** Provisioning default: without an explicit mode licences would make the tenant byo_required. */
export const DEFAULT_LLM_ACCESS = 'local_allowed' satisfies LlmAccessMode;

export function isLlmAccessMode(v: unknown): v is LlmAccessMode {
	return typeof v === 'string' && (LLM_ACCESS_MODES as readonly string[]).includes(v);
}

/**
 * Slots whose tenant registration the server refuses (409 `tenant_byo_disabled`)
 * when the mode is `platform_only`, and which `byo_required` demands. The policy
 * covers every GPU / model slot, so this IS the GPU list — one source, no copy.
 */
export const BYO_LOCKABLE_SLOTS: readonly string[] = GPU_SLOTS;

export interface LlmAccessBanner {
	mode: LlmAccessMode;
	title: string;
	body: string;
	tone: 'info' | 'warning';
}

/** Banner copy for the tenant's mode; null when the server did not say (never guessed). */
export function llmAccessBanner(
	access: TenantLlmAccessView | null | undefined
): LlmAccessBanner | null {
	if (!access || !isLlmAccessMode(access.mode)) return null;
	const mode = access.mode;
	const title = LLM_ACCESS_LABELS[mode];
	switch (mode) {
		case 'local_allowed':
			return {
				mode,
				title,
				tone: 'info',
				body: 'Each GPU / model service below uses your own provider when you register one, and falls back to the platform service when you have not.'
			};
		case 'platform_only':
			return {
				mode,
				title,
				tone: 'info',
				body: 'This workspace uses the platform GPU / model services only. Registering your own providers is disabled for every service below; ask the platform operator to change the access mode.'
			};
		case 'byo_required':
			return {
				mode,
				title,
				tone: 'warning',
				body: 'This workspace must use its own providers: the platform GPU / model services are not available. Every service marked “Required — not registered” below must be registered before runs that use it can start.'
			};
	}
}

/** True when the mode forbids a tenant registration on this slot (the form is read-only). */
export function slotLockedByAccess(mode: LlmAccessMode | null | undefined, slot: string): boolean {
	return mode === 'platform_only' && BYO_LOCKABLE_SLOTS.includes(slot);
}

/** Read-only explanation shown on a locked slot. */
export const LOCKED_SLOT_REASON =
	'Platform services only: this workspace uses the platform service here. Tenant providers are disabled — the platform operator can change the access mode.';

/** True when the mode requires the tenant's own registration and this model slot has none. */
export function slotRequiredByAccess(
	mode: LlmAccessMode | null | undefined,
	slot: Pick<ProviderSlot, 'slot' | 'source' | 'connection'>
): boolean {
	if (mode !== 'byo_required' || !isGpuSlot(slot.slot)) return false;
	return !(slot.source === 'tenant' && slot.connection);
}

/** Which w2v work a slot serves, in plain language. */
export const SLOT_USED_BY: Readonly<Record<string, string>> = {
	llm: 'Scripts, storyboards, and course, slide and analysis text',
	vlm: 'Screenshot and video analysis',
	tts: 'Narration',
	asr: 'Transcription and captions',
	image: 'Generated images',
	ocr: 'Text extraction from documents and screenshots',
	video_gen: 'Generated video clips'
};

export function usedByText(slot: string): string | null {
	return SLOT_USED_BY[slot] ?? null;
}

/** True when licences says another app owns the tenant (w2v cannot manage its LLM access). */
export function isTenantNotOnboarded(err: unknown): boolean {
	return err instanceof ApiError && err.code?.toUpperCase() === 'TENANT_NOT_ONBOARDED';
}

/** Operator copy for a failed llm-access read/write; never swallows the server's reason. */
export function llmAccessErrorMessage(err: unknown, fallback: string): string {
	if (err instanceof ApiError) {
		const reason = err.detail ? `: ${err.detail}` : '.';
		switch (err.code?.toUpperCase()) {
			case 'LICENCES_REFUSED':
				return `The licences service refused the change${reason}`;
			case 'LICENCES_UNAVAILABLE':
				return `The licences service is unavailable — try again shortly${reason}`;
			case 'TENANT_NOT_FOUND':
				return 'This tenant is not known to the licences service.';
			case 'TENANT_NOT_ONBOARDED':
				return 'This tenant is managed by another app and is not onboarded to Studio.';
			default:
				return err.detail || fallback;
		}
	}
	return err instanceof Error && err.message ? err.message : fallback;
}

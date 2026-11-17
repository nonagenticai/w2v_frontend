/**
 * Provider connections API client (P3 WP5) — `/api/tenant/connections`.
 *
 * A tenant_admin brings its own provider per slot (`llm` is the only writable
 * slot in P3; the rest are listed as "platform provided"). Replaces the retired
 * `/api/llm-config` (WM BYO) surface.
 *
 * Secrets are WRITE-ONLY. A request may carry `secret` — absent = keep the
 * stored one (the client OMITS the key to keep; it never sends `null`), `""` = clear it, any other value = set it. No response carries the
 * secret or its ciphertext: only `has_secret` + the 12-hex `key_fingerprint`.
 *
 * Every type is an ALIAS of the generated schema (type-drift-check), so a backend
 * rename breaks the call sites instead of drifting silently. Errors arrive in the
 * canonical envelope with a STABLE `error.code`; screens branch on
 * `providerError(err).code`, never on message text.
 */

import { api, ApiError } from './client.js';
import type { components } from './types.gen.js';

type Schemas = components['schemas'];

export type SlotView = Schemas['SlotView'];
export type SlotList = Schemas['SlotList'];
export type ConnectionView = Schemas['ConnectionView'];
export type ConnectionDraft = Schemas['ConnectionDraft'];
export type ConnectionPut = Schemas['ConnectionPut'];
export type ConnectionTestResult = Schemas['ConnectionTestResult'];

/**
 * Tenant LLM-access posture (licences `byo_mode`, app `w2v`). The pinned OpenAPI
 * package predates these fields, so they are hand-written under names that do
 * NOT collide with any generated schema (type-drift-check); switch to aliases
 * once the orchestrator schema is regenerated.
 */
export type LlmAccessMode = 'local_allowed' | 'platform_only' | 'byo_required';
export interface TenantLlmAccessView {
	mode: LlmAccessMode;
	label?: string | null;
}
/** A slot as the Providers page holds it (the generated view). */
export type ProviderSlot = SlotView;
/** `GET /tenant/connections` with the tenant's LLM-access posture. */
export type ProviderSlotList = Omit<SlotList, 'items'> & {
	items: ProviderSlot[];
	llm_access?: TenantLlmAccessView | null;
};
/** `POST /tenant/connections/{slot}/models` body; `secret` omitted = use the stored key. */
export interface ModelListDraft {
	kind: string;
	base_url: string | null;
	secret?: string;
}
export interface ModelListResult {
	models: string[];
}

const seg = (slot: string): string => encodeURIComponent(slot);

export const providers = {
	/** One entry per registry slot, writable or not. */
	list(): Promise<ProviderSlotList> {
		return api.get<ProviderSlotList>('/tenant/connections');
	},
	/** Policy + SSRF + a LIVE test, then a new version. A failed test persists nothing (422). */
	save(slot: string, body: ConnectionPut): Promise<SlotView> {
		return api.put<SlotView>(`/tenant/connections/${seg(slot)}`, body);
	},
	/** Test a draft, or — with no draft — the stored current version. Always 200 + `ok`. */
	test(slot: string, draft?: ConnectionDraft): Promise<ConnectionTestResult> {
		return api.post<ConnectionTestResult>(`/tenant/connections/${seg(slot)}/test`, draft);
	},
	/** The provider's model ids (`GET {base}/models` server-side). 422 `models_unavailable` otherwise. */
	models(slot: string, draft: ModelListDraft): Promise<ModelListResult> {
		return api.post<ModelListResult>(`/tenant/connections/${seg(slot)}/models`, draft);
	},
	/** Soft delete: the slot falls back to the platform default. */
	remove(slot: string): Promise<void> {
		return api.delete<void>(`/tenant/connections/${seg(slot)}`);
	}
};

/** What the screen should do about an error, beyond showing the message. */
export type ProviderErrorAction = 'focus-secret' | 'reload' | null;

export interface ProviderErrorInfo {
	code: string | undefined;
	message: string;
	action: ProviderErrorAction;
	/** HTTP status the provider answered the live test with (PROVIDER_TEST_FAILED). */
	upstreamStatus: number | null;
	/** True when the fault is the platform's, not the tenant's configuration. */
	platformIssue: boolean;
	/** PROVIDER_TEST_RATE_LIMITED: seconds until Test/Save may be tried again
	 *  (`details.retry_after`, else the `Retry-After` header). Null otherwise. */
	retryAfterSeconds: number | null;
}

function retryAfterOf(err: ApiError): number | null {
	const v = err.details?.retry_after;
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.ceil(v);
	return err.retryAfter;
}

function upstreamStatusOf(details: Record<string, unknown> | undefined): number | null {
	const v = details?.upstream_status;
	return typeof v === 'number' ? v : null;
}

/** Map a save/test/remove error to user copy + the follow-up the screen owes. */
export function providerError(err: unknown, fallback = 'Something went wrong.'): ProviderErrorInfo {
	const base: ProviderErrorInfo = {
		code: undefined,
		message: fallback,
		action: null,
		upstreamStatus: null,
		platformIssue: false,
		retryAfterSeconds: null
	};
	if (!(err instanceof ApiError)) {
		return { ...base, message: err instanceof Error && err.message ? err.message : fallback };
	}
	const code = err.code;
	const server = err.detail || fallback;
	switch (code) {
		case 'PROVIDER_TEST_FAILED': {
			const upstreamStatus = upstreamStatusOf(err.details);
			const prefix =
				upstreamStatus !== null
					? `The provider rejected the test call (HTTP ${upstreamStatus})`
					: 'The test call to the provider failed';
			return { ...base, code, upstreamStatus, message: `${prefix}: ${server} Nothing was saved.` };
		}
		case 'SECRET_REENTRY_REQUIRED':
			return {
				...base,
				code,
				action: 'focus-secret',
				message:
					'You changed the provider or its endpoint, so the stored key cannot be reused — enter the API key again.'
			};
		case 'EGRESS_REFUSED':
			return {
				...base,
				code,
				message: `That base URL is not allowed from this deployment: ${server}`
			};
		case 'VERSION_CONFLICT':
			return {
				...base,
				code,
				action: 'reload',
				message:
					'This provider was changed somewhere else in the meantime. The latest settings were reloaded — review them and save again.'
			};
		case 'PROVIDER_KEYRING_UNAVAILABLE':
			return {
				...base,
				code,
				platformIssue: true,
				message:
					'Provider credentials cannot be stored on the platform right now. This is a platform issue, not your configuration — try again later or contact support.'
			};
		case 'PROVIDER_TEST_RATE_LIMITED': {
			const retryAfterSeconds = retryAfterOf(err);
			return {
				...base,
				code,
				retryAfterSeconds,
				message:
					retryAfterSeconds !== null
						? `Too many provider tests — try again in ${retryAfterSeconds} s.`
						: 'Too many provider tests — try again shortly.'
			};
		}
		case 'tenant_byo_disabled':
		case 'TENANT_BYO_DISABLED':
			return {
				...base,
				code,
				message:
					'This workspace is set to Platform services only: it uses the platform GPU / model services and tenant providers are disabled. Ask the platform operator to change the access mode.'
			};
		case 'models_unavailable':
		case 'MODELS_UNAVAILABLE': {
			const upstreamStatus = upstreamStatusOf(err.details);
			const status = upstreamStatus !== null ? ` (HTTP ${upstreamStatus})` : '';
			return {
				...base,
				code,
				upstreamStatus,
				message: `Couldn't load the provider's models${status}: ${server}`
			};
		}
		case 'SLOT_NOT_WRITABLE':
			return {
				...base,
				code,
				message: "This provider is platform provided and can't be changed per workspace."
			};
		case 'INVALID_BASE_URL':
			return {
				...base,
				code,
				message: `That base URL is not valid — use a full http(s) URL such as https://api.example.com/v1. (${server})`
			};
		case 'PROVIDER_KIND_NOT_ALLOWED':
			return {
				...base,
				code,
				message:
					'That provider type is not enabled for this deployment — choose another provider type.'
			};
		case 'BASE_URL_REQUIRED':
			return {
				...base,
				code,
				message:
					'This provider type needs a base URL — enter its endpoint, e.g. https://api.example.com/v1.'
			};
		case 'SECRET_UNREADABLE':
			return {
				...base,
				code,
				action: 'focus-secret',
				message: 'The stored key can no longer be read — enter the API key again.'
			};
		default:
			return { ...base, code, message: server };
	}
}

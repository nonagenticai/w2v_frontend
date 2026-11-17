/**
 * `byo_provider_required` — the orchestrator's refusal for a tenant whose licence
 * says `byo_mode=byo_required` but who has not configured its own provider for a
 * model-provider slot it needs (w2v_orchestrator#1106; every governed slot since #1150).
 *
 * It reaches the SPA on two channels, and this module is the ONE place that
 * recognises it on either, so no screen re-derives the shape:
 *
 *  - a failed run: `GET /api/runs/{id}` carries
 *    `failure_detail: {code, modality, slots, message}` (null on every other
 *    failure; `slots` = every missing slot comma-separated, `modality` = the first,
 *    w2v_orchestrator#1150);
 *  - a refused request: HTTP **402** whose structured detail is that same object
 *    (`POST /api/tts/preview`, the run-start preflight on start / regenerate /
 *    resume). The orchestrator's object-detail handler puts
 *    it in the canonical envelope at `error.details`; a bare FastAPI body has it at
 *    `detail`. Both are accepted.
 *
 * Deliberately free of imports from `client.ts` — the client imports this module
 * (a BYO 402 must not trip the licence gate), so the reverse import would cycle.
 */

export const BYO_PROVIDER_REQUIRED = 'byo_provider_required';

/** Query param carrying the refused slot(s) (`llm,tts,image`) to the project page,
 *  set by the create wizard when the project was created but its start-run hit
 *  the BYO 402. */
export const BYO_REQUIRED_QUERY = 'byo_required';

/** Query param on `/providers` naming the slots a refused run start still needs
 *  (`/providers?missing=llm,tts,image`); the page highlights those cards. */
export const MISSING_SLOTS_QUERY = 'missing';

/** Every `byo_governed` model-provider slot (orchestrator `ByoModality`, #1150). */
export const BYO_MODALITIES = ['llm', 'vlm', 'tts', 'asr', 'image', 'video_gen', 'ocr'] as const;
export type ByoModality = (typeof BYO_MODALITIES)[number];

const MODALITY_LABEL: Record<ByoModality, string> = {
	llm: 'LLM',
	vlm: 'VLM',
	tts: 'TTS',
	asr: 'ASR',
	image: 'image',
	video_gen: 'video generation',
	ocr: 'OCR'
};

export interface ByoProviderRequired {
	/** The FIRST missing slot; null when the server named none this build knows. */
	modality: ByoModality | null;
	/** Every missing slot, first-use order (`slots: "llm,tts,image"`); `[modality]`
	 *  for a pre-#1150 single-slot detail, `[]` when none is known. */
	slots: ByoModality[];
	/** The server's sentence ("Configure your own LLM, TTS and image providers to
	 *  continue"), else one built from `slots`. */
	message: string;
	/** What to append to `/providers`: `?missing=llm,tts#provider-slot-llm`, or `''`
	 *  when no slot is known — the link then opens the page itself. */
	settingsSuffix: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asModality(v: unknown): ByoModality | null {
	return typeof v === 'string' && (BYO_MODALITIES as readonly string[]).includes(v)
		? (v as ByoModality)
		: null;
}

/** Known slots from a comma-separated list (`"llm, tts,bogus"` → `['llm','tts']`), de-duplicated. */
export function parseSlotList(value: unknown): ByoModality[] {
	if (typeof value !== 'string') return [];
	const out: ByoModality[] = [];
	for (const part of value.split(',')) {
		const m = asModality(part.trim());
		if (m && !out.includes(m)) out.push(m);
	}
	return out;
}

function joinLabels(labels: string[]): string {
	if (labels.length <= 1) return labels.join('');
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** "Configure your own <LLM, TTS and image> provider(s) to continue". */
export function byoProviderMessage(slots: ByoModality | ByoModality[] | null): string {
	const list = slots === null ? [] : Array.isArray(slots) ? slots : [slots];
	if (list.length === 0) return 'Configure your own provider to continue';
	const noun = list.length === 1 ? 'provider' : 'providers';
	return `Configure your own ${joinLabels(list.map((s) => MODALITY_LABEL[s]))} ${noun} to continue`;
}

/** DOM id of a provider slot's card on the Providers page (the link target). */
export function providerSlotAnchor(slot: string): string {
	return `provider-slot-${slot.replace(/[^a-z0-9]+/gi, '-')}`;
}

/** `?missing=<slots>#provider-slot-<first>` for the Providers link, else `''`. */
export function byoProviderSettingsSuffix(slots: ByoModality[]): string {
	if (slots.length === 0) return '';
	return `?${MISSING_SLOTS_QUERY}=${slots.join(',')}#${providerSlotAnchor(slots[0])}`;
}

/** The structured detail object itself (`{code, modality, message}`), or null. */
export function parseByoProviderRequired(detail: unknown): ByoProviderRequired | null {
	if (!isRecord(detail) || detail.code !== BYO_PROVIDER_REQUIRED) return null;
	const first = asModality(detail.modality);
	const listed = parseSlotList(detail.slots);
	const slots = listed.length > 0 ? listed : first ? [first] : [];
	const message =
		typeof detail.message === 'string' && detail.message.trim()
			? detail.message.trim()
			: byoProviderMessage(slots);
	return {
		modality: slots[0] ?? null,
		slots,
		message,
		settingsSuffix: byoProviderSettingsSuffix(slots)
	};
}

/** The notice for a `?byo_required=<slot[,slot…]>` query value, or null when absent. */
export function byoProviderRequiredFromQuery(
	value: string | null | undefined
): ByoProviderRequired | null {
	return value ? parseByoProviderRequired({ code: BYO_PROVIDER_REQUIRED, slots: value }) : null;
}

/** The query value carrying a refusal's slots onward (`llm,tts,image`; `provider` when none known). */
export function byoRequiredQueryValue(required: ByoProviderRequired): string {
	return required.slots.length > 0 ? required.slots.join(',') : 'provider';
}

/**
 * A run's `failure_detail`. Ignores everything but the BYO code. Takes any object:
 * the generated `RunDetail` predates the field (#1108), and a
 * `{ failure_detail?: unknown }` parameter is a TS weak type it would fail.
 */
export function byoProviderRequiredFromRun(
	run: object | null | undefined
): ByoProviderRequired | null {
	return isRecord(run) ? parseByoProviderRequired(run.failure_detail) : null;
}

/** A parsed 402 response body — canonical `error.details` or bare `detail`. */
export function byoProviderRequiredFromBody(body: unknown): ByoProviderRequired | null {
	if (!isRecord(body)) return null;
	const envelope = body.error;
	if (isRecord(envelope)) {
		const hit = parseByoProviderRequired(envelope.details);
		if (hit) return hit;
	}
	return parseByoProviderRequired(body.detail);
}

/**
 * A thrown API error. Duck-typed on `status` + `details` (what `ApiError` carries)
 * rather than `instanceof`, so a module-mocked `ApiError` in a test — or the
 * blob transport's — is recognised the same way. Only a 402 counts.
 */
export function byoProviderRequiredFromError(err: unknown): ByoProviderRequired | null {
	if (!isRecord(err) || err.status !== 402) return null;
	return parseByoProviderRequired(err.details);
}

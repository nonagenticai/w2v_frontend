/**
 * The API shape a tenant's provider must expose, per GPU / model slot.
 *
 * The orchestrator's registry (`GET /api/provider-requirements`, `GET
 * /api/tenant/connections`) does not describe the wire shape, so this is the one
 * static map the Providers page shows. Keep it the ONLY copy.
 *
 * Pure module: no Svelte, no I/O — `slot-api-shapes.test.ts`.
 */
import { EXAMPLE_ENDPOINTS } from './provider-groups.js';

export interface SlotApiShape {
	/** `METHOD /path`, relative to the registered base URL. */
	endpoint: string;
	/** Brief request body. */
	request: string;
	/** Brief response body. */
	response: string;
}

export const SLOT_API_SHAPES: Readonly<Record<string, SlotApiShape>> = {
	llm: {
		endpoint: 'POST /v1/chat/completions',
		request: 'OpenAI chat completions: { model, messages[], response_format? }',
		response: '{ choices[0].message.content }'
	},
	vlm: {
		endpoint: 'POST /v1/chat/completions',
		request: 'OpenAI chat completions with image_url content parts',
		response: '{ choices[0].message.content }'
	},
	tts: {
		endpoint: 'POST /api/tts/synthesize',
		request: 'JSON { text, voice?, speed? }',
		response: 'audio/wav bytes'
	},
	asr: {
		endpoint: 'POST /api/asr/transcribe',
		request: 'multipart/form-data: file (audio), language?, word_timestamps?',
		response: '{ text, language, duration, segments[{ start, end, text, words[] }] }'
	},
	image: {
		endpoint: 'POST /api/image/generate',
		request: 'JSON { prompt, width?, height?, seed? }',
		response: '{ image_base64 (PNG), width, height, seed }'
	},
	// The `nonagentic_endpoint` kind (a copy of the platform OCR service); the
	// `openai-compatible` kind differs, see KIND_API_SHAPES.
	ocr: {
		endpoint: 'POST /v1/ocr',
		request:
			'Mistral OCR shape: { model?, document: { type, document_url | image_url } } — model optional',
		response: '{ pages[{ index, markdown }] }'
	},
	video_gen: {
		endpoint: 'Provider-native video API',
		request: 'OpenAI Sora (/v1/videos) or Google Veo (Gemini API), per provider type',
		response: 'job id, polled until the clip URL is ready'
	}
};

/**
 * Per-kind overrides, keyed `<slot>:<kind>`, where one slot's kinds speak different
 * paths. OCR (w2v_orchestrator#1150): `nonagentic_endpoint` = `POST {base}/v1/ocr`,
 * model optional; `openai-compatible` = `POST {base}/ocr` with a base URL that
 * already ends in `/v1` (e.g. https://api.mistral.ai/v1), model required.
 */
const KIND_API_SHAPES: Readonly<Record<string, SlotApiShape>> = {
	'ocr:openai-compatible': {
		endpoint: 'POST /ocr (base URL ends in /v1, e.g. https://api.mistral.ai/v1)',
		request:
			'Mistral OCR: { model, document: { type, document_url | image_url } } — model required (e.g. mistral-ocr-latest)',
		response: '{ pages[{ index, markdown }] }'
	}
};

/** The public gateway in front of the platform's own GPU / model services. */
export const PLATFORM_GATEWAY_BASE = 'https://api.nonagentic.ai';

/** The shape for `slot`, refined by the chosen `kind` where the kinds differ. */
export function slotApiShape(slot: string, kind?: string | null): SlotApiShape | null {
	return (kind ? KIND_API_SHAPES[`${slot}:${kind}`] : undefined) ?? SLOT_API_SHAPES[slot] ?? null;
}

/**
 * The platform gateway endpoint (`https://api.nonagentic.ai/<service>`) a tenant may
 * register for a slot with its own licence token; null where the gateway serves none.
 */
export function platformGatewayUrl(slot: string): string | null {
	return EXAMPLE_ENDPOINTS[slot] ?? null;
}

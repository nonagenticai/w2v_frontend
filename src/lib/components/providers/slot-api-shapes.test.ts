import { describe, it, expect } from 'vitest';
import { GPU_SLOTS } from './provider-groups';
import { PLATFORM_GATEWAY_BASE, platformGatewayUrl, slotApiShape } from './slot-api-shapes';

describe('slot API shapes', () => {
	it('every GPU / model slot has an expected API shape', () => {
		for (const s of GPU_SLOTS) {
			const shape = slotApiShape(s);
			expect(shape, s).not.toBeNull();
			expect(shape?.endpoint).toBeTruthy();
			expect(shape?.request).toBeTruthy();
			expect(shape?.response).toBeTruthy();
		}
		expect(slotApiShape('scrape.firecrawl')).toBeNull();
	});

	it('names the agreed paths per slot', () => {
		expect(slotApiShape('llm')?.endpoint).toBe('POST /v1/chat/completions');
		expect(slotApiShape('vlm')?.endpoint).toBe('POST /v1/chat/completions');
		expect(slotApiShape('tts')?.endpoint).toBe('POST /api/tts/synthesize');
		expect(slotApiShape('asr')?.endpoint).toBe('POST /api/asr/transcribe');
		expect(slotApiShape('asr')?.request).toMatch(/multipart/);
		expect(slotApiShape('image')?.endpoint).toBe('POST /api/image/generate');
		expect(slotApiShape('ocr')?.endpoint).toBe('POST /v1/ocr');
		expect(slotApiShape('ocr')?.request).toMatch(/Mistral/);
	});

	it('OCR: the two kinds speak different paths, model required only for openai-compatible', () => {
		const ne = slotApiShape('ocr', 'nonagentic_endpoint');
		expect(ne?.endpoint).toBe('POST /v1/ocr');
		expect(ne?.request).toMatch(/model optional/);
		const oc = slotApiShape('ocr', 'openai-compatible');
		expect(oc?.endpoint).toMatch(/^POST \/ocr /);
		expect(oc?.endpoint).toMatch(/\/v1/);
		expect(oc?.request).toMatch(/model required/);
		// A kind without an override falls back to the slot's shape.
		expect(slotApiShape('llm', 'openai-compatible')?.endpoint).toBe('POST /v1/chat/completions');
	});

	it('the platform gateway is https://api.nonagentic.ai/<service>', () => {
		expect(PLATFORM_GATEWAY_BASE).toBe('https://api.nonagentic.ai');
		expect(platformGatewayUrl('tts')).toBe('https://api.nonagentic.ai/tts');
		expect(platformGatewayUrl('ocr')).toBe('https://api.nonagentic.ai/ocr');
		expect(platformGatewayUrl('video_gen')).toBeNull();
	});
});

import { describe, it, expect } from 'vitest';
import type { SlotView } from '$lib/api/providers.js';
import { MANIFEST } from './manifest.fixture';
import {
	EXAMPLE_ENDPOINTS,
	GPU_SLOTS,
	PROBE_CAVEAT,
	slotsFromManifest,
	splitSlots,
	summaryRow
} from './provider-groups';

const req = (slot: string) => MANIFEST.slots.find((s) => s.slot === slot);
const view = (slot: string, over: Partial<SlotView> = {}): SlotView => ({
	slot,
	type: 'connection',
	writable: true,
	allowed_kinds: [],
	source: 'deployment',
	default_kind: 'nonagentic',
	byo_required: false,
	connection: null,
	...over
});

describe('splitSlots', () => {
	it('puts the GPU & model services first, in GPU_SLOTS order; everything else is an integration', () => {
		const names = [
			'device_farm',
			'tts',
			'ocr',
			'scrape',
			'llm',
			'asr',
			'video_gen',
			'vlm',
			'image'
		];
		const { gpu, other } = splitSlots(names.map((n) => view(n)));
		expect(gpu.map((s) => s.slot)).toEqual([
			'llm',
			'vlm',
			'tts',
			'asr',
			'image',
			'ocr',
			'video_gen'
		]);
		expect(other.map((s) => s.slot)).toEqual(['device_farm', 'scrape']);
		expect(GPU_SLOTS).toEqual(['llm', 'vlm', 'tts', 'asr', 'image', 'ocr', 'video_gen']);
	});
});

describe('summaryRow (source / model / key status)', () => {
	it('byo_required: an unregistered GPU slot is "Required — not registered"; a registered one is not', () => {
		const row = summaryRow(view('ocr'), req('ocr'), 'byo_required');
		expect(row).toMatchObject({
			source: 'required',
			sourceLabel: 'Required — not registered',
			model: '—'
		});
		const conn = { id: 'c', kind: 'openai', model: 'm', version: 1, has_secret: true };
		expect(
			summaryRow(view('tts', { source: 'tenant', connection: conn }), req('tts'), 'byo_required')
				.source
		).toBe('tenant');
		expect(summaryRow(view('scrape'), req('scrape'), 'byo_required').source).toBe('default');
		expect(summaryRow(view('ocr'), req('ocr'), 'local_allowed').source).toBe('default');
		expect(summaryRow(view('ocr'), req('ocr'), 'platform_only').source).toBe('default');
	});

	it('a tenant connection: "Your connection", kind label · model, key Stored or None', () => {
		const conn = {
			id: 'c',
			kind: 'openai-compatible',
			model: 'qwen',
			version: 1,
			has_secret: true
		};
		const row = summaryRow(view('llm', { source: 'tenant', connection: conn }), req('llm'));
		expect(row).toMatchObject({
			source: 'tenant',
			sourceLabel: 'Your connection',
			model: 'OpenAI-compatible · qwen',
			key: 'Stored',
			label: 'Language model (LLM)'
		});
		const none = summaryRow(
			view('llm', { source: 'tenant', connection: { ...conn, has_secret: false, model: null } }),
			req('llm')
		);
		expect(none.key).toBe('None');
		expect(none.model).toBe('OpenAI-compatible · provider default');
	});

	it('no connection: the platform default, no key', () => {
		const row = summaryRow(view('llm', { default_kind: 'nonagentic-wm' }), req('llm'));
		expect(row).toMatchObject({
			source: 'default',
			sourceLabel: 'Platform default',
			model: 'Platform (Nonagentic)',
			key: '—'
		});
	});

	it('byo_required without a connection: "Not configured" (nothing serves it)', () => {
		const row = summaryRow(view('tts', { byo_required: true }), req('tts'));
		expect(row).toMatchObject({
			source: 'unconfigured',
			sourceLabel: 'Not configured',
			model: '—'
		});
	});

	it('an unknown slot falls back to its id as the label', () => {
		expect(summaryRow(view('newslot'), undefined).label).toBe('newslot');
	});
});

describe('slotsFromManifest (read-only view for a member)', () => {
	it('one view per manifest slot, no connection, writable only for a connection slot with kinds', () => {
		const views = slotsFromManifest(MANIFEST);
		expect(views.map((v) => v.slot)).toEqual(MANIFEST.slots.map((s) => s.slot));
		for (const v of views) expect(v.connection).toBeNull();
		const llm = views.find((v) => v.slot === 'llm')!;
		expect(llm.writable).toBe(true);
		expect(llm.allowed_kinds).toEqual(req('llm')!.allowed_kinds);
	});
});

describe('copy', () => {
	it('example endpoints for owner testing; the caveat names public https and the live test', () => {
		expect(EXAMPLE_ENDPOINTS).toMatchObject({
			llm: 'https://api.nonagentic.ai/vllm/v1',
			tts: 'https://api.nonagentic.ai/tts',
			asr: 'https://api.nonagentic.ai/asr',
			image: 'https://api.nonagentic.ai/image'
		});
		expect(PROBE_CAVEAT).toMatch(/public https/);
		expect(PROBE_CAVEAT).toMatch(/live test/);
	});
});

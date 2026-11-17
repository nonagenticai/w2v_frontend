import { describe, expect, it } from 'vitest';
import {
	byoProviderMessage,
	byoProviderRequiredFromBody,
	byoProviderRequiredFromError,
	byoProviderRequiredFromQuery,
	byoProviderRequiredFromRun,
	byoRequiredQueryValue,
	parseByoProviderRequired,
	parseSlotList,
	providerSlotAnchor
} from './byo-provider.js';

// The exact object w2v_orchestrator#1108 puts on `RunDetail.failure_detail` and
// on the 402's structured detail (`SlotNotConfiguredError.failure_detail`).
const TTS = {
	code: 'byo_provider_required',
	modality: 'tts',
	message: 'Configure your own TTS provider to continue'
};

// The final #1150 shape: every missing slot, first one as `modality`.
const MULTI = {
	code: 'byo_provider_required',
	modality: 'llm',
	slots: 'llm,tts,image',
	message: 'Configure your own LLM, TTS and image providers to continue'
};

describe('parseByoProviderRequired', () => {
	it('the #1150 multi-slot detail → every slot, the server message, a ?missing= link', () => {
		expect(parseByoProviderRequired(MULTI)).toEqual({
			modality: 'llm',
			slots: ['llm', 'tts', 'image'],
			message: 'Configure your own LLM, TTS and image providers to continue',
			settingsSuffix: '?missing=llm,tts,image#provider-slot-llm'
		});
	});

	it.each(['llm', 'vlm', 'tts', 'asr', 'image', 'video_gen', 'ocr'])(
		'single-slot (pre-#1150) detail %s → that slot, linked',
		(modality) => {
			const hit = parseByoProviderRequired({ code: 'byo_provider_required', modality });
			expect(hit?.slots).toEqual([modality]);
			expect(hit?.settingsSuffix).toBe(
				`?missing=${modality}#provider-slot-${modality.replace('_', '-')}`
			);
		}
	);

	it('without a server message, builds one from the slots', () => {
		expect(parseByoProviderRequired({ ...MULTI, message: undefined })?.message).toBe(
			'Configure your own LLM, TTS and image providers to continue'
		);
		expect(parseByoProviderRequired({ ...TTS, message: '' })?.message).toBe(
			'Configure your own TTS provider to continue'
		);
	});

	it('unknown slots are dropped; none known → page link, generic message', () => {
		expect(parseByoProviderRequired({ ...MULTI, slots: 'bogus,tts,tts' })?.slots).toEqual(['tts']);
		expect(
			parseByoProviderRequired({ code: 'byo_provider_required', modality: 'device_farm' })
		).toEqual({
			modality: null,
			slots: [],
			message: 'Configure your own provider to continue',
			settingsSuffix: ''
		});
	});

	it.each([
		['null', null],
		['a string', 'byo_provider_required'],
		['an array', [TTS]],
		['another code', { ...TTS, code: 'gpu_busy' }],
		['no code', { modality: 'tts', message: 'x' }]
	])('rejects %s', (_label, value) => {
		expect(parseByoProviderRequired(value)).toBeNull();
	});
});

describe('byoProviderRequiredFromRun', () => {
	it('reads failure_detail', () => {
		expect(byoProviderRequiredFromRun({ failure_detail: TTS })?.modality).toBe('tts');
	});
	it('null failure_detail (every other failure) and a missing run are not BYO', () => {
		expect(byoProviderRequiredFromRun({ failure_detail: null })).toBeNull();
		expect(byoProviderRequiredFromRun({})).toBeNull();
		expect(byoProviderRequiredFromRun(null)).toBeNull();
	});
});

describe('byoProviderRequiredFromBody', () => {
	it('reads the canonical envelope error.details (what the orchestrator emits)', () => {
		const body = {
			error: { code: 'HTTP_402', message: TTS.message, status: 402, details: TTS }
		};
		expect(byoProviderRequiredFromBody(body)?.modality).toBe('tts');
	});
	it('reads a bare FastAPI { detail: {...} } body', () => {
		expect(byoProviderRequiredFromBody({ detail: { ...TTS, modality: 'asr' } })?.modality).toBe(
			'asr'
		);
	});
	it('a string detail or an envelope without BYO details is not BYO', () => {
		expect(byoProviderRequiredFromBody({ detail: 'payment required' })).toBeNull();
		expect(byoProviderRequiredFromBody({ error: { code: 'HTTP_402', message: 'x' } })).toBeNull();
		expect(byoProviderRequiredFromBody(null)).toBeNull();
	});
});

describe('byoProviderRequiredFromError', () => {
	it('recognises a 402 carrying the BYO details', () => {
		const err = Object.assign(new Error('402'), { status: 402, details: TTS });
		expect(byoProviderRequiredFromError(err)).toEqual({
			modality: 'tts',
			slots: ['tts'],
			message: 'Configure your own TTS provider to continue',
			settingsSuffix: '?missing=tts#provider-slot-tts'
		});
	});
	it('recognises the run-start 402 naming several slots', () => {
		const err = Object.assign(new Error('402'), { status: 402, details: MULTI });
		expect(byoProviderRequiredFromError(err)?.slots).toEqual(['llm', 'tts', 'image']);
	});
	it('only a 402 counts — the same details on another status are ignored', () => {
		for (const status of [400, 403, 500, 503]) {
			const err = Object.assign(new Error('x'), { status, details: TTS });
			expect(byoProviderRequiredFromError(err)).toBeNull();
		}
	});
	it('a 402 without BYO details, and non-errors, are not BYO', () => {
		expect(byoProviderRequiredFromError({ status: 402, details: undefined })).toBeNull();
		expect(byoProviderRequiredFromError(new Error('boom'))).toBeNull();
		expect(byoProviderRequiredFromError('402')).toBeNull();
		expect(byoProviderRequiredFromError(null)).toBeNull();
	});
});

describe('message + anchor helpers', () => {
	it('byoProviderMessage', () => {
		expect(byoProviderMessage('tts')).toBe('Configure your own TTS provider to continue');
		expect(byoProviderMessage(['llm', 'video_gen'])).toBe(
			'Configure your own LLM and video generation providers to continue'
		);
		expect(byoProviderMessage(null)).toBe('Configure your own provider to continue');
		expect(byoProviderMessage([])).toBe('Configure your own provider to continue');
	});
	it('providerSlotAnchor is a valid fragment for dotted slot names', () => {
		expect(providerSlotAnchor('tts')).toBe('provider-slot-tts');
		expect(providerSlotAnchor('publish.youtube')).toBe('provider-slot-publish-youtube');
	});
});

describe('byoProviderRequiredFromQuery', () => {
	it('a slot list → its notice; an unknown value → the slot-less notice', () => {
		expect(byoProviderRequiredFromQuery('image')?.settingsSuffix).toBe(
			'?missing=image#provider-slot-image'
		);
		expect(byoProviderRequiredFromQuery('llm,tts,image')?.message).toBe(
			'Configure your own LLM, TTS and image providers to continue'
		);
		expect(byoProviderRequiredFromQuery('provider')).toEqual({
			modality: null,
			slots: [],
			message: 'Configure your own provider to continue',
			settingsSuffix: ''
		});
	});
	it('byoRequiredQueryValue round-trips through the query', () => {
		const hit = parseByoProviderRequired(MULTI)!;
		expect(byoRequiredQueryValue(hit)).toBe('llm,tts,image');
		expect(byoProviderRequiredFromQuery(byoRequiredQueryValue(hit))?.slots).toEqual(hit.slots);
		expect(byoRequiredQueryValue(byoProviderRequiredFromQuery('provider')!)).toBe('provider');
	});
});

describe('parseSlotList', () => {
	it('trims, filters unknown, de-duplicates', () => {
		expect(parseSlotList(' llm , ocr,nope,llm')).toEqual(['llm', 'ocr']);
		expect(parseSlotList(null)).toEqual([]);
	});
	it('absent or empty → null', () => {
		expect(byoProviderRequiredFromQuery(null)).toBeNull();
		expect(byoProviderRequiredFromQuery('')).toBeNull();
	});
});

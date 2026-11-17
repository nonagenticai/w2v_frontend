import { describe, it, expect } from 'vitest';
import type { ConnectionView } from '$lib/api/providers.js';
import type { KindRequirement, SlotRequirement } from '$lib/api/provider-requirements.js';
import { MANIFEST } from './manifest.fixture';
import {
	buildDraft,
	fieldKeysFor,
	fieldPlaceholder,
	hasModelField,
	initialValues,
	kindLabel,
	kindRequirement,
	modelListDraft,
	normalizeModels,
	validateDraft,
	type SecretState
} from './connection-form';

const slot = (name: string): SlotRequirement => {
	const s = MANIFEST.slots.find((x) => x.slot === name);
	if (!s) throw new Error(`fixture has no slot ${name}`);
	return s;
};
const kind = (s: string, k: string): KindRequirement => {
	const r = kindRequirement(slot(s), k);
	if (!r) throw new Error(`fixture has no kind ${s}/${k}`);
	return r;
};

/** A slot/kind the frontend has never heard of: proves nothing is hardcoded. */
const ACME: SlotRequirement = {
	slot: 'llm',
	label: 'Language model (LLM)',
	type: 'connection',
	default_kind: 'nonagentic-wm',
	default_kind_label: 'Platform (Nonagentic)',
	allowed_kinds: ['acme'],
	byo_required: false,
	kinds: {
		acme: {
			label: 'Acme AI',
			help: 'Acme hosted models.',
			base_url: 'forbidden',
			default_base_url: null,
			model_required: false,
			secret_required: true,
			secret_label: 'Acme token',
			required_options: ['region'],
			fields: [
				{ key: 'options.region', label: 'Region', required: true, help: 'eu-1', format: 'text' },
				{ key: 'options.tier', label: 'Tier', required: false, help: '', format: 'text' }
			]
		}
	},
	used_by: []
};

const NO_KEY: SecretState = { mode: 'replace', value: '', hasStored: false };
const TYPED: SecretState = { mode: 'replace', value: 'sk-x', hasStored: false };
const KEPT: SecretState = { mode: 'keep', value: '', hasStored: true };

function conn(over: Partial<ConnectionView> = {}): ConnectionView {
	return { id: 'c', kind: 'openai', version: 1, has_secret: true, options: {}, ...over };
}

describe('fields come from the manifest, in manifest order', () => {
	it('tts kinds: fields + required flags exactly as the server describes them', () => {
		const fields = (k: string) => kind('tts', k).fields.map((f) => [f.key, f.required]);
		expect(fields('openai')).toEqual([
			['model', false],
			['options.voice', true],
			['base_url', false]
		]);
		expect(fields('openai-compatible')).toEqual([
			['base_url', true],
			['model', true],
			['options.voice', true]
		]);
	});

	it('a kind the frontend has never seen renders from its manifest entry alone', () => {
		const acme = kindRequirement(ACME, 'acme')!;
		expect(acme.fields.map((f) => f.key)).toEqual(['options.region', 'options.tier']);
		expect(acme.secret_label).toBe('Acme token');
		expect(kindLabel(ACME, 'acme')).toBe('Acme AI');
		expect(fieldKeysFor(ACME).sort()).toEqual([
			'base_url',
			'model',
			'options.region',
			'options.tier'
		]);
	});

	it('a kind absent from the manifest has no form (no generic fallback table)', () => {
		expect(kindRequirement(slot('llm'), 'brand-new-kind')).toBeUndefined();
		expect(kindRequirement(undefined, 'anthropic')).toBeUndefined();
	});

	it('labels: kind label, the default kind label, else the raw id', () => {
		expect(kindLabel(slot('video_gen'), 'veo')).toBe('Google Veo');
		expect(kindLabel(slot('device_farm'), 'local')).toBe('Platform (local automation)');
		expect(kindLabel(undefined, 'platform')).toBe('platform');
	});

	it('placeholders derive from required-ness, help and the default endpoint', () => {
		const tts = kind('tts', 'openai');
		const f = (key: string) => tts.fields.find((x) => x.key === key)!;
		expect(fieldPlaceholder(f('options.voice'), tts)).toBe('Required — e.g. alloy');
		expect(fieldPlaceholder(f('base_url'), tts)).toBe(
			'Optional — defaults to https://api.openai.com/v1'
		);
	});
});

describe('validateDraft — required fields and the secret, per the manifest', () => {
	it('required fields missing → one message per field; optional ones never', () => {
		const errors = validateDraft(kind('tts', 'openai-compatible'), {}, NO_KEY);
		expect(errors).toEqual({
			base_url: 'Base URL is required.',
			model: 'Model is required.',
			'options.voice': 'Voice is required.'
		});
	});

	it('url-format fields reject a non-http(s) value', () => {
		const errors = validateDraft(kind('llm', 'openai-compatible'), { base_url: 'ftp://x' }, NO_KEY);
		expect(errors.base_url).toMatch(/full http\(s\) URL/);
	});

	it('secret_required: the manifest secret label names the missing key', () => {
		const acme = kindRequirement(ACME, 'acme')!;
		expect(validateDraft(acme, { 'options.region': 'eu-1' }, NO_KEY)).toEqual({
			secret: 'Acme token is required.'
		});
		expect(validateDraft(acme, { 'options.region': 'eu-1' }, TYPED)).toEqual({});
		expect(validateDraft(acme, { 'options.region': 'eu-1' }, KEPT)).toEqual({});
		expect(
			validateDraft(acme, { 'options.region': 'eu-1' }, { ...KEPT, mode: 'clear' }).secret
		).toMatch(/replace it instead of clearing/);
	});

	it('secret not required (llm anthropic): no key is fine', () => {
		expect(validateDraft(kind('llm', 'anthropic'), {}, NO_KEY)).toEqual({});
	});

	it('kind switch with a stored key: a NEW key is demanded', () => {
		const errors = validateDraft(
			kind('device_farm', 'browserstack'),
			{ 'options.username': 'bob' },
			{ ...KEPT, requireNewFor: 'BrowserStack' }
		);
		expect(errors).toEqual({ secret: 'Enter a key for BrowserStack.' });
	});
});

describe('initialValues / buildDraft', () => {
	it('reads base_url/model/string options from the stored connection, never a secret', () => {
		const v = initialValues(
			slot('tts'),
			conn({ kind: 'elevenlabs', model: 'm', base_url: null, options: { voice: 'v1', speed: 2 } })
		);
		expect(v).toEqual({ base_url: '', model: 'm', 'options.voice': 'v1' });
	});

	it('only shown fields are sent; options overlay stored ones; keep omits the secret', () => {
		const acme = kindRequirement(ACME, 'acme')!;
		const body = buildDraft(
			'acme',
			acme,
			{
				base_url: 'https://ignored',
				model: 'ignored',
				'options.region': ' eu-1 ',
				'options.tier': ''
			},
			{ tier: 'gold', other: 'kept' },
			KEPT
		);
		expect(body).toEqual({
			kind: 'acme',
			base_url: null,
			model: null,
			options: { region: 'eu-1', other: 'kept' }
		});
		expect(Object.keys(body)).not.toContain('secret');
	});

	it('replace sends the typed secret; clear sends ""', () => {
		const k = kind('llm', 'anthropic');
		expect(buildDraft('anthropic', k, {}, null, TYPED).secret).toBe('sk-x');
		expect(buildDraft('anthropic', k, {}, null, { ...KEPT, mode: 'clear' }).secret).toBe('');
	});
});

describe('write-only key: "stored; leave blank to keep it"', () => {
	it('a blank replace on a stored key keeps it: no error, `secret` omitted', () => {
		const k = { ...kind('tts', 'openai'), secret_required: true };
		const blank: SecretState = { mode: 'replace', value: '', hasStored: true };
		expect(
			validateDraft(k, { model: 'm', 'options.voice': 'alloy' }, blank).secret
		).toBeUndefined();
		expect(Object.keys(buildDraft('openai', k, {}, null, blank))).not.toContain('secret');
	});

	it('a blank replace still fails when nothing is stored, or when a new kind needs a new key', () => {
		const k = { ...kind('tts', 'openai'), secret_required: true };
		expect(validateDraft(k, {}, NO_KEY).secret).toBeDefined();
		expect(
			validateDraft(k, {}, { mode: 'replace', value: '', hasStored: true, requireNewFor: 'OpenAI' })
				.secret
		).toMatch(/Enter a key for OpenAI/);
	});
});

describe('Load models — request body + result normalisation', () => {
	const oc = () => kind('llm', 'openai-compatible');

	it('sends kind + typed base URL + a newly typed key', () => {
		expect(
			modelListDraft(
				'openai-compatible',
				oc(),
				{ base_url: ' https://x.test/v1 ', model: '' },
				TYPED
			)
		).toEqual({ kind: 'openai-compatible', base_url: 'https://x.test/v1', secret: 'sk-x' });
	});

	it('omits the secret on keep / clear / blank replace (server uses the stored key)', () => {
		const v = { base_url: 'https://x.test/v1', model: '' };
		for (const s of [KEPT, NO_KEY, { ...KEPT, mode: 'clear' as const }]) {
			expect(modelListDraft('openai-compatible', oc(), v, s)).not.toHaveProperty('secret');
		}
	});

	it('base_url is null when blank or when the kind shows no base URL field', () => {
		expect(
			modelListDraft('openai-compatible', oc(), { base_url: '  ' }, NO_KEY).base_url
		).toBeNull();
		const acme = ACME.kinds!.acme;
		expect(
			modelListDraft('acme', acme, { base_url: 'https://ignored' }, NO_KEY).base_url
		).toBeNull();
	});

	it('hasModelField follows the manifest', () => {
		expect(hasModelField(oc())).toBe(true);
		expect(hasModelField(ACME.kinds!.acme)).toBe(false);
		expect(hasModelField(undefined)).toBe(false);
	});

	it('normalizeModels de-duplicates, trims, sorts and drops junk', () => {
		expect(normalizeModels(['b', ' a ', 'b', '', 3, null])).toEqual(['a', 'b']);
		expect(normalizeModels(undefined)).toEqual([]);
	});
});

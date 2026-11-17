import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client.js', async () => {
	const actual: typeof import('./client.js') = await vi.importActual('./client.js');
	return { ...actual, api: { get: vi.fn(), put: vi.fn() } };
});

import { api } from './client.js';
import {
	tenantDefaults,
	formFromDefaults,
	bodyFromForm,
	validateDefaultsForm,
	wizardPrefill,
	type TenantDefaultsWire
} from './tenant-defaults.js';
import { wizard } from '$lib/stores/wizard.svelte.js';

const DEPLOYMENT = {
	captions_mode: 'none' as const,
	captions_karaoke: true,
	voice_direction_tone: null,
	retention_mode: null,
	timing_director_model_tier: null
};

beforeEach(() => vi.clearAllMocks());

describe('tenant defaults api', () => {
	it('GET/PUT /tenant/defaults (unversioned route)', async () => {
		await tenantDefaults.get();
		expect(api.get).toHaveBeenCalledWith('/tenant/defaults');
		await tenantDefaults.put({ expected_version: 0 });
		expect(api.put).toHaveBeenCalledWith('/tenant/defaults', { expected_version: 0 });
	});
});

describe('form <-> document', () => {
	it('round-trips a full document; a number input value (Svelte writes numbers) is accepted', () => {
		const doc = {
			voice: { voice_id: 'af_heart', speed: 1.1 },
			brand: { primary_color: '#112233', secondary_color: '#abc', font_family: 'Inter' },
			captions: { mode: 'burned_in' as const, karaoke: false },
			voice_direction: { tone: 'warm' },
			retention_mode: 'auto' as const,
			model_tier: { timing_director: 'tier-high' as const }
		};
		const form = formFromDefaults(doc);
		expect(form.karaoke).toBe('off');
		// bind:value on <input type=number> hands back a number, not a string.
		(form as unknown as { speed: number }).speed = 1.1;
		expect(bodyFromForm(form, 7)).toEqual({ expected_version: 7, ...doc });
	});

	it('an empty form clears every block to null (deployment defaults)', () => {
		expect(bodyFromForm(formFromDefaults({}), 3)).toEqual({
			expected_version: 3,
			voice: null,
			brand: null,
			captions: null,
			voice_direction: null,
			retention_mode: null,
			model_tier: null
		});
	});

	it('validation mirrors the API schema bounds', () => {
		const form = formFromDefaults({});
		expect(validateDefaultsForm({ ...form, speed: '0.4' })).toHaveProperty('speed');
		expect(validateDefaultsForm({ ...form, speed: '2' })).toEqual({});
		expect(validateDefaultsForm({ ...form, primaryColor: '#12345' })).toHaveProperty(
			'primaryColor'
		);
		expect(validateDefaultsForm({ ...form, tone: 'x'.repeat(65) })).toHaveProperty('tone');
	});
});

describe('wizard prefill', () => {
	const view = (over: Partial<TenantDefaultsWire>): TenantDefaultsWire => ({
		version: 1,
		deployment: DEPLOYMENT,
		...over
	});

	it('captions fall back to the deployment default; unset fields stay null', () => {
		expect(wizardPrefill(view({}))).toEqual({
			voiceId: null,
			speed: null,
			brandColor: null,
			captionsMode: 'none'
		});
		expect(wizardPrefill(view({ captions: { mode: 'overlay' } })).captionsMode).toBe('overlay');
	});

	it('applyTenantDefaults fills factory values only — an earlier user choice wins', () => {
		wizard.resetWizard();
		wizard.narrationSpeed = 1.5; // the user already moved the slider
		wizard.applyTenantDefaults({
			voiceId: 'bm_george',
			speed: 0.9,
			brandColor: '#000000',
			captionsMode: 'none'
		});
		expect(wizard.voice).toBe('bm_george');
		expect(wizard.narrationSpeed).toBe(1.5);
		expect(wizard.brandColor).toBe('#000000');
		wizard.resetWizard();
	});
});

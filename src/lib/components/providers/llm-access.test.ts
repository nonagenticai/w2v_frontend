import { describe, it, expect } from 'vitest';
import { ApiError } from '$lib/api/client.js';
import {
	BYO_LOCKABLE_SLOTS,
	DEFAULT_LLM_ACCESS,
	LLM_ACCESS_HINTS,
	LLM_ACCESS_OPTIONS,
	llmAccessBanner,
	llmAccessErrorMessage,
	isTenantNotOnboarded,
	slotLockedByAccess,
	slotRequiredByAccess,
	usedByText
} from './llm-access';
import { GPU_SLOTS } from './provider-groups';

describe('LLM access labels + banner', () => {
	it('offers exactly the three modes with the agreed labels, default local_allowed', () => {
		expect(LLM_ACCESS_OPTIONS).toEqual([
			{ value: 'local_allowed', label: 'Platform services allowed' },
			{ value: 'byo_required', label: 'Own providers required' },
			{ value: 'platform_only', label: 'Platform services only' }
		]);
		expect(DEFAULT_LLM_ACCESS).toBe('local_allowed');
	});

	it('each mode has owner-facing help', () => {
		expect(LLM_ACCESS_HINTS.local_allowed).toMatch(/falls back to the platform/i);
		expect(LLM_ACCESS_HINTS.byo_required).toMatch(/must register every/);
		expect(LLM_ACCESS_HINTS.platform_only).toMatch(/tenant providers are disabled/i);
	});

	it.each([
		['local_allowed', 'Platform services allowed', 'info', /falls back to the platform/],
		['platform_only', 'Platform services only', 'info', /own providers is disabled/i],
		['byo_required', 'Own providers required', 'warning', /Required — not registered/]
	] as const)('%s → %s', (mode, title, tone, body) => {
		const b = llmAccessBanner({ mode, label: 'server label ignored' });
		expect(b).toMatchObject({ mode, title, tone });
		expect(b?.body).toMatch(body);
	});

	it('no banner when the server did not say, or said something unknown', () => {
		expect(llmAccessBanner(null)).toBeNull();
		expect(llmAccessBanner(undefined)).toBeNull();
		expect(llmAccessBanner({ mode: 'weird' as never })).toBeNull();
	});
});

describe('slot rules', () => {
	it('the lock list IS the GPU / model slot list (one source), incl. video_gen and ocr', () => {
		expect(BYO_LOCKABLE_SLOTS).toBe(GPU_SLOTS);
		expect(BYO_LOCKABLE_SLOTS).toEqual(['llm', 'vlm', 'tts', 'asr', 'image', 'ocr', 'video_gen']);
	});

	it('platform_only locks every GPU / model slot, never an integration', () => {
		for (const s of ['llm', 'vlm', 'tts', 'asr', 'image', 'ocr', 'video_gen']) {
			expect(slotLockedByAccess('platform_only', s)).toBe(true);
			expect(slotLockedByAccess('byo_required', s)).toBe(false);
			expect(slotLockedByAccess('local_allowed', s)).toBe(false);
		}
		expect(slotLockedByAccess('platform_only', 'scrape.firecrawl')).toBe(false);
		expect(slotLockedByAccess('platform_only', 'publish.youtube')).toBe(false);
		expect(slotLockedByAccess('local_allowed', 'llm')).toBe(false);
		expect(slotLockedByAccess(null, 'llm')).toBe(false);
	});

	it('byo_required flags every model slot without a tenant registration', () => {
		const empty = { slot: 'tts', source: 'deployment' as const, connection: null };
		expect(slotRequiredByAccess('byo_required', empty)).toBe(true);
		expect(slotRequiredByAccess('byo_required', { ...empty, slot: 'video_gen' })).toBe(true);
		expect(slotRequiredByAccess('byo_required', { ...empty, slot: 'ocr' })).toBe(true);
		expect(slotRequiredByAccess('platform_only', empty)).toBe(false);
		expect(slotRequiredByAccess('byo_required', { ...empty, slot: 'scrape.x' })).toBe(false);
		expect(slotRequiredByAccess('local_allowed', empty)).toBe(false);
		expect(
			slotRequiredByAccess('byo_required', {
				slot: 'tts',
				source: 'tenant',
				connection: { id: 'c', kind: 'openai', version: 1, has_secret: true, options: {} }
			})
		).toBe(false);
	});

	it('"Used by" names the w2v work per model slot', () => {
		expect(usedByText('llm')).toMatch(/Scripts, storyboards/);
		expect(usedByText('vlm')).toMatch(/Screenshot and video analysis/);
		expect(usedByText('tts')).toBe('Narration');
		expect(usedByText('asr')).toMatch(/captions/);
		expect(usedByText('image')).toBe('Generated images');
		expect(usedByText('video_gen')).toBe('Generated video clips');
		expect(usedByText('ocr')).toMatch(/Text extraction/);
		expect(usedByText('publish.youtube')).toBeNull();
	});
});

describe('isTenantNotOnboarded', () => {
	it('is true only for the licences tenant-owned-by-another-app answer', () => {
		expect(isTenantNotOnboarded(new ApiError(403, 'Forbidden', 'x', 'TENANT_NOT_ONBOARDED'))).toBe(
			true
		);
		expect(isTenantNotOnboarded(new ApiError(502, 'Bad Gateway', 'x', 'LICENCES_REFUSED'))).toBe(
			false
		);
		expect(isTenantNotOnboarded(new Error('x'))).toBe(false);
	});
});

describe('llmAccessErrorMessage', () => {
	it('licences_refused keeps the server detail', () => {
		const err = new ApiError(502, 'Bad Gateway', 'licences 403', 'LICENCES_REFUSED');
		expect(llmAccessErrorMessage(err, 'fb')).toBe(
			'The licences service refused the change: licences 403'
		);
	});
	it('LICENCES_UNAVAILABLE / TENANT_NOT_FOUND get operator copy', () => {
		expect(
			llmAccessErrorMessage(new ApiError(503, 'x', 'down', 'LICENCES_UNAVAILABLE'), 'fb')
		).toMatch(/unavailable — try again shortly: down/);
		expect(llmAccessErrorMessage(new ApiError(404, 'x', 'nf', 'TENANT_NOT_FOUND'), 'fb')).toMatch(
			/not known/
		);
	});
	it('other errors show their detail, non-ApiErrors their message', () => {
		expect(llmAccessErrorMessage(new ApiError(500, 'x', 'boom'), 'fb')).toBe('boom');
		expect(llmAccessErrorMessage(new Error('offline'), 'fb')).toBe('offline');
		expect(llmAccessErrorMessage(null, 'fb')).toBe('fb');
	});
});

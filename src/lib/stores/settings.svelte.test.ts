import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetToDefaults, updateTheme } from './settings.svelte.js';

// happy-dom exposes `window` but not a working Storage, so the store's
// saveToStorage (which the prod browser path always reaches) would throw.
// Install a Map-backed localStorage for the duration of these tests.
function installLocalStorageMock(): void {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	});
}

describe('settings store — reset', () => {
	beforeEach(() => {
		installLocalStorageMock();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('Reset restores the browser preferences and persists only theme + projectsView', () => {
		updateTheme({ name: 'dark' });
		resetToDefaults();
		const persisted = JSON.parse(localStorage.getItem('w2v_settings') ?? '{}');
		expect(Object.keys(persisted).sort()).toEqual(['projectsView', 'theme']);
		expect(persisted.theme).toEqual({ name: 'default' });
	});

	it('a throwing localStorage write does not break the caller; memory still updates', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('quota', 'QuotaExceededError');
			},
			removeItem: () => {},
			clear: () => {}
		});
		const { getThemeName } = await import('./settings.svelte.js');
		expect(() => updateTheme({ name: 'dark' })).not.toThrow();
		expect(() => resetToDefaults()).not.toThrow();
		updateTheme({ name: 'light' });
		expect(getThemeName()).toBe('light');
	});
});

describe('settings store — retired AI-generation keys are purged on load', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('drops features/imageGen/videoGen (incl. a legacy plaintext key) and rewrites storage', async () => {
		installLocalStorageMock();
		localStorage.setItem(
			'w2v_settings',
			JSON.stringify({
				projectsView: { layout: 'list', sortBy: 'title', order: 'asc' },
				features: { asr: true, imageGeneration: true, videoGeneration: false },
				imageGen: { service: 'replicate', apiKey: 'sk-legacy-image' },
				videoGen: { service: 'runway', apiKey: 'sk-legacy-video' }
			})
		);
		vi.resetModules();
		const fresh = await import('./settings.svelte.js');

		const s = fresh.getSettings() as unknown as Record<string, unknown>;
		expect(s.features).toBeUndefined();
		expect(s.imageGen).toBeUndefined();
		expect(s.videoGen).toBeUndefined();
		// Non-retired values survive the purge.
		expect(fresh.getSettings().projectsView).toEqual({
			layout: 'list',
			sortBy: 'title',
			order: 'asc'
		});

		const raw = localStorage.getItem('w2v_settings') ?? '';
		expect(raw).not.toContain('sk-legacy-image');
		expect(raw).not.toContain('sk-legacy-video');
		expect(raw).not.toContain('imageGen');
		expect(raw).toContain('"sortBy":"title"');
	});

	// The browser-only Device Farm card + the legacy apiKeys bag were read by nothing
	// (the device farm is the server-side `device_farm` slot on /providers). Older
	// builds persisted BrowserStack credentials / API keys in plaintext: purge them.
	it('drops the retired deviceFarm/apiKeys keys (incl. plaintext credentials) and rewrites storage', async () => {
		installLocalStorageMock();
		localStorage.setItem(
			'w2v_settings',
			JSON.stringify({
				deviceFarm: {
					provider: 'browserstack',
					browserstackUsername: 'bs-user',
					browserstackAccessKey: 'bs-key'
				},
				apiKeys: { anthropic: 'sk-ant-legacy', openai: 'sk-openai-legacy' },
				theme: { name: 'light' }
			})
		);
		vi.resetModules();
		const fresh = await import('./settings.svelte.js');

		const s = fresh.getSettings() as unknown as Record<string, unknown>;
		expect(s.deviceFarm).toBeUndefined();
		expect(s.apiKeys).toBeUndefined();
		expect(fresh.getSettings().theme).toEqual({ name: 'light' });

		const raw = localStorage.getItem('w2v_settings') ?? '';
		expect(raw).not.toContain('bs-user');
		expect(raw).not.toContain('bs-key');
		expect(raw).not.toContain('sk-ant-legacy');
		expect(raw).not.toContain('deviceFarm');
		expect(raw).toContain('"name":"light"');
	});

	// P6 FE-1: the browser-only Default Config / Narration / Video cards were replaced
	// by the server-backed workspace defaults. Their stored values are purged, not
	// migrated, so nothing can keep reading a stale browser voice.
	it('drops the retired crawl/narration/video keys and rewrites storage', async () => {
		installLocalStorageMock();
		localStorage.setItem(
			'w2v_settings',
			JSON.stringify({
				crawl: { depth: 2, maxPages: 12 },
				narration: { provider: 'kokoro', voice: 'bm_george', speed: 1.2 },
				video: { resolution: '3840x2160', crf: 18, transition: 'wipe' },
				theme: { name: 'dark' }
			})
		);
		vi.resetModules();
		const fresh = await import('./settings.svelte.js');

		const s = fresh.getSettings() as unknown as Record<string, unknown>;
		expect(s.crawl).toBeUndefined();
		expect(s.narration).toBeUndefined();
		expect(s.video).toBeUndefined();
		expect(fresh.getSettings().theme).toEqual({ name: 'dark' });

		const raw = localStorage.getItem('w2v_settings') ?? '';
		expect(raw).not.toContain('bm_george');
		expect(raw).not.toContain('maxPages');
		expect(raw).not.toContain('3840x2160');
		expect(raw).toContain('"name":"dark"');
	});
});

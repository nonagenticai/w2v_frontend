// Providers page — the LLM-access banner from GET /tenant/connections `llm_access`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { providersMock, requirementsMock } = vi.hoisted(() => ({
	providersMock: { list: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn(), models: vi.fn() },
	requirementsMock: { get: vi.fn() }
}));
vi.mock('$lib/api/providers.js', async () => {
	const actual: typeof import('$lib/api/providers.js') =
		await vi.importActual('$lib/api/providers.js');
	return { ...actual, providers: providersMock };
});
vi.mock('$lib/api/provider-requirements.js', () => ({ providerRequirements: requirementsMock }));
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/auth.svelte.js', () => ({
	ensureAuthReady: () => Promise.resolve(),
	isTenantAdmin: () => true
}));
vi.mock('$lib/api/youtube.js', () => ({
	youtube: {
		authStatus: vi
			.fn()
			.mockResolvedValue({ connected: false, status: 'platform_default', tenant_id: 't' }),
		authConnect: vi.fn(),
		authDisconnect: vi.fn()
	}
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { render, screen, within } from '@testing-library/svelte';
import type { ProviderSlot } from '$lib/api/providers.js';
import { MANIFEST } from '$lib/components/providers/manifest.fixture';
import Page from './+page.svelte';

const slot = (name: string, writable = true): ProviderSlot => ({
	slot: name,
	type: 'connection',
	writable,
	allowed_kinds: MANIFEST.slots.find((s) => s.slot === name)?.allowed_kinds ?? [],
	source: 'deployment',
	default_kind: 'nonagentic',
	byo_required: false,
	connection: null
});

beforeEach(() => {
	vi.clearAllMocks();
	requirementsMock.get.mockResolvedValue(MANIFEST);
});

describe('providers page — LLM access banner', () => {
	it.each([
		['local_allowed', 'Platform services allowed'],
		['platform_only', 'Platform services only'],
		['byo_required', 'Own providers required']
	])('%s renders "%s"', async (mode, title) => {
		providersMock.list.mockResolvedValue({
			llm_access: { mode, label: title },
			items: [slot('llm'), slot('tts')]
		});
		render(Page);
		const banner = await screen.findByTestId('providers-llm-access');
		expect(banner.getAttribute('data-mode')).toBe(mode);
		expect(banner.textContent).toContain(title);
	});

	it('platform_only locks every GPU slot incl. video_gen + ocr; byo_required flags them Required', async () => {
		const gpu = () => [slot('llm'), slot('tts'), slot('ocr'), slot('video_gen')];
		providersMock.list.mockResolvedValue({ llm_access: { mode: 'platform_only' }, items: gpu() });
		const { unmount } = render(Page);
		await screen.findByTestId('providers-llm-access');
		for (const s of ['llm', 'tts', 'ocr', 'video_gen']) {
			expect(await screen.findByTestId(`provider-locked-${s}`)).toBeTruthy();
		}
		unmount();

		providersMock.list.mockResolvedValue({ llm_access: { mode: 'byo_required' }, items: gpu() });
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		expect(within(card).getByTestId('provider-required-tts')).toBeTruthy();
		for (const s of ['llm', 'ocr', 'video_gen']) {
			expect(screen.getByTestId(`provider-required-${s}`)).toBeTruthy();
			expect(screen.queryByTestId(`provider-locked-${s}`)).toBeNull();
			const row = screen.getByTestId(`providers-summary-${s}`);
			expect(row.getAttribute('data-source')).toBe('required');
			expect(within(row).getByTestId('providers-summary-source').textContent).toBe(
				'Required — not registered'
			);
		}
	});

	it('local_allowed: nothing locked or required; ocr sits in the GPU group', async () => {
		providersMock.list.mockResolvedValue({
			llm_access: { mode: 'local_allowed' },
			items: [slot('ocr'), slot('llm')]
		});
		render(Page);
		const gpu = await screen.findByTestId('providers-gpu');
		expect(within(gpu).getByTestId('provider-card-ocr')).toBeTruthy();
		expect(screen.queryByTestId('provider-locked-ocr')).toBeNull();
		expect(screen.queryByTestId('provider-required-ocr')).toBeNull();
		expect(screen.getByTestId('providers-gateway-hint').textContent).toContain(
			'https://api.nonagentic.ai/<service>'
		);
	});

	it('no banner when the server omits llm_access', async () => {
		providersMock.list.mockResolvedValue({ items: [slot('llm')] });
		render(Page);
		await screen.findByTestId('provider-card-llm');
		expect(screen.queryByTestId('providers-llm-access')).toBeNull();
	});
});

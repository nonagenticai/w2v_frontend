import { describe, it, expect, vi, beforeEach } from 'vitest';

const { defaultsGet, defaultsPut, providersList, isTenantAdminMock } = vi.hoisted(() => ({
	defaultsGet: vi.fn(),
	defaultsPut: vi.fn(),
	providersList: vi.fn(),
	isTenantAdminMock: vi.fn(() => true)
}));
vi.mock('$lib/api/tenant-defaults.js', async () => {
	const actual: typeof import('$lib/api/tenant-defaults.js') = await vi.importActual(
		'$lib/api/tenant-defaults.js'
	);
	return { ...actual, tenantDefaults: { get: defaultsGet, put: defaultsPut } };
});
vi.mock('$lib/api/providers.js', () => ({ providers: { list: providersList } }));
vi.mock('$lib/api/tts.js', () => ({ tts: { previewVoice: vi.fn() } }));
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => isTenantAdminMock() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client';
import { tts } from '$lib/api/tts.js';
import { toastError } from '$lib/stores/toast.svelte.js';
import type { TenantDefaultsWire } from '$lib/api/tenant-defaults.js';
import Card from './TenantDefaultsCard.svelte';

const DEPLOYMENT = {
	captions_mode: 'none' as const,
	captions_karaoke: false,
	voice_direction_tone: 'confident',
	retention_mode: 'critique_only' as const,
	timing_director_model_tier: 'tier-flash'
};

function view(over: Partial<TenantDefaultsWire> = {}): TenantDefaultsWire {
	return {
		version: 2,
		updated_at: '2026-10-09T10:00:00Z',
		voice: { voice_id: 'af_bella' },
		captions: { mode: 'overlay' },
		deployment: DEPLOYMENT,
		...over
	};
}

const voiceSelect = () => document.getElementById('defaults-voice') as HTMLSelectElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: /Save defaults/ }));

beforeEach(() => {
	vi.clearAllMocks();
	isTenantAdminMock.mockReturnValue(true);
	providersList.mockResolvedValue({ items: [] });
	defaultsGet.mockResolvedValue(view());
});

describe('TenantDefaultsCard', () => {
	it('saves the whole document with the loaded version; "deployment default" fields go as null', async () => {
		defaultsPut.mockResolvedValue(view({ version: 3, voice: { voice_id: 'bm_george' } }));
		render(Card);
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		// Deployment labels name what null resolves to.
		expect(document.body.textContent).toContain('Deployment default (No captions)');
		expect(document.body.textContent).toContain('Deployment default (tier-flash)');

		await fireEvent.change(voiceSelect(), { target: { value: 'bm_george' } });
		const karaoke = document.querySelector('select[name="defaults-karaoke"]') as HTMLSelectElement;
		await fireEvent.change(karaoke, { target: { value: 'on' } });
		await save();

		await waitFor(() => expect(defaultsPut).toHaveBeenCalledTimes(1));
		expect(defaultsPut.mock.calls[0][0]).toEqual({
			expected_version: 2,
			voice: { voice_id: 'bm_george', speed: null },
			brand: null,
			captions: { mode: 'overlay', karaoke: true },
			voice_direction: null,
			retention_mode: null,
			model_tier: null
		});
		// No logo field anywhere in the body (the API refuses brand.logo_key).
		expect(JSON.stringify(defaultsPut.mock.calls[0][0])).not.toContain('logo');
		expect(await screen.findByTestId('tenant-defaults-version')).toHaveTextContent('Version 3');
	});

	it('409 VERSION_CONFLICT: explains, reloads the latest version, keeps the editor usable', async () => {
		defaultsPut.mockRejectedValue(
			new ApiError(409, 'Conflict', 'expected version 2, current is 4', 'VERSION_CONFLICT')
		);
		render(Card);
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		defaultsGet.mockResolvedValue(view({ version: 4, voice: { voice_id: 'am_adam' } }));
		await save();

		expect(await screen.findByTestId('tenant-defaults-error')).toHaveTextContent(
			'Someone else changed these defaults'
		);
		await waitFor(() => expect(defaultsGet).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(voiceSelect().value).toBe('am_adam'));
		expect(screen.getByRole('button', { name: /Save defaults/ })).not.toBeDisabled();
	});

	it('422 UNKNOWN_VOICE: shows the API detail under the voice field', async () => {
		const detail =
			"voice_id 'nova-x' is not a voice the narration backend accepts; choose one of the 54 catalog voices, or configure a tenant TTS provider first";
		defaultsPut.mockRejectedValue(new ApiError(422, 'Unprocessable', detail, 'UNKNOWN_VOICE'));
		render(Card);
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		await save();
		expect(await screen.findByTestId('defaults-voice-error')).toHaveTextContent(detail);
	});

	it('offers only catalog voices without a tenant TTS connection; a free-text id with one', async () => {
		const { unmount } = render(Card);
		await waitFor(() => expect(providersList).toHaveBeenCalled());
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		const values = [...voiceSelect().options].map((o) => o.value);
		expect(values).toHaveLength(55); // deployment default + 54 kokoro catalog voices
		expect(values).not.toContain('__custom__');
		unmount();

		providersList.mockResolvedValue({
			items: [{ slot: 'tts', source: 'tenant', connection: { id: 'c-1' } }]
		});
		render(Card);
		await waitFor(() =>
			expect([...voiceSelect().options].map((o) => o.value)).toContain('__custom__')
		);
		await fireEvent.change(voiceSelect(), { target: { value: '__custom__' } });
		expect(document.querySelector('input[name="defaults-voice-custom"]')).not.toBeNull();
	});

	it('client-side validation blocks an out-of-range speed and a bad hex color', async () => {
		render(Card);
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		await fireEvent.input(document.querySelector('input[name="defaults-speed"]')!, {
			target: { value: '3' }
		});
		await fireEvent.input(document.querySelector('input[name="defaults-primaryColor"]')!, {
			target: { value: 'blue' }
		});
		await save();
		expect(defaultsPut).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('Speed must be 0.5 – 2.0.');
		expect(document.body.textContent).toContain('Use a hex color like #4F46E5.');
	});

	it('member: read-only — fields disabled, no Save, no tenant-admin-only lookups', async () => {
		isTenantAdminMock.mockReturnValue(false);
		render(Card);
		expect(await screen.findByTestId('tenant-defaults-readonly')).toBeTruthy();
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		expect(voiceSelect().closest('fieldset')).toBeDisabled();
		expect(screen.queryByRole('button', { name: /Save defaults/ })).toBeNull();
		expect(providersList).not.toHaveBeenCalled();
	});

	// w2v_orchestrator#1106: the preview's 402 byo_provider_required renders the
	// inline what-to-do notice instead of the generic "Voice preview failed" toast.
	const previewButton = () => screen.getByRole('button', { name: /Preview/ });

	it('voice preview 402 byo_provider_required: BYO notice + settings link, no generic toast', async () => {
		vi.mocked(tts.previewVoice).mockRejectedValueOnce(
			new ApiError(
				402,
				'Payment Required',
				'Configure your own TTS provider to continue',
				'HTTP_402',
				{
					code: 'byo_provider_required',
					modality: 'tts',
					message: 'Configure your own TTS provider to continue'
				}
			)
		);
		render(Card);
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		await fireEvent.click(previewButton());
		const notice = await screen.findByTestId('byo-provider-required');
		expect(notice).toHaveTextContent('Configure your own TTS provider to continue');
		expect(screen.getByTestId('byo-provider-settings-link')).toHaveAttribute(
			'href',
			'/providers?missing=tts#provider-slot-tts'
		);
		expect(toastError).not.toHaveBeenCalled();
	});

	it('voice preview: any other failure keeps the generic toast and shows no BYO notice', async () => {
		vi.mocked(tts.previewVoice).mockRejectedValueOnce(
			new ApiError(502, 'Bad Gateway', 'voice preview failed: boom')
		);
		render(Card);
		await waitFor(() => expect(voiceSelect().value).toBe('af_bella'));
		await fireEvent.click(previewButton());
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		expect(vi.mocked(toastError).mock.calls[0][0]).toBe('Voice preview failed');
		expect(screen.queryByTestId('byo-provider-required')).toBeNull();
	});
});

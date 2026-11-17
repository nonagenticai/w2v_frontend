import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const previewMock = vi.fn();

const authHolder = vi.hoisted(() => ({ tenantAdmin: true }));
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => authHolder.tenantAdmin }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

vi.mock('$lib/api', () => ({
	tts: { previewVoice: (...a: unknown[]) => previewMock(...a) },
	ApiError: class ApiError extends Error {
		detail: string;
		constructor(detail = '') {
			super(detail);
			this.detail = detail;
		}
	}
}));

import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import VoiceEditor from './VoiceEditor.svelte';
import type { VoiceConfig } from '$lib/types';

// jsdom has neither blob URLs nor real media playback.
beforeAll(() => {
	URL.createObjectURL = vi.fn(() => 'blob:preview');
	URL.revokeObjectURL = vi.fn();
	HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
	HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
	vi.clearAllMocks();
	authHolder.tenantAdmin = true;
	previewMock.mockResolvedValue(new Blob(['x'], { type: 'audio/wav' }));
});

describe('VoiceEditor', () => {
	it('prefills the select + speed from the provided value', () => {
		const { getByLabelText } = render(VoiceEditor, {
			value: { voice_id: 'am_michael', speed: 1.3 } as VoiceConfig
		});
		expect((getByLabelText('Narration voice') as HTMLSelectElement).value).toBe('am_michael');
		// speed readout rendered in the label
		expect(getByLabelText(/^Speed/).id).toBe('voice-speed');
	});

	it('previews the selected voice at the current speed', async () => {
		const { getByRole } = render(VoiceEditor, {
			value: { voice_id: 'am_puck', speed: 1.2 } as VoiceConfig
		});
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		await tick();
		expect(previewMock).toHaveBeenCalledTimes(1);
		expect(previewMock).toHaveBeenCalledWith({ voice: 'am_puck', speed: 1.2 });
	});

	it('falls back to the default narrator voice when none is selected', async () => {
		const { getByRole } = render(VoiceEditor, { value: {} as VoiceConfig });
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		await tick();
		expect(previewMock).toHaveBeenCalledWith({ voice: 'af_heart', speed: 1.0 });
	});

	it('surfaces a preview error', async () => {
		previewMock.mockRejectedValueOnce(new Error('tts down'));
		const { getByRole, findByTestId } = render(VoiceEditor, {
			value: { voice_id: 'af_bella' } as VoiceConfig
		});
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		const err = await findByTestId('voice-preview-error');
		expect(err.textContent).toContain('tts down');
	});

	// w2v_orchestrator#1106: a byo_required tenant without its own TTS provider
	// gets a 402 from POST /api/tts/preview. Shape = what postForBlob throws.
	const byo402 = () =>
		Object.assign(new Error('402 Payment Required'), {
			status: 402,
			detail: 'Configure your own TTS provider to continue',
			details: {
				code: 'byo_provider_required',
				modality: 'tts',
				message: 'Configure your own TTS provider to continue'
			}
		});

	it('a 402 byo_provider_required shows the BYO message + settings link, not the generic error', async () => {
		previewMock.mockRejectedValueOnce(byo402());
		const { getByRole, findByTestId, queryByTestId, getByTestId } = render(VoiceEditor, {
			value: { voice_id: 'af_bella' } as VoiceConfig
		});
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		const notice = await findByTestId('byo-provider-required');
		expect(notice.textContent).toContain('Configure your own TTS provider to continue');
		expect(getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=tts#provider-slot-tts'
		);
		expect(queryByTestId('voice-preview-error')).toBeNull();
	});

	it('a later successful preview clears the BYO notice', async () => {
		previewMock.mockRejectedValueOnce(byo402());
		const { getByRole, findByTestId, queryByTestId } = render(VoiceEditor, {
			value: { voice_id: 'af_bella' } as VoiceConfig
		});
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		await findByTestId('byo-provider-required');
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		await tick();
		await tick();
		expect(queryByTestId('byo-provider-required')).toBeNull();
	});

	it('a non-BYO 402 keeps the generic preview error', async () => {
		previewMock.mockRejectedValueOnce(
			Object.assign(new Error('licence required'), { status: 402, details: undefined })
		);
		const { getByRole, findByTestId, queryByTestId } = render(VoiceEditor, {
			value: { voice_id: 'af_bella' } as VoiceConfig
		});
		await fireEvent.click(getByRole('button', { name: /Preview/ }));
		expect((await findByTestId('voice-preview-error')).textContent).toContain('licence required');
		expect(queryByTestId('byo-provider-required')).toBeNull();
	});
});

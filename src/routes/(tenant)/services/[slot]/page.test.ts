// Service test bench — one page per GPU slot. The form, the exact request body,
// the result renderer, the history list and the refusal copy all come from the
// slot descriptor + `/api/services/*`, so these tests pin the wiring per slot
// rather than re-testing the descriptor table (that lives in `slots.test.ts`).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { labMock, providersMock, requirementsMock } = vi.hoisted(() => ({
	labMock: {
		run: vi.fn(),
		runForm: vi.fn(),
		history: vi.fn(),
		historyRun: vi.fn(),
		enhance: vi.fn()
	},
	providersMock: { list: vi.fn() },
	requirementsMock: { get: vi.fn() }
}));

vi.mock('$lib/api/serviceLab.js', async () => {
	const actual: typeof import('$lib/api/serviceLab.js') =
		await vi.importActual('$lib/api/serviceLab.js');
	return { ...actual, serviceLab: labMock };
});
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
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError, setActiveTenantId } from '$lib/api/client';
import type { ServiceRun } from '$lib/api/serviceLab.js';
import type { SlotId } from '$lib/services/slots.js';
import Page from './+page.svelte';

const IMAGE_RUN: ServiceRun = {
	id: 'r-1',
	slot: 'image',
	status: 'succeeded',
	created_at: '2026-11-01T10:00:00Z',
	duration_ms: 4200,
	provider: { source: 'deployment', kind: 'local_image', model: null },
	request: { prompt: 'A red fox in fresh snow' },
	output_kind: 'image',
	text: null,
	media_url: '/api/services/image/history/r-1/media',
	media_content_type: 'image/png',
	error: null
};

const VIDEO_RUN: ServiceRun = {
	id: 'v-1',
	slot: 'video',
	status: 'succeeded',
	created_at: '2026-11-01T09:00:00Z',
	duration_ms: 61_000,
	provider: { source: 'deployment', kind: 'stub', model: null },
	request: { prompt: 'A lighthouse at dusk' },
	output_kind: 'video',
	text: null,
	media_url: '/api/services/video/history/v-1/media',
	media_content_type: 'video/mp4',
	error: null
};

const ASR_RUN: ServiceRun = {
	id: 'a-1',
	slot: 'asr',
	status: 'succeeded',
	created_at: '2026-11-01T08:00:00Z',
	duration_ms: 1500,
	provider: { source: 'deployment', kind: 'local_asr', model: null },
	request: { language: 'en' },
	output_kind: 'transcript',
	text: 'Hello there.',
	media_url: null,
	media_content_type: null,
	error: null
};

const slotView = (slot: string) => ({
	slot,
	type: 'connection',
	writable: false,
	allowed_kinds: [],
	source: 'deployment',
	default_kind: 'local_image',
	byo_required: false,
	connection: null
});

beforeEach(() => {
	vi.clearAllMocks();
	setActiveTenantId(null);
	for (const fn of [
		labMock.run,
		labMock.runForm,
		labMock.history,
		labMock.historyRun,
		labMock.enhance,
		providersMock.list,
		requirementsMock.get
	]) {
		fn.mockReset();
	}
	labMock.history.mockResolvedValue({ items: [] });
	providersMock.list.mockResolvedValue({ items: [slotView('image'), slotView('video')] });
	requirementsMock.get.mockResolvedValue({ slots: [], dependencies: [] });
});

/** Render a slot and wait until the page's initial loads have actually run. */
async function renderSlot(slot: SlotId) {
	const view = render(Page, { props: { data: { slot } } });
	await waitFor(() => expect(labMock.history).toHaveBeenCalled());
	return view;
}

const typePrompt = async (value: string) =>
	fireEvent.input(screen.getByLabelText('Prompt'), { target: { value } });

describe('one form per slot', () => {
	const FORMS: {
		slot: SlotId;
		labels: string[];
		action: string;
		enhance: boolean;
	}[] = [
		{
			slot: 'image',
			labels: ['Prompt', 'Width', 'Height', 'Seed'],
			action: 'Generate image',
			enhance: true
		},
		{
			slot: 'tts',
			labels: ['Text', 'Voice', 'Speed'],
			action: 'Synthesize speech',
			enhance: false
		},
		{ slot: 'asr', labels: ['Audio file', 'Language'], action: 'Transcribe', enhance: false },
		{
			slot: 'llm',
			labels: ['Prompt', 'System prompt'],
			action: 'Send prompt',
			enhance: true
		},
		{
			slot: 'vlm',
			labels: ['Image file', 'Image URL', 'Prompt'],
			action: 'Ask about image',
			enhance: true
		},
		{ slot: 'ocr', labels: ['Document'], action: 'Extract text', enhance: false },
		{ slot: 'video', labels: ['Prompt', 'Seconds'], action: 'Generate video', enhance: true }
	];

	it('renders the descriptor fields, the submit action and (only) the prompt Enhance button', async () => {
		for (const form of FORMS) {
			const { unmount } = await renderSlot(form.slot);
			for (const label of form.labels) {
				expect(screen.getByLabelText(label), `${form.slot}: ${label}`).toBeTruthy();
			}
			expect(screen.getByRole('button', { name: form.action })).toBeTruthy();
			expect(!!screen.queryByTestId('enhance-prompt'), form.slot).toBe(form.enhance);
			unmount();
		}
	});
});

describe('submit sends the exact body the contract expects', () => {
	it('image is JSON, with only the fields the user filled in and numbers as numbers', async () => {
		labMock.run.mockResolvedValue(IMAGE_RUN);
		await renderSlot('image');
		await typePrompt('A red fox in fresh snow');
		await fireEvent.input(screen.getByLabelText('Width'), { target: { value: '512' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

		await waitFor(() => expect(labMock.run).toHaveBeenCalledTimes(1));
		expect(labMock.run.mock.calls[0]).toEqual([
			'image',
			{ prompt: 'A red fox in fresh snow', width: 512 }
		]);
		expect(labMock.runForm).not.toHaveBeenCalled();
	});

	it('asr is multipart: the picked file plus the filled text fields', async () => {
		labMock.runForm.mockResolvedValue(ASR_RUN);
		await renderSlot('asr');
		const clip = new File(['audio-bytes'], 'clip.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(screen.getByLabelText('Audio file'), { target: { files: [clip] } });
		await fireEvent.input(screen.getByLabelText('Language'), { target: { value: 'en' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Transcribe' }));

		await waitFor(() => expect(labMock.runForm).toHaveBeenCalledTimes(1));
		const [slot, body] = labMock.runForm.mock.calls[0];
		expect(slot).toBe('asr');
		expect((body as FormData).get('file')).toBe(clip);
		expect((body as FormData).get('language')).toBe('en');
		expect(labMock.run).not.toHaveBeenCalled();
	});
});

describe('result and history', () => {
	it('a succeeded image run renders <img src> and adds a row to the history', async () => {
		labMock.run.mockResolvedValue(IMAGE_RUN);
		await renderSlot('image');
		expect(screen.getByTestId('service-history').textContent).toContain('No runs yet');

		await typePrompt('A red fox in fresh snow');
		await fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

		const img = await screen.findByTestId('result-image');
		expect(img.getAttribute('src')).toBe('/api/services/image/history/r-1/media');
		const rows = await screen.findAllByTestId('history-row');
		expect(rows).toHaveLength(1);
		expect(within(rows[0]).getByTestId('history-prompt').textContent).toContain(
			'A red fox in fresh snow'
		);
	});

	it('history from a previous load renders, names the provider, and reopens the run', async () => {
		labMock.history.mockResolvedValue({ items: [IMAGE_RUN] });
		labMock.historyRun.mockResolvedValue(IMAGE_RUN);
		await renderSlot('image');

		const row = await screen.findByTestId('history-row');
		expect(within(row).getByTestId('history-meta').textContent).toContain(
			'Platform default · local_image'
		);
		expect(within(row).getByTestId('history-thumb').querySelector('img')?.getAttribute('src')).toBe(
			'/api/services/image/history/r-1/media'
		);

		await fireEvent.click(within(row).getByTestId('history-open'));
		await waitFor(() => expect(labMock.historyRun).toHaveBeenCalledWith('image', 'r-1'));
		expect(await screen.findByTestId('result-image')).toBeTruthy();
	});
});

describe('refusals are rendered truthfully', () => {
	it('402 byo_provider_required shows the message and the Providers link', async () => {
		labMock.run.mockRejectedValue(
			new ApiError(
				402,
				'Payment Required',
				'Configure your own image provider to continue',
				'byo_provider_required',
				{
					code: 'byo_provider_required',
					modality: 'image',
					slots: 'image'
				}
			)
		);
		await renderSlot('image');
		await typePrompt('a fox');
		await fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

		const error = await screen.findByTestId('service-error');
		expect(error.textContent).toContain('Configure your own image provider to continue');
		expect(screen.getByTestId('service-error-providers').getAttribute('href')).toBe('/providers');
	});

	it('422 names what the service rejected instead of blaming it', async () => {
		// The orchestrator's `invalid_service_input` refusal (a PNG posted to
		// /asr, a blank prompt). Before this branch existed it fell through to
		// the generic "The service call failed.", which reads like an outage.
		labMock.run.mockRejectedValue(
			new ApiError(422, 'Unprocessable Entity', "asr needs an audio upload, got 'image/png'")
		);
		await renderSlot('image');
		await typePrompt('a fox');
		await fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

		const error = await screen.findByTestId('service-error');
		expect(error.textContent).toContain('The service rejected these inputs');
		expect(error.textContent).toContain('asr needs an audio upload');
	});

	it('503 busy quotes the Retry-After window', async () => {
		labMock.run.mockRejectedValue(
			new ApiError(503, 'Service Unavailable', 'busy', undefined, undefined, 30)
		);
		await renderSlot('image');
		await typePrompt('a fox');
		await fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

		const error = await screen.findByTestId('service-error');
		expect(error.textContent).toMatch(/try again in 30 s/i);
		expect(screen.queryByTestId('service-error-providers')).toBeNull();
	});
});

describe('Enhance prompt', () => {
	const enhanceButton = () =>
		within(screen.getByTestId('enhance-prompt')).getByRole('button', { name: 'Enhance prompt' });

	it('is disabled while the prompt is empty', async () => {
		await renderSlot('image');
		expect(enhanceButton()).toBeDisabled();
	});

	it('sends {prompt, target}, replaces the text, and never submits the run', async () => {
		const rewrite = 'A red fox in fresh snow, golden hour, 35mm photograph, shallow depth of field';
		labMock.enhance.mockResolvedValue({ prompt: rewrite });
		await renderSlot('image');
		await typePrompt('a fox');
		await fireEvent.click(enhanceButton());

		await waitFor(() => expect(labMock.enhance).toHaveBeenCalledWith('a fox', 'image'));
		await waitFor(() =>
			expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(rewrite)
		);
		expect(labMock.run).not.toHaveBeenCalled();
	});

	it('keeps the user text untouched when the rewrite fails, and says so', async () => {
		labMock.enhance.mockRejectedValue(new ApiError(502, 'Bad Gateway', 'upstream exploded'));
		await renderSlot('image');
		await typePrompt('a fox');
		await fireEvent.click(enhanceButton());

		expect(await screen.findByTestId('enhance-error')).toBeTruthy();
		expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('a fox');
	});
});

describe('video slot', () => {
	it('plays the clip and states that the stub renderer is a placeholder', async () => {
		labMock.run.mockResolvedValue(VIDEO_RUN);
		await renderSlot('video');
		await typePrompt('A lighthouse at dusk');
		await fireEvent.click(screen.getByRole('button', { name: 'Generate video' }));

		expect(await screen.findByTestId('result-video')).toBeTruthy();
		expect(screen.getByTestId('result-provider').textContent).toContain('Platform default · stub');
		expect(screen.getByTestId('result-stub').textContent).toContain('placeholder');
	});

	it('history renders a previous clip with its provider', async () => {
		labMock.history.mockResolvedValue({ items: [VIDEO_RUN] });
		await renderSlot('video');

		const row = await screen.findByTestId('history-row');
		expect(within(row).getByTestId('history-video')).toBeTruthy();
		expect(within(row).getByTestId('history-meta').textContent).toContain(
			'Platform default · stub'
		);
	});

	it('a 409 renders the no-renderer state with the Providers link — and no player', async () => {
		labMock.run.mockRejectedValue(
			new ApiError(409, 'Conflict', 'video_renderer_unavailable', 'video_renderer_unavailable')
		);
		await renderSlot('video');
		await typePrompt('A lighthouse at dusk');
		await fireEvent.click(screen.getByRole('button', { name: 'Generate video' }));

		const error = await screen.findByTestId('service-error');
		expect(error.textContent).toContain('No video renderer is configured on this deployment');
		expect(screen.getByTestId('service-error-providers').getAttribute('href')).toBe('/providers');
		expect(screen.queryByTestId('result-video')).toBeNull();
		expect(screen.queryByTestId('service-result')).toBeNull();
	});
});

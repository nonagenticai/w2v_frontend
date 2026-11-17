import { describe, it, expect, vi, beforeEach } from 'vitest';

const { providersMock } = vi.hoisted(() => ({
	providersMock: { list: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn() }
}));
vi.mock('$lib/api/providers.js', async () => {
	const actual: typeof import('$lib/api/providers.js') =
		await vi.importActual('$lib/api/providers.js');
	return { ...actual, providers: providersMock };
});
const { requirementsMock } = vi.hoisted(() => ({ requirementsMock: { get: vi.fn() } }));
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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client';
import type { SlotView } from '$lib/api/providers.js';
import type { ProviderRequirements } from '$lib/api/provider-requirements.js';
import { MANIFEST } from '$lib/components/providers/manifest.fixture';
import Page from './+page.svelte';

const SECRET = 'sk-live-THIS-MUST-NEVER-RENDER-0123456789';

function llm(over: Partial<SlotView> = {}): SlotView {
	return {
		slot: 'llm',
		type: 'connection',
		writable: true,
		allowed_kinds: ['anthropic', 'openai-compatible'],
		source: 'deployment',
		default_kind: 'nonagentic-wm',
		byo_required: false,
		connection: null,
		...over
	};
}
const TTS: SlotView = {
	slot: 'tts',
	type: 'connection',
	writable: false,
	allowed_kinds: [],
	source: 'deployment',
	default_kind: 'kokoro',
	byo_required: false,
	connection: null
};
const TENANT_LLM = llm({
	source: 'tenant',
	connection: {
		id: 'c-1',
		kind: 'openai-compatible',
		base_url: 'https://llm.example.com/v1',
		model: 'gpt-x',
		options: {},
		version: 2,
		has_secret: true,
		key_fingerprint: 'a1b2c3d4e5f6',
		last_test_at: '2026-10-08T10:00:00Z',
		last_test_ok: false,
		last_test_error: 'upstream 401'
	}
});

const apiErr = (status: number, code: string, msg = 'server message', details?: object) =>
	new ApiError(status, 'x', msg, code, details as Record<string, unknown> | undefined);

beforeEach(() => {
	vi.clearAllMocks();
	providersMock.list.mockResolvedValue({ items: [llm(), TTS] });
	requirementsMock.get.mockResolvedValue(MANIFEST);
});

async function llmCard(): Promise<HTMLElement> {
	return screen.findByTestId('provider-card-llm');
}
function input(card: HTMLElement, label: string): HTMLInputElement {
	return within(card).getByLabelText(label) as HTMLInputElement;
}
async function choose(select: HTMLSelectElement, value: string): Promise<void> {
	await fireEvent.change(select, { target: { value } });
}
async function submit(card: HTMLElement): Promise<void> {
	await fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
}

describe('(tenant)/providers — no tenant connection', () => {
	it('shows the platform default, an empty secret field, kinds limited to allowed_kinds', async () => {
		render(Page);
		const card = await llmCard();
		expect(within(card).getByTestId('provider-source-llm').textContent).toContain(
			'Platform default'
		);
		expect(card.textContent).toContain('Platform (Nonagentic)');
		const kinds = Array.from(
			(within(card).getByLabelText('Provider type') as HTMLSelectElement).options
		)
			.map((o) => o.value)
			.filter(Boolean);
		expect(kinds).toEqual(['anthropic', 'openai-compatible']);
		expect(input(card, 'API key').value).toBe('');
		expect(within(card).queryByTestId('provider-secret-stored')).toBeNull();
		expect(within(card).queryByRole('button', { name: 'Remove' })).toBeNull();
	});

	it('the secret field is a password input with autocomplete + spellcheck off', async () => {
		render(Page);
		const card = await llmCard();
		const secret = input(card, 'API key');
		expect(secret.type).toBe('password');
		expect(secret.getAttribute('autocomplete')).toBe('off');
		expect(secret.getAttribute('spellcheck')).toBe('false');
		// Input's default is unchanged: other fields carry no autocomplete attribute.
		expect(input(card, 'Model').hasAttribute('autocomplete')).toBe(false);
		expect(input(card, 'Model').hasAttribute('spellcheck')).toBe(false);
	});

	it('renders a non-writable slot read-only as platform provided', async () => {
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		expect(within(card).getByTestId('provider-readonly').textContent).toMatch(/Platform provided/);
		expect(within(card).queryByRole('button', { name: 'Save' })).toBeNull();
		expect(within(card).queryByRole('button', { name: 'Test' })).toBeNull();
	});

	it('saves with expected_version 0 and the typed key, then forgets the key', async () => {
		providersMock.save.mockResolvedValue({
			...TENANT_LLM,
			connection: { ...TENANT_LLM.connection!, version: 1, last_test_ok: true }
		});
		render(Page);
		const card = await llmCard();
		await choose(
			within(card).getByLabelText('Provider type') as HTMLSelectElement,
			'openai-compatible'
		);
		await fireEvent.input(input(card, 'Base URL'), {
			target: { value: 'https://llm.example.com/v1' }
		});
		await fireEvent.input(input(card, 'Model'), { target: { value: 'gpt-x' } });
		await fireEvent.input(input(card, 'API key'), { target: { value: SECRET } });
		await submit(card);

		await waitFor(() =>
			expect(providersMock.save).toHaveBeenCalledWith('llm', {
				kind: 'openai-compatible',
				base_url: 'https://llm.example.com/v1',
				model: 'gpt-x',
				secret: SECRET,
				expected_version: 0
			})
		);
		const after = await llmCard();
		await waitFor(() =>
			expect(within(after).getByTestId('provider-source-llm').textContent).toContain(
				'Your connection'
			)
		);
		// The key is gone from the DOM: not as text, not as any input's value.
		expect(document.body.textContent).not.toContain(SECRET);
		for (const el of Array.from(document.querySelectorAll('input'))) {
			expect(el.value).not.toBe(SECRET);
		}
		expect(within(after).getByTestId('provider-secret-stored').textContent).toContain(
			'a1b2c3d4e5f6'
		);
	});
});

describe('(tenant)/providers — tenant connection', () => {
	beforeEach(() => {
		providersMock.list.mockResolvedValue({ items: [TENANT_LLM, TTS] });
	});

	it('shows source, fingerprint (never a key), pre-filled fields and the last test status', async () => {
		render(Page);
		const card = await llmCard();
		expect(within(card).getByTestId('provider-source-llm').textContent).toContain(
			'Your connection'
		);
		expect(within(card).getByTestId('provider-secret-stored').textContent).toContain(
			'a1b2c3d4e5f6'
		);
		expect(within(card).queryByLabelText('API key')).toBeNull();
		expect(input(card, 'Base URL').value).toBe('https://llm.example.com/v1');
		expect(input(card, 'Model').value).toBe('gpt-x');
		const last = within(card).getByTestId('provider-last-test').textContent ?? '';
		expect(last).toContain('failed');
		expect(last).toContain('upstream 401');
	});

	it('keep → secret key OMITTED; clear → ""; replace → the typed value', async () => {
		let v = 2;
		providersMock.save.mockImplementation(async () => ({
			...TENANT_LLM,
			connection: { ...TENANT_LLM.connection!, version: ++v }
		}));
		render(Page);
		let card = await llmCard();
		await submit(card);
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(1));
		expect(providersMock.save.mock.calls[0][1]).toMatchObject({ expected_version: 2 });
		// Keep must leave the key out entirely — `null` is not the same wire shape.
		expect(Object.keys(providersMock.save.mock.calls[0][1])).not.toContain('secret');

		card = await llmCard();
		await fireEvent.click(within(card).getByRole('button', { name: 'Clear' }));
		expect(within(card).getByTestId('provider-secret-cleared')).toBeTruthy();
		await submit(card);
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(2));
		expect(providersMock.save.mock.calls[1][1]).toMatchObject({ secret: '', expected_version: 3 });

		card = await llmCard();
		await fireEvent.click(within(card).getByRole('button', { name: 'Replace' }));
		await fireEvent.input(input(card, 'API key'), { target: { value: 'sk-rotated' } });
		await submit(card);
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(3));
		expect(providersMock.save.mock.calls[2][1]).toMatchObject({ secret: 'sk-rotated' });
	});

	it('Test sends the draft and shows the result with the upstream status', async () => {
		providersMock.test.mockResolvedValue({
			ok: false,
			message: 'invalid key',
			upstream_status: 401
		});
		render(Page);
		const card = await llmCard();
		await fireEvent.click(within(card).getByRole('button', { name: 'Test' }));
		await waitFor(() =>
			expect(providersMock.test).toHaveBeenCalledWith('llm', {
				kind: 'openai-compatible',
				base_url: 'https://llm.example.com/v1',
				model: 'gpt-x'
			})
		);
		// toHaveBeenCalledWith treats `secret: undefined` as absent — check the keys.
		expect(Object.keys(providersMock.test.mock.calls[0][1])).not.toContain('secret');
		const result = await within(card).findByTestId('provider-test-result');
		expect(result.textContent?.replace(/\s+/g, ' ')).toContain(
			'Test failed (HTTP 401): invalid key'
		);
	});

	it('Remove asks first, then DELETEs and falls back to the platform default', async () => {
		providersMock.remove.mockResolvedValue(undefined);
		render(Page);
		const card = await llmCard();
		await fireEvent.click(within(card).getByRole('button', { name: 'Remove' }));
		const confirm = await screen.findByTestId('provider-remove-confirm');
		expect(providersMock.remove).not.toHaveBeenCalled();
		providersMock.list.mockResolvedValue({ items: [llm(), TTS] });
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(providersMock.remove).toHaveBeenCalledWith('llm'));
		await waitFor(async () =>
			expect(within(await llmCard()).getByTestId('provider-source-llm').textContent).toContain(
				'Platform default'
			)
		);
	});
});

describe('(tenant)/providers — save error codes render inline', () => {
	beforeEach(() => {
		providersMock.list.mockResolvedValue({ items: [TENANT_LLM, TTS] });
	});

	it('PROVIDER_TEST_FAILED shows the upstream status; nothing replaced', async () => {
		providersMock.save.mockRejectedValue(
			apiErr(422, 'PROVIDER_TEST_FAILED', 'Unauthorized', { upstream_status: 401 })
		);
		render(Page);
		const card = await llmCard();
		await submit(card);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toContain('HTTP 401');
		expect(err.textContent).toContain('Nothing was saved');
		expect(within(card).getByTestId('provider-source-llm').textContent).toContain(
			'Your connection'
		);
	});

	it('SECRET_REENTRY_REQUIRED opens and focuses the secret field', async () => {
		providersMock.save.mockRejectedValue(apiErr(422, 'SECRET_REENTRY_REQUIRED'));
		render(Page);
		const card = await llmCard();
		await fireEvent.input(input(card, 'Base URL'), {
			target: { value: 'https://other.example.com/v1' }
		});
		await submit(card);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toMatch(/enter the API key again/);
		const secret = input(card, 'API key');
		await waitFor(() => expect(document.activeElement).toBe(secret));
		expect(secret.value).toBe('');
	});

	it('EGRESS_REFUSED shows the reason', async () => {
		providersMock.save.mockRejectedValue(
			apiErr(422, 'EGRESS_REFUSED', 'host resolves to a private address')
		);
		render(Page);
		const card = await llmCard();
		await submit(card);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toContain('not allowed');
		expect(err.textContent).toContain('host resolves to a private address');
	});

	it('VERSION_CONFLICT reloads the latest state and says so', async () => {
		providersMock.save.mockRejectedValue(apiErr(409, 'VERSION_CONFLICT'));
		const newer = {
			...TENANT_LLM,
			connection: { ...TENANT_LLM.connection!, version: 3, model: 'gpt-newer' }
		};
		render(Page);
		const card = await llmCard();
		providersMock.list.mockResolvedValue({ items: [newer, TTS] });
		await submit(card);
		await waitFor(() => expect(providersMock.list).toHaveBeenCalledTimes(2));
		const notice = await screen.findByTestId('provider-notice');
		expect(notice.textContent).toMatch(/reloaded/);
		expect(input(await llmCard(), 'Model').value).toBe('gpt-newer');
	});

	it.each([
		['SLOT_NOT_WRITABLE', /platform provided/],
		['INVALID_BASE_URL', /base URL is not valid/],
		['PROVIDER_KIND_NOT_ALLOWED', /provider type is not enabled/],
		['BASE_URL_REQUIRED', /needs a base URL/]
	])('%s renders its own message, not the raw server text', async (code, expected) => {
		providersMock.save.mockRejectedValue(apiErr(422, code, 'raw-server-text'));
		render(Page);
		const card = await llmCard();
		await submit(card);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toMatch(expected);
	});

	it('PROVIDER_KEYRING_UNAVAILABLE reads as a platform issue', async () => {
		providersMock.save.mockRejectedValue(apiErr(503, 'PROVIDER_KEYRING_UNAVAILABLE'));
		render(Page);
		const card = await llmCard();
		await submit(card);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toMatch(/platform issue/);
	});
});

describe('(tenant)/providers — rate limit (PROVIDER_TEST_RATE_LIMITED)', () => {
	beforeEach(() => {
		providersMock.list.mockResolvedValue({ items: [TENANT_LLM, TTS] });
	});

	function buttons(card: HTMLElement) {
		return {
			test: within(card).getByRole('button', { name: 'Test' }) as HTMLButtonElement,
			save: within(card).getByRole('button', { name: 'Save' }) as HTMLButtonElement
		};
	}

	it('Test: shows the wait and disables Test + Save until retry_after elapses', async () => {
		providersMock.test.mockRejectedValue(
			apiErr(429, 'PROVIDER_TEST_RATE_LIMITED', 'slow down', { retry_after: 1 })
		);
		render(Page);
		const card = await llmCard();
		await fireEvent.click(buttons(card).test);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toContain('Too many provider tests — try again in 1 s');
		await waitFor(() => expect(buttons(card).test.disabled).toBe(true));
		expect(buttons(card).save.disabled).toBe(true);
		// A click while cooling down sends nothing.
		await fireEvent.click(buttons(card).test);
		expect(providersMock.test).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(buttons(card).test.disabled).toBe(false), { timeout: 2500 });
		expect(buttons(card).save.disabled).toBe(false);
	});

	it('Save: uses the Retry-After header when details carry no retry_after', async () => {
		providersMock.save.mockRejectedValue(
			new ApiError(429, 'x', 'slow down', 'PROVIDER_TEST_RATE_LIMITED', undefined, 7)
		);
		render(Page);
		const card = await llmCard();
		await submit(card);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toContain('Too many provider tests — try again in 7 s');
		await waitFor(() => expect(buttons(card).save.disabled).toBe(true));
		expect(buttons(card).test.disabled).toBe(true);
	});
});

describe('(tenant)/providers — load failure', () => {
	it('shows an error state with retry', async () => {
		providersMock.list.mockRejectedValue(apiErr(403, 'FORBIDDEN', 'tenant_admin required'));
		render(Page);
		expect(await screen.findByText("Couldn't load providers")).toBeTruthy();
	});
});

describe('(tenant)/providers — P5 slots (kind-specific fields)', () => {
	const slot = (name: string, kinds: string[], over: Partial<SlotView> = {}): SlotView => ({
		slot: name,
		type: 'connection',
		writable: true,
		allowed_kinds: kinds,
		source: 'deployment',
		default_kind: 'nonagentic',
		byo_required: false,
		connection: null,
		...over
	});
	const TTS_W = slot('tts', ['openai', 'elevenlabs', 'openai-compatible']);
	const FARM = slot('device_farm', ['browserstack']);

	beforeEach(() => {
		providersMock.list.mockResolvedValue({
			items: [
				llm(),
				TTS_W,
				slot('image', ['openai']),
				FARM,
				slot('publish.youtube', [], { type: 'grant', writable: false })
			]
		});
	});

	it('renders the YouTube grant card once, not as a generic connection card', async () => {
		render(Page);
		await screen.findByTestId('provider-card-tts');
		expect(screen.getAllByTestId('provider-card-publish.youtube')).toHaveLength(1);
		expect(screen.queryByTestId('provider-readonly')).toBeNull();
	});

	it('labels and fields come from the manifest (tts openai: Voice is required there)', async () => {
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		expect(card.textContent).toContain('Text to speech');
		await fireEvent.input(input(card, 'API key'), { target: { value: 'sk-x' } });
		await submit(card);
		expect(await within(card).findByText('Voice is required.')).toBeTruthy();
		expect(providersMock.save).not.toHaveBeenCalled();
	});

	it('switching the tts kind swaps the fields (elevenlabs → Voice ID, compatible → Base URL)', async () => {
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		expect(within(card).getByLabelText('Voice')).toBeTruthy();
		await choose(within(card).getByLabelText('Provider type') as HTMLSelectElement, 'elevenlabs');
		expect(within(card).getByLabelText('Voice ID')).toBeTruthy();
		expect(within(card).queryByLabelText('Voice')).toBeNull();
	});

	it('missing required fields show inline and nothing is sent', async () => {
		render(Page);
		const card = await screen.findByTestId('provider-card-device_farm');
		expect(within(card).getByLabelText('Access key')).toBeTruthy();
		expect(within(card).queryByLabelText('Model')).toBeNull();
		await submit(card);
		expect(await within(card).findByText('Username is required.')).toBeTruthy();
		expect(within(card).getByText('Access key is required.')).toBeTruthy();
		await fireEvent.click(within(card).getByRole('button', { name: 'Test' }));
		expect(providersMock.save).not.toHaveBeenCalled();
		expect(providersMock.test).not.toHaveBeenCalled();
	});

	it('browserstack save sends options.username + secret; a 422 test failure shows inline', async () => {
		providersMock.save.mockRejectedValue(
			apiErr(422, 'PROVIDER_TEST_FAILED', 'bad credentials', { upstream_status: 401 })
		);
		render(Page);
		const card = await screen.findByTestId('provider-card-device_farm');
		await fireEvent.input(input(card, 'Username'), { target: { value: 'bob' } });
		await fireEvent.input(input(card, 'Access key'), { target: { value: SECRET } });
		await submit(card);
		await waitFor(() =>
			expect(providersMock.save).toHaveBeenCalledWith('device_farm', {
				kind: 'browserstack',
				base_url: null,
				model: null,
				secret: SECRET,
				options: { username: 'bob' },
				expected_version: 0
			})
		);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toContain('HTTP 401');
		expect(err.textContent).toContain('Nothing was saved');
	});

	it('kind change to a key-requiring kind demands a NEW key; the old key is never carried', async () => {
		const tenantTts = slot('tts', ['openai', 'elevenlabs', 'openai-compatible'], {
			source: 'tenant',
			connection: {
				id: 'c-tts',
				kind: 'openai',
				base_url: null,
				model: null,
				options: {},
				version: 4,
				has_secret: true,
				key_fingerprint: 'oldfp123',
				last_test_at: null,
				last_test_ok: null,
				last_test_error: null
			}
		});
		providersMock.list.mockResolvedValue({ items: [llm(), tenantTts] });
		providersMock.save.mockResolvedValue(tenantTts);
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		// Same kind: the stored key is offered.
		expect(within(card).getByTestId('provider-secret-stored')).toBeTruthy();
		await choose(within(card).getByLabelText('Provider type') as HTMLSelectElement, 'elevenlabs');
		// New kind: the stored (OpenAI) key is not offered and cannot be kept.
		expect(within(card).queryByTestId('provider-secret-stored')).toBeNull();
		expect(within(card).queryByRole('button', { name: 'Keep the stored key' })).toBeNull();
		await fireEvent.input(input(card, 'Voice ID'), { target: { value: 'voice-9' } });
		await submit(card);
		expect(await within(card).findByText('Enter a key for ElevenLabs.')).toBeTruthy();
		await fireEvent.click(within(card).getByRole('button', { name: 'Test' }));
		expect(providersMock.save).not.toHaveBeenCalled();
		expect(providersMock.test).not.toHaveBeenCalled();

		await fireEvent.input(input(card, 'API key'), { target: { value: 'xi-new' } });
		await submit(card);
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(1));
		expect(providersMock.save.mock.calls[0][1]).toMatchObject({
			kind: 'elevenlabs',
			secret: 'xi-new',
			expected_version: 4
		});
	});

	it('switching back to the saved kind restores keep-the-stored-key', async () => {
		const tenantTts = slot('tts', ['openai', 'elevenlabs'], {
			source: 'tenant',
			connection: {
				id: 'c-tts',
				kind: 'openai',
				base_url: null,
				model: null,
				options: {},
				version: 4,
				has_secret: true,
				key_fingerprint: 'oldfp123',
				last_test_at: null,
				last_test_ok: null,
				last_test_error: null
			}
		});
		providersMock.list.mockResolvedValue({ items: [llm(), tenantTts] });
		providersMock.save.mockResolvedValue(tenantTts);
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		const kindSelect = within(card).getByLabelText('Provider type') as HTMLSelectElement;
		await choose(kindSelect, 'elevenlabs');
		await choose(kindSelect, 'openai');
		expect(within(card).getByTestId('provider-secret-stored')).toBeTruthy();
		// The manifest marks options.voice required for tts/openai (server rule).
		await fireEvent.input(input(card, 'Voice'), { target: { value: 'alloy' } });
		await submit(card);
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(1));
		expect(Object.keys(providersMock.save.mock.calls[0][1])).not.toContain('secret');
	});

	it('elevenlabs save puts the voice id in options.voice', async () => {
		providersMock.save.mockResolvedValue(TTS_W);
		render(Page);
		const card = await screen.findByTestId('provider-card-tts');
		await choose(within(card).getByLabelText('Provider type') as HTMLSelectElement, 'elevenlabs');
		await fireEvent.input(input(card, 'Voice ID'), { target: { value: 'voice-123' } });
		await fireEvent.input(input(card, 'API key'), { target: { value: 'xi-key' } });
		await submit(card);
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(1));
		expect(providersMock.save.mock.calls[0]).toEqual([
			'tts',
			{
				kind: 'elevenlabs',
				base_url: null,
				model: null,
				secret: 'xi-key',
				options: { voice: 'voice-123' },
				expected_version: 0
			}
		]);
	});
});

describe('(tenant)/providers — P8 manifest', () => {
	const youtubeView = (over: Partial<SlotView> = {}): SlotView => ({
		slot: 'publish.youtube',
		type: 'grant',
		writable: false,
		allowed_kinds: [],
		source: 'deployment',
		default_kind: 'platform',
		byo_required: false,
		connection: null,
		...over
	});
	const withoutYoutube = (m: ProviderRequirements): ProviderRequirements => ({
		...m,
		slots: m.slots.filter((x) => x.slot !== 'publish.youtube')
	});

	it('shows webscraper + media_discovery under a read-only "Platform dependencies" note, not as slot cards', async () => {
		render(Page);
		const deps = await screen.findByTestId('provider-dependencies');
		expect(deps.textContent).toContain('Platform dependencies');
		expect(within(deps).getByTestId('provider-dependency-webscraper').textContent).toContain(
			'Web scraper'
		);
		expect(within(deps).getByTestId('provider-dependency-media_discovery').textContent).toContain(
			'Media discovery'
		);
		expect(deps.textContent).not.toMatch(/\bKAG\b/i);
		expect(within(deps).queryByRole('button')).toBeNull();
		expect(within(deps).queryByRole('textbox')).toBeNull();
		expect(screen.queryByTestId('provider-card-webscraper')).toBeNull();
		expect(screen.queryByTestId('provider-card-media_discovery')).toBeNull();
	});

	it('a manifest load failure fails the page (no form without the server rules)', async () => {
		requirementsMock.get.mockRejectedValue(apiErr(500, 'INTERNAL', 'boom'));
		render(Page);
		expect(await screen.findByText("Couldn't load providers")).toBeTruthy();
		expect(screen.queryByTestId('provider-card-llm')).toBeNull();
	});

	it('a kind the manifest does not describe renders no form and cannot be saved', async () => {
		providersMock.list.mockResolvedValue({ items: [llm({ allowed_kinds: ['brand-new-kind'] })] });
		render(Page);
		const card = await llmCard();
		expect(within(card).getByTestId('provider-no-form')).toBeTruthy();
		expect((within(card).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
			true
		);
	});

	it('publish.youtube offered as a grant: Connect is shown although writable=false', async () => {
		providersMock.list.mockResolvedValue({ items: [llm(), youtubeView()] });
		render(Page);
		const card = await screen.findByTestId('provider-card-publish.youtube');
		await waitFor(() => expect(card.getAttribute('data-state')).toBe('platform_default'));
		expect(within(card).getByRole('button', { name: 'Connect YouTube' })).toBeTruthy();
		expect(within(card).queryByTestId('youtube-not-writable')).toBeNull();
	});

	it('publish.youtube NOT writable (platform-provided connection slot): Connect hidden with a reason', async () => {
		providersMock.list.mockResolvedValue({
			items: [llm(), youtubeView({ type: 'connection', writable: false })]
		});
		requirementsMock.get.mockResolvedValue(withoutYoutube(MANIFEST));
		render(Page);
		const card = await screen.findByTestId('provider-card-publish.youtube');
		await waitFor(() => expect(card.getAttribute('data-state')).toBe('platform_default'));
		expect(within(card).queryByRole('button', { name: 'Connect YouTube' })).toBeNull();
		expect(within(card).getByTestId('youtube-not-writable').textContent).toMatch(
			/platform provided/
		);
	});

	it('publish.youtube absent from both APIs: Connect hidden, says it is not offered', async () => {
		requirementsMock.get.mockResolvedValue(withoutYoutube(MANIFEST));
		render(Page);
		const card = await screen.findByTestId('provider-card-publish.youtube');
		await waitFor(() => expect(card.getAttribute('data-state')).toBe('platform_default'));
		expect(within(card).queryByRole('button', { name: 'Connect YouTube' })).toBeNull();
		expect(within(card).getByTestId('youtube-not-writable').textContent).toMatch(/not offered/);
	});
});

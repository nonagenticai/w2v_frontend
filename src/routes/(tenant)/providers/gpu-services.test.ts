// Providers page — tenant GPU service registration (care-bus /admin/providers pattern):
// GPU & model services grouped apart from integrations, a summary table (source /
// model / key status), "Testing and saving…" while the live probe runs, an inline
// upstream error, and a read-only view for a non-admin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { providersMock, requirementsMock, auth } = vi.hoisted(() => ({
	providersMock: { list: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn() },
	requirementsMock: { get: vi.fn() },
	auth: { admin: true }
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
	isTenantAdmin: () => auth.admin
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
import type { ProviderRequirements, SlotRequirement } from '$lib/api/provider-requirements.js';
import { MANIFEST } from '$lib/components/providers/manifest.fixture';
import Page from './+page.svelte';

/** The orchestrator's new self-hosted kind, exactly as the manifest describes it. */
const ENDPOINT_KIND = {
	label: 'Nonagentic-protocol GPU endpoint',
	help: 'Your own GPU service speaking the Nonagentic protocol.',
	base_url: 'required' as const,
	default_base_url: null,
	model_required: false,
	secret_required: false,
	secret_label: 'Token',
	required_options: [],
	fields: [
		{
			key: 'base_url',
			label: 'Base URL',
			required: true,
			help: 'https://gpu.example.com/asr',
			format: 'url' as const
		}
	]
};
const ASR_REQ: SlotRequirement = {
	slot: 'asr',
	label: 'Speech to text',
	type: 'connection',
	default_kind: 'nonagentic',
	default_kind_label: 'Platform (Nonagentic)',
	allowed_kinds: ['nonagentic_endpoint'],
	byo_required: false,
	kinds: { nonagentic_endpoint: ENDPOINT_KIND },
	used_by: []
};
const WITH_ASR: ProviderRequirements = { ...MANIFEST, slots: [...MANIFEST.slots, ASR_REQ] };

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
const LLM_TENANT = slot('llm', ['anthropic', 'openai-compatible'], {
	default_kind: 'nonagentic-wm',
	source: 'tenant',
	connection: {
		id: 'c-1',
		kind: 'openai-compatible',
		base_url: 'https://api.nonagentic.ai/vllm/v1',
		model: 'local-llm',
		options: {},
		version: 3,
		has_secret: true,
		key_fingerprint: 'a1b2c3d4e5f6'
	}
});
const ASR = slot('asr', ['nonagentic_endpoint']);
const TTS = slot('tts', ['elevenlabs', 'openai', 'openai-compatible'], { byo_required: true });
const FARM = slot('device_farm', ['browserstack']);
const SCRAPE = slot('scrape', [], { writable: false, default_kind: 'platform' });

beforeEach(() => {
	vi.clearAllMocks();
	auth.admin = true;
	providersMock.list.mockResolvedValue({ items: [FARM, SCRAPE, TTS, ASR, LLM_TENANT] });
	requirementsMock.get.mockResolvedValue(WITH_ASR);
});

describe('grouping', () => {
	it('GPU & model services sit under their own heading, apart from integrations', async () => {
		render(Page);
		const gpu = await screen.findByTestId('providers-gpu');
		expect(within(gpu).getByRole('heading', { name: 'GPU & model services' })).toBeTruthy();
		const inGpu = ['llm', 'tts', 'asr'].map((s) => within(gpu).queryByTestId(`provider-card-${s}`));
		expect(inGpu.every(Boolean)).toBe(true);
		expect(within(gpu).queryByTestId('provider-card-device_farm')).toBeNull();
		const integrations = screen.getByTestId('providers-integrations');
		expect(within(integrations).getByTestId('provider-card-device_farm')).toBeTruthy();
		expect(within(integrations).getByTestId('provider-card-scrape')).toBeTruthy();
		// llm → tts → asr in GPU_SLOTS order, whatever order the server listed them in
		const order = within(gpu)
			.getAllByTestId(/^provider-card-/)
			.map((e) => e.dataset.testid);
		expect(order).toEqual(['provider-card-llm', 'provider-card-tts', 'provider-card-asr']);
	});
});

describe('summary table', () => {
	it('one row per GPU service: source, model, key status', async () => {
		render(Page);
		const table = await screen.findByTestId('providers-summary');
		const row = (s: string) => within(table).getByTestId(`providers-summary-${s}`);
		const cell = (s: string, c: string) => within(row(s)).getByTestId(`providers-summary-${c}`);
		expect(cell('llm', 'source').textContent).toBe('Your connection');
		expect(cell('llm', 'model').textContent).toBe('OpenAI-compatible · local-llm');
		expect(cell('llm', 'key').textContent).toBe('Stored');
		expect(cell('tts', 'source').textContent).toBe('Not configured');
		expect(cell('asr', 'source').textContent).toBe('Platform default');
		expect(cell('asr', 'key').textContent).toBe('—');
		expect(within(table).queryByTestId('providers-summary-device_farm')).toBeNull();
	});

	it('the caveat says the endpoint must be reachable over public https', async () => {
		render(Page);
		const gpu = await screen.findByTestId('providers-gpu');
		expect(gpu.textContent).toMatch(/reachable over public https/);
	});
});

describe('the new nonagentic_endpoint kind renders from the manifest', () => {
	it('label, required Base URL, optional token, owner-testing example endpoint', async () => {
		render(Page);
		const card = await screen.findByTestId('provider-card-asr');
		const kinds = within(card).getByLabelText('Provider type') as HTMLSelectElement;
		expect(Array.from(kinds.options).map((o) => o.textContent?.trim())).toContain(
			'Nonagentic-protocol GPU endpoint'
		);
		expect((within(card).getByLabelText('Base URL') as HTMLInputElement).placeholder).toMatch(
			/^Required/
		);
		expect((within(card).getByLabelText('Token') as HTMLInputElement).placeholder).toBe('Not set');
		expect(within(card).getByTestId('provider-example-endpoint').textContent).toContain(
			'https://api.nonagentic.ai/asr'
		);
	});

	it('saves base_url without a token (optional), expected_version 0', async () => {
		providersMock.save.mockResolvedValue({ ...ASR, source: 'tenant' });
		render(Page);
		const card = await screen.findByTestId('provider-card-asr');
		await fireEvent.input(within(card).getByLabelText('Base URL'), {
			target: { value: 'https://api.nonagentic.ai/asr' }
		});
		await fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(1));
		const [name, body] = providersMock.save.mock.calls[0]!;
		expect(name).toBe('asr');
		expect(body).toMatchObject({
			kind: 'nonagentic_endpoint',
			base_url: 'https://api.nonagentic.ai/asr',
			expected_version: 0
		});
		expect(Object.keys(body)).not.toContain('secret');
	});
});

describe('save → live test → save', () => {
	it('reads "Testing and saving…" while the probe runs; an upstream error shows inline', async () => {
		let reject!: (e: unknown) => void;
		providersMock.save.mockReturnValue(new Promise((_, r) => (reject = r)));
		render(Page);
		const card = await screen.findByTestId('provider-card-llm');
		await fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
		const busy = await within(card).findByRole('button', { name: /Testing and saving…/ });
		expect((busy as HTMLButtonElement).disabled).toBe(true);
		reject(
			new ApiError(422, 'x', 'connection refused', 'PROVIDER_TEST_FAILED', { upstream_status: 502 })
		);
		const err = await within(card).findByTestId('provider-error');
		expect(err.textContent).toMatch(/HTTP 502/);
		expect(err.textContent).toMatch(/Nothing was saved/);
		expect(within(card).getByRole('button', { name: 'Save' })).toBeTruthy();
	});

	it('a stored key: blank field placeholder says it is kept, and the save omits `secret`', async () => {
		providersMock.save.mockResolvedValue(LLM_TENANT);
		render(Page);
		const card = await screen.findByTestId('provider-card-llm');
		await fireEvent.click(within(card).getByRole('button', { name: 'Replace' }));
		const key = within(card).getByLabelText('API key') as HTMLInputElement;
		expect(key.placeholder).toBe('Stored; leave blank to keep it');
		await fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(providersMock.save).toHaveBeenCalledTimes(1));
		expect(Object.keys(providersMock.save.mock.calls[0]![1])).not.toContain('secret');
	});

	it('Remove confirms first and says the platform default applies again', async () => {
		render(Page);
		const card = await screen.findByTestId('provider-card-llm');
		await fireEvent.click(within(card).getByRole('button', { name: 'Remove' }));
		const confirm = await screen.findByTestId('provider-remove-confirm');
		expect(confirm.textContent).toMatch(/platform default/);
		expect(providersMock.remove).not.toHaveBeenCalled();
	});
});

describe('non-admin (member) view', () => {
	beforeEach(() => {
		auth.admin = false;
	});

	it('read-only callout, never calls the admin-only connections API, every control disabled', async () => {
		render(Page);
		expect(await screen.findByTestId('providers-readonly')).toBeTruthy();
		expect(providersMock.list).not.toHaveBeenCalled();
		const card = await screen.findByTestId('provider-card-llm');
		expect((within(card).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		expect((within(card).getByRole('button', { name: 'Test' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		expect((within(card).getByLabelText('Provider type') as HTMLSelectElement).disabled).toBe(true);
		// no claim about the tenant's state it could not read
		expect(screen.queryByTestId('providers-summary')).toBeNull();
		expect(within(card).queryByTestId('provider-source-llm')).toBeNull();
	});
});

describe('OCR slot — two kinds from the manifest (w2v_orchestrator#1150)', () => {
	const field = (key: string, label: string, required: boolean, help: string) => ({
		key,
		label,
		required,
		help,
		format: key === 'base_url' ? ('url' as const) : ('text' as const)
	});
	const OCR_KIND = (label: string, modelRequired: boolean) => ({
		...ENDPOINT_KIND,
		label,
		model_required: modelRequired,
		fields: [
			field('base_url', 'Base URL', true, 'https://ocr.example.com'),
			field('model', 'Model', modelRequired, 'the OCR model')
		]
	});
	const OCR_REQ: SlotRequirement = {
		...ASR_REQ,
		slot: 'ocr',
		label: 'Document OCR',
		default_kind: 'platform',
		default_kind_label: 'Platform',
		allowed_kinds: ['nonagentic_endpoint', 'openai-compatible'],
		kinds: {
			nonagentic_endpoint: OCR_KIND('Nonagentic-protocol endpoint', false),
			'openai-compatible': OCR_KIND('OpenAI-compatible', true)
		}
	};
	const OCR = slot('ocr', ['nonagentic_endpoint', 'openai-compatible'], {
		default_kind: 'platform'
	});

	beforeEach(() => {
		providersMock.list.mockResolvedValue({ items: [OCR, LLM_TENANT] });
		requirementsMock.get.mockResolvedValue({ ...MANIFEST, slots: [...MANIFEST.slots, OCR_REQ] });
	});

	it('renders in the GPU group; model required only for openai-compatible; shape follows the kind', async () => {
		render(Page);
		const gpu = await screen.findByTestId('providers-gpu');
		const card = within(gpu).getByTestId('provider-card-ocr');
		const base = within(card).getByLabelText('Base URL') as HTMLInputElement;
		expect(base.placeholder).toMatch(/^Required/);
		expect((within(card).getByLabelText('Model') as HTMLInputElement).placeholder).not.toMatch(
			/^Required/
		);
		const shape = within(card).getByTestId('provider-api-shape-ocr');
		expect(shape.textContent).toContain('POST /v1/ocr');

		await fireEvent.change(within(card).getByLabelText('Provider type'), {
			target: { value: 'openai-compatible' }
		});
		expect((within(card).getByLabelText('Model') as HTMLInputElement).placeholder).toMatch(
			/^Required/
		);
		expect(within(card).getByTestId('provider-api-shape-ocr').textContent).toMatch(
			/POST \/ocr .*\/v1/
		);
	});
});

describe('?missing=<slots> from a refused run start (#1150)', () => {
	afterEach(() => window.history.replaceState({}, '', '/'));

	it('highlights every named slot still without its own connection and lists it', async () => {
		window.history.replaceState({}, '', '/providers?missing=tts,llm,bogus');
		render(Page);
		const banner = await screen.findByTestId('providers-missing');
		// llm already has the tenant's own connection → no longer missing.
		expect(banner.getAttribute('data-slots')).toBe('tts');
		expect(screen.getByTestId('provider-card-tts').getAttribute('data-missing')).toBe('true');
		expect(screen.getByTestId('provider-missing-tts')).toBeTruthy();
		expect(screen.getByTestId('provider-card-llm').getAttribute('data-missing')).toBeNull();
	});

	it('no query → no banner, nothing highlighted', async () => {
		render(Page);
		await screen.findByTestId('provider-card-tts');
		expect(screen.queryByTestId('providers-missing')).toBeNull();
		expect(screen.getByTestId('provider-card-tts').getAttribute('data-missing')).toBeNull();
	});
});

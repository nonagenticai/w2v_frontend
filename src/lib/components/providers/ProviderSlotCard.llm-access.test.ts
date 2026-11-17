// ProviderSlotCard — "Used by", own-connection note, LLM-access lock / required flag,
// and "Load models" (POST /tenant/connections/{slot}/models → datalist, free text kept).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { providersMock } = vi.hoisted(() => ({
	providersMock: { list: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn(), models: vi.fn() }
}));
vi.mock('$lib/api/providers.js', async () => {
	const actual: typeof import('$lib/api/providers.js') =
		await vi.importActual('$lib/api/providers.js');
	return { ...actual, providers: providersMock };
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client.js';
import type { LlmAccessMode, ProviderSlot } from '$lib/api/providers.js';
import { MANIFEST } from './manifest.fixture';
import ProviderSlotCard from './ProviderSlotCard.svelte';

const REQ = MANIFEST.slots.find((s) => s.slot === 'llm')!;
const VIEW: ProviderSlot = {
	slot: 'llm',
	type: 'connection',
	writable: true,
	allowed_kinds: ['openai-compatible', 'anthropic'],
	source: 'deployment',
	default_kind: 'nonagentic-wm',
	byo_required: false,
	connection: null
};

function mount(slot: ProviderSlot = VIEW, access: LlmAccessMode | null = null) {
	return render(ProviderSlotCard, {
		props: { slot, requirement: REQ, access, onchanged: vi.fn(), onreload: vi.fn() }
	});
}
const card = () => screen.getByTestId('provider-card-llm');

beforeEach(() => vi.clearAllMocks());

describe('ProviderSlotCard — used by + own connection', () => {
	it('names the w2v work the slot serves', () => {
		mount();
		expect(screen.getByTestId('provider-used-by-llm').textContent).toMatch(
			/Used by:\s*Scripts, storyboards, and course, slide and analysis text/
		);
	});

	it('a tenant connection says it is used for Studio runs; the platform default does not', () => {
		const { unmount } = mount({ ...VIEW, source: 'tenant' });
		expect(screen.getByTestId('provider-own-note-llm').textContent).toMatch(
			/used for this workspace's Studio runs/
		);
		expect(card().textContent).not.toMatch(/Pipeline only|Applies to all services/);
		unmount();
		mount();
		expect(screen.queryByTestId('provider-own-note-llm')).toBeNull();
	});
});

describe('ProviderSlotCard — LLM access', () => {
	it('platform_only makes the form read-only with an explanation', () => {
		mount(VIEW, 'platform_only');
		expect(screen.getByTestId('provider-locked-llm').textContent).toMatch(/Platform services only/);
		const save = within(card()).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		const kind = within(card()).getByLabelText('Provider type') as HTMLSelectElement;
		expect(kind.disabled).toBe(true);
	});

	it('byo_required flags a slot without a registration as Required', () => {
		mount(VIEW, 'byo_required');
		expect(screen.getByTestId('provider-source-llm').textContent).toContain(
			'Required — not registered'
		);
		expect(screen.getByTestId('provider-required-llm').textContent).toMatch(
			/Required — not registered/
		);
		// byo_required never locks: the tenant must be able to register.
		expect(screen.queryByTestId('provider-locked-llm')).toBeNull();
		expect(
			(within(card()).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled
		).toBe(false);
	});

	it('platform_only locks video_gen and ocr too (every GPU / model slot)', () => {
		for (const name of ['video_gen', 'ocr']) {
			const { unmount } = render(ProviderSlotCard, {
				props: {
					slot: { ...VIEW, slot: name, allowed_kinds: ['openai'] },
					access: 'platform_only',
					onchanged: vi.fn(),
					onreload: vi.fn()
				}
			});
			expect(screen.getByTestId(`provider-locked-${name}`)).toBeTruthy();
			unmount();
		}
	});

	it('local_allowed: editable, nothing flagged', () => {
		mount(VIEW, 'local_allowed');
		expect(screen.queryByTestId('provider-locked-llm')).toBeNull();
		expect(screen.queryByTestId('provider-required-llm')).toBeNull();
		expect(
			(within(card()).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled
		).toBe(false);
	});
});

describe('ProviderSlotCard — expected API shape', () => {
	it('shows the path, request and response, plus the platform gateway', () => {
		mount();
		const shape = screen.getByTestId('provider-api-shape-llm');
		expect(shape.textContent).toContain('POST /v1/chat/completions');
		expect(shape.textContent).toMatch(/Request/);
		expect(shape.textContent).toMatch(/Response/);
		expect(screen.getByTestId('provider-gateway-llm').textContent).toContain(
			'https://api.nonagentic.ai/vllm/v1'
		);
	});

	it('an integration slot shows no API shape', () => {
		render(ProviderSlotCard, {
			props: {
				slot: { ...VIEW, slot: 'scrape.firecrawl' },
				onchanged: vi.fn(),
				onreload: vi.fn()
			}
		});
		expect(screen.queryByTestId('provider-api-shape-scrape.firecrawl')).toBeNull();
	});
});

describe('ProviderSlotCard — Load models', () => {
	it('SECRET_REENTRY_REQUIRED prompts for the key', async () => {
		providersMock.models.mockRejectedValue(
			new ApiError(422, 'x', 'reenter', 'SECRET_REENTRY_REQUIRED')
		);
		mount();
		await fireEvent.click(within(card()).getByRole('button', { name: 'Load models' }));
		const err = await screen.findByTestId('provider-models-error');
		expect(err.textContent).toMatch(/enter the API key again/);
		await waitFor(() => expect(document.activeElement?.id).toBe('provider-llm-secret'));
	});

	it('POSTs kind + base_url + typed key and offers the models as a datalist', async () => {
		providersMock.models.mockResolvedValue({ models: ['qwen-b', 'qwen-a'] });
		mount();
		await fireEvent.input(within(card()).getByLabelText('Base URL'), {
			target: { value: 'https://llm.example.com/v1' }
		});
		await fireEvent.input(within(card()).getByLabelText('API key'), {
			target: { value: 'sk-typed' }
		});
		await fireEvent.click(within(card()).getByRole('button', { name: 'Load models' }));
		await waitFor(() => expect(screen.getByTestId('provider-model-options')).toBeTruthy());
		expect(providersMock.models).toHaveBeenCalledWith('llm', {
			kind: 'openai-compatible',
			base_url: 'https://llm.example.com/v1',
			secret: 'sk-typed'
		});
		const opts = [...screen.getByTestId('provider-model-options').querySelectorAll('option')].map(
			(o) => o.value
		);
		expect(opts).toEqual(['qwen-a', 'qwen-b']);
		const model = within(card()).getByLabelText('Model') as HTMLInputElement;
		expect(model.getAttribute('list')).toBe('provider-llm-model-options');
		// Free text is still accepted.
		await fireEvent.input(model, { target: { value: 'my-custom-model' } });
		expect(model.value).toBe('my-custom-model');
	});

	it('shows the 422 detail when the provider list is unavailable', async () => {
		providersMock.models.mockRejectedValue(
			new ApiError(422, 'x', 'upstream answered 401', 'models_unavailable')
		);
		mount();
		await fireEvent.click(within(card()).getByRole('button', { name: 'Load models' }));
		const err = await screen.findByTestId('provider-models-error');
		expect(err.textContent).toContain('upstream answered 401');
		expect(screen.queryByTestId('provider-model-options')).toBeNull();
	});
});

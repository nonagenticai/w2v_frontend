import { describe, it, expect, vi, beforeEach } from 'vitest';

const { providersMock } = vi.hoisted(() => ({
	providersMock: { list: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn() }
}));
vi.mock('$lib/api/providers.js', async () => {
	const actual: typeof import('$lib/api/providers.js') =
		await vi.importActual('$lib/api/providers.js');
	return { ...actual, providers: providersMock };
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { SlotView } from '$lib/api/providers.js';
import type { SlotRequirement } from '$lib/api/provider-requirements.js';
import ProviderSlotCard from './ProviderSlotCard.svelte';

const SECRET = 'acme-tok-THIS-MUST-NEVER-RENDER';

/** A slot whose kind, fields and secret label exist ONLY in this manifest entry. */
const REQ: SlotRequirement = {
	slot: 'video_gen',
	label: 'Video generation (from the manifest)',
	type: 'connection',
	default_kind: 'nonagentic',
	default_kind_label: 'Platform (Nonagentic)',
	allowed_kinds: ['acme'],
	byo_required: false,
	kinds: {
		acme: {
			label: 'Acme Video',
			help: 'Acme hosted video models.',
			base_url: 'forbidden',
			default_base_url: null,
			model_required: false,
			secret_required: true,
			secret_label: 'Acme token',
			required_options: ['region'],
			fields: [
				{ key: 'options.region', label: 'Region', required: true, help: 'eu-1', format: 'text' },
				{ key: 'options.tier', label: 'Tier', required: false, help: '', format: 'text' }
			]
		}
	},
	used_by: []
};
const VIEW: SlotView = {
	slot: 'video_gen',
	type: 'connection',
	writable: true,
	allowed_kinds: ['acme'],
	source: 'deployment',
	default_kind: 'nonagentic',
	byo_required: false,
	connection: null
};

function mount() {
	return render(ProviderSlotCard, {
		props: { slot: VIEW, requirement: REQ, onchanged: vi.fn(), onreload: vi.fn() }
	});
}
const card = () => screen.getByTestId('provider-card-video_gen');
const field = (label: string) => within(card()).getByLabelText(label) as HTMLInputElement;

beforeEach(() => vi.clearAllMocks());

describe('ProviderSlotCard — generic renderer driven by the manifest', () => {
	it('renders the slot label, kind label, help and exactly the manifest fields', () => {
		mount();
		expect(card().textContent).toContain('Video generation (from the manifest)');
		expect(card().textContent).toContain('Platform default: Platform (Nonagentic)');
		const kinds = Array.from(
			(within(card()).getByLabelText('Provider type') as HTMLSelectElement).options
		).map((o) => o.textContent?.trim());
		expect(kinds).toContain('Acme Video');
		expect(within(card()).getByTestId('provider-kind-help').textContent).toContain(
			'Acme hosted video models.'
		);
		expect(field('Region').placeholder).toBe('Required — eu-1');
		expect(field('Tier').placeholder).toBe('Optional');
		// base_url is "forbidden" for this kind and model isn't listed: no such inputs.
		expect(within(card()).queryByLabelText('Base URL')).toBeNull();
		expect(within(card()).queryByLabelText('Model')).toBeNull();
	});

	it('the secret uses the manifest label and is a masked, non-autocompleted input', () => {
		mount();
		const secret = field('Acme token');
		expect(secret.type).toBe('password');
		expect(secret.getAttribute('autocomplete')).toBe('off');
		expect(secret.value).toBe('');
	});

	it('required validation blocks Save and Test; nothing is sent', async () => {
		mount();
		await fireEvent.click(within(card()).getByRole('button', { name: 'Save' }));
		expect(await within(card()).findByText('Region is required.')).toBeTruthy();
		expect(within(card()).getByText('Acme token is required.')).toBeTruthy();
		await fireEvent.click(within(card()).getByRole('button', { name: 'Test' }));
		expect(providersMock.save).not.toHaveBeenCalled();
		expect(providersMock.test).not.toHaveBeenCalled();
	});

	it('a valid form saves through the per-slot PUT with options + secret', async () => {
		providersMock.save.mockResolvedValue({ ...VIEW, source: 'tenant' });
		mount();
		await fireEvent.input(field('Region'), { target: { value: 'eu-1' } });
		await fireEvent.input(field('Acme token'), { target: { value: SECRET } });
		await fireEvent.click(within(card()).getByRole('button', { name: 'Save' }));
		await waitFor(() =>
			expect(providersMock.save).toHaveBeenCalledWith('video_gen', {
				kind: 'acme',
				base_url: null,
				model: null,
				secret: SECRET,
				options: { region: 'eu-1' },
				expected_version: 0
			})
		);
	});
});

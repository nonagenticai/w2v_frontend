import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tenancyMock } = vi.hoisted(() => ({
	tenancyMock: { apiKeys: vi.fn(), createApiKey: vi.fn(), revokeApiKey: vi.fn() }
}));
vi.mock('$lib/api/tenancy.js', async () => {
	const actual: typeof import('$lib/api/tenancy.js') = await vi.importActual('$lib/api/tenancy.js');
	return { ...actual, tenancy: tenancyMock };
});
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/stores/auth.svelte.js', () => ({ ensureAuthReady: () => Promise.resolve() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Page from './+page.svelte';

const SECRET = 'w2v_sk_live_0123456789abcdefSECRET';
const KEY = {
	id: 'k-1',
	name: 'CI',
	prefix: 'w2v_sk_live_01',
	created_by: null,
	created_at: '2026-10-01T00:00:00Z',
	last_used_at: null,
	expires_at: null,
	scopes: [] as string[]
};

beforeEach(() => {
	vi.clearAllMocks();
	tenancyMock.apiKeys.mockResolvedValue({ items: [KEY], total: 1 });
});

async function createKey(name = 'Deploy bot'): Promise<void> {
	render(Page);
	await screen.findByTestId('api-keys-row');
	await fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
	const form = await screen.findByTestId('api-key-create-form');
	await fireEvent.input(within(form).getByLabelText('Name'), { target: { value: name } });
	await fireEvent.submit(form);
}

describe('(tenant)/api-keys page', () => {
	it('lists keys by name + public prefix, never a secret', async () => {
		render(Page);
		const row = await screen.findByTestId('api-keys-row');
		expect(row.textContent).toContain('CI');
		expect(row.textContent).toContain('w2v_sk_live_01');
		expect(screen.queryByTestId('api-key-secret')).toBeNull();
	});

	it('shows the new secret ONCE with a copy button and a warning, then forgets it', async () => {
		tenancyMock.createApiKey.mockResolvedValue({
			...KEY,
			id: 'k-2',
			name: 'Deploy bot',
			key: SECRET
		});
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

		await createKey();
		await waitFor(() =>
			expect(tenancyMock.createApiKey).toHaveBeenCalledWith('Deploy bot', null, [])
		);
		const panel = await screen.findByTestId('api-key-secret');
		expect(within(panel).getByTestId('api-key-secret-value').textContent).toBe(SECRET);
		expect(within(panel).getByTestId('api-key-secret-warning').textContent).toMatch(
			/only time the key is shown/i
		);

		await fireEvent.click(within(panel).getByRole('button', { name: 'Copy' }));
		expect(writeText).toHaveBeenCalledWith(SECRET);

		await fireEvent.click(within(panel).getByRole('button', { name: "I've saved it" }));
		expect(screen.queryByTestId('api-key-secret')).toBeNull();
		expect(document.body.textContent).not.toContain(SECRET);
	});

	it('revoke asks first, then DELETEs', async () => {
		tenancyMock.revokeApiKey.mockResolvedValue(undefined);
		render(Page);
		const row = await screen.findByTestId('api-keys-row');
		await fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
		const confirm = await screen.findByTestId('api-key-revoke-confirm');
		expect(tenancyMock.revokeApiKey).not.toHaveBeenCalled();
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(tenancyMock.revokeApiKey).toHaveBeenCalledWith('k-1'));
	});
});

describe('(tenant)/api-keys — scopes (P8)', () => {
	it("the list shows each key's scopes, or member access only", async () => {
		tenancyMock.apiKeys.mockResolvedValue({
			items: [KEY, { ...KEY, id: 'k-2', name: 'merqi', scopes: ['connections:write'] }],
			total: 2
		});
		render(Page);
		await waitFor(() => expect(screen.getAllByTestId('api-keys-row')).toHaveLength(2));
		const [plain, scoped] = screen.getAllByTestId('api-key-scopes');
		expect(plain.textContent).toContain('Member access only');
		expect(scoped.textContent).toContain('Write provider connections');
	});

	it('create offers every API scope, unchecked by default; checking one sends it', async () => {
		tenancyMock.createApiKey.mockResolvedValue({ ...KEY, id: 'k-3', name: 'merqi', key: SECRET });
		render(Page);
		await screen.findByTestId('api-keys-row');
		await fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
		const form = await screen.findByTestId('api-key-create-form');
		const boxes = within(form).getAllByRole('checkbox') as HTMLInputElement[];
		expect(boxes.map((b) => b.value)).toEqual(['connections:write']);
		expect(boxes.every((b) => !b.checked)).toBe(true);
		await fireEvent.input(within(form).getByLabelText('Name'), { target: { value: 'merqi' } });
		await fireEvent.click(boxes[0]);
		await fireEvent.submit(form);
		await waitFor(() =>
			expect(tenancyMock.createApiKey).toHaveBeenCalledWith('merqi', null, ['connections:write'])
		);
	});

	it('unchecking a scope again removes it from the payload', async () => {
		tenancyMock.createApiKey.mockResolvedValue({ ...KEY, id: 'k-4', name: 'ci', key: SECRET });
		render(Page);
		await screen.findByTestId('api-keys-row');
		await fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
		const form = await screen.findByTestId('api-key-create-form');
		const box = within(form).getByRole('checkbox') as HTMLInputElement;
		await fireEvent.click(box);
		await fireEvent.click(box);
		await fireEvent.input(within(form).getByLabelText('Name'), { target: { value: 'ci' } });
		await fireEvent.submit(form);
		await waitFor(() => expect(tenancyMock.createApiKey).toHaveBeenCalledWith('ci', null, []));
	});
});

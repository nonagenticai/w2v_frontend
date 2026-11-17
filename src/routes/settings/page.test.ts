import { describe, it, expect, vi, beforeEach } from 'vitest';

// The page is a plain settings form; everything it talks to is mocked so the
// assertions are about what the UI *claims*, not about the network.
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const authStatusMock = vi.fn();
const authDisconnectMock = vi.fn();
const authConnectMock = vi.fn();
vi.mock('$lib/api/youtube.js', () => ({
	youtube: {
		authStatus: (...a: unknown[]) => authStatusMock(...a),
		authConnect: (...a: unknown[]) => authConnectMock(...a),
		authDisconnect: (...a: unknown[]) => authDisconnectMock(...a)
	}
}));
vi.mock('$lib/api/tts.js', () => ({ tts: { previewVoice: vi.fn() } }));
const { defaultsGet } = vi.hoisted(() => ({ defaultsGet: vi.fn() }));
vi.mock('$lib/api/tenant-defaults.js', async () => {
	const actual: typeof import('$lib/api/tenant-defaults.js') = await vi.importActual(
		'$lib/api/tenant-defaults.js'
	);
	return { ...actual, tenantDefaults: { get: defaultsGet, put: vi.fn() } };
});
vi.mock('$lib/api/providers.js', () => ({
	providers: { list: vi.fn().mockResolvedValue({ items: [] }) }
}));

const { isTenantAdminMock } = vi.hoisted(() => ({ isTenantAdminMock: vi.fn(() => false) }));
vi.mock('$lib/stores/auth.svelte', async () => {
	const actual: typeof import('$lib/stores/auth.svelte') =
		await vi.importActual('$lib/stores/auth.svelte');
	return { ...actual, isTenantAdmin: () => isTenantAdminMock() };
});

const toastSuccessMock = vi.fn();
const toastInfoMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccessMock(...a),
	toastInfo: (...a: unknown[]) => toastInfoMock(...a),
	toastError: (...a: unknown[]) => toastErrorMock(...a)
}));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Page from './+page.svelte';

function installLocalStorageMock(): void {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	installLocalStorageMock();
	authStatusMock.mockResolvedValue({ connected: false, channel_title: null });
	isTenantAdminMock.mockReturnValue(false);
	defaultsGet.mockResolvedValue({
		version: 0,
		deployment: {
			captions_mode: 'none',
			captions_karaoke: false,
			voice_direction_tone: 'confident',
			retention_mode: 'critique_only',
			timing_director_model_tier: null
		}
	});
});

describe('/settings — workspace defaults are server-backed (P6 FE-1)', () => {
	it('renders the server-backed defaults card, not the browser-only Default Config / Narration / Video cards', async () => {
		render(Page);
		expect(await screen.findByTestId('tenant-defaults')).toBeTruthy();
		await waitFor(() => expect(defaultsGet).toHaveBeenCalledTimes(1));
		expect(screen.queryByText('Default Config')).toBeNull();
		expect(screen.queryByText('Video Output')).toBeNull();
		expect(screen.queryByTestId('crawl-depth-not-wired')).toBeNull();
		expect(screen.queryByTestId('video-crf-not-wired')).toBeNull();
		expect(document.querySelector('input[name="crawl-max-pages"]')).toBeNull();
		expect(document.querySelector('[name="narration-provider"]')).toBeNull();
	});
});

describe('/settings — provider configuration moved to /providers', () => {
	it('links a tenant admin to Providers; the BYO-LLM and AI-Generation sections are gone', async () => {
		isTenantAdminMock.mockReturnValue(true);
		render(Page);
		const link = await screen.findByTestId('settings-providers-link');
		expect(link.getAttribute('href')).toBe('/providers');
		expect(link.textContent).toContain('Providers');
		expect(link.textContent).toContain('YouTube');
		expect(link.textContent).toContain('device-farm');
		expect(screen.queryByTestId('settings-providers-admin-only')).toBeNull();
		expect(screen.queryByText(/LLM Provider \(BYO\)/)).toBeNull();
		expect(screen.queryByText(/AI Generation/)).toBeNull();
		expect(screen.queryByTestId('ai-generation-not-wired')).toBeNull();
		expect(document.querySelector('input[name="imagegen-key"]')).toBeNull();
		expect(document.querySelector('a[href="/settings/llm-provider"]')).toBeNull();
	});

	it('a member gets an admin-only note, not a link the API would 403', async () => {
		render(Page);
		const note = await screen.findByTestId('settings-providers-admin-only');
		expect(note.textContent).toContain('workspace admin');
		expect(screen.queryByTestId('settings-providers-link')).toBeNull();
	});

	// YouTube is connected ONLY on /providers (YouTubeGrantCard: tenant_admin AND the
	// API offering the slot). /settings used to offer Connect to every user.
	it.each([true, false])(
		'offers no YouTube Connect/Disconnect and never reads the YouTube status (admin=%s)',
		async (admin) => {
			isTenantAdminMock.mockReturnValue(admin);
			render(Page);
			await screen.findByTestId('tenant-defaults');
			expect(
				screen.queryByRole('button', { name: /Connect YouTube|Reconnect YouTube/ })
			).toBeNull();
			expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
			expect(screen.queryByTestId('youtube-connection')).toBeNull();
			expect(authStatusMock).not.toHaveBeenCalled();
			expect(authConnectMock).not.toHaveBeenCalled();
		}
	);

	// The browser-only Device Farm card was read by nothing; the device farm is the
	// server-side `device_farm` slot on /providers.
	it('has no browser-only Device Farm card', async () => {
		render(Page);
		await screen.findByTestId('tenant-defaults');
		expect(screen.queryByText('Device Farm')).toBeNull();
		expect(screen.queryByTestId('device-farm-not-wired')).toBeNull();
		expect(document.querySelector('[name="farm-provider"]')).toBeNull();
		expect(document.querySelector('input[name="farm-bs-key"]')).toBeNull();
	});
});

describe('/settings — destructive controls confirm first', () => {
	it('the reset sits in the "This browser" card, next to the controls it resets', async () => {
		render(Page);
		const card = await screen.findByTestId('browser-preferences');
		expect(within(card).getByLabelText('App colour scheme')).toBeTruthy();
		expect(within(card).getByLabelText('Projects list layout')).toBeTruthy();
		expect(within(card).getByRole('button', { name: /Reset browser preferences/ })).toBeTruthy();
		// No page-level "Reset All" that resets controls living on other pages.
		expect(screen.queryByRole('button', { name: /Reset All/ })).toBeNull();
	});

	it('Reset confirms instead of wiping immediately', async () => {
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: /Reset browser preferences/ }));

		const confirm = await screen.findByTestId('settings-reset-confirm');
		expect(confirm.textContent).toContain('cannot be undone');
		// Nothing was reset yet.
		expect(toastSuccessMock).not.toHaveBeenCalled();

		await fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it('Reset preferences restores the browser preferences', async () => {
		localStorage.setItem('w2v_settings', JSON.stringify({ theme: { name: 'dark' } }));
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: /Reset browser preferences/ }));
		const confirm = await screen.findByTestId('settings-reset-confirm');
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Reset preferences' }));
		expect(toastSuccessMock).toHaveBeenCalledWith('Browser preferences reset');
		expect(JSON.parse(localStorage.getItem('w2v_settings') ?? '{}').theme).toEqual({
			name: 'default'
		});
	});
});

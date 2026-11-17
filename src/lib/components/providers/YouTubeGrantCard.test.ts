import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ytMock, roleMock } = vi.hoisted(() => ({
	ytMock: {
		authStatus: vi.fn(),
		authConnect: vi.fn(),
		authDisconnect: vi.fn(),
		settings: vi.fn(),
		setOAuthClient: vi.fn(),
		removeOAuthClient: vi.fn()
	},
	roleMock: { admin: true }
}));
vi.mock('$lib/api/youtube.js', () => ({ youtube: ytMock }));
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => roleMock.admin }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client';
import YouTubeGrantCard from './YouTubeGrantCard.svelte';

const status = (s: string, over: object = {}) => ({
	connected: s === 'connected',
	status: s,
	tenant_id: 't-1',
	channel_title: 'My Channel',
	...over
});

async function settled(state: string): Promise<HTMLElement> {
	const card = await screen.findByTestId('provider-card-publish.youtube');
	await waitFor(() => expect(card.getAttribute('data-state')).toBe(state));
	return card;
}
const btn = (name: string) => screen.queryByRole('button', { name });

const settingsFixture = (over: object = {}) => ({
	oauth_client_id: null,
	has_oauth_client_secret: false,
	redirect_uri: 'https://w2v.example/api/youtube/auth/callback',
	platform_channel_allowed: null,
	effective_platform_channel_allowed: true,
	platform_channel: { channel_id: 'UCplat', channel_title: 'Platform Ch' },
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	roleMock.admin = true;
	ytMock.settings.mockResolvedValue(settingsFixture());
});

describe('YouTubeGrantCard — tenant admin', () => {
	it('connected: shows the channel and offers Disconnect, not Connect', async () => {
		ytMock.authStatus.mockResolvedValue(status('connected'));
		render(YouTubeGrantCard);
		const card = await settled('connected');
		expect(card.textContent).toContain('My Channel');
		expect(btn('Disconnect')).toBeTruthy();
		expect(btn('Connect YouTube')).toBeNull();
		expect(screen.queryByTestId('youtube-admin-only')).toBeNull();
	});

	it('platform_default: Connect navigates the same tab to the authorization URL', async () => {
		ytMock.authStatus.mockResolvedValue(status('platform_default'));
		ytMock.authConnect.mockResolvedValue({ authorization_url: 'https://accounts.google/x' });
		// A window.open after the await is popup-blocked — it must not be used.
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		render(YouTubeGrantCard);
		await settled('platform_default');
		expect(btn('Disconnect')).toBeNull();
		await fireEvent.click(btn('Connect YouTube')!);
		await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google/x'));
		expect(assign).toHaveBeenCalledTimes(1);
		expect(open).not.toHaveBeenCalled();
		expect(screen.queryByTestId('youtube-error')).toBeNull();
		open.mockRestore();
		assign.mockRestore();
	});

	it('Connect with no authorization_url shows an inline error and does not navigate', async () => {
		ytMock.authStatus.mockResolvedValue(status('not_connected'));
		ytMock.authConnect.mockResolvedValue({ authorization_url: null });
		const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
		render(YouTubeGrantCard);
		await settled('not_connected');
		await fireEvent.click(btn('Connect YouTube')!);
		expect((await screen.findByTestId('youtube-error')).textContent).toContain(
			'Connection failed: the server returned no Google sign-in URL.'
		);
		expect(assign).not.toHaveBeenCalled();
		assign.mockRestore();
	});

	it('reconnect_required: both Reconnect and Disconnect', async () => {
		ytMock.authStatus.mockResolvedValue(
			status('reconnect_required', { reconnect_reason: 'revoked' })
		);
		render(YouTubeGrantCard);
		await settled('reconnect_required');
		expect(btn('Reconnect YouTube')).toBeTruthy();
		expect(btn('Disconnect')).toBeTruthy();
	});

	it('Disconnect asks first, then calls the flow and re-reads the status', async () => {
		ytMock.authStatus.mockResolvedValueOnce(status('connected'));
		ytMock.authStatus.mockResolvedValue(status('platform_default'));
		ytMock.authDisconnect.mockResolvedValue({ message: 'ok' });
		render(YouTubeGrantCard);
		await settled('connected');
		await fireEvent.click(btn('Disconnect')!);
		const confirm = await screen.findByTestId('youtube-disconnect-confirm');
		expect(ytMock.authDisconnect).not.toHaveBeenCalled();
		const confirmBtn = Array.from(confirm.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Disconnect'
		)!;
		await fireEvent.click(confirmBtn);
		await waitFor(() => expect(ytMock.authDisconnect).toHaveBeenCalledTimes(1));
		await settled('platform_default');
		expect(ytMock.authStatus).toHaveBeenCalledTimes(2);
	});

	it('a 403 from the server reads as the admin-only message', async () => {
		ytMock.authStatus.mockResolvedValue(status('not_connected'));
		ytMock.authConnect.mockRejectedValue(new ApiError(403, 'Forbidden', 'nope', 'FORBIDDEN'));
		render(YouTubeGrantCard);
		await settled('not_connected');
		await fireEvent.click(btn('Connect YouTube')!);
		expect((await screen.findByTestId('youtube-error')).textContent).toMatch(
			/Only a workspace admin/
		);
	});

	it('status read failure: unknown state, Connect stays reachable', async () => {
		ytMock.authStatus.mockRejectedValue(new Error('boom'));
		render(YouTubeGrantCard);
		await screen.findByTestId('youtube-status-error');
		expect(btn('Connect YouTube')).toBeTruthy();
	});
});

describe('YouTubeGrantCard — member (not tenant admin)', () => {
	beforeEach(() => {
		roleMock.admin = false;
	});

	it.each(['connected', 'reconnect_required', 'platform_default', 'not_connected'])(
		'%s: status only — no Connect/Reconnect/Disconnect, admin-only note',
		async (s) => {
			ytMock.authStatus.mockResolvedValue(status(s));
			render(YouTubeGrantCard);
			await settled(s);
			expect(btn('Connect YouTube')).toBeNull();
			expect(btn('Reconnect YouTube')).toBeNull();
			expect(btn('Disconnect')).toBeNull();
			expect(btn('Refresh status')).toBeTruthy();
			expect(screen.getByTestId('youtube-admin-only').textContent).toMatch(/workspace admin/);
			expect(ytMock.authConnect).not.toHaveBeenCalled();
			expect(ytMock.authDisconnect).not.toHaveBeenCalled();
		}
	);

	it('status read failure: still no Connect for a member', async () => {
		ytMock.authStatus.mockRejectedValue(new Error('boom'));
		render(YouTubeGrantCard);
		await screen.findByTestId('youtube-status-error');
		expect(btn('Connect YouTube')).toBeNull();
	});
});

describe('YouTubeGrantCard — per-tenant config backend (mode / needs_reconnect)', () => {
	const modeStatus = (mode: string, over: object = {}) => ({
		connected: mode === 'tenant',
		tenant_id: 't-1',
		mode,
		needs_reconnect: false,
		...over
	});

	it('tenant: "Connected: <channel>" and Disconnect only', async () => {
		ytMock.authStatus.mockResolvedValue(modeStatus('tenant', { channel_title: 'merqi TV' }));
		render(YouTubeGrantCard);
		await settled('connected');
		expect(screen.getByTestId('youtube-status-line').textContent?.trim()).toBe(
			'Connected: merqi TV'
		);
		expect(btn('Disconnect')).toBeTruthy();
		expect(btn('Connect YouTube')).toBeNull();
	});

	it('platform: names the platform channel and offers Connect', async () => {
		ytMock.authStatus.mockResolvedValue(modeStatus('platform', { channel_title: 'George Dekker' }));
		render(YouTubeGrantCard);
		await settled('platform_default');
		expect(screen.getByTestId('youtube-status-line').textContent?.trim()).toBe(
			'No channel connected — videos publish to the platform channel George Dekker'
		);
		expect(btn('Connect YouTube')).toBeTruthy();
		expect(btn('Disconnect')).toBeNull();
	});

	it('none: says publishing will fail and offers Connect', async () => {
		ytMock.authStatus.mockResolvedValue(modeStatus('none'));
		render(YouTubeGrantCard);
		await settled('not_connected');
		expect(screen.getByTestId('youtube-status-line').textContent?.trim()).toBe(
			'Not connected — publishing will fail'
		);
		expect(btn('Connect YouTube')).toBeTruthy();
	});

	it('needs_reconnect wins over mode: Reconnect + Disconnect, no plain Connect', async () => {
		ytMock.authStatus.mockResolvedValue(
			modeStatus('tenant', { needs_reconnect: true, channel_title: 'merqi TV' })
		);
		render(YouTubeGrantCard);
		await settled('reconnect_required');
		expect(screen.getByTestId('youtube-reconnect-message').textContent).toMatch(
			/Reconnect required/
		);
		expect(btn('Reconnect YouTube')).toBeTruthy();
		expect(btn('Connect YouTube')).toBeNull();
		expect(btn('Disconnect')).toBeTruthy();
	});
});

describe('YouTubeGrantCard — own OAuth client section', () => {
	beforeEach(() => {
		ytMock.authStatus.mockResolvedValue(status('platform_default'));
	});

	it('shows the redirect URI and the current client; the secret field is never prefilled', async () => {
		ytMock.settings.mockResolvedValue(
			settingsFixture({ oauth_client_id: 'cid-123', has_oauth_client_secret: true })
		);
		render(YouTubeGrantCard);
		expect((await screen.findByTestId('youtube-redirect-uri')).textContent).toBe(
			'https://w2v.example/api/youtube/auth/callback'
		);
		expect(screen.getByTestId('youtube-oauth-current').textContent).toContain('cid-123');
		expect(screen.getByTestId('youtube-oauth-secret-state').textContent).toContain('Secret set');
		const secret = document.querySelector<HTMLInputElement>(
			'input[name="youtube-oauth-client-secret"]'
		)!;
		expect(secret.type).toBe('password');
		expect(secret.value).toBe('');
		const id = document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-id"]')!;
		expect(id.value).toBe('cid-123');
		expect(screen.getByTestId('youtube-oauth-warning').textContent).toMatch(/reconnect/i);
	});

	it('Save needs both fields, PUTs them, clears the secret and re-reads the status', async () => {
		ytMock.setOAuthClient.mockResolvedValue(
			settingsFixture({ oauth_client_id: 'new-id', has_oauth_client_secret: true })
		);
		render(YouTubeGrantCard);
		await screen.findByTestId('youtube-redirect-uri');
		const save = btn('Save client') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		const id = document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-id"]')!;
		const secret = document.querySelector<HTMLInputElement>(
			'input[name="youtube-oauth-client-secret"]'
		)!;
		await fireEvent.input(id, { target: { value: ' new-id ' } });
		expect(save.disabled).toBe(true);
		await fireEvent.input(secret, { target: { value: 's3cret' } });
		expect(save.disabled).toBe(false);
		await fireEvent.click(save);
		await waitFor(() =>
			expect(ytMock.setOAuthClient).toHaveBeenCalledWith({
				client_id: 'new-id',
				client_secret: 's3cret'
			})
		);
		await waitFor(() => expect(secret.value).toBe(''));
		await waitFor(() => expect(ytMock.authStatus).toHaveBeenCalledTimes(2));
	});

	it('the secret is never persisted to browser storage, logged, or echoed into the page', async () => {
		const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {})
		);
		// A recording Storage for both: node's experimental global localStorage
		// shadows jsdom's here, so stub them explicitly.
		const writes: string[] = [];
		const fakeStorage = () => ({
			getItem: () => null,
			setItem: (k: string, v: string) => void writes.push(`${k}=${v}`),
			removeItem: () => {},
			clear: () => {},
			key: () => null,
			length: 0
		});
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('sessionStorage', fakeStorage());
		ytMock.setOAuthClient.mockRejectedValue(
			new ApiError(422, 'Unprocessable', 'client_id invalid')
		);
		render(YouTubeGrantCard);
		await screen.findByTestId('youtube-redirect-uri');
		await fireEvent.input(
			document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-id"]')!,
			{ target: { value: 'cid' } }
		);
		await fireEvent.input(
			document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-secret"]')!,
			{ target: { value: 'TOPSECRET-9' } }
		);
		await fireEvent.click(btn('Save client')!);
		expect((await screen.findByTestId('youtube-oauth-error')).textContent).toContain(
			'client_id invalid'
		);
		expect(writes.join('\n')).not.toContain('TOPSECRET-9');
		vi.unstubAllGlobals();
		expect(document.body.textContent).not.toContain('TOPSECRET-9');
		for (const spy of logs) {
			expect(JSON.stringify(spy.mock.calls)).not.toContain('TOPSECRET-9');
			spy.mockRestore();
		}
	});

	it('Remove asks first, then DELETEs, renders the returned settings and re-reads status', async () => {
		ytMock.settings.mockResolvedValueOnce(
			settingsFixture({ oauth_client_id: 'cid-123', has_oauth_client_secret: true })
		);
		ytMock.removeOAuthClient.mockResolvedValue(settingsFixture());
		render(YouTubeGrantCard);
		await screen.findByTestId('youtube-oauth-secret-state');
		await fireEvent.click(btn('Remove client')!);
		const confirm = await screen.findByTestId('youtube-oauth-remove-confirm');
		expect(ytMock.removeOAuthClient).not.toHaveBeenCalled();
		const confirmBtn = Array.from(confirm.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Remove client'
		)!;
		await fireEvent.click(confirmBtn);
		await waitFor(() => expect(ytMock.removeOAuthClient).toHaveBeenCalledTimes(1));
		// The DELETE body IS the new settings — no second GET.
		await waitFor(() =>
			expect(screen.getByTestId('youtube-oauth-current').textContent).toContain(
				'Platform OAuth client'
			)
		);
		expect(ytMock.settings).toHaveBeenCalledTimes(1);
		expect(
			document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-id"]')!.value
		).toBe('');
		await waitFor(() => expect(ytMock.authStatus).toHaveBeenCalledTimes(2));
	});

	it('a 403 on save reads as the admin-only message', async () => {
		ytMock.setOAuthClient.mockRejectedValue(new ApiError(403, 'Forbidden', 'nope', 'FORBIDDEN'));
		render(YouTubeGrantCard);
		await screen.findByTestId('youtube-redirect-uri');
		await fireEvent.input(
			document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-id"]')!,
			{ target: { value: 'x' } }
		);
		await fireEvent.input(
			document.querySelector<HTMLInputElement>('input[name="youtube-oauth-client-secret"]')!,
			{ target: { value: 'y' } }
		);
		await fireEvent.click(btn('Save client')!);
		expect((await screen.findByTestId('youtube-oauth-error')).textContent).toMatch(
			/Only a workspace admin can change the OAuth client/
		);
	});

	it('a member never sees the section and never reads the settings', async () => {
		roleMock.admin = false;
		render(YouTubeGrantCard);
		await settled('platform_default');
		expect(screen.queryByTestId('youtube-oauth-client')).toBeNull();
		expect(ytMock.settings).not.toHaveBeenCalled();
	});
});

describe('YouTubeGrantCard — slot writability (P8)', () => {
	it('not writable: Connect hidden, the reason shown, no own-OAuth-client section', async () => {
		ytMock.authStatus.mockResolvedValue(status('platform_default'));
		render(YouTubeGrantCard, {
			props: { writable: false, notWritableReason: 'YouTube publishing is platform provided.' }
		});
		const card = await settled('platform_default');
		expect(btn('Connect YouTube')).toBeNull();
		expect(screen.getByTestId('youtube-not-writable').textContent).toContain(
			'YouTube publishing is platform provided.'
		);
		expect(ytMock.settings).not.toHaveBeenCalled();
		expect(card.textContent).not.toContain('Only a workspace admin');
	});

	it('not writable + reconnect_required: no Reconnect, Disconnect still offered', async () => {
		ytMock.authStatus.mockResolvedValue(status('reconnect_required'));
		render(YouTubeGrantCard, { props: { writable: false } });
		await settled('reconnect_required');
		expect(btn('Reconnect YouTube')).toBeNull();
		expect(btn('Disconnect')).toBeTruthy();
	});
});

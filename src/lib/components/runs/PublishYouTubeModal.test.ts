import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const { isTenantAdminMock } = vi.hoisted(() => ({ isTenantAdminMock: vi.fn(() => true) }));
vi.mock('$lib/stores/auth.svelte', async () => {
	const actual: typeof import('$lib/stores/auth.svelte') =
		await vi.importActual('$lib/stores/auth.svelte');
	return { ...actual, isTenantAdmin: () => isTenantAdminMock() };
});

import { render, screen } from '@testing-library/svelte';
import PublishYouTubeModal from './PublishYouTubeModal.svelte';

// The modal must tell the user WHERE a publish lands (platform default vs own
// channel) and must block publishing with a reconnect pointer when Google has
// revoked the tenant's grant.
describe('PublishYouTubeModal', () => {
	beforeEach(() => {
		isTenantAdminMock.mockReturnValue(true);
	});

	it('platform_default: shows the platform-channel note and still offers Publish', () => {
		render(PublishYouTubeModal, {
			props: {
				open: true,
				connected: true,
				connectionState: 'platform_default',
				onsubmit: vi.fn()
			}
		});

		const note = screen.getByTestId('youtube-platform-default-note');
		expect(note.textContent?.replace(/\s+/g, ' ')).toContain(
			"publish to the platform's YouTube channel, not your own"
		);
		expect(note.querySelector('a')?.getAttribute('href')).toBe('/providers');
		expect(screen.getByRole('button', { name: /Publish/, hidden: true })).toBeTruthy();
	});

	it('the published captions download carries the project-named file name', () => {
		render(PublishYouTubeModal, {
			props: {
				open: true,
				connected: true,
				connectionState: 'connected',
				jobStatus: 'completed',
				publishedUrl: 'https://youtu.be/x',
				publishedCaptionUrl: '/api/runs/r1/captions.srt',
				captionsFileName: 'acme-launch-captions.srt',
				onsubmit: vi.fn()
			}
		});
		const link = screen.getByText('Download captions (.srt)').closest('a');
		expect(link?.getAttribute('download')).toBe('acme-launch-captions.srt');
	});

	it('own channel: no platform-default note', () => {
		render(PublishYouTubeModal, {
			props: { open: true, connected: true, connectionState: 'connected', onsubmit: vi.fn() }
		});

		expect(screen.queryByTestId('youtube-platform-default-note')).toBeNull();
	});

	it('reconnect_required: blocks publish and points a tenant admin to Providers to reconnect', () => {
		render(PublishYouTubeModal, {
			props: {
				open: true,
				connected: false,
				connectionState: 'reconnect_required',
				onsubmit: vi.fn()
			}
		});

		const block = screen.getByTestId('youtube-reconnect-required');
		expect(block.textContent?.replace(/\s+/g, ' ')).toContain('expired or was revoked');
		expect(block.querySelector('a')?.getAttribute('href')).toBe('/providers');
		expect(screen.queryByRole('button', { name: /Publish/, hidden: true })).toBeNull();
		expect(screen.queryByLabelText('Title')).toBeNull();
		expect(screen.queryByText(/No YouTube account is connected/)).toBeNull();
	});

	it('not connected: a tenant admin is linked to Providers', () => {
		render(PublishYouTubeModal, {
			props: { open: true, connected: false, connectionState: 'not_connected', onsubmit: vi.fn() }
		});
		expect(screen.getByTestId('youtube-providers-link').getAttribute('href')).toBe('/providers');
	});

	// /providers is tenant_admin-only: a member is told who can fix it, never given
	// a link that would 403 — and never pointed at /settings, which has no YouTube.
	it.each([
		['reconnect_required', false, 'reconnect it'],
		['not_connected', false, 'connect one'],
		['platform_default', true, 'connect your own channel']
	] as const)('member, %s: says a workspace admin must act, no link', (state, connected, verb) => {
		isTenantAdminMock.mockReturnValue(false);
		render(PublishYouTubeModal, {
			props: { open: true, connected, connectionState: state, onsubmit: vi.fn() }
		});
		const note = screen.getByTestId('youtube-admin-must-connect');
		expect(note.textContent).toContain(`A workspace admin must ${verb}`);
		expect(screen.queryByTestId('youtube-providers-link')).toBeNull();
		expect(document.querySelector('a[href="/providers"]')).toBeNull();
		expect(document.querySelector('a[href="/settings"]')).toBeNull();
	});
});

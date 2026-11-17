import { describe, it, expect, vi, beforeEach } from 'vitest';

const { musicMock, isTenantAdminMock } = vi.hoisted(() => ({
	musicMock: { list: vi.fn(), upload: vi.fn(), update: vi.fn(), remove: vi.fn() },
	isTenantAdminMock: vi.fn(() => true)
}));
vi.mock('$lib/api/music.js', async () => {
	const actual: typeof import('$lib/api/music.js') = await vi.importActual('$lib/api/music.js');
	return { ...actual, tenantMusic: musicMock };
});
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => isTenantAdminMock() }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn() }));

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client';
import { setActiveTenantId } from '$lib/api/client';
import type { TenantMusicItem, TenantMusicUploadLimits } from '$lib/api/music.js';
import Page from './+page.svelte';

const TRACK: TenantMusicItem = {
	id: 't-1',
	sound_id: 'tenant_synth_bed',
	category: 'music',
	description: 'Upbeat synth bed',
	duration_s: 95.4,
	bytes: 3 * 1024 * 1024,
	content_type: 'audio/mpeg',
	rights: 'tenant-declared',
	rights_attested_by: 'u-1',
	created_at: '2026-10-09T10:00:00Z',
	url: '/api/tenant/music/t-1/content'
};

// A deliberately NON-default cap and format set: the page must render what the
// server says, not a constant that happens to match the deployment default.
const LIMITS: TenantMusicUploadLimits = {
	max_bytes: 20 * 1024 * 1024,
	max_duration_s: null,
	max_description_length: 12,
	categories: ['music', 'ambient'],
	formats: [
		{ format: 'mp3', extension: '.mp3', content_type: 'audio/mpeg' },
		{ format: 'flac', extension: 'flac', content_type: 'audio/flac' }
	]
};

const uploadButton = () => screen.getByRole('button', { name: /^Upload$/ });

beforeEach(() => {
	vi.clearAllMocks();
	isTenantAdminMock.mockReturnValue(true);
	setActiveTenantId(null);
	musicMock.list.mockResolvedValue({ tracks: [TRACK], limits: LIMITS });
});

describe('/music — workspace music library', () => {
	it('lists tracks with the same-origin content path as the audio source and the tenant-declared rights label', async () => {
		render(Page);
		const row = await screen.findByTestId('music-track');
		expect(row.textContent).toContain('tenant_synth_bed');
		expect(row.textContent).toContain('1:35');
		expect(row.textContent).toContain('3.0 MiB');
		expect(row.textContent).toContain('Rights: tenant-declared');
		expect(row.querySelector('audio')?.getAttribute('src')).toBe('/api/tenant/music/t-1/content');
	});

	it('scopes the audio source to a super-admin tenant switch (browser-fetched media)', async () => {
		setActiveTenantId('tenant-b');
		render(Page);
		const row = await screen.findByTestId('music-track');
		expect(row.querySelector('audio')?.getAttribute('src')).toBe(
			'/api/tenant/music/t-1/content?active_tenant=tenant-b'
		);
	});

	it('shows the SERVER limits (formats, cap, categories, accept) and the rights notice; Upload stays disabled until the rights box is ticked', async () => {
		render(Page);
		expect(await screen.findByTestId('music-upload-limits')).toHaveTextContent(
			'MP3, FLAC audio, up to 20.0 MiB'
		);
		expect(document.getElementById('music-file')?.getAttribute('accept')).toBe(
			'audio/mpeg,.mp3,audio/flac,.flac'
		);
		const categorySelect = document.querySelector(
			'select[name="music-category"]'
		) as HTMLSelectElement;
		expect([...categorySelect.options].map((o) => o.value)).toEqual(['music', 'ambient']);
		expect(screen.getByTestId('music-rights-notice')).toHaveTextContent('tenant-declared');

		const file = new File(['ID3'], 'Synth Bed.mp3', { type: 'audio/mpeg' });
		const input = document.getElementById('music-file') as HTMLInputElement;
		await fireEvent.change(input, { target: { files: [file] } });
		expect(uploadButton()).toBeDisabled();

		musicMock.upload.mockResolvedValue({ ...TRACK, id: 't-2', sound_id: 'tenant_synth_bed_2' });
		await fireEvent.click(screen.getByTestId('music-rights'));
		expect(uploadButton()).not.toBeDisabled();
		await fireEvent.click(uploadButton());

		await waitFor(() => expect(musicMock.upload).toHaveBeenCalledTimes(1));
		expect(musicMock.upload.mock.calls[0][0]).toMatchObject({
			file,
			rightsAttested: true,
			category: 'music'
		});
		await waitFor(() => expect(screen.getAllByTestId('music-track')).toHaveLength(2));
	});

	it('refuses a file over the server cap before uploading it', async () => {
		render(Page);
		await screen.findByTestId('music-track');
		const big = new File(['x'], 'big.wav', { type: 'audio/wav' });
		Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
		const input = document.getElementById('music-file') as HTMLInputElement;
		await fireEvent.change(input, { target: { files: [big] } });
		await fireEvent.click(screen.getByTestId('music-rights'));
		expect(await screen.findByTestId('music-file-too-large')).toHaveTextContent(
			'larger than the 20.0 MiB limit'
		);
		expect(uploadButton()).toBeDisabled();
		expect(musicMock.upload).not.toHaveBeenCalled();
	});

	it('blocks a description longer than the server max', async () => {
		render(Page);
		await screen.findByTestId('music-track');
		const input = document.getElementById('music-file') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File(['ID3'], 'a.mp3', { type: 'audio/mpeg' })] }
		});
		await fireEvent.click(screen.getByTestId('music-rights'));
		expect(uploadButton()).not.toBeDisabled();
		const desc = document.querySelector('input[name="music-description"]') as HTMLInputElement;
		await fireEvent.input(desc, { target: { value: 'thirteen char' } });
		expect(uploadButton()).toBeDisabled();
		expect(screen.getByText('At most 12 characters.')).toBeTruthy();
	});

	it('shows the API refusal (e.g. FILE_TOO_LARGE with the configured cap) verbatim-ish', async () => {
		render(Page);
		await screen.findByTestId('music-track');
		const input = document.getElementById('music-file') as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File(['x'], 'big.wav', { type: 'audio/wav' })] }
		});
		await fireEvent.click(screen.getByTestId('music-rights'));
		musicMock.upload.mockRejectedValue(
			new ApiError(422, 'Unprocessable', 'audio exceeds the 20 MiB limit', 'FILE_TOO_LARGE', {
				max_bytes: 20 * 1024 * 1024
			})
		);
		await fireEvent.click(uploadButton());
		expect(await screen.findByTestId('music-upload-error')).toHaveTextContent(
			'larger than the 20.0 MiB limit'
		);
	});

	it('delete asks for confirmation, then removes the row', async () => {
		render(Page);
		const row = await screen.findByTestId('music-track');
		await fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
		expect(musicMock.remove).not.toHaveBeenCalled();
		const confirm = await screen.findByTestId('music-delete-confirm');
		musicMock.remove.mockResolvedValue(undefined);
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(musicMock.remove).toHaveBeenCalledWith('t-1'));
		await waitFor(() => expect(screen.queryByTestId('music-track')).toBeNull());
	});

	it('edit PATCHes description + category', async () => {
		musicMock.update.mockResolvedValue({ ...TRACK, description: 'Calm bed' });
		render(Page);
		const row = await screen.findByTestId('music-track');
		await fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
		const desc = document.querySelector(
			'input[name="music-edit-description-t-1"]'
		) as HTMLInputElement;
		await fireEvent.input(desc, { target: { value: 'Calm bed' } });
		await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
		await waitFor(() =>
			expect(musicMock.update).toHaveBeenCalledWith('t-1', {
				category: 'music',
				description: 'Calm bed'
			})
		);
		expect(await screen.findByText('Calm bed')).toBeTruthy();
	});

	it('member: can list and play, sees no upload / edit / delete controls', async () => {
		isTenantAdminMock.mockReturnValue(false);
		render(Page);
		const row = await screen.findByTestId('music-track');
		expect(row.querySelector('audio')).not.toBeNull();
		expect(screen.queryByTestId('music-upload')).toBeNull();
		expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
		expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
	});
});

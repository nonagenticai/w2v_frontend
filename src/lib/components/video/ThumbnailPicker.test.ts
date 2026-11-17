import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const uploadThumbnail = vi.fn();
const patchThumbnail = vi.fn();
vi.mock('$lib/api', () => ({
	course: {
		uploadThumbnail: (...a: unknown[]) => uploadThumbnail(...a),
		patchThumbnail: (...a: unknown[]) => patchThumbnail(...a)
	},
	ApiError: class ApiError extends Error {}
}));

import ThumbnailPicker from './ThumbnailPicker.svelte';

describe('ThumbnailPicker', () => {
	beforeEach(() => {
		uploadThumbnail.mockReset();
		patchThumbnail.mockReset();
	});

	it('capture → upload the frame blob, then PATCH the returned url', async () => {
		uploadThumbnail.mockResolvedValue({ thumbnail_url: 'http://x/picked.png', bytes: 3 });
		patchThumbnail.mockResolvedValue({ output: { thumbnail_override_url: 'http://x/picked.png' } });
		const onSaved = vi.fn();
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
		const captureFrame = vi.fn().mockResolvedValue(blob);
		const { getByText } = render(ThumbnailPicker, {
			runId: 'run-1',
			hasOverride: false,
			captureFrame,
			onSaved
		});
		await fireEvent.click(getByText('Use current frame'));
		await tick();
		await tick();
		expect(captureFrame).toHaveBeenCalled();
		expect(uploadThumbnail).toHaveBeenCalledWith(blob, 'frame.png');
		expect(patchThumbnail).toHaveBeenCalledWith('run-1', 'http://x/picked.png');
		expect(onSaved).toHaveBeenCalledWith({ thumbnail_override_url: 'http://x/picked.png' });
	});

	it('shows an error and does not upload when the frame cannot be captured', async () => {
		const captureFrame = vi.fn().mockResolvedValue(null);
		const { getByText, getByRole } = render(ThumbnailPicker, {
			runId: 'run-1',
			hasOverride: false,
			captureFrame,
			onSaved: vi.fn()
		});
		await fireEvent.click(getByText('Use current frame'));
		await tick();
		expect(uploadThumbnail).not.toHaveBeenCalled();
		expect(getByRole('alert').textContent).toContain('Could not capture');
	});

	it('revert PATCHes a null thumbnail and is only offered when an override exists', async () => {
		patchThumbnail.mockResolvedValue({ output: {} });
		const onSaved = vi.fn();
		const { getByText, rerender, queryByText } = render(ThumbnailPicker, {
			runId: 'run-1',
			hasOverride: true,
			captureFrame: vi.fn(),
			onSaved
		});
		await fireEvent.click(getByText('Revert to auto cover'));
		await tick();
		expect(patchThumbnail).toHaveBeenCalledWith('run-1', null);

		await rerender({ runId: 'run-1', hasOverride: false, captureFrame: vi.fn(), onSaved });
		expect(queryByText('Revert to auto cover')).toBeNull();
	});
});

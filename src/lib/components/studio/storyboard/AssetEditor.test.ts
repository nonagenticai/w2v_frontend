import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store mutations the editor drives — captured so we can assert call args.
const createAsset = vi.fn().mockResolvedValue({});
const updateAsset = vi.fn().mockResolvedValue({});
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	createAsset: (...a: unknown[]) => createAsset(...a),
	updateAsset: (...a: unknown[]) => updateAsset(...a),
	loadAssets: vi.fn().mockResolvedValue(undefined),
	getAssetList: () => [],
	deleteAsset: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccess(...a),
	toastError: (...a: unknown[]) => toastError(...a)
}));

// Only the reference-image upload is stubbed; the rest of `$lib/api` stays real
// (the editor also pulls `scopedMediaUrl` out of `$lib/api/client.js`).
const imageUpload = vi.fn();
vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return {
		...actual,
		uploads: { ...actual.uploads, storyboardAssetImage: (f: File) => imageUpload(f) }
	};
});

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import AssetEditor from './AssetEditor.svelte';
import type { StoryboardAssetResponse } from '$lib/types';

function asset(over: Partial<StoryboardAssetResponse> = {}): StoryboardAssetResponse {
	return {
		id: 'a1',
		kind: 'character',
		name: 'Hero',
		canonical_descriptor: 'a brave knight',
		...over
	} as unknown as StoryboardAssetResponse;
}

const save = (c: HTMLElement) => c.querySelector('[data-testid="asset-save"]') as HTMLButtonElement;
const pick = (c: HTMLElement) =>
	c.querySelector('[data-testid="asset-reference-add"]') as HTMLInputElement;
const thumbs = (c: HTMLElement) => c.querySelectorAll('[data-testid="asset-reference-thumb"]');
const png = (name = 'ref.png') => new File(['xx'], name, { type: 'image/png' });

beforeEach(() => {
	vi.clearAllMocks();
	imageUpload.mockResolvedValue({
		image_url: '/api/media/ref-1.png',
		bytes: 2,
		width: 512,
		height: 512
	});
});

describe('AssetEditor', () => {
	it('disables Save until the name is non-empty', async () => {
		const { container } = render(AssetEditor, { props: { projectId: 'p1', kind: 'character' } });
		expect(save(container).disabled).toBe(true);
		const name = container.querySelector('#asset-name-new') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Villain' } });
		expect(save(container).disabled).toBe(false);
	});

	it('calls createAsset with the kind/name/descriptor when there is no asset', async () => {
		const onDone = vi.fn();
		const { container } = render(AssetEditor, {
			props: { projectId: 'p1', kind: 'location', onDone }
		});
		const name = container.querySelector('#asset-name-new') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Cave' } });
		const descr = container.querySelector('#asset-descriptor-new') as HTMLTextAreaElement;
		await fireEvent.input(descr, { target: { value: 'a damp cavern' } });
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(createAsset).toHaveBeenCalledWith('p1', {
				kind: 'location',
				name: 'Cave',
				canonical_descriptor: 'a damp cavern',
				reference_images: [],
				seed: null,
				style_token: null
			})
		);
		expect(updateAsset).not.toHaveBeenCalled();
		await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
		expect(toastSuccess).toHaveBeenCalled();
	});

	it('sends a null descriptor when the textarea is left empty', async () => {
		const { container } = render(AssetEditor, { props: { projectId: 'p1', kind: 'prop' } });
		const name = container.querySelector('#asset-name-new') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Sword' } });
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(createAsset).toHaveBeenCalledWith('p1', {
				kind: 'prop',
				name: 'Sword',
				canonical_descriptor: null,
				reference_images: [],
				seed: null,
				style_token: null
			})
		);
	});

	it('calls updateAsset with the asset id when editing an existing asset', async () => {
		const onDone = vi.fn();
		const { container } = render(AssetEditor, {
			props: { projectId: 'p1', asset: asset(), kind: 'character', onDone }
		});
		// Name is prefilled, so Save is enabled immediately.
		expect(save(container).disabled).toBe(false);
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateAsset).toHaveBeenCalledWith('p1', 'a1', {
				kind: 'character',
				name: 'Hero',
				canonical_descriptor: 'a brave knight',
				reference_images: [],
				seed: null,
				style_token: null
			})
		);
		expect(createAsset).not.toHaveBeenCalled();
		await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
	});

	it('toasts an error and keeps the editor open when the store rejects', async () => {
		createAsset.mockRejectedValueOnce(new Error('boom'));
		const onDone = vi.fn();
		const { container } = render(AssetEditor, {
			props: { projectId: 'p1', kind: 'character', onDone }
		});
		const name = container.querySelector('#asset-name-new') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Hero' } });
		await fireEvent.click(save(container));
		await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to create asset', 'boom'));
		expect(onDone).not.toHaveBeenCalled();
	});

	// ── Reference images ────────────────────────────────────────────────────
	// Catches: an upload whose returned URL is dropped on the floor (thumbnail
	// rendered from a local object URL, nothing added to the saved body) — the
	// asset would save with an empty moodboard while the UI showed an image.
	it('uploads a picked file and appends the returned image_url to the saved body', async () => {
		const { container } = render(AssetEditor, {
			props: { projectId: 'p1', asset: asset(), kind: 'character' }
		});
		const file = png();
		await fireEvent.change(pick(container), { target: { files: [file] } });

		await waitFor(() => expect(imageUpload).toHaveBeenCalledWith(file));
		await waitFor(() => expect(thumbs(container)).toHaveLength(1));

		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateAsset).toHaveBeenCalledWith(
				'p1',
				'a1',
				expect.objectContaining({ reference_images: ['/api/media/ref-1.png'] })
			)
		);
	});

	// Catches the masked-failure defect: a swallowed upload rejection that leaves
	// the user with no error AND (worse) appends a placeholder/undefined URL that
	// the backend would store as a dead reference.
	it('surfaces an upload failure and appends nothing', async () => {
		imageUpload.mockRejectedValueOnce(new Error('415: not an image'));
		const { container } = render(AssetEditor, {
			props: { projectId: 'p1', asset: asset(), kind: 'character' }
		});
		await fireEvent.change(pick(container), { target: { files: [png('renamed.png')] } });

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				'Failed to upload reference image',
				'415: not an image'
			)
		);
		expect(thumbs(container)).toHaveLength(0);

		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateAsset).toHaveBeenCalledWith(
				'p1',
				'a1',
				expect.objectContaining({ reference_images: [] })
			)
		);
	});

	// Catches a remove that only hides the thumbnail (visual-only splice of a
	// render list) while the URL stays in the body and the image comes back on
	// the next load.
	it('drops a removed thumbnail from the saved body', async () => {
		const { container } = render(AssetEditor, {
			props: {
				projectId: 'p1',
				asset: asset({ reference_images: ['/api/media/a.png', '/api/media/b.png'] }),
				kind: 'character'
			}
		});
		expect(thumbs(container)).toHaveLength(2);

		const remove = container.querySelectorAll('[data-testid="asset-reference-remove"]');
		await fireEvent.click(remove[0]);
		await waitFor(() => expect(thumbs(container)).toHaveLength(1));

		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateAsset).toHaveBeenCalledWith(
				'p1',
				'a1',
				expect.objectContaining({ reference_images: ['/api/media/b.png'] })
			)
		);
	});

	// ── Seed / style token ──────────────────────────────────────────────────
	// Catches fields that render but are never read into the request body — the
	// exact shape of "the UI shipped, the value never left the browser".
	it('round-trips seed and style_token into the update body', async () => {
		const { container } = render(AssetEditor, {
			props: {
				projectId: 'p1',
				asset: asset({ seed: 4242, style_token: 'gritty-noir' }),
				kind: 'character'
			}
		});
		expect((container.querySelector('[data-testid="asset-seed"]') as HTMLInputElement).value).toBe(
			'4242'
		);
		await fireEvent.input(container.querySelector('[data-testid="asset-seed"]')!, {
			target: { value: '77' }
		});
		await fireEvent.input(container.querySelector('[data-testid="asset-style-token"]')!, {
			target: { value: 'washed-out' }
		});
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateAsset).toHaveBeenCalledWith(
				'p1',
				'a1',
				expect.objectContaining({ seed: 77, style_token: 'washed-out' })
			)
		);
	});

	// Catches the quiet coercion: a non-numeric seed becoming `null`, which the
	// backend would read as "deliberately unpinned" rather than "typo".
	it('refuses a non-numeric seed instead of silently sending null', async () => {
		const { container } = render(AssetEditor, {
			props: { projectId: 'p1', asset: asset(), kind: 'character' }
		});
		await fireEvent.input(container.querySelector('[data-testid="asset-seed"]')!, {
			target: { value: '12abc' }
		});
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				'Seed must be a whole number',
				'Leave it empty to let each render pick its own.'
			)
		);
		expect(updateAsset).not.toHaveBeenCalled();
	});

	it('sends a null seed and style_token when both are left empty', async () => {
		const { container } = render(AssetEditor, {
			props: {
				projectId: 'p1',
				asset: asset({ seed: 9, style_token: 'old' }),
				kind: 'character'
			}
		});
		await fireEvent.input(container.querySelector('[data-testid="asset-seed"]')!, {
			target: { value: '' }
		});
		await fireEvent.input(container.querySelector('[data-testid="asset-style-token"]')!, {
			target: { value: '  ' }
		});
		await fireEvent.click(save(container));
		await waitFor(() =>
			expect(updateAsset).toHaveBeenCalledWith(
				'p1',
				'a1',
				expect.objectContaining({ seed: null, style_token: null })
			)
		);
	});
});

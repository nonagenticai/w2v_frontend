import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoryboardAssetResponse } from '$lib/types';

// Hoisted so the (hoisted) vi.mock factory and the tests share ONE ApiError
// class — the component narrows with `instanceof ApiError`. `detail` is `string`
// on the wire for most routes but an object for the asset-in-use 409, so the
// mock mirrors the runtime shape rather than the declared type.
const h = vi.hoisted(() => {
	class MockApiError extends Error {
		status: number;
		detail: unknown;
		constructor(status: number, detail: unknown) {
			super(typeof detail === 'string' ? detail : JSON.stringify(detail));
			this.status = status;
			this.detail = detail;
		}
	}
	return { MockApiError };
});
// `uploads` is stubbed too: the library nests AssetEditor, which imports it from
// `$lib/api`. Nothing here drives an upload, but a mocked module with the export
// missing would leave the child holding `undefined`.
vi.mock('$lib/api', () => ({
	ApiError: h.MockApiError,
	uploads: { storyboardAssetImage: vi.fn() }
}));

// Captured store mutations + a mutable list the mocked getAssetList returns.
const loadAssets = vi.fn().mockResolvedValue(undefined);
const deleteAsset = vi.fn().mockResolvedValue(undefined);
const createAsset = vi.fn().mockResolvedValue({});
const updateAsset = vi.fn().mockResolvedValue({});
const toastSuccess = vi.fn();
const toastError = vi.fn();
let list: StoryboardAssetResponse[] = [];

vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	loadAssets: (...a: unknown[]) => loadAssets(...a),
	getAssetList: () => list,
	deleteAsset: (...a: unknown[]) => deleteAsset(...a),
	createAsset: (...a: unknown[]) => createAsset(...a),
	updateAsset: (...a: unknown[]) => updateAsset(...a)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccess(...a),
	toastError: (...a: unknown[]) => toastError(...a)
}));

import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import AssetLibrary from './AssetLibrary.svelte';

function asset(over: Partial<StoryboardAssetResponse> = {}): StoryboardAssetResponse {
	return {
		id: 'a1',
		kind: 'character',
		name: 'Hero',
		canonical_descriptor: 'a brave knight',
		...over
	} as unknown as StoryboardAssetResponse;
}

beforeEach(() => {
	vi.clearAllMocks();
	list = [];
});

describe('AssetLibrary', () => {
	it('loads assets on mount', () => {
		render(AssetLibrary, { props: { projectId: 'p1' } });
		expect(loadAssets).toHaveBeenCalledWith('p1');
	});

	it('groups assets by kind and shows an empty state for empty groups', () => {
		list = [asset({ id: 'c1', kind: 'character', name: 'Hero' })];
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });

		const characters = getByTestId('asset-group-character');
		expect(within(characters).getByText('Hero')).toBeTruthy();
		// Filled group has no empty placeholder…
		expect(characters.querySelector('[data-testid="asset-empty-character"]')).toBeNull();
		// …while the other two groups do.
		expect(getByTestId('asset-empty-location').textContent).toMatch(/no locations yet/i);
		expect(getByTestId('asset-empty-prop').textContent).toMatch(/no props yet/i);
	});

	it('calls deleteAsset with the project and asset id, then toasts success', async () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		await fireEvent.click(within(getByTestId('asset-row')).getByTestId('asset-delete'));
		await waitFor(() => expect(deleteAsset).toHaveBeenCalledWith('p1', 'a1'));
		await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
	});

	it('names the referencing panels on a 409 and keeps the asset in the list', async () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		deleteAsset.mockRejectedValueOnce(
			new h.MockApiError(409, {
				message: 'asset is referenced by storyboard panels; remove the references first',
				panels: [
					{ id: 'p-1', shot_key: 'clip-1' },
					{ id: 'p-3', shot_key: 'clip-3' }
				]
			})
		);
		const { getByTestId, getAllByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		await fireEvent.click(within(getByTestId('asset-row')).getByTestId('asset-delete'));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				'Asset is in use',
				'Used by clip-1, clip-3 — remove the references first.'
			)
		);
		expect(toastSuccess).not.toHaveBeenCalled();
		// The store is pessimistic: a rejected delete leaves the row rendered.
		expect(getAllByTestId('asset-row')).toHaveLength(1);
		expect(within(getByTestId('asset-row')).getByTestId('asset-name').textContent).toContain(
			'Hero'
		);
	});

	it('truncates a long panel list to the first five plus a count', async () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		deleteAsset.mockRejectedValueOnce(
			new h.MockApiError(409, {
				message: 'asset is referenced by storyboard panels; remove the references first',
				panels: Array.from({ length: 7 }, (_, i) => ({
					id: `p-${i + 1}`,
					shot_key: `clip-${i + 1}`
				}))
			})
		);
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		await fireEvent.click(within(getByTestId('asset-row')).getByTestId('asset-delete'));

		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				'Asset is in use',
				'Used by clip-1, clip-2, clip-3, clip-4, clip-5 and 2 more — remove the references first.'
			)
		);
	});

	it('falls back to the generic toast on a non-409 failure', async () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		deleteAsset.mockRejectedValueOnce(new h.MockApiError(500, 'boom'));
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		await fireEvent.click(within(getByTestId('asset-row')).getByTestId('asset-delete'));

		await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to delete asset', 'boom'));
	});

	// Catches an unconditional <img> (src="" / src={undefined}) on reference-less
	// assets — the browser's broken-image glyph on every row in the library.
	it('renders a row thumbnail only when the asset has a reference image', () => {
		list = [
			asset({ id: 'a1', name: 'Hero', reference_images: ['/api/media/hero.png'] }),
			asset({ id: 'a2', name: 'Sidekick', reference_images: [] })
		];
		const { getAllByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		const rows = getAllByTestId('asset-row');
		expect(rows).toHaveLength(2);

		const thumb = within(rows[0]).getByTestId('asset-row-thumb') as HTMLImageElement;
		expect(thumb.getAttribute('src')).toBe('/api/media/hero.png');
		// Meaningful alt (a11y gate): names the asset, not "image".
		expect(thumb.alt).toContain('Hero');

		expect(rows[1].querySelector('[data-testid="asset-row-thumb"]')).toBeNull();
	});

	// An asset with no reference images must render exactly as it did before
	// thumbnails existed — name, descriptor and both row actions, no extra node.
	it('renders a reference-less row unchanged', () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		const row = within(getByTestId('asset-row'));
		expect(row.getByTestId('asset-name').textContent).toContain('Hero');
		expect(row.getByTestId('asset-descriptor').textContent).toContain('a brave knight');
		expect(row.getByTestId('asset-edit')).toBeTruthy();
		expect(row.getByTestId('asset-delete')).toBeTruthy();
		expect(getByTestId('asset-row').querySelectorAll('img')).toHaveLength(0);
	});

	it('opens the inline editor when Add is clicked', async () => {
		const { getByTestId, queryByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		expect(queryByTestId('asset-editor')).toBeNull();
		await fireEvent.click(getByTestId('add-asset-character'));
		expect(getByTestId('asset-editor')).toBeTruthy();
	});

	it('opens the inline editor in place of the row when Edit is clicked', async () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		await fireEvent.click(within(getByTestId('asset-row')).getByTestId('asset-edit'));
		expect(getByTestId('asset-editor')).toBeTruthy();
	});

	it('leaves every add-asset and the row edit/delete enabled when not disabled', () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1' } });
		for (const kind of ['character', 'location', 'prop']) {
			expect((getByTestId(`add-asset-${kind}`) as HTMLButtonElement).disabled).toBe(false);
		}
		const row = within(getByTestId('asset-row'));
		expect((row.getByTestId('asset-edit') as HTMLButtonElement).disabled).toBe(false);
		expect((row.getByTestId('asset-delete') as HTMLButtonElement).disabled).toBe(false);
	});

	it('disables every add-asset and the row edit/delete when disabled', () => {
		list = [asset({ id: 'a1', name: 'Hero' })];
		const { getByTestId } = render(AssetLibrary, { props: { projectId: 'p1', disabled: true } });
		for (const kind of ['character', 'location', 'prop']) {
			expect((getByTestId(`add-asset-${kind}`) as HTMLButtonElement).disabled).toBe(true);
		}
		const row = within(getByTestId('asset-row'));
		expect((row.getByTestId('asset-edit') as HTMLButtonElement).disabled).toBe(true);
		expect((row.getByTestId('asset-delete') as HTMLButtonElement).disabled).toBe(true);
	});
});

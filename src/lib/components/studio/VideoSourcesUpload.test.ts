/**
 * VideoSourcesUpload — what the person uploading a 134 MB drone clip actually
 * gets: a way out, a bar that moves, and a sentence written for them.
 *
 * These are the UI-side fences for the three defects. The transport-side fences
 * (abort releases the staged parts, an abort after `complete` does NOT) live in
 * `src/lib/api/uploads.video-sources-chunked.test.ts`; this file asserts only
 * what the component is responsible for — that a cancel is offered, wired to a
 * real signal, and reported as a cancel rather than as a failure, and that no
 * wire-level error string ever reaches the screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));

const videoSourceAuto = vi.fn();
const listVideoSources = vi.fn();
const deleteVideoSource = vi.fn();
vi.mock('$lib/api', () => ({
	uploads: {
		videoSourceAuto: (...args: unknown[]) => videoSourceAuto(...args),
		listVideoSources: (...args: unknown[]) => listVideoSources(...args),
		deleteVideoSource: (...args: unknown[]) => deleteVideoSource(...args)
	}
}));

import VideoSourcesUpload from './VideoSourcesUpload.svelte';
import { ApiError } from '$lib/api/client';

function clip(name = 'drone.mp4', size = 134_496_939): File {
	const file = new File([new Uint8Array(1)], name, { type: 'video/mp4' });
	Object.defineProperty(file, 'size', { value: size });
	return file;
}

function setup() {
	const utils = render(VideoSourcesUpload, { projectId: 'proj-1' });
	return utils;
}

async function pick(container: HTMLElement, file: File) {
	const input = container.querySelector('[data-testid="video-sources-input"]') as HTMLInputElement;
	Object.defineProperty(input, 'files', { value: [file], configurable: true });
	await fireEvent.change(input);
}

beforeEach(() => {
	videoSourceAuto.mockReset();
	listVideoSources.mockReset();
	deleteVideoSource.mockReset();
	listVideoSources.mockResolvedValue({ items: [], total: 0 });
});

afterEach(() => vi.restoreAllMocks());

describe('VideoSourcesUpload — cancelling an upload', () => {
	it('offers a Cancel control while a clip is in flight and aborts the real signal', async () => {
		// ⛔ THE FENCE for defect 1 at the UI. There was no cancel control of any
		// kind: `videoSourceAuto` was called with only `onProgress`, so a mis-picked
		// 512 MB file could be escaped ONLY by closing the tab — and the pump is
		// sequential, so it also held every clip queued behind it. Remove the
		// `signal:` argument in `pump()` and this reds on `signal.aborted`.
		let captured: AbortSignal | undefined;
		videoSourceAuto.mockImplementation(
			(_p: string, _f: File, opts: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					captured = opts.signal;
					opts.signal?.addEventListener('abort', () =>
						reject(opts.signal?.reason ?? new Error('aborted'))
					);
				})
		);
		const { container } = setup();

		await pick(container, clip());
		const cancelButton = await screen.findByTestId('video-source-cancel');
		await fireEvent.click(cancelButton);

		expect(captured).toBeInstanceOf(AbortSignal);
		expect(captured?.aborted).toBe(true);
		// Reported as a CANCEL, not as a failure: telling someone the clip "could
		// not be uploaded" invites them to retry what they deliberately stopped.
		await waitFor(() => {
			expect(screen.getByTestId('video-sources-list').textContent).toMatch(/was cancelled/i);
		});
		expect(screen.getByTestId('video-sources-list').textContent).not.toMatch(/could not upload/i);
	});

	it('paints a determinate bar from the fractions the uploader reports', async () => {
		// Defect 2 as the operator sees it: the bar must sit at a real intermediate
		// value mid-transfer, not at 0 until the whole clip has landed.
		videoSourceAuto.mockImplementation(
			(_p: string, _f: File, opts: { onProgress?: (f: number) => void }) =>
				new Promise(() => {
					opts.onProgress?.(0);
					opts.onProgress?.(0.42);
				})
		);
		const { container } = setup();

		await pick(container, clip());

		await waitFor(() => {
			expect(screen.getByTestId('video-source-progress').getAttribute('aria-valuenow')).toBe('42');
		});
	});
});

describe('VideoSourcesUpload — what a failure says', () => {
	it('shows the human 413 copy, never ApiError’s "413 Payload Too Large" template', async () => {
		// ⛔ THE FENCE for defect 3. `ApiError.message` is
		// `${status} ${statusText}: ${detail}` — a wire trace. Rendering `err.message`
		// straight put "413 Payload Too Large: Request Entity Too Large" in front of a
		// tester while the sentence written for that exact code sat unused one module
		// away. Revert `pump()`'s catch to `err.message` and this reds.
		videoSourceAuto.mockRejectedValue(
			new ApiError(413, 'Payload Too Large', 'Request Entity Too Large')
		);
		const { container } = setup();

		await pick(container, clip());

		const list = await screen.findByTestId('video-sources-list');
		await waitFor(() => expect(list.textContent).toMatch(/rejected by the network/i));
		expect(list.textContent).not.toMatch(/413 Payload Too Large/);
		// And it does not tell them to compress a file that is inside our own cap.
		expect(list.textContent).not.toMatch(/compress/i);
	});

	it('does not put a raw status line on screen when the clip list fails to load', async () => {
		listVideoSources.mockRejectedValue(new ApiError(403, 'Forbidden', 'Not permitted'));

		setup();

		await waitFor(() => expect(screen.getByText('Not permitted')).toBeInTheDocument());
		expect(document.body.textContent).not.toMatch(/403 Forbidden/);
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	getToken: vi.fn()
}));

import { getToken } from '$lib/services/keycloak.js';
import { ApiError, clearLicenseToken, setLicenseToken } from './client.js';
import { downloadBlob, downloadJsonAsFile, downloads, postForBlob } from './downloads.js';
import { byoProviderRequiredFromError } from './byo-provider.js';

describe('downloads helper', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		vi.mocked(getToken).mockReset();
		clearLicenseToken();

		// JSDOM/happy-dom URL.createObjectURL stub
		vi.stubGlobal('URL', {
			...URL,
			createObjectURL: vi.fn(() => 'blob:mock'),
			revokeObjectURL: vi.fn()
		});
	});

	afterEach(() => {
		clearLicenseToken();
	});

	it('forwards a fresh keycloak token + X-Tenant-Id Bearer license header on every call', async () => {
		vi.mocked(getToken).mockReturnValueOnce('tok-1');
		setLicenseToken('lic-xyz');
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: async () => new Blob(['hello']),
			clone: () => ({ json: async () => ({}) })
		});

		await downloadBlob('/pipeline/abc/video', 'video.mp4', 'video/mp4');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer tok-1');
		expect(headers['X-Tenant-Id']).toBe('Bearer lic-xyz');
		expect(headers.Accept).toBe('video/mp4');
	});

	it('omits X-Tenant-Id entirely when no license token is configured', async () => {
		vi.mocked(getToken).mockReturnValueOnce('tok-1');
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: async () => new Blob(['hello']),
			clone: () => ({ json: async () => ({}) })
		});

		await downloadBlob('/pipeline/abc/video', 'video.mp4');
		const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		// No bare UUID — backend would reject `X-Tenant-Id: <uuid>` as a
		// malformed license header. Either send `Bearer <token>` or nothing.
		expect(headers['X-Tenant-Id']).toBeUndefined();
		expect(headers['x-tenant-id']).toBeUndefined();
	});

	it('omits Authorization when no token is present', async () => {
		vi.mocked(getToken).mockReturnValueOnce(undefined);
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: async () => new Blob(['x']),
			clone: () => ({ json: async () => ({}) })
		});

		await downloadBlob('/pipeline/abc/video', 'video.mp4');
		const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});

	it('throws ApiError on non-2xx with server detail', async () => {
		vi.mocked(getToken).mockReturnValue(undefined);
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 403,
			statusText: 'Forbidden',
			clone: () => ({ json: async () => ({ detail: 'license expired' }) })
		});

		await expect(downloadBlob('/pipeline/abc/x', 'x.bin')).rejects.toBeInstanceOf(ApiError);
	});

	it('falls back to statusText when error body is not JSON', async () => {
		vi.mocked(getToken).mockReturnValue(undefined);
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			clone: () => ({
				json: async () => {
					throw new Error('not json');
				}
			})
		});

		await expect(downloadBlob('/pipeline/abc/x', 'x.bin')).rejects.toMatchObject({
			status: 500,
			detail: 'Internal Server Error'
		});
	});

	it('downloadJsonAsFile parses JSON, returns it, and writes via Blob', async () => {
		vi.mocked(getToken).mockReturnValueOnce(undefined);
		const payload = { ok: true, items: [1, 2, 3] };
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => payload,
			clone: () => ({ json: async () => payload })
		});

		// stub anchor click so happy-dom doesn't actually navigate
		const click = vi.fn();
		const origCreateElement = document.createElement.bind(document);
		const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreateElement(tag);
			if (tag === 'a') {
				(el as HTMLAnchorElement).click = click;
			}
			return el;
		});

		const result = await downloadJsonAsFile<typeof payload>(
			'/pipeline/x/pack/bundle',
			'bundle.json'
		);

		expect(result).toEqual(payload);
		expect(click).toHaveBeenCalledOnce();
		spy.mockRestore();
	});

	it('downloads.critiqueReportPdf hits the critique PDF route', async () => {
		vi.mocked(getToken).mockReturnValueOnce(undefined);
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
			clone: () => ({ json: async () => ({}) })
		});
		const click = vi.fn();
		const origCreateElement = document.createElement.bind(document);
		const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreateElement(tag);
			if (tag === 'a') (el as HTMLAnchorElement).click = click;
			return el;
		});

		await downloads.critiqueReportPdf('run-123', 'report.pdf');

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/critique/run-123/report/pdf',
			expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/pdf' }) })
		);
		spy.mockRestore();
	});

	it.each([
		['storyboardCsv', 'export.csv', 'text/csv'],
		['storyboardEdl', 'export.edl', 'text/plain'],
		['storyboardFcpxml', 'export.fcpxml', 'application/xml'],
		['storyboardPdf', 'export.pdf', 'application/pdf']
	] as const)('downloads.%s hits %s with the right Accept mime', async (fn, file, mime) => {
		vi.mocked(getToken).mockReturnValueOnce(undefined);
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			blob: async () => new Blob(['data'], { type: mime }),
			clone: () => ({ json: async () => ({}) })
		});
		const click = vi.fn();
		const origCreateElement = document.createElement.bind(document);
		const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreateElement(tag);
			if (tag === 'a') (el as HTMLAnchorElement).click = click;
			return el;
		});

		await downloads[fn]('proj-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`/api/projects/proj-1/storyboard/${file}`,
			expect.objectContaining({ headers: expect.objectContaining({ Accept: mime }) })
		);
		spy.mockRestore();
	});

	// w2v_orchestrator#1106: the voice preview (`POST /api/tts/preview`, a blob
	// route) answers a byo_required tenant with a 402 whose structured detail must
	// SURVIVE into the ApiError, or no screen can tell it from any other failure.
	describe('postForBlob — 402 byo_provider_required', () => {
		const BYO = {
			code: 'byo_provider_required',
			modality: 'tts',
			message: 'Configure your own TTS provider to continue'
		};
		const reply402 = (body: unknown) => ({
			ok: false,
			status: 402,
			statusText: 'Payment Required',
			clone: () => ({ json: async () => body })
		});

		it.each([
			[
				'canonical envelope (error.details)',
				{ error: { code: 'HTTP_402', message: BYO.message, status: 402, details: BYO } }
			],
			['bare FastAPI detail object', { detail: BYO }]
		])('carries the detail through on a %s', async (_label, body) => {
			fetchMock.mockResolvedValueOnce(reply402(body));
			const err = await postForBlob('/tts/preview', { voice: 'af_heart' }, 'audio/wav').catch(
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(ApiError);
			expect((err as ApiError).detail).toBe(BYO.message);
			expect(byoProviderRequiredFromError(err)?.modality).toBe('tts');
		});
	});
});

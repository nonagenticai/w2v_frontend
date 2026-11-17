import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { parseTotalCount, runs } from './runs.js';

describe('runs api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 'run-1' })
		});
	});

	it('start POSTs to /deliverables/{id}/runs with the supplied body', async () => {
		await runs.start('deliv-42', { pause_after_stages: ['brief_intake'] });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/deliverables/deliv-42/runs');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ pause_after_stages: ['brief_intake'] });
	});

	it('listForProject hands X-Total-Count to onTotal', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers({ 'X-Total-Count': '73' }),
			json: async () => []
		});
		const onTotal = vi.fn();
		await runs.listForProject('p-1', { limit: 50, onTotal });
		expect(onTotal).toHaveBeenCalledWith(73);
	});

	it('listForProject reports null when the header is absent', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: async () => []
		});
		const onTotal = vi.fn();
		await runs.listForProject('p-1', { onTotal });
		expect(onTotal).toHaveBeenCalledWith(null);
	});

	it('parseTotalCount accepts only non-negative integers', () => {
		expect(parseTotalCount('0')).toBe(0);
		expect(parseTotalCount(' 12 ')).toBe(12);
		expect(parseTotalCount('-1')).toBeNull();
		expect(parseTotalCount('1.5')).toBeNull();
		expect(parseTotalCount('abc')).toBeNull();
		expect(parseTotalCount(null)).toBeNull();
	});

	it('start defaults to an empty body', async () => {
		await runs.start('deliv-42');
		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({});
	});

	it('start forwards an Idempotency-Key header when supplied', async () => {
		await runs.start('deliv-42', {}, { idempotencyKey: 'idem-123' });
		const [, init] = fetchMock.mock.calls[0];
		expect(new Headers(init.headers).get('Idempotency-Key')).toBe('idem-123');
	});

	it('start omits the Idempotency-Key header when not supplied', async () => {
		await runs.start('deliv-42');
		const [, init] = fetchMock.mock.calls[0];
		expect(new Headers(init.headers).get('Idempotency-Key')).toBeNull();
	});

	it('get fetches /runs/{id}', async () => {
		await runs.get('run-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1');
		expect(init.method).toBeUndefined();
	});

	it.each(['cancel', 'pause', 'resume'] as const)('%s POSTs /runs/{id}/%s', async (verb) => {
		await runs[verb]('run-1');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain(`/runs/run-1/${verb}`);
		expect(init.method).toBe('POST');
	});

	it('regenerateClip POSTs the spine stage + element id to /regenerate-clip', async () => {
		await runs.regenerateClip('run-1', 'promo_storyboard', 's3');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/regenerate-clip');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ stage_name: 'promo_storyboard', element_id: 's3' });
	});

	it('renarrateClip POSTs the new line + voice to /renarrate-clip', async () => {
		await runs.renarrateClip('run-1', 'promo_storyboard', 's3', {
			narrationText: 'Ship faster.',
			voice: 'bm_george'
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/renarrate-clip');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			stage_name: 'promo_storyboard',
			element_id: 's3',
			narration_text: 'Ship faster.',
			voice: 'bm_george'
		});
	});

	it('renarrateClip omits an unset field (omitted = keep the current line/voice)', async () => {
		await runs.renarrateClip('run-1', 'promo_storyboard', 's3', { voice: 'af_bella' });
		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({
			stage_name: 'promo_storyboard',
			element_id: 's3',
			voice: 'af_bella'
		});
	});

	it('reorderClips POSTs the ordered ids to /reorder-clips', async () => {
		await runs.reorderClips('run-1', 'promo_storyboard', ['s2', 's1']);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/reorder-clips');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			stage_name: 'promo_storyboard',
			ordered_element_ids: ['s2', 's1']
		});
	});

	it('applyClipEdits POSTs the per-clip overrides to /apply-edits', async () => {
		await runs.applyClipEdits('run-1', 'demo_video_gen', {
			'clip-2': { clip_lead_seconds: 1.5, clip_anchor: 'start' }
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/apply-edits');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			stage_name: 'demo_video_gen',
			edits: { 'clip-2': { clip_lead_seconds: 1.5, clip_anchor: 'start' } }
		});
	});

	it('applyClipEdits includes a music override when supplied', async () => {
		await runs.applyClipEdits(
			'run-1',
			'demo_video_gen',
			{},
			{ track: 'corporate_uplift', gain_db: -14 }
		);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/apply-edits');
		expect(JSON.parse(init.body)).toEqual({
			stage_name: 'demo_video_gen',
			edits: {},
			music: { track: 'corporate_uplift', gain_db: -14 }
		});
	});

	it('applyClipEdits omits music when not supplied', async () => {
		await runs.applyClipEdits('run-1', 'demo_video_gen', { 'clip-1': { caption: 'hi' } });
		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({
			stage_name: 'demo_video_gen',
			edits: { 'clip-1': { caption: 'hi' } }
		});
	});

	it('stages.restampElement POSTs full value to the restamp route', async () => {
		await runs.stages.restampElement('run-1', 'storyboard_draft', 'shot_3', {
			value: { text: 'new shot text', kind: 'shot' }
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/stages/storyboard_draft/elements/shot_3/restamp');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			value: { text: 'new shot text', kind: 'shot' }
		});
	});
});

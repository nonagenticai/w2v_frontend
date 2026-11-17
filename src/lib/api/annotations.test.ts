import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/services/keycloak.js', () => ({
	ensureFreshToken: vi.fn()
}));

import { annotations } from './annotations.js';

describe('annotations api client', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	it('adapts the StageOutputAnnotations envelope to the internal list model', async () => {
		// Wire contract: { stage_output_id, items:[{stage_output_id, applied_in_run_id, ...}] }.
		// Reading `.annotations` off this used to yield undefined (empty Notes rail).
		// The ITEMS are passed through verbatim now — the internal
		// `AnnotationResponse` is an alias of the generated schema, so the row
		// asserted below is the wire row, field for field.
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				stage_output_id: 'so-1',
				items: [
					{
						id: 'a1',
						stage_output_id: 'so-1',
						element_id: 'clip-2',
						text: 'tighten this',
						status: 'applied',
						applied_in_run_id: 'run-99',
						created_at: '2026-07-29T00:00:00Z',
						updated_at: '2026-07-29T00:00:00Z'
					}
				]
			})
		});

		const result = await annotations.list('run-1', 'storyboard');

		const [url] = fetchMock.mock.calls[0];
		expect(url).toContain('/runs/run-1/stages/storyboard/annotations');
		expect(result.total).toBe(1);
		expect(result.annotations).toHaveLength(1);
		expect(result.annotations[0]).toEqual({
			id: 'a1',
			stage_output_id: 'so-1',
			element_id: 'clip-2',
			text: 'tighten this',
			status: 'applied',
			applied_in_run_id: 'run-99',
			created_at: '2026-07-29T00:00:00Z',
			updated_at: '2026-07-29T00:00:00Z'
		});
	});

	it('returns an empty list (not a crash) when items is absent', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ stage_output_id: 'so-2' })
		});

		const result = await annotations.list('run-1', 'render');

		expect(result.annotations).toEqual([]);
		expect(result.total).toBe(0);
	});

	it('returns the created annotation in the wire shape', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				id: 'a2',
				stage_output_id: 'so-1',
				element_id: null,
				text: 'new note',
				status: 'open',
				applied_in_run_id: null,
				created_at: '2026-07-29T00:00:00Z',
				updated_at: '2026-07-29T00:00:00Z'
			})
		});

		const result = await annotations.create('run-1', 'storyboard', {
			text: 'new note',
			element_id: null
		});

		expect(result).toMatchObject({
			id: 'a2',
			stage_output_id: 'so-1',
			applied_in_run_id: null,
			status: 'open'
		});
	});
});

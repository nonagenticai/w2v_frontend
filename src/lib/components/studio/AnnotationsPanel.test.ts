import { fireEvent, render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The panel reads the annotations-fetch outcome off `page.data` — both routes
// that mount it (the stage-editor rail and the Studio clip inspector) publish
// the same `annotationsError` key from their loader.
const h = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({
	page: {
		get data() {
			return h.data;
		}
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn().mockResolvedValue(undefined) }));

import AnnotationsPanel from './AnnotationsPanel.svelte';
import type { AnnotationResponse } from '$lib/types';

beforeEach(() => {
	h.data = {};
});

const ann = (overrides: Partial<AnnotationResponse> = {}): AnnotationResponse => ({
	id: '1',
	stage_output_id: 'so-1',
	element_id: null,
	text: 'note',
	status: 'open',
	applied_in_run_id: null,
	created_at: '2026-05-08T00:00:00Z',
	updated_at: '2026-05-08T00:00:00Z',
	...overrides
});

describe('AnnotationsPanel', () => {
	it('renders the open bucket by default and hides applied/dismissed entries', () => {
		const { getByText, queryByText } = render(AnnotationsPanel, {
			props: {
				items: [
					ann({ id: '1', status: 'open', text: 'OPEN_NOTE' }),
					ann({ id: '2', status: 'applied', text: 'APPLIED_NOTE' }),
					ann({ id: '3', status: 'dismissed', text: 'DISMISSED_NOTE' })
				],
				selectedIds: new Set<string>()
			}
		});
		expect(getByText('OPEN_NOTE')).toBeTruthy();
		expect(queryByText('APPLIED_NOTE')).toBeNull();
		expect(queryByText('DISMISSED_NOTE')).toBeNull();
	});

	it('switches buckets when a tab is clicked', async () => {
		const { getByRole, getByText, queryByText } = render(AnnotationsPanel, {
			props: {
				items: [
					ann({ id: '1', status: 'open', text: 'OPEN_NOTE' }),
					ann({ id: '2', status: 'applied', text: 'APPLIED_NOTE' })
				],
				selectedIds: new Set<string>()
			}
		});
		await fireEvent.click(getByRole('tab', { name: /applied/i }));
		expect(getByText('APPLIED_NOTE')).toBeTruthy();
		expect(queryByText('OPEN_NOTE')).toBeNull();
	});

	it('shows the empty-bucket message when filtered is empty', () => {
		const { getByText } = render(AnnotationsPanel, {
			props: {
				items: [],
				selectedIds: new Set<string>()
			}
		});
		expect(getByText('No open notes.')).toBeTruthy();
	});

	// The `annotation-draft` testid is a CONTRACT with the post-promote E2E
	// (pr-studio-clip-regen). The inspector hosts several textareas now (caption,
	// re-narrate text, this note), so the spec can no longer find it by role — a
	// silent rename here would break the surgical-regen shard in CI, not locally.
	it('exposes the annotation draft under a stable testid for E2E', () => {
		const { getByTestId } = render(AnnotationsPanel, {
			props: { items: [], selectedIds: new Set<string>() }
		});
		expect(getByTestId('annotation-draft').tagName).toBe('TEXTAREA');
	});

	it('hides the Add-stage-note form when not viewing the open bucket', async () => {
		const { getByRole, queryByPlaceholderText } = render(AnnotationsPanel, {
			props: {
				items: [ann({ id: '1', status: 'applied', text: 'A' })],
				selectedIds: new Set<string>()
			}
		});
		expect(queryByPlaceholderText(/Stage-level note/)).toBeTruthy();
		await fireEvent.click(getByRole('tab', { name: /applied/i }));
		expect(queryByPlaceholderText(/Stage-level note/)).toBeNull();
	});

	it('shows tab counts derived from items', () => {
		const { getByRole } = render(AnnotationsPanel, {
			props: {
				items: [
					ann({ id: '1', status: 'open' }),
					ann({ id: '2', status: 'open' }),
					ann({ id: '3', status: 'applied' })
				],
				selectedIds: new Set<string>()
			}
		});
		expect(getByRole('tab', { name: /open\s*2/i })).toBeTruthy();
		expect(getByRole('tab', { name: /applied\s*1/i })).toBeTruthy();
		expect(getByRole('tab', { name: /dismissed\s*0/i })).toBeTruthy();
	});

	// `created_at` is NOT NULL on the orchestrator side at every layer — the
	// column (migration 0013_annotations), the ORM mapping, and the
	// `AnnotationResponse` pydantic model all declare it non-optional, so the
	// generated `types.gen.ts` types it as a plain `string`. The predecessor of
	// this test fed a `null` timestamp, which the wire can never produce; it now
	// asserts the ordering property itself, with the input deliberately
	// scrambled so that dropping the sort reverses the expectation.
	it('orders open notes by created_at ASC', () => {
		const { container } = render(AnnotationsPanel, {
			props: {
				items: [
					ann({ id: 'b', text: 'B', created_at: '2026-05-08T03:00:00Z' }),
					ann({ id: 'a', text: 'A', created_at: '2026-05-08T01:00:00Z' }),
					ann({ id: 'c', text: 'C', created_at: '2026-05-07T22:00:00Z' })
				],
				selectedIds: new Set<string>()
			}
		});
		const list = container.querySelector('[data-testid="annotations-list"]');
		expect(list?.textContent).toMatch(/C[\s\S]*A[\s\S]*B/);
	});

	describe('inline pin form (replaces window.prompt)', () => {
		it('shows the pin indicator and switches button label when pinningElementId is set', () => {
			const { getByText, getByRole, queryByTestId, getByTestId } = render(AnnotationsPanel, {
				props: {
					items: [],
					selectedIds: new Set<string>(),
					pinningElementId: 'scene-3',
					pinningElementLabel: 'Scene 3',
					onAddElementNote: vi.fn()
				}
			});
			expect(queryByTestId('annotations-pin-indicator')).toBeTruthy();
			const indicator = getByTestId('annotations-pin-indicator');
			expect(indicator.textContent).toContain('Scene 3');
			expect(getByText('Add element note')).toBeTruthy();
			expect(getByRole('button', { name: /clear pin/i })).toBeTruthy();
		});

		it('falls back to elementId when no label is given', () => {
			const { getByTestId } = render(AnnotationsPanel, {
				props: {
					items: [],
					selectedIds: new Set<string>(),
					pinningElementId: 'scene-3',
					onAddElementNote: vi.fn()
				}
			});
			expect(getByTestId('annotations-pin-indicator').textContent).toContain('scene-3');
		});

		it('hides the pin indicator and shows stage label when no pinning is active', () => {
			const { getByText, queryByTestId } = render(AnnotationsPanel, {
				props: {
					items: [],
					selectedIds: new Set<string>()
				}
			});
			expect(queryByTestId('annotations-pin-indicator')).toBeNull();
			expect(getByText('Add stage note')).toBeTruthy();
		});

		it('routes submit to onAddElementNote with the pinned id when pinning is active', async () => {
			const onAddElementNote = vi.fn().mockResolvedValue(undefined);
			const onAddStageNote = vi.fn();
			const { getByPlaceholderText, getByText } = render(AnnotationsPanel, {
				props: {
					items: [],
					selectedIds: new Set<string>(),
					pinningElementId: 'scene-3',
					onAddElementNote,
					onAddStageNote
				}
			});
			const textarea = getByPlaceholderText(/Note pinned to scene-3/);
			await fireEvent.input(textarea, { target: { value: 'Tighten the hook' } });
			await fireEvent.click(getByText('Add element note'));
			expect(onAddElementNote).toHaveBeenCalledWith('scene-3', 'Tighten the hook');
			expect(onAddStageNote).not.toHaveBeenCalled();
		});

		it('routes submit to onAddStageNote when pinning is not active', async () => {
			const onAddElementNote = vi.fn();
			const onAddStageNote = vi.fn().mockResolvedValue(undefined);
			const { getByPlaceholderText, getByText } = render(AnnotationsPanel, {
				props: {
					items: [],
					selectedIds: new Set<string>(),
					onAddStageNote,
					onAddElementNote
				}
			});
			const textarea = getByPlaceholderText(/Stage-level note/);
			await fireEvent.input(textarea, { target: { value: 'Stage-wide rewrite' } });
			await fireEvent.click(getByText('Add stage note'));
			expect(onAddStageNote).toHaveBeenCalledWith('Stage-wide rewrite');
			expect(onAddElementNote).not.toHaveBeenCalled();
		});

		it('clicking "Clear pin" calls onClearPinning without submitting', async () => {
			const onClearPinning = vi.fn();
			const onAddElementNote = vi.fn();
			const { getByRole } = render(AnnotationsPanel, {
				props: {
					items: [],
					selectedIds: new Set<string>(),
					pinningElementId: 'scene-3',
					onClearPinning,
					onAddElementNote
				}
			});
			await fireEvent.click(getByRole('button', { name: /clear pin/i }));
			expect(onClearPinning).toHaveBeenCalledTimes(1);
			expect(onAddElementNote).not.toHaveBeenCalled();
		});
	});
});

/**
 * `items: []` means BOTH "this stage has no notes" and "the annotations fetch
 * failed" — and this panel used to state the first one out loud ("No open
 * notes.") plus a confident 0 on every bucket tab. A tester who filed a note and
 * reloaded read that as "my note was never saved".
 */
describe('AnnotationsPanel when the annotations fetch failed', () => {
	it('shows an error state instead of claiming there are no notes', () => {
		h.data = { annotationsError: new Error('annotations 500') };
		const { getByTestId, queryByText } = render(AnnotationsPanel, {
			props: { items: [], selectedIds: new Set<string>() }
		});
		expect(getByTestId('annotations-unavailable')).toBeInTheDocument();
		expect(getByTestId('error-state')).toHaveAttribute('role', 'alert');
		// The regression guard: an error banner that still leaves "No open notes."
		// on screen misleads exactly as before.
		expect(queryByText('No open notes.')).toBeNull();
	});

	it('does not render a confident zero on the bucket tabs', () => {
		h.data = { annotationsError: new Error('annotations 500') };
		const { getByRole } = render(AnnotationsPanel, {
			props: { items: [], selectedIds: new Set<string>() }
		});
		// "?" — the count is unknown, not zero.
		expect(getByRole('tab', { name: /open/i }).textContent).toContain('?');
		expect(getByRole('tab', { name: /open/i }).textContent).not.toContain('0');
	});

	it('still says "No open notes." for a genuinely empty, successful fetch', () => {
		h.data = { annotationsError: null };
		const { getByText, queryByTestId, getByRole } = render(AnnotationsPanel, {
			props: { items: [], selectedIds: new Set<string>() }
		});
		expect(getByText('No open notes.')).toBeInTheDocument();
		expect(queryByTestId('annotations-unavailable')).toBeNull();
		expect(getByRole('tab', { name: /open/i }).textContent).toContain('0');
	});

	it('does not crash when $app/state carries no page data', () => {
		h.data = undefined as unknown as Record<string, unknown>;
		const { getByText } = render(AnnotationsPanel, {
			props: { items: [], selectedIds: new Set<string>() }
		});
		expect(getByText('No open notes.')).toBeInTheDocument();
	});
});

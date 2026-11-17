import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Only the voiceover upload call is stubbed; everything else in `$lib/api` stays
// real (the component imports `ApiError` from it too).
const voiceoverUpload = vi.fn();
vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return {
		...actual,
		uploads: { ...actual.uploads, voiceover: (f: File) => voiceoverUpload(f) }
	};
});

// The inspector mounts a wavesurfer-backed <Waveform> for a clip that has a
// replacement voiceover; wavesurfer needs real Web Audio, which happy-dom lacks.
vi.mock('wavesurfer.js', () => ({
	default: {
		create: vi.fn(() => ({
			destroy: vi.fn(),
			playPause: vi.fn(),
			on: vi.fn(),
			load: vi.fn()
		}))
	}
}));

// The inspector (and the AnnotationsPanel it nests) read the annotations-fetch
// outcome off `page.data`, published by the studio loader as `annotationsError`.
const h = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({
	page: {
		get data() {
			return h.data;
		}
	}
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn().mockResolvedValue(undefined) }));
// The BYO notice links /providers only for a tenant_admin.
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => true }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

import ClipInspector from './ClipInspector.svelte';
import { ApiError } from '$lib/api';
import type { Clip } from '$lib/utils/timeline';
import type { AnnotationResponse } from '$lib/types';

const clip: Clip = {
	id: 's1',
	lineId: null,
	index: 0,
	seconds: 3,
	startSec: 0,
	description: 'opening shot',
	narration: 'Welcome to the tour.',
	visualType: 'footage',
	thumbnailUrl: null,
	posterVideoUrl: null,
	isFootage: false,
	clipLeadSeconds: 0,
	clipAnchor: 'start',
	caption: '',
	fit: null,
	speed: null,
	transition: null,
	adjust: null,
	overlays: null,
	audio: null,
	audioUrl: null,
	audioSeconds: null
};

function note(over: Partial<AnnotationResponse> = {}): AnnotationResponse {
	return {
		id: 'a1',
		stage_output_id: 'so-promo-storyboard',
		element_id: 's1',
		text: 'make it punchier',
		status: 'open',
		applied_in_run_id: null,
		created_at: '2026-07-04T00:00:00Z',
		updated_at: '2026-07-04T00:00:00Z',
		...over
	};
}

beforeEach(() => {
	h.data = {};
});

describe('ClipInspector', () => {
	const base = {
		clip,
		annotations: [] as AnnotationResponse[],
		onAddNote: vi.fn(async () => {}),
		onRegenerate: vi.fn()
	};

	it('disables Regenerate when the clip has no open notes', () => {
		const { container } = render(ClipInspector, { props: { ...base } });
		const btn = container.querySelector(
			'[data-testid="regenerate-clip"] button'
		) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
	});

	it('hides a broken thumbnail (onerror) instead of showing a broken image', async () => {
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, thumbnailUrl: 'https://cdn/broken.png' } }
		});
		const img = container.querySelector('[data-testid="inspector-thumb"]')!;
		expect(img).toBeTruthy();
		await fireEvent.error(img);
		expect(container.querySelector('[data-testid="inspector-thumb"]')).toBeNull();
	});

	it('enables Regenerate and fires onRegenerate when there are open notes', async () => {
		const onRegenerate = vi.fn();
		const { container } = render(ClipInspector, {
			props: { ...base, annotations: [note()], onRegenerate }
		});
		const btn = container.querySelector(
			'[data-testid="regenerate-clip"] button'
		) as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
		await fireEvent.click(btn);
		expect(onRegenerate).toHaveBeenCalled();
	});

	it('only counts notes pinned to this clip', () => {
		const { container, getByText } = render(ClipInspector, {
			props: { ...base, annotations: [note({ id: 'a2', element_id: 'OTHER' })] }
		});
		// A note for a different clip must not enable regeneration.
		const btn = container.querySelector(
			'[data-testid="regenerate-clip"] button'
		) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(getByText(/Add a note above/)).toBeTruthy();
	});

	it('hides the whole edit section when no onEditChange handler is wired', () => {
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: true } }
		});
		expect(container.querySelector('[data-testid="clip-edit"]')).toBeNull();
	});

	it('shows caption + fit controls for any clip and reports changes', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false },
				caption: '',
				fit: 'contain',
				onEditChange
			}
		});
		// Edit section present even for a non-footage clip (caption/fit apply to any shot).
		expect(container.querySelector('[data-testid="clip-edit"]')).toBeTruthy();
		// But the footage-only trim controls are hidden.
		expect(container.querySelector('[data-testid="trim-lead"]')).toBeNull();

		const cap = container.querySelector('[data-testid="edit-caption"]') as HTMLTextAreaElement;
		await fireEvent.input(cap, { target: { value: 'hello' } });
		expect(onEditChange).toHaveBeenCalledWith('caption', 'hello');

		const fit = container.querySelector('[data-testid="edit-fit"]') as HTMLSelectElement;
		await fireEvent.change(fit, { target: { value: 'cover' } });
		expect(onEditChange).toHaveBeenCalledWith('fit', 'cover');
	});

	it('reports a playback speed change with a numeric value', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, speed: 1, onEditChange }
		});
		const speed = container.querySelector('[data-testid="clip-speed"]') as HTMLSelectElement;
		expect(speed).toBeTruthy();
		await fireEvent.change(speed, { target: { value: '2' } });
		expect(onEditChange).toHaveBeenCalledWith('speed', 2);
	});

	it('offers the widened speed range including 0.25×, 3× and 4×', () => {
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, speed: 1, onEditChange: vi.fn() }
		});
		const speed = container.querySelector('[data-testid="clip-speed"]') as HTMLSelectElement;
		const values = Array.from(speed.options).map((o) => o.value);
		expect(values).toEqual(['0.25', '0.5', '1', '1.5', '2', '3', '4']);
	});

	it('reports a color-grade preset as { preset } and clears to {} on (none)', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, adjust: {}, onEditChange }
		});
		const preset = container.querySelector('[data-testid="clip-preset"]') as HTMLSelectElement;
		expect(preset).toBeTruthy();
		await fireEvent.change(preset, { target: { value: 'warm' } });
		expect(onEditChange).toHaveBeenCalledWith('adjust', { preset: 'warm' });
		await fireEvent.change(preset, { target: { value: '' } });
		expect(onEditChange).toHaveBeenCalledWith('adjust', {});
	});

	it('merges a grade slider onto the current adjust', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false },
				adjust: { contrast: 1.5 },
				onEditChange
			}
		});
		const brightness = container.querySelector(
			'[data-testid="clip-brightness"]'
		) as HTMLInputElement;
		await fireEvent.input(brightness, { target: { value: '0.5' } });
		expect(onEditChange).toHaveBeenCalledWith('adjust', { contrast: 1.5, brightness: 0.5 });

		const saturation = container.querySelector(
			'[data-testid="clip-saturation"]'
		) as HTMLInputElement;
		await fireEvent.input(saturation, { target: { value: '2' } });
		expect(onEditChange).toHaveBeenCalledWith('adjust', { contrast: 1.5, saturation: 2 });
	});

	it('adds, edits and removes text overlays', async () => {
		const onEditChange = vi.fn();
		// Empty list → the "Add overlay" button seeds a default overlay.
		const { container, rerender } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, overlays: [], onEditChange }
		});
		const add = container.querySelector('[data-testid="clip-overlay-add"]') as HTMLButtonElement;
		await fireEvent.click(add);
		expect(onEditChange).toHaveBeenCalledWith('overlays', [
			{ text: '', position: 'bottom-center', font_size: 48, color: '#ffffff' }
		]);

		// With an existing overlay, editing a field patches that row in place.
		await rerender({
			...base,
			clip: { ...clip, isFootage: false },
			overlays: [{ text: 'Hi', position: 'middle-center', font_size: 48, color: '#ffffff' }],
			onEditChange
		});
		const text = container.querySelector('[data-testid="clip-overlay-text-0"]') as HTMLInputElement;
		await fireEvent.input(text, { target: { value: 'Title' } });
		expect(onEditChange).toHaveBeenCalledWith('overlays', [
			{ text: 'Title', position: 'middle-center', font_size: 48, color: '#ffffff' }
		]);

		const pos = container.querySelector('[data-testid="clip-overlay-pos-0"]') as HTMLSelectElement;
		await fireEvent.change(pos, { target: { value: 'top-left' } });
		expect(onEditChange).toHaveBeenCalledWith('overlays', [
			{ text: 'Hi', position: 'top-left', font_size: 48, color: '#ffffff' }
		]);

		// Removing the only overlay emits an empty list (collapses out downstream).
		const remove = container.querySelector(
			'[data-testid="clip-overlay-remove-0"]'
		) as HTMLButtonElement;
		await fireEvent.click(remove);
		expect(onEditChange).toHaveBeenCalledWith('overlays', []);
	});

	it('offers ONLY server-valid overlay anchors (guards the TextOverlay enum)', async () => {
		// Regression: the picker used to offer 'center', which the orchestrator's
		// TextOverlay.position Literal calls 'middle-center' → apply-edits 422'd and the
		// whole edit silently failed. These are the nine valid anchors; assert exactly
		// them, so a value the server rejects can never reappear in the dropdown.
		const VALID = [
			'top-left',
			'top-center',
			'top-right',
			'middle-left',
			'middle-center',
			'middle-right',
			'bottom-left',
			'bottom-center',
			'bottom-right'
		];
		const { container } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false },
				overlays: [{ text: 'x', position: 'middle-center', font_size: 48, color: '#fff' }],
				// The edit UI (and thus the position select) only renders when an
				// onEditChange handler is supplied — showEdit = onEditChange !== undefined.
				onEditChange: vi.fn()
			}
		});
		const select = container.querySelector(
			'[data-testid="clip-overlay-pos-0"]'
		) as HTMLSelectElement;
		expect([...select.options].map((o) => o.value)).toEqual(VALID);
	});

	it('reports an entering transition as {type, duration} and clears to null on None', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, transition: null, onEditChange }
		});
		const trans = container.querySelector('[data-testid="clip-transition"]') as HTMLSelectElement;
		expect(trans).toBeTruthy();
		// Choosing a type emits an object with the default 0.5s duration.
		await fireEvent.change(trans, { target: { value: 'fade' } });
		expect(onEditChange).toHaveBeenCalledWith('transition', { type: 'fade', duration: 0.5 });

		// A duration input appears once a transition is set; it re-emits with the new duration.
		const { container: c2 } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false },
				transition: { type: 'fade', duration: 0.5 },
				onEditChange
			}
		});
		const dur = c2.querySelector('[data-testid="clip-transition-duration"]') as HTMLInputElement;
		expect(dur).toBeTruthy();
		await fireEvent.input(dur, { target: { value: '1.2' } });
		expect(onEditChange).toHaveBeenCalledWith('transition', { type: 'fade', duration: 1.2 });

		// Selecting "None (cut)" clears the override back to a hard cut (null).
		const trans2 = c2.querySelector('[data-testid="clip-transition"]') as HTMLSelectElement;
		await fireEvent.change(trans2, { target: { value: '' } });
		expect(onEditChange).toHaveBeenCalledWith('transition', null);
	});

	it('uploads a voiceover and reports audio_url + audio_seconds together', async () => {
		voiceoverUpload.mockResolvedValueOnce({ audio_url: 'https://cdn/vo.mp3', seconds: 12.4 });
		const onEditChange = vi.fn();
		const { container, getByTestId } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, onEditChange }
		});
		// Before any upload the shot is on its TTS narration.
		expect(getByTestId('clip-voiceover-status').textContent).toContain('TTS narration');

		const input = container.querySelector(
			'[data-testid="clip-voiceover-file"]'
		) as HTMLInputElement;
		const file = new File(['xx'], 'take-2.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(input, { target: { files: [file] } });

		await waitFor(() =>
			expect(onEditChange).toHaveBeenCalledWith('audio_url', 'https://cdn/vo.mp3', clip.id)
		);
		expect(voiceoverUpload).toHaveBeenCalledWith(file);
		expect(onEditChange).toHaveBeenCalledWith('audio_seconds', 12.4, clip.id);
	});

	it('addresses the upload to the clip it STARTED on, not the one selected when it lands', async () => {
		// The inspector instance is reused across clip selections. If the upload
		// resolved against the live `clip` prop, selecting another clip mid-flight
		// would write clip A's voiceover onto clip B — silently replacing B's
		// narration with A's audio. The target clip id is latched at request time.
		let resolveUpload: (v: { audio_url: string; seconds: number }) => void = () => {};
		voiceoverUpload.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);
		const onEditChange = vi.fn();
		const clipA = { ...clip, id: 'clip-a', isFootage: false };
		const clipB = { ...clip, id: 'clip-b', isFootage: false };
		const { container, rerender } = render(ClipInspector, {
			props: { ...base, clip: clipA, onEditChange }
		});

		const input = container.querySelector(
			'[data-testid="clip-voiceover-file"]'
		) as HTMLInputElement;
		const file = new File(['xx'], 'take-2.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(input, { target: { files: [file] } });

		// The user selects a different clip while the upload is still in flight.
		await rerender({ ...base, clip: clipB, onEditChange });
		resolveUpload({ audio_url: 'https://cdn/vo.mp3', seconds: 12.4 });

		await waitFor(() =>
			expect(onEditChange).toHaveBeenCalledWith('audio_url', 'https://cdn/vo.mp3', 'clip-a')
		);
		expect(onEditChange).toHaveBeenCalledWith('audio_seconds', 12.4, 'clip-a');
		// Nothing was ever addressed to the clip that merely happened to be selected.
		for (const call of onEditChange.mock.calls) expect(call[2]).not.toBe('clip-b');
	});

	it('does not show a phantom "Uploading…" on a clip whose upload is not in flight', async () => {
		voiceoverUpload.mockReturnValueOnce(new Promise(() => {}));
		const clipA = { ...clip, id: 'clip-a', isFootage: false };
		const clipB = { ...clip, id: 'clip-b', isFootage: false };
		const { container, rerender, queryByText } = render(ClipInspector, {
			props: { ...base, clip: clipA, onEditChange: vi.fn() }
		});
		const input = container.querySelector(
			'[data-testid="clip-voiceover-file"]'
		) as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File(['xx'], 'take-2.mp3', { type: 'audio/mpeg' })] }
		});
		await waitFor(() => expect(queryByText(/Uploading/i)).not.toBeNull());

		// Switching to a clip with no upload in flight must clear the busy state.
		await rerender({ ...base, clip: clipB, onEditChange: vi.fn() });
		expect(queryByText(/Uploading/i)).toBeNull();
		expect(
			(container.querySelector('[data-testid="clip-voiceover-file"]') as HTMLInputElement).disabled
		).toBe(false);
	});

	it('warns that the uploaded voiceover reflows the shot length', () => {
		const { getByTestId } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false, seconds: 5 },
				audioUrl: 'https://cdn/vo.mp3',
				audioSeconds: 12.4,
				onEditChange: vi.fn()
			}
		});
		const reflow = getByTestId('clip-voiceover-reflow').textContent ?? '';
		expect(reflow).toContain('12.4s');
		expect(reflow).toContain('shot was 5.0s');
		expect(reflow).toContain('clip will lengthen');
	});

	it('Remove clears the voiceover back to TTS by emitting audio_url: null', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false },
				audioUrl: 'https://cdn/vo.mp3',
				audioSeconds: 9,
				onEditChange
			}
		});
		const remove = container.querySelector(
			'[data-testid="clip-voiceover-remove"]'
		) as HTMLButtonElement;
		expect(remove).toBeTruthy();
		await fireEvent.click(remove);
		expect(onEditChange).toHaveBeenCalledWith('audio_url', null);
	});

	it('has no Remove button and no reflow warning when the clip has no voiceover', () => {
		const { container } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, onEditChange: vi.fn() }
		});
		expect(container.querySelector('[data-testid="clip-voiceover-remove"]')).toBeNull();
		expect(container.querySelector('[data-testid="clip-voiceover-reflow"]')).toBeNull();
	});

	it('shows a waveform player only when the clip has a voiceover url', async () => {
		// No voiceover → nothing to play, so no player is mounted at all.
		const { container, rerender } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, onEditChange: vi.fn() }
		});
		expect(container.querySelector('[data-testid="clip-waveform"]')).toBeNull();

		await rerender({
			...base,
			clip: { ...clip, isFootage: false },
			audioUrl: 'https://cdn/vo.mp3',
			audioSeconds: 9,
			onEditChange: vi.fn()
		});
		const wf = container.querySelector('[data-testid="clip-waveform"]');
		expect(wf).toBeTruthy();
		// The existing filename/Remove UI is kept alongside it.
		expect(container.querySelector('[data-testid="clip-voiceover-remove"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="clip-voiceover-status"]')).toBeTruthy();
	});

	it('drops the waveform again when the voiceover is removed', async () => {
		const { container, rerender } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: false },
				audioUrl: 'https://cdn/vo.mp3',
				audioSeconds: 9,
				onEditChange: vi.fn()
			}
		});
		expect(container.querySelector('[data-testid="clip-waveform"]')).toBeTruthy();
		await rerender({
			...base,
			clip: { ...clip, isFootage: false },
			audioUrl: null,
			onEditChange: vi.fn()
		});
		expect(container.querySelector('[data-testid="clip-waveform"]')).toBeNull();
	});

	it('surfaces an upload failure instead of reporting an edit', async () => {
		voiceoverUpload.mockRejectedValueOnce(new Error('boom'));
		const onEditChange = vi.fn();
		const { container, findByTestId } = render(ClipInspector, {
			props: { ...base, clip: { ...clip, isFootage: false }, onEditChange }
		});
		const input = container.querySelector(
			'[data-testid="clip-voiceover-file"]'
		) as HTMLInputElement;
		await fireEvent.change(input, {
			target: { files: [new File(['xx'], 'bad.mp3', { type: 'audio/mpeg' })] }
		});
		expect(await findByTestId('clip-voiceover-error')).toBeTruthy();
		expect(onEditChange).not.toHaveBeenCalled();
	});

	it('shows trim controls only for a footage clip and reports lead/anchor changes', async () => {
		const onEditChange = vi.fn();
		const { container } = render(ClipInspector, {
			props: {
				...base,
				clip: { ...clip, isFootage: true },
				leadSeconds: 0,
				anchor: 'start',
				onEditChange
			}
		});
		const lead = container.querySelector('[data-testid="trim-lead"]') as HTMLInputElement;
		expect(lead).toBeTruthy();
		await fireEvent.input(lead, { target: { value: '2' } });
		expect(onEditChange).toHaveBeenCalledWith('clip_lead_seconds', 2);

		const anchor = container.querySelector('[data-testid="trim-anchor"]') as HTMLSelectElement;
		await fireEvent.change(anchor, { target: { value: 'end' } });
		expect(onEditChange).toHaveBeenCalledWith('clip_anchor', 'end');
	});
});

describe('ClipInspector re-narrate', () => {
	const base = {
		clip,
		annotations: [] as AnnotationResponse[],
		onAddNote: vi.fn(async () => {}),
		onRegenerate: vi.fn(),
		narrationText: clip.narration
	};
	const btn = (c: HTMLElement) =>
		c.querySelector('[data-testid="renarrate-clip"] button') as HTMLButtonElement;
	const textarea = (c: HTMLElement) =>
		c.querySelector('[data-testid="renarrate-text"]') as HTMLTextAreaElement;

	it('hides the re-narrate control when no onRenarrate handler is wired', () => {
		const { container } = render(ClipInspector, { props: { ...base } });
		expect(container.querySelector('[data-testid="renarrate-clip"]')).toBeNull();
	});

	it('pre-fills the line and is disabled until the text or the voice changes', async () => {
		const onRenarrate = vi.fn(async () => {});
		const { container } = render(ClipInspector, { props: { ...base, onRenarrate } });
		expect(textarea(container).value).toBe('Welcome to the tour.');
		// Neither text nor voice changed → nothing to synthesize (the route 422s).
		expect(btn(container).disabled).toBe(true);

		// Re-typing the same line (even with stray whitespace) is still no change.
		await fireEvent.input(textarea(container), { target: { value: '  Welcome to the tour. ' } });
		expect(btn(container).disabled).toBe(true);

		await fireEvent.input(textarea(container), { target: { value: 'Welcome to the NEW tour.' } });
		expect(btn(container).disabled).toBe(false);
	});

	it('fires onRenarrate with the clip element id, the edited text and the picked voice', async () => {
		const onRenarrate = vi.fn(async () => {});
		const { container } = render(ClipInspector, { props: { ...base, onRenarrate } });

		await fireEvent.input(textarea(container), { target: { value: 'Ship faster.' } });
		const voice = container.querySelector('[data-testid="renarrate-voice"]') as HTMLSelectElement;
		await fireEvent.change(voice, { target: { value: 'bm_george' } });
		await fireEvent.click(btn(container));

		await waitFor(() =>
			expect(onRenarrate).toHaveBeenCalledWith({
				elementId: 's1',
				narrationText: 'Ship faster.',
				voice: 'bm_george'
			})
		);
	});

	it('sends only the voice when the line is untouched', async () => {
		const onRenarrate = vi.fn(async () => {});
		const { container } = render(ClipInspector, { props: { ...base, onRenarrate } });
		const voice = container.querySelector('[data-testid="renarrate-voice"]') as HTMLSelectElement;
		await fireEvent.change(voice, { target: { value: 'af_bella' } });
		expect(btn(container).disabled).toBe(false);
		await fireEvent.click(btn(container));
		// No `narrationText` key at all — an omitted field means "keep the line".
		await waitFor(() =>
			expect(onRenarrate).toHaveBeenCalledWith({ elementId: 's1', voice: 'af_bella' })
		);
	});

	it('addresses the re-narrate to the clip it STARTED on, not the one selected when it lands', async () => {
		// The slice-2 regression: this inspector instance is REUSED across clip
		// selections, so an action that resolves against the live `clip` prop lands
		// clip A's result on clip B. The target clip id is latched at request time
		// and every write (payload, busy, error) is keyed by it.
		let rejectRenarrate: (e: unknown) => void = () => {};
		const onRenarrate = vi.fn(
			() =>
				new Promise<void>((_res, rej) => {
					rejectRenarrate = rej;
				})
		);
		const clipA = { ...clip, id: 'clip-a', narration: 'A line' };
		const clipB = { ...clip, id: 'clip-b', narration: 'B line' };
		const { container, rerender } = render(ClipInspector, {
			props: { ...base, clip: clipA, narrationText: clipA.narration, onRenarrate }
		});

		await fireEvent.input(textarea(container), { target: { value: 'A rewritten' } });
		await fireEvent.click(btn(container));
		expect(onRenarrate).toHaveBeenCalledWith({ elementId: 'clip-a', narrationText: 'A rewritten' });

		// The user selects another clip while the child run is being spawned.
		await rerender({ ...base, clip: clipB, narrationText: clipB.narration, onRenarrate });
		// B shows ITS OWN line — A's draft never leaks across the selection.
		expect(textarea(container).value).toBe('B line');
		// …and B is not busy (no phantom in-flight state).
		expect(textarea(container).disabled).toBe(false);

		rejectRenarrate(new ApiError(422, 'Unprocessable Entity', 'line is not on this stage'));

		// A's failure is NEVER applied to B.
		await waitFor(() => expect(onRenarrate).toHaveBeenCalledTimes(1));
		expect(container.querySelector('[data-testid="renarrate-error"]')).toBeNull();
		// Switching back to A surfaces it on the clip that actually fired it.
		await rerender({ ...base, clip: clipA, narrationText: clipA.narration, onRenarrate });
		await waitFor(() =>
			expect(container.querySelector('[data-testid="renarrate-error"]')?.textContent).toContain(
				'line is not on this stage'
			)
		);
	});

	it('blocks re-narrate with the reason inline when the clip has an uploaded voiceover', () => {
		// An upload WINS over TTS at compile, so re-narrating would be a silent
		// no-op — the backend 422s and so do we, before firing anything.
		const onRenarrate = vi.fn(async () => {});
		const { container, getByTestId } = render(ClipInspector, {
			props: { ...base, audioUrl: 'https://cdn/vo.mp3', audioSeconds: 9, onRenarrate }
		});
		expect(btn(container).disabled).toBe(true);
		expect(textarea(container).disabled).toBe(true);
		expect(getByTestId('renarrate-blocked').textContent).toContain(
			'Remove the uploaded voiceover before re-narrating this line.'
		);
		expect(onRenarrate).not.toHaveBeenCalled();
	});

	it('surfaces a server 422 detail inline', async () => {
		const onRenarrate = vi.fn(async () => {
			throw new ApiError(
				422,
				'Unprocessable Entity',
				'Remove the uploaded voiceover before re-narrating this line.'
			);
		});
		const { container, findByTestId } = render(ClipInspector, {
			props: { ...base, onRenarrate }
		});
		await fireEvent.input(textarea(container), { target: { value: 'Another take.' } });
		await fireEvent.click(btn(container));

		const err = await findByTestId('renarrate-error');
		expect(err.textContent).toContain(
			'Remove the uploaded voiceover before re-narrating this line.'
		);
		// The button is usable again after the failure (busy state cleared).
		await waitFor(() => expect(btn(container).disabled).toBe(false));
	});

	it('a 402 byo_provider_required (#1150) shows the provider notice with a ?missing= link', async () => {
		const onRenarrate = vi.fn(async () => {
			throw new ApiError(402, 'Payment Required', 'x', 'HTTP_402', {
				code: 'byo_provider_required',
				modality: 'tts',
				slots: 'tts,llm',
				message: 'Configure your own TTS and LLM providers to continue'
			});
		});
		const { container, findByTestId, getByTestId } = render(ClipInspector, {
			props: { ...base, onRenarrate }
		});
		await fireEvent.input(textarea(container), { target: { value: 'Another take.' } });
		await fireEvent.click(btn(container));

		const err = await findByTestId('renarrate-error');
		expect(err.querySelector('[data-testid="byo-provider-required"]')).not.toBeNull();
		expect(getByTestId('byo-provider-required-message').textContent?.trim()).toBe(
			'Configure your own TTS and LLM providers to continue'
		);
		expect(getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=tts,llm#provider-slot-tts'
		);
	});
});

/**
 * The studio loader used to coerce a failed annotations fetch to `[]`, so the
 * inspector lost every feedback marker silently and then instructed the reviewer
 * to "Add a note above, then regenerate to apply it" — about notes that already
 * existed. Regenerating on that belief drops the feedback from the child run.
 */
describe('ClipInspector when the annotations fetch failed', () => {
	const base = {
		clip,
		annotations: [] as AnnotationResponse[],
		onAddNote: vi.fn(async () => {}),
		onRegenerate: vi.fn()
	};

	it('stops claiming the clip has no notes', () => {
		h.data = { annotationsError: new Error('annotations 500') };
		const { getByTestId, queryByText } = render(ClipInspector, { props: { ...base } });
		expect(getByTestId('regenerate-notes-unknown')).toBeInTheDocument();
		expect(queryByText(/Add a note above, then regenerate to apply it/)).toBeNull();
	});

	// The paired inverse control for the SAME branch. It does NOT red on a
	// wholesale revert of this component (nothing on main triggers the error
	// copy) and is not claimed to; it reds when the branch OVER-fires
	// (`{#if annotationsError}` → `{#if true}`), which is the other way this fix
	// can be wrong. Mutation-proven in that direction, not by revert.
	it('still gives the add-a-note hint when the fetch genuinely returned nothing', () => {
		h.data = { annotationsError: null };
		const { getByText, queryByTestId } = render(ClipInspector, { props: { ...base } });
		expect(getByText(/Add a note above, then regenerate to apply it/)).toBeInTheDocument();
		expect(queryByTestId('regenerate-notes-unknown')).toBeNull();
	});
});

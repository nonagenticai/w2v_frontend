import { describe, it, expect, vi, beforeEach } from 'vitest';

// Renders the Studio page, selects a clip, and drives the new inspector controls
// (color grade + text overlays) to prove `handleEditChange` COLLAPSES a
// neutral grade / empty overlay list back out of the pending-edit map — the
// "Apply edits & re-render" button (`save-edits`) is the observable dirty flag.
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	invalidateAll: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

// A completed run shows the editable timeline + wires onEditChange (canReorder).
vi.mock('$lib/stores/job-progress', () => ({
	JobProgressState: class {
		jobStatus = 'completed';
		isTerminal = true;
		hydrateFromDetail() {}
		connect() {}
		disconnect() {}
	}
}));

const applyClipEdits = vi.fn().mockResolvedValue({ id: 'child' });
const voiceoverUpload = vi
	.fn()
	.mockResolvedValue({ audio_url: 'https://cdn/vo.mp3', seconds: 12.4 });
vi.mock('$lib/api', () => ({
	ApiError: class ApiError extends Error {},
	runs: {
		applyClipEdits: (...args: unknown[]) => applyClipEdits(...args)
	},
	annotations: { create: vi.fn(), dismiss: vi.fn() },
	listMusicTracks: vi.fn().mockResolvedValue([]),
	uploads: { voiceover: (f: File) => voiceoverUpload(f) }
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Page from './+page.svelte';

function makeData(lines: Array<Record<string, unknown>> = [{ id: 'l1' }]) {
	return {
		project: { id: 'p1', title: 'Proj' },
		run: {
			id: 'r1',
			status: 'completed',
			config_snapshot: {},
			stage_outputs: [
				{ stage_name: 'storyboard', status: 'completed', output: { lines } },
				{ stage_name: 'compile', status: 'completed', output: { video_url: 'https://x/v.mp4' } }
			]
		},
		spineStageName: 'storyboard',
		// Server-named spine: clip edits + music save target only `clip_spine_stage`.
		spineReorderable: true,
		annotations: []
	} as never;
}

async function pickClip(i = 0) {
	await fireEvent.click(screen.getAllByTestId('clip-select')[i]);
	await tick();
}

async function selectClip(lines?: Array<Record<string, unknown>>) {
	render(Page, { data: makeData(lines) });
	await pickClip(0);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Studio clip edits — grade + overlays collapse', () => {
	it('is not dirty until a control changes', async () => {
		await selectClip();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('marks dirty on a grade change and collapses back on the neutral value', async () => {
		await selectClip();
		const brightness = screen.getByTestId('clip-brightness') as HTMLInputElement;

		await fireEvent.input(brightness, { target: { value: '0.5' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		// Back to the neutral 0 → the grade collapses out → no pending edits.
		await fireEvent.input(brightness, { target: { value: '0' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('marks dirty when adding an overlay and collapses when the list empties', async () => {
		await selectClip();

		await fireEvent.click(screen.getByTestId('clip-overlay-add'));
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		// Removing the only overlay leaves an empty list → collapses out.
		await fireEvent.click(screen.getByTestId('clip-overlay-remove-0'));
		await tick();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('marks dirty on a volume change and collapses back on 0 dB', async () => {
		await selectClip();
		const gain = screen.getByTestId('clip-audio-gain') as HTMLInputElement;

		await fireEvent.input(gain, { target: { value: '-20' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		// Back to the neutral 0 dB → the audio block collapses out → no pending edits.
		await fireEvent.input(gain, { target: { value: '0' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('carries a non-default audio block in the apply-edits payload (gain)', async () => {
		await selectClip();
		const gain = screen.getByTestId('clip-audio-gain') as HTMLInputElement;

		await fireEvent.input(gain, { target: { value: '-20' } });
		await tick();

		const btn = screen.getByTestId('save-edits').querySelector('button')!;
		await fireEvent.click(btn);
		await tick();

		expect(applyClipEdits).toHaveBeenCalledTimes(1);
		const edits = applyClipEdits.mock.calls[0][2] as Record<string, { audio?: unknown }>;
		const entry = Object.values(edits)[0];
		expect(entry.audio).toEqual({ gain_db: -20 });
	});

	it('carries mute in the apply-edits payload and drops audio when unmuted', async () => {
		await selectClip();
		const mute = screen.getByTestId('clip-audio-mute') as HTMLInputElement;

		// Mute on → dirty → payload carries audio.mute.
		await fireEvent.click(mute);
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const btn = screen.getByTestId('save-edits').querySelector('button')!;
		await fireEvent.click(btn);
		await tick();
		const edits = applyClipEdits.mock.calls[0][2] as Record<string, { audio?: unknown }>;
		expect(Object.values(edits)[0].audio).toEqual({ mute: true });
	});

	it('carries audio_url + audio_seconds in the payload after a voiceover upload', async () => {
		await selectClip();
		const file = screen.getByTestId('clip-voiceover-file') as HTMLInputElement;

		await fireEvent.change(file, {
			target: { files: [new File(['xx'], 'take-2.mp3', { type: 'audio/mpeg' })] }
		});
		await waitFor(() => expect(screen.queryByTestId('save-edits')).not.toBeNull());

		const btn = screen.getByTestId('save-edits').querySelector('button')!;
		await fireEvent.click(btn);
		await tick();

		const edits = applyClipEdits.mock.calls[0][2] as Record<
			string,
			{ audio_url?: string; audio_seconds?: number }
		>;
		const entry = Object.values(edits)[0];
		expect(entry.audio_url).toBe('https://cdn/vo.mp3');
		expect(entry.audio_seconds).toBe(12.4);
	});

	it('Remove drops BOTH voiceover keys, collapsing the edit back out', async () => {
		await selectClip();
		const file = screen.getByTestId('clip-voiceover-file') as HTMLInputElement;
		await fireEvent.change(file, {
			target: { files: [new File(['xx'], 'take-2.mp3', { type: 'audio/mpeg' })] }
		});
		await waitFor(() => expect(screen.queryByTestId('clip-voiceover-remove')).not.toBeNull());

		await fireEvent.click(screen.getByTestId('clip-voiceover-remove'));
		await tick();
		// audio_url: null deletes the override AND its declared duration → nothing
		// pending → the shot falls back to its TTS narration.
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('sends NEITHER voiceover key when no file was uploaded (presence-is-opt-in)', async () => {
		await selectClip();
		// A regular (non-voiceover) edit still applies…
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
		await tick();
		await fireEvent.click(screen.getByTestId('save-edits').querySelector('button')!);
		await tick();

		const edits = applyClipEdits.mock.calls[0][2] as Record<string, Record<string, unknown>>;
		const entry = Object.values(edits)[0];
		// …carrying no voiceover keys at all — byte-identical narration downstream.
		expect('audio_url' in entry).toBe(false);
		expect('audio_seconds' in entry).toBe(false);
	});

	it('reports a re-stitched clip audio block (spine base drives the controls)', async () => {
		// apply-edits merges the edit onto the CHILD spine, so reopening the run
		// must show the gain/mute it actually contains — not 0 dB / unmuted.
		await selectClip([{ id: 'l1', audio: { gain_db: -12, mute: true } }]);
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('-12');
		expect((screen.getByTestId('clip-audio-mute') as HTMLInputElement).checked).toBe(true);
		// Reading the spine is NOT an edit — nothing is pending.
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('reports a re-stitched speed / transition / grade / overlays / voiceover', async () => {
		await selectClip([
			{
				id: 'l1',
				speed: 2,
				transition: { type: 'fade', duration: 1.2 },
				adjust: { brightness: 0.5, preset: 'cinematic' },
				overlays: [{ text: 'Buy now', position: 'top-left' }],
				audio_url: 'https://cdn/vo.mp3',
				audio_seconds: 12.4
			}
		]);
		expect((screen.getByTestId('clip-speed') as HTMLSelectElement).value).toBe('2');
		expect((screen.getByTestId('clip-transition') as HTMLSelectElement).value).toBe('fade');
		expect((screen.getByTestId('clip-transition-duration') as HTMLInputElement).value).toBe('1.2');
		expect((screen.getByTestId('clip-preset') as HTMLSelectElement).value).toBe('cinematic');
		expect((screen.getByTestId('clip-brightness') as HTMLInputElement).value).toBe('0.5');
		expect((screen.getByTestId('clip-overlay-text-0') as HTMLInputElement).value).toBe('Buy now');
		expect(screen.getByTestId('clip-voiceover-status').textContent).not.toContain('TTS narration');
		expect(screen.queryByTestId('clip-voiceover-remove')).not.toBeNull();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('still shows the documented defaults on a clip carrying no such keys', async () => {
		// Regression guard for an UNEDITED run: the spine read must not manufacture
		// a value (a 0 speed, an empty-but-present grade) where there is none.
		await selectClip([{ id: 'l1' }]);
		expect((screen.getByTestId('clip-speed') as HTMLSelectElement).value).toBe('1');
		expect((screen.getByTestId('clip-transition') as HTMLSelectElement).value).toBe('');
		expect(screen.queryByTestId('clip-transition-duration')).toBeNull();
		expect((screen.getByTestId('clip-preset') as HTMLSelectElement).value).toBe('');
		expect((screen.getByTestId('clip-brightness') as HTMLInputElement).value).toBe('0');
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('0');
		expect((screen.getByTestId('clip-audio-mute') as HTMLInputElement).checked).toBe(false);
		expect(screen.queryByTestId('clip-overlay-row-0')).toBeNull();
		expect(screen.getByTestId('clip-voiceover-status').textContent).toContain('TTS narration');
		expect(screen.queryByTestId('clip-voiceover-remove')).toBeNull();
	});

	it('falls back to the default when the spine node is malformed', async () => {
		await selectClip([{ id: 'l1', audio: 'nope', overlays: {}, speed: 'fast' }]);
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('0');
		expect((screen.getByTestId('clip-speed') as HTMLSelectElement).value).toBe('1');
		expect(screen.queryByTestId('clip-overlay-row-0')).toBeNull();
	});

	it('lets a PENDING edit win over the spine base (ordering guarantee)', async () => {
		// Two clips so the controls are re-rendered from the other clip's values in
		// between: coming back re-resolves the chain from scratch, which is what
		// makes an inverted `spine ?? edit` order observable here.
		render(Page, {
			data: makeData([{ id: 'l1', audio: { gain_db: -12 }, speed: 2 }, { id: 'l2' }])
		});
		await pickClip(0);
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('-12');

		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
		await fireEvent.change(screen.getByTestId('clip-speed'), { target: { value: '3' } });
		await tick();

		// Away to the untouched sibling (controls re-render at its defaults)…
		await pickClip(1);
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('0');
		expect((screen.getByTestId('clip-speed') as HTMLSelectElement).value).toBe('1');

		// …and back: the pending edit, not the spine base, is what we see.
		await pickClip(0);
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('-20');
		expect((screen.getByTestId('clip-speed') as HTMLSelectElement).value).toBe('3');
	});

	it('drops the audio key from the payload once toggled back to default', async () => {
		await selectClip();
		const mute = screen.getByTestId('clip-audio-mute') as HTMLInputElement;

		// Mute on then off → all-default audio → whole edit collapses out.
		await fireEvent.click(mute);
		await tick();
		await fireEvent.click(mute);
		await tick();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});
});

// A RE-STITCHED run's spine genuinely carries speed / transition / grade /
// overlays / audio / voiceover (apply-edits merges the edit onto the child's
// spine element). Choosing the DEFAULT on such a clip must send an explicit
// CLEAR — the orchestrator pops a field whose value is `null` — because an
// omitted key is left untouched by `model_dump(exclude_unset=True)`, which is
// what made a spine-authored value impossible to clear from the UI.
describe('Studio clip edits — clearing a SPINE-AUTHORED value', () => {
	/** The single clip's edit entry from the one apply-edits call. */
	async function applyAndReadEntry(): Promise<Record<string, unknown>> {
		const btn = screen.getByTestId('save-edits').querySelector('button')!;
		await fireEvent.click(btn);
		await tick();
		expect(applyClipEdits).toHaveBeenCalledTimes(1);
		const edits = applyClipEdits.mock.calls[0][2] as Record<string, Record<string, unknown>>;
		return Object.values(edits)[0];
	}

	it('sends the literal speed 1 (not an omission) to clear a spine 2×', async () => {
		await selectClip([{ id: 'l1', speed: 2 }]);
		await fireEvent.change(screen.getByTestId('clip-speed'), { target: { value: '1' } });
		await tick();
		// Dirty: 1× genuinely differs from the 2× the run contains.
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const entry = await applyAndReadEntry();
		// `speed` is NOT nullable in ClipEdit (a null 422s); the compiler emits no
		// filter at 1.0, so the literal 1 IS the clear.
		expect('speed' in entry).toBe(true);
		expect(entry.speed).toBe(1);
	});

	it('sends transition: null to clear a spine-authored fade', async () => {
		await selectClip([{ id: 'l1', transition: { type: 'fade', duration: 1.2 } }]);
		await fireEvent.change(screen.getByTestId('clip-transition'), { target: { value: '' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const entry = await applyAndReadEntry();
		expect('transition' in entry).toBe(true);
		expect(entry.transition).toBeNull();
	});

	it('sends audio: null to clear a spine-authored gain', async () => {
		await selectClip([{ id: 'l1', audio: { gain_db: -6 } }]);
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '0' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const entry = await applyAndReadEntry();
		expect('audio' in entry).toBe(true);
		expect(entry.audio).toBeNull();
	});

	it('sends adjust: null to clear a spine-authored grade', async () => {
		await selectClip([{ id: 'l1', adjust: { brightness: 0.5 } }]);
		await fireEvent.input(screen.getByTestId('clip-brightness'), { target: { value: '0' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const entry = await applyAndReadEntry();
		expect('adjust' in entry).toBe(true);
		expect(entry.adjust).toBeNull();
	});

	it('sends overlays: null to clear spine-authored overlays', async () => {
		await selectClip([{ id: 'l1', overlays: [{ text: 'Buy now', position: 'top-left' }] }]);
		await fireEvent.click(screen.getByTestId('clip-overlay-remove-0'));
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const entry = await applyAndReadEntry();
		expect('overlays' in entry).toBe(true);
		expect(entry.overlays).toBeNull();
	});

	it('Remove sends BOTH audio_url: null AND audio_seconds: null on a spine voiceover', async () => {
		await selectClip([{ id: 'l1', audio_url: 'https://cdn/vo.mp3', audio_seconds: 12.4 }]);
		await fireEvent.click(screen.getByTestId('clip-voiceover-remove'));
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		const entry = await applyAndReadEntry();
		// The pairing invariant: a stale audio_seconds would keep re-declaring the
		// shot's length after the voiceover it measured is gone.
		expect('audio_url' in entry).toBe(true);
		expect(entry.audio_url).toBeNull();
		expect('audio_seconds' in entry).toBe(true);
		expect(entry.audio_seconds).toBeNull();
	});

	it('shows the DEFAULT after a clear — the control does not snap back', async () => {
		// The read chain resolves the pending edit by KEY PRESENCE: a plain
		// `edit?.transition ?? spine.transition` would fall through the explicit
		// null straight back onto the fade being cleared, so the user would clear
		// the transition and watch it reappear while the payload said null.
		await selectClip([
			{
				id: 'l1',
				transition: { type: 'fade', duration: 1.2 },
				adjust: { brightness: 0.5 },
				audio: { gain_db: -6 },
				audio_url: 'https://cdn/vo.mp3',
				audio_seconds: 12.4
			}
		]);
		await fireEvent.change(screen.getByTestId('clip-transition'), { target: { value: '' } });
		await fireEvent.input(screen.getByTestId('clip-brightness'), { target: { value: '0' } });
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '0' } });
		await fireEvent.click(screen.getByTestId('clip-voiceover-remove'));
		await tick();

		expect((screen.getByTestId('clip-transition') as HTMLSelectElement).value).toBe('');
		expect(screen.queryByTestId('clip-transition-duration')).toBeNull();
		expect((screen.getByTestId('clip-brightness') as HTMLInputElement).value).toBe('0');
		expect((screen.getByTestId('clip-audio-gain') as HTMLInputElement).value).toBe('0');
		expect(screen.getByTestId('clip-voiceover-status').textContent).toContain('TTS narration');
		expect(screen.queryByTestId('clip-voiceover-remove')).toBeNull();
	});

	it('collapses a ROUND TRIP back to the spine value (no pointless re-stitch)', async () => {
		await selectClip([{ id: 'l1', speed: 2 }]);
		const speed = screen.getByTestId('clip-speed') as HTMLSelectElement;

		// Away from the spine value…
		await fireEvent.change(speed, { target: { value: '3' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		// …and back to it: the run already contains 2×, so nothing is pending and
		// no render is spent.
		await fireEvent.change(speed, { target: { value: '2' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).toBeNull();
	});

	it('still omits speed 1 on a first-generation (spine-less) clip', async () => {
		// Regression guard for rule 2: with no spine value, the default must remain
		// a plain omission — byte-identical to the pre-fix behaviour. Driven AWAY
		// and back so the assertion cannot pass vacuously on an unchanged control.
		await selectClip([{ id: 'l1' }]);
		const speed = screen.getByTestId('clip-speed') as HTMLSelectElement;

		await fireEvent.change(speed, { target: { value: '2' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).not.toBeNull();

		await fireEvent.change(speed, { target: { value: '1' } });
		await tick();
		expect(screen.queryByTestId('save-edits')).toBeNull();

		// And alongside another edit, speed is absent entirely — not sent as 1.
		await fireEvent.input(screen.getByTestId('clip-audio-gain'), { target: { value: '-20' } });
		await tick();
		const entry = await applyAndReadEntry();
		expect('speed' in entry).toBe(false);
	});
});

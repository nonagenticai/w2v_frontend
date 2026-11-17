import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import FootageProbeGrid from './FootageProbeGrid.svelte';

// A realistic paused footage_probe gate: one ready clip, one whose derivative is
// still rendering, one whose derivative worker errored. All three MUST reach the
// reviewer — the failure this renderer exists to prevent is a clip that cannot be
// previewed quietly reading as reviewed footage.
const output = {
	sources: [
		{
			id: 'src-a',
			filename: 'drone-pass.mp4',
			bytes: 134_217_728,
			content_type: 'video/mp4',
			preview_status: 'ready',
			duration_s: 6.006,
			fps: 23.976,
			codec: 'h264',
			width: 1920,
			height: 1080,
			original_url: '/api/runs/r1/artifact/a.mp4',
			preview_url: '/api/runs/r1/artifact/a-preview.mp4'
		},
		{
			id: 'src-b',
			filename: 'interview.mov',
			bytes: 2048,
			content_type: 'video/quicktime',
			preview_status: 'pending',
			duration_s: 12.5,
			fps: 30,
			codec: 'hevc',
			width: 1280,
			height: 720,
			original_url: '/api/runs/r1/artifact/b.mov',
			preview_url: ''
		},
		{
			id: 'src-c',
			filename: 'broken.mkv',
			bytes: 512,
			content_type: 'video/x-matroska',
			preview_status: 'failed',
			duration_s: 0,
			fps: 0,
			codec: '',
			width: 0,
			height: 0,
			original_url: '/api/runs/r1/artifact/c.mkv',
			preview_url: ''
		}
	],
	total_duration_s: 18.506,
	notes: ['source src-c preview_status=failed (ffmpeg exited 1; original is still usable)']
};

const all = (container: HTMLElement, id: string): HTMLElement[] => [
	...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
];
const one = (container: HTMLElement, id: string): HTMLElement | null =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
// Whitespace-collapsed, same reason as CutPlanTimeline.test.ts: the markup is
// Prettier-formatted, so assertions pin WORDS, never line breaks.
const text = (container: HTMLElement, id: string): string =>
	(one(container, id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const texts = (container: HTMLElement, id: string): string[] =>
	all(container, id).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());

describe('FootageProbeGrid — the first action_reel review gate', () => {
	it('renders one row per source, keyed by the video_sources row id', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(all(container, 'footage-probe-source').map((e) => e.dataset.sourceId)).toEqual([
			'src-a',
			'src-b',
			'src-c'
		]);
	});

	it('renders a verdict strip, before any source row, with the run total', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(text(container, 'footage-probe-count')).toBe('3 sources');
		expect(text(container, 'footage-probe-total')).toContain('18.5s');
		const ordered = [...container.querySelectorAll('[data-testid]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(ordered.indexOf('footage-probe-verdict')).toBeLessThan(
			ordered.indexOf('footage-probe-source')
		);
	});

	it('shows filename, duration, resolution, fps, codec and a human-readable size', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(texts(container, 'footage-probe-filename')).toEqual([
			'drone-pass.mp4',
			'interview.mov',
			'broken.mkv'
		]);
		const meta = texts(container, 'footage-probe-meta')[0];
		expect(meta).toContain('6.0s');
		expect(meta).toContain('1920×1080');
		expect(meta).toContain('23.98 fps');
		expect(meta).toContain('h264');
		expect(texts(container, 'footage-probe-size')[0]).toContain('128.0 MB');
	});

	// THE POINT OF THE RENDERER. A clip whose preview is pending or failed has no
	// proxy to play; it must SAY which, and must never emit a <video> whose src is
	// the "" sentinel (a broken element that reads as bad footage).
	it('names the reason instead of rendering a broken player when there is no preview', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(texts(container, 'footage-probe-no-preview')).toEqual([
			'no preview — no preview generated',
			'no preview — preview failed'
		]);
		// Exactly one playable source ⇒ exactly one <video> in the DOM.
		expect(all(container, 'footage-probe-preview-video')).toHaveLength(1);
		expect(all(container, 'footage-probe-preview-video')[0].getAttribute('src')).toBe(
			'/api/runs/r1/artifact/a-preview.mp4#t=1'
		);
	});

	it('badges each preview status, and never lets an unknown status read as ready', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(texts(container, 'footage-probe-status')).toEqual([
			'preview ready',
			'no preview generated',
			'preview failed'
		]);
		const { container: c2 } = render(FootageProbeGrid, {
			output: { sources: [{ id: 's1', filename: 'x.mp4', bytes: 10 }] }
		});
		expect(text(c2, 'footage-probe-status')).toBe('preview status not recorded');
	});

	it('spells out a failed derivative in the row, not only in the notes', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(texts(container, 'footage-probe-source-failed')).toHaveLength(1);
		expect(texts(container, 'footage-probe-source-failed')[0]).toContain('Preview render failed');
		expect(text(container, 'footage-probe-unpreviewable')).toBe('2 without a preview');
	});

	it('surfaces the stage notes visibly', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(text(container, 'footage-probe-note')).toContain('preview_status=failed');
	});

	// Two identical note strings are a legal payload (footage_probe appends one per
	// source inside a single loop); a duplicate {#each} key is a Svelte 5 runtime
	// error that would blank the whole panel on this boundary-less page.
	it('renders two identical notes without a duplicate-key crash', () => {
		const dup = 'source has no probed duration; treating as 0s';
		const { container } = render(FootageProbeGrid, {
			output: { ...output, notes: [dup, dup] }
		});
		expect(all(container, 'footage-probe-note')).toHaveLength(2);
	});

	// The recorded production trap: a live producer can emit byte-identical
	// filenames, so keying rows on the name would throw. The row key is `id`.
	it('renders BOTH sources when two uploads share a filename', () => {
		const { container } = render(FootageProbeGrid, {
			output: {
				sources: [
					{ id: 'src-1', filename: 'clip.mp4', bytes: 10, preview_status: 'ready' },
					{ id: 'src-2', filename: 'clip.mp4', bytes: 20, preview_status: 'ready' }
				]
			}
		});
		expect(texts(container, 'footage-probe-filename')).toEqual(['clip.mp4', 'clip.mp4']);
		expect(all(container, 'footage-probe-source').map((e) => e.dataset.sourceId)).toEqual([
			'src-1',
			'src-2'
		]);
	});

	// Every numeric is pydantic-defaulted to 0 upstream, so 0 means NOT PROBED.
	// Printing "0×0 · 0 fps · 0.0s" as fact would be an affirmative false reading.
	it('says "not probed" for a zeroed probe rather than printing zeros as facts', () => {
		const { container } = render(FootageProbeGrid, {
			output: { sources: [output.sources[2]] }
		});
		expect(one(container, 'footage-probe-no-duration')).not.toBeNull();
		expect(one(container, 'footage-probe-no-resolution')).not.toBeNull();
		expect(text(container, 'footage-probe-meta')).not.toContain('0×0');
		expect(text(container, 'footage-probe-meta')).not.toContain('fps');
	});

	// A stage output is JSONB from the wire: the matcher only inspects sources[0],
	// so a null/scalar SECOND element reaches this component. It must not throw —
	// StageOutputView has no error boundary.
	it('survives a partial / malformed payload without crashing', () => {
		const { container } = render(FootageProbeGrid, {
			output: {
				sources: [
					{ id: 'src-a', filename: 'ok.mp4', bytes: 10, preview_status: 'ready' },
					null,
					'garbage',
					{ filename: 'no-id.mp4' }
				],
				notes: [null, 'a real note'],
				total_duration_s: null
			}
		});
		expect(all(container, 'footage-probe-source')).toHaveLength(2);
		expect(all(container, 'footage-probe-note')).toHaveLength(1);
		expect(text(container, 'footage-probe-count')).toBe('2 sources');
	});

	it('falls back to summing per-source durations when the total is missing', () => {
		const { container } = render(FootageProbeGrid, {
			output: { sources: output.sources }
		});
		expect(text(container, 'footage-probe-total')).toContain('18.5s');
	});

	it('renders nothing but an honest empty verdict for an empty sources list', () => {
		const { container } = render(FootageProbeGrid, { output: { sources: [], notes: [] } });
		expect(all(container, 'footage-probe-source')).toHaveLength(0);
		expect(text(container, 'footage-probe-count')).toBe('0 sources');
	});

	// A preview that 404s / expires must say so rather than sit black — the same
	// honesty contract CutPlanTimeline keeps for source clips.
	it('replaces a dead preview with an expired-link message on error', async () => {
		const { container } = render(FootageProbeGrid, { output });
		all(container, 'footage-probe-preview-video')[0].dispatchEvent(new Event('error'));
		await tick();
		expect(text(container, 'footage-probe-preview-expired')).toContain('re-run footage_probe');
		expect(all(container, 'footage-probe-preview-video')).toHaveLength(0);
	});
});

// The tile plays a transcoded proxy (h264 / ≤720p / aac) because the uploaded
// masters are 4K hevc with PCM audio no browser decodes. The meta line beside it
// is ffprobe on the MASTER. Unlabelled, that reads as a contradiction; labelled,
// it reads as two facts about two files.
describe('the metadata line is labelled as the source file, not the preview', () => {
	it('labels the meta line on every row as the source file', () => {
		const { container } = render(FootageProbeGrid, { output });
		expect(texts(container, 'footage-probe-meta-label')).toEqual([
			'source file',
			'source file',
			'source file'
		]);
		// The label must sit INSIDE the meta line it qualifies — a label rendered
		// elsewhere in the row qualifies nothing.
		expect(texts(container, 'footage-probe-meta')[0]).toContain('source file');
	});

	it('states the resolution and codec as the source file’s, beside the proxy player', () => {
		const { container } = render(FootageProbeGrid, { output });
		const meta = texts(container, 'footage-probe-meta')[0];
		// Anchored on purpose. `indexOf(label) < indexOf(res)` passes VACUOUSLY when
		// the label is missing — -1 is less than everything — which is precisely the
		// bug this file is here to prevent. The label must OPEN the line, before the
		// first measurement it qualifies.
		expect(meta).toMatch(/^source file\s*·\s*6\.0s\s*·\s*1920×1080\b/);
		expect(meta).toContain('h264');
	});
});

// Four preview_status values, four DIFFERENT things a reviewer must be able to
// tell apart. A clip still awaiting a proxy, a clip whose proxy errored, and a
// clip whose status was never recorded are three different facts; collapsing
// them into one message is the defect this block pins.
describe('each preview_status renders a distinct, honest state', () => {
	const renderOne = (s: Record<string, unknown>) =>
		render(FootageProbeGrid, { output: { sources: [s] } }).container;

	it('ready renders a player pointed at the preview proxy, and no no-preview state', () => {
		const c = renderOne(output.sources[0]);
		expect(all(c, 'footage-probe-preview-video')).toHaveLength(1);
		expect(all(c, 'footage-probe-preview-video')[0].getAttribute('src')).toBe(
			'/api/runs/r1/artifact/a-preview.mp4#t=1'
		);
		expect(one(c, 'footage-probe-no-preview')).toBeNull();
		expect(text(c, 'footage-probe-status')).toBe('preview ready');
	});

	it('pending says no preview was generated, and renders NO player', () => {
		const c = renderOne(output.sources[1]);
		expect(all(c, 'footage-probe-preview-video')).toHaveLength(0);
		expect(text(c, 'footage-probe-no-preview')).toBe('no preview — no preview generated');
		expect(one(c, 'footage-probe-source-failed')).toBeNull();
	});

	it('failed reads differently from pending, and renders NO player', () => {
		const c = renderOne(output.sources[2]);
		expect(all(c, 'footage-probe-preview-video')).toHaveLength(0);
		expect(text(c, 'footage-probe-no-preview')).toBe('no preview — preview failed');
		// The two states must not collapse into the same sentence.
		const pending = renderOne(output.sources[1]);
		expect(text(c, 'footage-probe-no-preview')).not.toBe(text(pending, 'footage-probe-no-preview'));
		// A failed clip additionally gets the row-level explanation. NOTE: this
		// element is a hardcoded literal (FootageProbeGrid.svelte) — no payload
		// flows into it, so asserting it lacks backend stderr would be a dead
		// assertion. The stderr sink is `footage-probe-note`, which renders
		// `output.notes` VERBATIM, and the orchestrator does put an ffmpeg stderr
		// tail there on purpose (footage_probe.py `_describe`). That is a backend
		// decision, not something this renderer may silently swallow.
		expect(text(c, 'footage-probe-source-failed')).toContain('Preview render failed');
	});

	it('an absent or unrecognised status never crashes and never reads as ready', () => {
		const absent = renderOne({ id: 's-absent', filename: 'a.mp4' });
		expect(all(absent, 'footage-probe-source')).toHaveLength(1);
		expect(text(absent, 'footage-probe-status')).toBe('preview status not recorded');

		const weird = renderOne({ id: 's-weird', filename: 'b.mp4', preview_status: 'quarantined' });
		expect(all(weird, 'footage-probe-source')).toHaveLength(1);
		expect(text(weird, 'footage-probe-status')).toBe('preview quarantined');
	});
});

// The live browser proof on 2026-08-23 showed nine of ten tiles as identical
// featureless grey rectangles: the unopened <video> was `preload="none"` with no
// poster, so nothing was ever fetched or painted. There is no thumbnail object in
// storage, so the tile paints its own first frame with a media fragment.
describe('an unopened ready tile paints a frame instead of a grey box', () => {
	it('asks for metadata and a seek offset, never the whole proxy', () => {
		const { container } = render(FootageProbeGrid, { output: { sources: [output.sources[0]] } });
		const v = all(container, 'footage-probe-preview-video')[0];
		expect(v.getAttribute('preload')).toBe('metadata');
		// `auto` would pull ten proxies (~0.5-1.3 MB each) on mount.
		expect(v.getAttribute('preload')).not.toBe('auto');
		expect(v.getAttribute('src')).toBe('/api/runs/r1/artifact/a-preview.mp4#t=1');
	});

	it('seeks inside the clip for a source shorter than the default offset', () => {
		const { container } = render(FootageProbeGrid, {
			output: {
				sources: [{ ...output.sources[0], id: 'short', duration_s: 1.2 }]
			}
		});
		// 1s would be past the useful part of a 1.2s clip; the midpoint is 0.6s.
		expect(all(container, 'footage-probe-preview-video')[0].getAttribute('src')).toBe(
			'/api/runs/r1/artifact/a-preview.mp4#t=0.6'
		);
	});

	it('falls back to an early offset when the duration was never probed', () => {
		const { container } = render(FootageProbeGrid, {
			output: {
				sources: [{ ...output.sources[0], id: 'unprobed', duration_s: 0 }]
			}
		});
		expect(all(container, 'footage-probe-preview-video')[0].getAttribute('src')).toBe(
			'/api/runs/r1/artifact/a-preview.mp4#t=0.5'
		);
	});

	// The whole point of preloading metadata is that it costs bytes. A tile with no
	// proxy must not spend any: no element, therefore no request.
	it('fetches nothing at all for pending, failed or unknown tiles', () => {
		const { container } = render(FootageProbeGrid, {
			output: {
				sources: [
					output.sources[1],
					output.sources[2],
					{ id: 's-unknown', filename: 'u.mp4', preview_status: 'quarantined' }
				]
			}
		});
		expect(all(container, 'footage-probe-source')).toHaveLength(3);
		expect(all(container, 'footage-probe-preview-video')).toHaveLength(0);
	});
});

// Guard against the label regressing to the lie it used to tell. `pending` reads
// as "no preview generated", NEVER as anything implying work is in progress.
//
// ⚠️ Corrected 2026-08-23: the rationale this block used to give — "no producer
// exists, all 137 rows are pending forever" — is STALE. `preview_proxy.py`
// (orchestrator PR #896) ships that producer, and production now measures
// 144 ready / 1 failed / 0 pending. The label is still right for a different
// reason: it describes what the reviewer HAS in front of them (no proxy on this
// tile), not what a worker intends to produce later.
describe('the pending label does not imply work in progress', () => {
	it('never says rendering, processing or in progress for a pending preview', () => {
		const { container } = render(FootageProbeGrid, {
			output: { sources: [{ id: 's1', filename: 'a.mp4', preview_status: 'pending' }] }
		});
		const shown = (texts(container, 'footage-probe-status')[0] ?? '').toLowerCase();
		expect(shown).toBe('no preview generated');
		for (const lie of ['rendering', 'processing', 'in progress', 'generating']) {
			expect(shown).not.toContain(lie);
		}
	});

	// The TONE, not just the words. This file's own contract is that an unknown
	// or unhealthy status must never read as healthy; a green pill saying "no
	// preview generated" would undo the honesty the label just bought, and the
	// label assertion above passes happily while it does.
	it('never paints a pending preview with the success tone', () => {
		const { container } = render(FootageProbeGrid, {
			output: { sources: [{ id: 's1', filename: 'a.mp4', preview_status: 'pending' }] }
		});
		const pill = all(container, 'footage-probe-status')[0]?.closest('span[class]');
		expect(pill?.className).toContain('--color-warning-bg');
		expect(pill?.className).not.toContain('--color-success-bg');
	});
});

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import CutPlanTimeline from './CutPlanTimeline.svelte';
import { setActiveTenantId } from '$lib/api/client.js';

const output = {
	shots: [
		{
			id: 's1',
			source_id: 'src-a',
			video_url: '/api/runs/r1/artifact/a.mp4',
			in_seconds: 1.5,
			out_seconds: 3.5,
			seconds: 2,
			speed: 1.0,
			beat_index: 0,
			start_seconds: 0,
			beat_locked: true,
			rationale: 'Opens on the widest motion.'
		},
		{
			id: 's2',
			source_id: 'src-b',
			video_url: '/api/runs/r1/artifact/b.mp4',
			in_seconds: 0,
			out_seconds: 4,
			seconds: 2,
			speed: 2.0,
			beat_index: 4,
			start_seconds: 2,
			beat_locked: false,
			rationale: ''
		}
	],
	total_seconds: 4,
	target_seconds: 4,
	bpm: 120,
	beat_grid_available: true,
	solver_stubbed: false,
	shortfall_seconds: 0
};

// Container-scoped (not screen-scoped) queries, exactly as NarrationTrack.test.ts
// does — several cases render twice, so a document-wide lookup would be ambiguous.
const all = (container: HTMLElement, id: string): HTMLElement[] => [
	...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)
];
const one = (container: HTMLElement, id: string): HTMLElement | null =>
	container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
// Whitespace-collapsed: the markup is Prettier-formatted, so a sentence can be
// reflowed across lines at any time. Assertions should pin the WORDS, never the
// line breaks — otherwise a formatting pass turns into a red test.
const text = (container: HTMLElement, id: string): string =>
	(one(container, id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const srcs = (container: HTMLElement) =>
	all(container, 'cut-plan-shot-video').map((el) => el.getAttribute('src'));

// SigV4 presign fixtures. Anchored to ONE timestamp captured at module load so
// `presigned(n)` is stable across the two calls a single assertion makes.
const NOW = Date.now();
/** `X-Amz-Date` (ISO 8601 basic, UTC) for `offsetSeconds` from now. */
const amzDate = (offsetSeconds: number): string =>
	new Date(NOW + offsetSeconds * 1000)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');
const AMZ_QUERY = (secondsFromNow: number): string =>
	`X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${amzDate(
		secondsFromNow - 3600
	)}&X-Amz-Expires=3600&X-Amz-Signature=deadbeef`;

/** A GENUINE presigned source url — absolute, on the object store — whose 1 h
 *  TTL expires `secondsFromNow` from now (negative ⇒ already dead). This one
 *  really does die: nothing re-signs it. */
const presigned = (secondsFromNow: number): string =>
	`https://minio.test/w2v-media/a.mp4?${AMZ_QUERY(secondsFromNow)}`;

/** The SAME dead query on the orchestrator's same-origin artifact proxy. This
 *  is what production actually serves: the proxy re-fetches with its own
 *  credentials and ignores the inbound query, so the params are inert
 *  passengers and the path CANNOT expire. Until the guard in `presign.ts`,
 *  every fixture in this file was this shape — which is why a suite that was
 *  fully green still shipped 20 dead thumbnails to a live cut_plan gate. */
const proxied = (secondsFromNow: number): string =>
	`/api/runs/r1/artifact/w2v-media/a.mp4?${AMZ_QUERY(secondsFromNow)}`;

describe('CutPlanTimeline — the cut review gate', () => {
	it('renders a verdict strip before any shot, with the beat-locked tally', () => {
		const { container } = render(CutPlanTimeline, { output });
		expect(text(container, 'cut-plan-verdict')).toContain('2 shots');
		expect(text(container, 'cut-plan-locked-count')).toContain('1 of 2');
		expect(text(container, 'cut-plan-bpm')).toContain('120');
		// The verdict must physically precede the first shot row in the DOM.
		const ordered = [...container.querySelectorAll('[data-testid]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(ordered.indexOf('cut-plan-verdict')).toBeLessThan(ordered.indexOf('cut-plan-shot'));
	});

	it('renders one video per shot seeked to its source in-point', () => {
		const { container } = render(CutPlanTimeline, { output });
		expect(srcs(container)).toEqual([
			'/api/runs/r1/artifact/a.mp4#t=1.5',
			// in_seconds 0 needs no fragment — the natural first frame IS the in-point.
			'/api/runs/r1/artifact/b.mp4'
		]);
	});

	// A <video> fetch carries no X-Active-Tenant-Id header, so the switch must ride
	// in the query string — and it must land BEFORE the #t fragment, or the browser
	// reads "?active_tenant=..." as part of the fragment and the media 404s.
	it('puts an active tenant switch before the media fragment', () => {
		setActiveTenantId('tenant-x');
		try {
			const { container } = render(CutPlanTimeline, { output });
			expect(srcs(container)[0]).toBe('/api/runs/r1/artifact/a.mp4?active_tenant=tenant-x#t=1.5');
		} finally {
			setActiveTenantId(null);
		}
	});

	it('chips a non-1.0 speed and flags a shot that is not beat-locked', () => {
		const { container } = render(CutPlanTimeline, { output });
		expect(all(container, 'cut-plan-shot-speed').map((e) => e.textContent)).toEqual(['2×']);
		expect(all(container, 'cut-plan-shot-unlocked')).toHaveLength(1);
	});

	it('shows the source trim and the rationale', () => {
		const { container } = render(CutPlanTimeline, { output });
		expect(text(container, 'cut-plan-shot-trim')).toContain('1.50–3.50s');
		expect(text(container, 'cut-plan-shot-trim')).toContain('src-a');
		expect(text(container, 'cut-plan-shot-rationale')).toContain('widest motion');
	});

	it('shows no honesty banners for a clean, beat-locked plan', () => {
		const { container } = render(CutPlanTimeline, { output });
		expect(one(container, 'cut-plan-warning-stubbed')).toBeNull();
		expect(one(container, 'cut-plan-warning-no-grid')).toBeNull();
		expect(one(container, 'cut-plan-warning-shortfall')).toBeNull();
	});

	// The whole point of the renderer: a degraded plan must be loud, never buried.
	it('warns LOUDLY when the solver was stubbed out to even spacing', () => {
		const { container } = render(CutPlanTimeline, {
			output: { ...output, solver_stubbed: true }
		});
		expect(text(container, 'cut-plan-warning-stubbed')).toMatch(/NOT\s+cut to the beat/);
	});

	it('warns when there was no beat grid at all', () => {
		const { container } = render(CutPlanTimeline, {
			output: { ...output, beat_grid_available: false }
		});
		expect(text(container, 'cut-plan-warning-no-grid')).toContain('No beat grid');
	});

	it('warns when the reel came out shorter than requested', () => {
		const { container } = render(CutPlanTimeline, {
			output: { ...output, target_seconds: 90, total_seconds: 58, shortfall_seconds: 32 }
		});
		expect(text(container, 'cut-plan-warning-shortfall')).toContain('32.0s shorter');
	});

	it('shows an explicit placeholder instead of an empty box when a shot has no source url', () => {
		const { container } = render(CutPlanTimeline, {
			output: { ...output, shots: [{ id: 's1', source_id: 'src-a', video_url: '', seconds: 2 }] }
		});
		expect(text(container, 'cut-plan-shot-no-url')).toContain('no source URL');
		expect(all(container, 'cut-plan-shot-video')).toHaveLength(0);
	});

	// Presigned source urls carry a 1 h TTL; a gate paused overnight has dead links,
	// and a silently-black <video> reads as bad footage rather than an expired link.
	it('replaces a dead presigned source with an expired-link message', async () => {
		const { container } = render(CutPlanTimeline, { output });
		all(container, 'cut-plan-shot-video')[0].dispatchEvent(new Event('error'));
		await tick();
		expect(text(container, 'cut-plan-shot-expired')).toContain('re-run cut_plan');
	});

	// THE FENCE. The expiry is stated in the url (X-Amz-Date + X-Amz-Expires), so
	// learning it by FIRING the request is the bug: one live cut_plan gate (20
	// shots / 10 sources) produced 50 console errors and scaled the orchestrator
	// HPA 2 → 5, every request for a full 128 MiB+ source clip. A provably dead
	// link must render the expired state having issued NO request at all — which
	// in the DOM means no <video> element, hence no `src`, ever.
	it('renders a provably expired presign WITHOUT ever giving a video a src', () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [{ id: 's1', source_id: 'src-a', video_url: presigned(-2 * 3600), seconds: 2 }]
			}
		});
		expect(text(container, 'cut-plan-shot-expired')).toContain('re-run cut_plan');
		expect(all(container, 'cut-plan-shot-video')).toHaveLength(0);
		expect(srcs(container)).toEqual([]);
	});

	it('still renders the video for a presign that has not expired yet', () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [{ id: 's1', source_id: 'src-a', video_url: presigned(600), seconds: 2 }]
			}
		});
		expect(one(container, 'cut-plan-shot-expired')).toBeNull();
		expect(srcs(container)[0]).toBe(presigned(600));
	});

	// THE LIVE DEFECT. On w2v.nonagentic.ai this gate rendered 20 of 20 shots as
	// `source link expired — re-run cut_plan`, console clean and ZERO failed
	// requests, because `src` is deliberately never set. The orchestrator serves
	// shots through its own artifact proxy and carries the original presign query
	// along verbatim; the proxy re-signs server-side and ignores that query, so
	// the path cannot die — but the stale params parsed, and a human was asked to
	// approve an edit they could not see.
	it('renders a proxy-served shot even when its presign query is long dead', () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [{ id: 's1', source_id: 'src-a', video_url: proxied(-48 * 3600), seconds: 2 }]
			}
		});
		expect(one(container, 'cut-plan-shot-expired')).toBeNull();
		expect(srcs(container)[0]).toBe(proxied(-48 * 3600));
	});

	// The proxy exemption must not blind the gate to a source that really is
	// gone: onerror still marks it.
	it('still marks a proxy-served shot dead when the request actually fails', async () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [{ id: 's1', source_id: 'src-a', video_url: proxied(-48 * 3600), seconds: 2 }]
			}
		});
		all(container, 'cut-plan-shot-video')[0].dispatchEvent(new Event('error'));
		await tick();
		expect(text(container, 'cut-plan-shot-expired')).toContain('re-run cut_plan');
	});

	// Fail OPEN: a url we cannot read an expiry from must still be rendered, and
	// fall back to the onerror path. Hiding a working preview because a parse
	// missed would be worse than the request storm the preflight prevents.
	it('renders the video when the url carries no X-Amz-Expires to read', () => {
		// Absolute, NOT the proxy path: otherwise the proxy exemption would carry
		// this test and it would assert nothing about fail-open parsing.
		const noExpires = `https://minio.test/w2v-media/a.mp4?X-Amz-Date=${amzDate(-2 * 3600)}`;
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [{ id: 's1', source_id: 'src-a', video_url: noExpires, seconds: 2 }]
			}
		});
		expect(one(container, 'cut-plan-shot-expired')).toBeNull();
		expect(srcs(container)).toEqual([noExpires]);
	});

	// The failure state is per SOURCE, not per shot: 20 shots off 10 sources
	// meant each source's death was rediscovered by every shot cut from it.
	it('marks every shot drawn from a source when one of them fails', async () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [
					{ id: 's1', source_id: 'src-a', video_url: '/api/runs/r1/artifact/a.mp4', seconds: 2 },
					{ id: 's2', source_id: 'src-a', video_url: '/api/runs/r1/artifact/a.mp4', seconds: 2 },
					{ id: 's3', source_id: 'src-b', video_url: '/api/runs/r1/artifact/b.mp4', seconds: 2 }
				]
			}
		});
		expect(all(container, 'cut-plan-shot-video')).toHaveLength(3);
		all(container, 'cut-plan-shot-video')[0].dispatchEvent(new Event('error'));
		await tick();
		expect(all(container, 'cut-plan-shot-expired')).toHaveLength(2);
		// The other source is untouched — one dead link must not blank the page.
		expect(srcs(container)).toEqual(['/api/runs/r1/artifact/b.mp4']);
	});

	it('never throws on a malformed payload', () => {
		const bad: Record<string, unknown> = { shots: 'nope', total_seconds: 'x', bpm: null };
		expect(() => render(CutPlanTimeline, { output: {} })).not.toThrow();
		expect(() => render(CutPlanTimeline, { output: bad })).not.toThrow();
	});

	// cut_plan's prose channel: `TRUNCATED: …`, per-segment solver clamps, dropped
	// sources. The three numeric banners do not cover these, so dropping `notes`
	// made them invisible on the one screen a reviewer approves the cut from.
	it('shows the planner notes', () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				notes: [
					'segment A0: no beat window this clip can fill at a usable speed; placed at a clamped 0.50x'
				]
			}
		});
		expect(text(container, 'cut-plan-note')).toContain('clamped 0.50x');
	});

	// "0 of 3 beat-locked" would read as a MEASURED failure when in fact nothing
	// was recorded; the unknown count keeps the tally from being falsely pessimistic
	// without ever counting an unknown as locked.
	// The solver DERIVES speed from the emitted trim, so a shot that is
	// conceptually unwarped arrives as 1.0000909090909091 and a 0.9x as
	// 0.8999999999999999. Live evidence from run 019ff2ca: the review surface
	// printed "1.0000909090909091x" and "0.9999069767441859x" chips -- float
	// noise on the one page a human is asked to approve, and a "speed" chip on
	// shots that are not warped at all.
	it('hides float-noise speeds and rounds the real ones', () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [
					{ id: 'a', source_id: 's', in_seconds: 0, seconds: 1, speed: 1.0000909090909091 },
					{ id: 'b', source_id: 's', in_seconds: 1, seconds: 1, speed: 0.9999069767441859 },
					{ id: 'c', source_id: 's', in_seconds: 2, seconds: 1, speed: 0.8999999999999999 },
					{ id: 'd', source_id: 's', in_seconds: 3, seconds: 1, speed: 1.125 },
					{ id: 'e', source_id: 's', in_seconds: 4, seconds: 1, speed: 0.5 }
				]
			}
		});
		// The two within half a percent of 1.0 carry no chip at all.
		expect(all(container, 'cut-plan-shot-speed').map((e) => e.textContent)).toEqual([
			'0.9×',
			'1.125×',
			'0.5×'
		]);
	});

	it('separates never-recorded lock state from a measured failure', () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [
					{ id: 'a', source_id: 's', in_seconds: 0, seconds: 1, beat_locked: true },
					{ id: 'b', source_id: 's', in_seconds: 1, seconds: 1, beat_locked: null },
					{ id: 'c', source_id: 's', in_seconds: 2, seconds: 1 }
				]
			}
		});
		expect(text(container, 'cut-plan-locked-count')).toContain('1 of 3 beat-locked');
		expect(text(container, 'cut-plan-locked-unknown')).toContain('2 not recorded');
	});

	// THE OTHER HALF OF THE FENCE. #382 stops a provably DEAD presign from ever
	// being requested; this stops a HEALTHY one from being requested on mount.
	// `preload="metadata"` on ~20 tiles, each a full source clip (up to 512 MiB),
	// measured ~1.2 GB of requests from opening one gate page, 6x `502 artifact
	// unreachable`, and exhausted the orchestrator's pgbouncer pool -- a
	// non-faststart mp4 has its moov at EOF, so the `#t=` seek walks large tail
	// ranges just to answer "metadata". No frame renders either way, so the tile
	// is visually identical; the clip must load ONLY on an explicit click.
	it('requests nothing on mount for a healthy presign, and loads only on click', async () => {
		const { container } = render(CutPlanTimeline, {
			output: {
				...output,
				shots: [
					{ id: 's1', source_id: 'src-a', video_url: presigned(3000), in_seconds: 1.5, seconds: 2 },
					{ id: 's2', source_id: 'src-b', video_url: presigned(3000), in_seconds: 0, seconds: 2 }
				]
			}
		});
		const vids = all(container, 'cut-plan-shot-video') as HTMLVideoElement[];
		expect(vids).toHaveLength(2);
		// Not expired -- this is the healthy path, so the videos ARE rendered with
		// a src. What must not happen is any of them fetching it.
		expect(one(container, 'cut-plan-shot-expired')).toBeNull();
		expect(srcs(container).every((s) => s != null)).toBe(true);
		for (const v of vids) {
			expect(v.getAttribute('preload')).toBe('none');
			// `controls` would hand the browser a second way to start fetching, and
			// autoplay a third. Neither may exist before the reviewer asks.
			expect(v.hasAttribute('controls')).toBe(false);
			expect(v.hasAttribute('autoplay')).toBe(false);
		}
		// Every tile is a real button, so the load is keyboard-reachable too.
		const buttons = all(container, 'cut-plan-shot-load');
		expect(buttons).toHaveLength(2);
		expect(buttons.every((b) => b.tagName === 'BUTTON')).toBe(true);

		// The click-to-load path: only the clicked tile starts fetching.
		await fireEvent.click(buttons[0]);
		await tick();
		const after = all(container, 'cut-plan-shot-video') as HTMLVideoElement[];
		expect(after[0].getAttribute('preload')).toBe('metadata');
		expect(after[0].hasAttribute('controls')).toBe(true);
		expect(after[0].getAttribute('src')).toBe(`${presigned(3000)}#t=1.5`);
		// ...and its neighbour is still inert.
		expect(after[1].getAttribute('preload')).toBe('none');
		expect(all(container, 'cut-plan-shot-load')).toHaveLength(1);
	});
});

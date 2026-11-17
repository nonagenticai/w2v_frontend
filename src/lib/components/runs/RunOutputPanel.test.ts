import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// The panel transitively imports the video components (chapter editor /
// thumbnail picker) which pull the api client → keycloak; stub it so module
// init stays offline.
vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));

const auditReportPdfMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/api/downloads.js', () => ({
	downloads: { auditReportPdf: (...a: unknown[]) => auditReportPdfMock(...a) }
}));

import RunOutputPanel from './RunOutputPanel.svelte';
import type { RunDetail } from '$lib/types/runs';

type StageOutput = NonNullable<RunDetail['stage_outputs']>[number];

function stage(stage_name: string, output: Record<string, unknown>): StageOutput {
	return {
		id: `id-${stage_name}`,
		run_id: 'run-1',
		stage_name,
		status: 'completed',
		output,
		error: null,
		started_at: null,
		completed_at: null
	} as StageOutput;
}

function run(...stages: StageOutput[]): RunDetail {
	return { id: 'run-1', stage_outputs: stages } as RunDetail;
}

const TWO_CHAPTERS = [
	{ sequence: 1, title: 'Intro', start_seconds: 0, duration_seconds: 60 },
	{ sequence: 2, title: 'Core', start_seconds: 60, duration_seconds: 60 }
];

describe('RunOutputPanel — polymorphic output resolution', () => {
	it('renders nothing when no completed result stage exists', () => {
		const { queryByTestId } = render(RunOutputPanel, {
			run: run(stage('brief_intake', {}))
		});
		expect(queryByTestId('run-output-panel')).toBeNull();
	});

	// ── video (ported from the retired video/page.test.ts) ──
	it('renders the video player with chapter markers and the course cover poster', () => {
		const { getByText, getByRole, container } = render(RunOutputPanel, {
			run: run(
				stage('course_stitch', {
					artifact_url: 'https://x/course.mp4',
					duration_seconds: 120,
					thumbnail_url: 'https://x/cover.png',
					chapters: TWO_CHAPTERS
				})
			)
		});
		expect(getByRole('heading', { name: 'Video' })).toBeTruthy();
		expect(getByText('Intro')).toBeTruthy();
		expect(getByText('Core')).toBeTruthy();
		const video = container.querySelector('video');
		expect(video?.getAttribute('poster')).toBe('https://x/cover.png');
	});

	it('hides the chapter panel when there are fewer than 2 chapters', () => {
		const { queryByText } = render(RunOutputPanel, {
			run: run(
				stage('course_stitch', {
					artifact_url: 'https://x/course.mp4',
					duration_seconds: 60,
					chapters: [{ sequence: 1, title: 'Only', start_seconds: 0, duration_seconds: 60 }]
				})
			)
		});
		expect(queryByText('Chapters')).toBeNull();
		expect(queryByText('Only')).toBeNull();
	});

	it('prefers a thumbnail_override_url over the auto thumbnail_url for the poster', () => {
		const { container } = render(RunOutputPanel, {
			run: run(
				stage('course_stitch', {
					artifact_url: 'https://x/course.mp4',
					thumbnail_url: 'https://x/auto.png',
					thumbnail_override_url: 'https://x/picked.png',
					chapters: TWO_CHAPTERS
				})
			)
		});
		expect(container.querySelector('video')?.getAttribute('poster')).toBe('https://x/picked.png');
	});

	it('shows an Edit button only when chapters carry a lesson_project_id', () => {
		const { getByText } = render(RunOutputPanel, {
			run: run(
				stage('course_stitch', {
					artifact_url: 'https://x/course.mp4',
					chapters: [
						{ ...TWO_CHAPTERS[0], level: 0, lesson_project_id: 'p1' },
						{ ...TWO_CHAPTERS[1], level: 0, lesson_project_id: 'p2' }
					]
				})
			)
		});
		expect(getByText('Edit')).toBeTruthy();
	});

	it('surfaces a Publish button on a video result when onPublish is provided', () => {
		const onPublish = vi.fn();
		const { getByText } = render(RunOutputPanel, {
			run: run(stage('promo_render', { artifact_url: 'https://x/promo.mp4' })),
			onPublish
		});
		expect(getByText('Publish to YouTube')).toBeTruthy();
	});

	it('offers an on-demand soft-CC .srt download on a video result', () => {
		const { getByTestId } = render(RunOutputPanel, {
			run: run(stage('promo_render', { artifact_url: 'https://x/promo.mp4' }))
		});
		const link = getByTestId('run-captions-download') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/api/runs/run-1/captions.srt');
		expect(link.getAttribute('download')).toBe('video-captions.srt');
	});

	it('offers a direct MP4 download pointing at the resolved artifact url', () => {
		const { getByTestId } = render(RunOutputPanel, {
			run: run(
				stage('promo_render', { artifact_url: '/api/runs/run-1/artifact/w2v-promo/promo.mp4' })
			)
		});
		const link = getByTestId('run-mp4-download') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/api/runs/run-1/artifact/w2v-promo/promo.mp4');
		expect(link.getAttribute('download')).toBe('video.mp4');
	});

	it('titles and names the downloads after the project, and offers a share link', () => {
		const { getByTestId, getByText, getByRole } = render(RunOutputPanel, {
			run: run(
				stage('promo_render', { artifact_url: '/api/runs/run-1/artifact/w2v-promo/promo.mp4' })
			),
			videoTitle: 'Promo video',
			downloadBaseName: 'acme-launch',
			shareUrl: 'https://studio.example/projects/p/runs/run-1'
		});
		expect(getByRole('heading', { name: 'Promo video' })).toBeTruthy();
		expect(getByTestId('run-mp4-download').getAttribute('download')).toBe('acme-launch.mp4');
		expect(getByTestId('run-captions-download').getAttribute('download')).toBe(
			'acme-launch-captions.srt'
		);
		expect(getByText('Copy link')).toBeTruthy();
	});

	it('"Copy link" puts the run page address on the clipboard and says so', async () => {
		const toast = await import('$lib/stores/toast.svelte.js');
		const ok = vi.spyOn(toast, 'toastSuccess');
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
		const { getByText } = render(RunOutputPanel, {
			run: run(
				stage('promo_render', { artifact_url: '/api/runs/run-1/artifact/w2v-promo/promo.mp4' })
			),
			shareUrl: 'https://studio.example/projects/p/runs/run-1'
		});
		await fireEvent.click(getByText('Copy link'));
		await vi.waitFor(() =>
			expect(writeText).toHaveBeenCalledWith('https://studio.example/projects/p/runs/run-1')
		);
		await vi.waitFor(() => expect(ok).toHaveBeenCalledWith('Link copied', expect.any(String)));
		ok.mockRestore();
	});

	it('"Copy link" reports a refused clipboard instead of failing silently', async () => {
		const toast = await import('$lib/stores/toast.svelte.js');
		const err = vi.spyOn(toast, 'toastError');
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
		});
		const { getByText } = render(RunOutputPanel, {
			run: run(
				stage('promo_render', { artifact_url: '/api/runs/run-1/artifact/w2v-promo/promo.mp4' })
			),
			shareUrl: 'https://studio.example/x'
		});
		await fireEvent.click(getByText('Copy link'));
		await vi.waitFor(() =>
			expect(err).toHaveBeenCalledWith('Could not copy the link', 'https://studio.example/x')
		);
		err.mockRestore();
	});

	it('uses h3 section headings when embedded under a page heading', () => {
		const { getByRole } = render(RunOutputPanel, {
			run: run(
				stage('promo_render', { artifact_url: '/api/runs/run-1/artifact/w2v-promo/promo.mp4' })
			),
			videoTitle: 'Promo video',
			headingLevel: 3
		});
		expect(getByRole('heading', { level: 3, name: 'Promo video' })).toBeTruthy();
	});

	// Browser-initiated requests (<a download>, media src) cannot carry the
	// X-Active-Tenant-Id header, so a super-admin's tenant switch has to travel in
	// the URL. Above, with no switch active, the hrefs stay byte-identical.
	it('carries an active tenant switch into the browser-fetched hrefs', async () => {
		const { setActiveTenantId } = await import('$lib/api/client.js');
		setActiveTenantId('tenant-9');
		try {
			const { getByTestId } = render(RunOutputPanel, {
				run: run(
					stage('promo_render', { artifact_url: '/api/runs/run-1/artifact/w2v-promo/promo.mp4' })
				)
			});
			expect(getByTestId('run-mp4-download').getAttribute('href')).toBe(
				'/api/runs/run-1/artifact/w2v-promo/promo.mp4?active_tenant=tenant-9'
			);
			expect(getByTestId('run-captions-download').getAttribute('href')).toBe(
				'/api/runs/run-1/captions.srt?active_tenant=tenant-9'
			);
		} finally {
			setActiveTenantId('');
		}
	});

	it('does not offer a captions download when there is no video', () => {
		const { queryByTestId } = render(RunOutputPanel, {
			run: run(
				stage('audiobook_stitch', {
					combined: { artifact_url: 'https://x/book.mp3', total_seconds: 1800 }
				})
			)
		});
		expect(queryByTestId('run-captions-download')).toBeNull();
	});

	// ── audiobook ──
	it('renders the audiobook player + per-chapter downloads', () => {
		const { getByText, container } = render(RunOutputPanel, {
			run: run(
				stage('audiobook_stitch', {
					combined: { artifact_url: 'https://x/book.mp3', total_seconds: 1800 },
					chapters: [
						{ sequence: 1, title: 'Chapter A', artifact_url: 'https://x/a.mp3', seconds: 600 },
						{ sequence: 2, title: 'Chapter B', artifact_url: 'https://x/b.mp3', seconds: 600 }
					]
				})
			)
		});
		expect(getByText('Audiobook')).toBeTruthy();
		expect(getByText(/Chapter A/)).toBeTruthy();
		expect(getByText('Download full audiobook')).toBeTruthy();
		// combined + 2 chapters = 3 audio elements
		expect(container.querySelectorAll('audio').length).toBe(3);
	});

	// ── critique report ──
	it('renders critique findings', () => {
		const { getByText } = render(RunOutputPanel, {
			run: run(
				stage('website_critique', {
					summary: 'Looks rough',
					findings: ['Slow hero image', 'No CTA above the fold']
				})
			)
		});
		expect(getByText('Critique report')).toBeTruthy();
		expect(getByText('Slow hero image')).toBeTruthy();
		expect(getByText(/Findings \(2\)/)).toBeTruthy();
	});

	// A critique-only website_review run (generate_video=false) skips compile, so
	// the run carries ONLY the website_critique stage — its findings must still
	// render and the on-demand PDF export (keyed on critique_job_id) must show.
	it('renders critique findings + Export PDF for a critique-only run', () => {
		const { getByText, getByRole } = render(RunOutputPanel, {
			run: run(
				stage('website_critique', {
					url: 'https://example.com',
					summary: 'Looks rough',
					critique_job_id: 'job-abc123',
					findings: [{ title: 'No CTA above the fold', severity: 'high', category: 'ux' }]
				})
			)
		});
		expect(getByText('Critique report')).toBeTruthy();
		expect(getByText('No CTA above the fold')).toBeTruthy();
		expect(getByRole('button', { name: /Export PDF/ })).toBeTruthy();
	});

	it('renders structured object findings as fields, not a JSON blob', () => {
		const { getByText, queryByText } = render(RunOutputPanel, {
			run: run(
				stage('website_critique', {
					summary: 'Audit',
					findings: [
						{
							id: 'f1',
							title: 'Disabled chat input',
							category: 'ux',
							severity: 'critical',
							description: 'The chat composer is disabled in the HTML.',
							recommendation: 'Enable the form elements on load.'
						}
					]
				})
			)
		});
		expect(getByText('Disabled chat input')).toBeTruthy();
		expect(getByText('critical')).toBeTruthy();
		expect(getByText('ux')).toBeTruthy();
		expect(getByText('The chat composer is disabled in the HTML.')).toBeTruthy();
		expect(getByText(/Enable the form elements on load\./)).toBeTruthy();
		// No raw-JSON leak of the object's id field.
		expect(queryByText(/"id": "f1"/)).toBeNull();
	});

	// ── redesign ──
	it('renders redesign before/after visuals', () => {
		const { getByText, getByAltText, container } = render(RunOutputPanel, {
			run: run(
				stage('website_redesign', {
					style: 'modern',
					visuals: [
						{ label: 'Hero original', role: 'before', image_url: 'https://x/before.png' },
						{ label: 'Hero redesign', role: 'after', image_url: 'https://x/after.png' }
					]
				})
			)
		});
		expect(getByText('Redesign')).toBeTruthy();
		expect(getByText('before')).toBeTruthy();
		expect(getByText('after')).toBeTruthy();
		expect(getByAltText('Hero original')).toBeTruthy();
		expect(container.querySelectorAll('img').length).toBe(2);
	});

	it('plays the animated hero clip when a visual carries a video_url, still as poster', () => {
		const { container } = render(RunOutputPanel, {
			run: run(
				stage('website_redesign', {
					style: 'modern',
					visuals: [
						{ label: 'Hero original', role: 'before', image_url: 'https://x/before.png' },
						{
							label: 'Hero redesign',
							role: 'after',
							image_url: 'https://x/after.png',
							video_url: 'https://x/after.mp4'
						}
					]
				})
			)
		});
		const video = container.querySelector('video');
		expect(video).not.toBeNull();
		expect(video?.getAttribute('src')).toBe('https://x/after.mp4');
		expect(video?.getAttribute('poster')).toBe('https://x/after.png'); // still = degrade path
		// The 'before' visual without a clip stays a static image.
		expect(container.querySelectorAll('img').length).toBe(1);
	});

	it('offers Download HTML when the redesign carries a job id', () => {
		const { getByRole } = render(RunOutputPanel, {
			run: run(
				stage('website_redesign', {
					url: 'https://acme.test',
					redesign_job_id: 'rd-abc123',
					visuals: [{ label: 'After', role: 'after', image_url: 'https://x/after.png' }]
				})
			)
		});
		expect(getByRole('button', { name: /Download HTML/ })).toBeTruthy();
	});

	it('labels a web_design run "Design" and offers HTML + PDF downloads', () => {
		const { getByText, queryByText, getByRole } = render(RunOutputPanel, {
			run: run(
				stage('web_design', {
					redesign_job_id: 'wd-1',
					redesigned_html_path: 'jobs/wd-1/index.html',
					// the engine emits "redesign desktop" labels/roles; web_design relabels them
					visuals: [
						{ label: 'redesign desktop', role: 'redesign_desktop', image_url: 'https://x/a.png' }
					]
				})
			)
		});
		expect(getByText('Design')).toBeTruthy();
		expect(queryByText('Redesign')).toBeNull();
		// the visual card sub-label is relabeled redesign → design
		expect(getByText('design desktop')).toBeTruthy();
		expect(queryByText('redesign desktop')).toBeNull();
		expect(getByRole('button', { name: /Download HTML/ })).toBeTruthy();
		expect(getByRole('button', { name: /Download PDF/ })).toBeTruthy();
	});

	it('labels a web_design_v2 assemble stage "Design", not "Redesign"', () => {
		const { getByText, queryByText } = render(RunOutputPanel, {
			run: run(
				stage('assemble', {
					redesign_job_id: 'wd2-1',
					redesigned_html_path: 'jobs/wd2-1/index.html',
					live_html_url: '/api/redesign/jobs/wd2-1/html',
					verification_status: 'passed',
					visuals: [
						{ label: 'redesign desktop', role: 'redesign_desktop', image_url: 'https://x/a.png' }
					]
				})
			)
		});
		expect(getByText('Design')).toBeTruthy();
		expect(queryByText('Redesign')).toBeNull();
		expect(getByText('design desktop')).toBeTruthy();
	});

	// ── rubric review ──
	it('renders the rubric review items', () => {
		const { getByText } = render(RunOutputPanel, {
			run: run(
				stage('promo_review', {
					overall_score: 4.2,
					summary: 'Strong hook',
					items: [
						{ criterion: 'clarity', score: 4, rationale: 'Clear message' },
						{ criterion: 'pacing', score: 5, rationale: 'Snappy' }
					]
				})
			)
		});
		expect(getByText('Review')).toBeTruthy();
		expect(getByText('clarity')).toBeTruthy();
		expect(getByText('Clear message')).toBeTruthy();
	});

	// ── SEO / CRO audit scorecard hero ──
	it('heroes the SEO audit scorecard for a scan-only audit run', () => {
		const { getByTestId, container } = render(RunOutputPanel, {
			run: run(
				stage('seo_audit_scan', {
					url: 'https://acme.test',
					overall_score: 93,
					grade: 'A',
					groups: [{ group: 'on_page', score: 90, weight: 0.2, count: 1 }]
				})
			)
		});
		expect(getByTestId('run-output-panel')).toBeTruthy();
		expect(getByTestId('seo-audit-scorecard')).toBeTruthy();
		// The audit section is the FIRST rendered output section (hero'd).
		expect(container.querySelector('[data-output-kind]')?.getAttribute('data-output-kind')).toBe(
			'audit'
		);
	});

	it('heroes the CRO audit scorecard (subsections) for a scan-only audit run', () => {
		const { getByTestId } = render(RunOutputPanel, {
			run: run(
				stage('cro_audit_scan', {
					url: 'https://acme.test',
					overall_score: 78,
					grade: 'B',
					subsections: [{ section: 'hero', score: 80, weight: 0.2, count: 1 }]
				})
			)
		});
		expect(getByTestId('cro-audit-scorecard')).toBeTruthy();
	});

	it('heroes the marketing scorecard (dimensions) for a scan-only audit run', () => {
		const { getByTestId, getByRole } = render(RunOutputPanel, {
			run: run(
				stage('marketing_scorecard_scan', {
					url: 'https://acme.test',
					overall_score: 74,
					grade: 'B',
					dimensions: [{ dimension: 'growth', score: 68, weight: 0.2, count: 2 }]
				})
			)
		});
		expect(getByTestId('marketing-scorecard')).toBeTruthy();
		// Regression: the drift bug lost the hero + Download-PDF for marketing runs.
		expect(getByRole('button', { name: /Download PDF/ })).toBeTruthy();
	});

	it('names a legacy (no project_type) marketing PDF marketing_scorecard-<host>.pdf', async () => {
		auditReportPdfMock.mockClear();
		const { getByRole } = render(RunOutputPanel, {
			run: run(
				stage('marketing_scorecard_scan', {
					url: 'https://acme.test',
					overall_score: 74,
					grade: 'B',
					dimensions: [{ dimension: 'growth', score: 68, weight: 0.2, count: 2 }]
				})
			)
		});
		await fireEvent.click(getByRole('button', { name: /Download PDF/ }));
		expect(auditReportPdfMock.mock.calls[0][1]).toBe('marketing_scorecard-acme.test.pdf');
	});

	it('offers a Download PDF button on the audit hero that calls auditReportPdf', async () => {
		auditReportPdfMock.mockClear();
		const { getByRole } = render(RunOutputPanel, {
			run: run(
				stage('seo_audit_scan', {
					url: 'https://acme.test',
					overall_score: 93,
					grade: 'A',
					groups: [{ group: 'on_page', score: 90, weight: 0.2, count: 1 }]
				})
			)
		});
		const btn = getByRole('button', { name: /Download PDF/ });
		await fireEvent.click(btn);
		expect(auditReportPdfMock).toHaveBeenCalledOnce();
		// Keyed on the run id, with a .pdf filename derived from the audited host.
		expect(auditReportPdfMock.mock.calls[0][0]).toBe('run-1');
		expect(auditReportPdfMock.mock.calls[0][1]).toBe('seo_audit-acme.test.pdf');
	});

	it('dispatches the hero + PDF name on project_type, not on the breakdown array', async () => {
		auditReportPdfMock.mockClear();
		const { getByTestId, getByRole } = render(RunOutputPanel, {
			run: run(
				stage('cro_audit_scan', {
					url: 'https://acme.test',
					overall_score: 80,
					grade: 'B',
					project_type: 'cro_audit',
					// A stray `groups` must not turn a CRO audit into an SEO one.
					groups: [{ group: 'x', score: 50, weight: 1 }],
					subsections: [{ section: 'hero', score: 80, weight: 0.2 }],
					ai: { requested: false, status: 'not_requested', layers: [] }
				})
			)
		});
		expect(getByTestId('cro-audit-scorecard')).toBeTruthy();
		expect(getByTestId('audit-ai-status').textContent).toContain('not requested');
		await fireEvent.click(getByRole('button', { name: /Download PDF/ }));
		expect(auditReportPdfMock.mock.calls[0][1]).toBe('cro_audit-acme.test.pdf');
	});

	it('names the audit PDF by host only — a URL path never leaks into the filename', async () => {
		auditReportPdfMock.mockClear();
		const { getByRole } = render(RunOutputPanel, {
			run: run(
				stage('cro_audit_scan', {
					url: 'https://a.test/pricing',
					overall_score: 80,
					grade: 'B',
					project_type: 'cro_audit',
					subsections: [{ section: 'hero', score: 80, weight: 0.2 }]
				})
			)
		});
		await fireEvent.click(getByRole('button', { name: /Download PDF/ }));
		expect(auditReportPdfMock.mock.calls[0][1]).toBe('cro_audit-a.test.pdf');
	});

	// ── multi-kind: a website_review run carries redesign + review + video at once ──
	it('renders every present output kind in one panel', () => {
		const { getByText, getByRole } = render(RunOutputPanel, {
			run: run(
				stage('website_redesign', { visuals: [{ image_url: 'https://x/v.png', role: 'after' }] }),
				stage('promo_review', { overall_score: 3.5, items: [{ criterion: 'tone' }] }),
				stage('website_review_compile', { artifact_url: 'https://x/review.mp4' })
			)
		});
		expect(getByText('Redesign')).toBeTruthy();
		expect(getByText('Review')).toBeTruthy();
		expect(getByRole('heading', { name: 'Video' })).toBeTruthy();
	});
});

// ── Regression: the blank demo_video run page (measured live 2026-08-10) ──
// Run 019feb3f-6c05-76ce-a482-42b3c3f24e14 rendered COMPLETELY blank
// (`document.body.innerText.length === 0`, no <main>) with a single console error:
// `https://svelte.dev/e/each_key_duplicate`.
//
// Cause: `final_critique` carries BOTH an `artifact_url` (so it wins
// `findResultStage(isVideoStage)` as the last video-bearing stage) AND a
// `chapters[]` in the minimal scene-cut shape the orchestrator's
// `FinalCritiqueChapter` model defines — `{start: float, title: str}`, with no
// `sequence`. RunOutputPanel adapted those to `number: c.sequence`, producing 18
// rows all keyed `undefined`, and ChapterMarkers' keyed `{#each}` threw. The throw
// escaped to the page root and destroyed the whole render.
describe('RunOutputPanel — demo_video final_critique chapters (blank-page regression)', () => {
	// Verbatim shape of the orchestrator's FinalCritiqueChapter: start + title only.
	const FINAL_CRITIQUE_CHAPTERS = Array.from({ length: 18 }, (_, i) => ({
		start: i * 7.5,
		title: `Chapter ${i + 1}`
	}));

	// The live run's completed stages, in DAG order. Four separate stages emit
	// `lines` with the identical ids clip-1…clip-6 (by design — each only rewrites
	// the text), and both tail stages carry id-less `chapters`.
	const LINES = Array.from({ length: 6 }, (_, i) => ({
		id: `clip-${i + 1}`,
		text: `Line ${i + 1}`,
		seconds: 5
	}));

	function demoVideoRun(): RunDetail {
		return run(
			stage('demo_video_gen', { lines: LINES }),
			stage('script_doctor', { lines: LINES }),
			stage('retention_plan', { lines: LINES }),
			stage('reconcile_timeline', { lines: LINES }),
			stage('demo_video_record', {
				clips: LINES.map((l) => ({ id: l.id, line_id: l.id, video_url: `https://x/${l.id}.mp4` }))
			}),
			stage('demo_video_narrate', {
				clips: LINES.map((l, i) => ({
					id: `sha-${i}`,
					line_id: l.id,
					artifact_url: `https://x/${l.id}.wav`
				}))
			}),
			stage('demo_video_compile', {
				artifact_url: 'https://x/demo.mp4',
				duration_seconds: 135,
				shot_timeline: LINES.map((l) => ({ line_id: l.id }))
			}),
			// The stage that actually wins isVideoStage — last one with an artifact_url.
			stage('final_critique', {
				artifact_url: 'https://x/demo-final.mp4',
				duration_seconds: 135,
				quality_badge: 'fair',
				chapters: FINAL_CRITIQUE_CHAPTERS
			}),
			stage('growth_bundle', {
				chapters: FINAL_CRITIQUE_CHAPTERS,
				snippets: [{ id: 'a1b2', channel: 'x', text: 'ship it' }]
			})
		);
	}

	it('renders the video + all 18 id-less chapters instead of throwing each_key_duplicate', () => {
		const { getByText, getByRole, getAllByRole, container } = render(RunOutputPanel, {
			run: demoVideoRun()
		});

		// Rendered at all — the whole defect was that nothing rendered.
		expect(container.querySelector('[data-testid="run-output-panel"]')).toBeTruthy();
		expect(getByRole('heading', { name: 'Video' })).toBeTruthy();
		expect(container.querySelector('video')?.getAttribute('src')).toBe('https://x/demo-final.mp4');

		// Every chapter row is present and keyed uniquely (18 in, 18 out).
		expect(getByText('Chapters')).toBeTruthy();
		const chapterButtons = getAllByRole('button').filter((b) =>
			/^Chapter \d+$/.test(b.textContent?.replace(/\s+/g, ' ').match(/Chapter \d+/)?.[0] ?? '')
		);
		expect(chapterButtons.length).toBe(18);

		// Numberless chapters fall back to their position for the badge, so the
		// first and last rows are labelled rather than blank.
		expect(getByText('Chapter 1')).toBeTruthy();
		expect(getByText('Chapter 18')).toBeTruthy();
	});

	it('still keys by sequence when the producer supplies one (course_stitch unchanged)', () => {
		const { getByText } = render(RunOutputPanel, {
			run: run(
				stage('course_stitch', {
					artifact_url: 'https://x/course.mp4',
					chapters: TWO_CHAPTERS
				})
			)
		});
		expect(getByText('Intro')).toBeTruthy();
		expect(getByText('Core')).toBeTruthy();
	});

	it('survives a producer that repeats the same chapter sequence', () => {
		const { getAllByText } = render(RunOutputPanel, {
			run: run(
				stage('course_stitch', {
					artifact_url: 'https://x/course.mp4',
					chapters: [
						{ sequence: 1, title: 'Dup', start_seconds: 0, duration_seconds: 10 },
						{ sequence: 1, title: 'Dup', start_seconds: 10, duration_seconds: 10 }
					]
				})
			)
		});
		expect(getAllByText('Dup').length).toBe(2);
	});
});

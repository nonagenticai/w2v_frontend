<script lang="ts">
	import { safeHref } from '$lib/utils/safe-url';
	import { withUniqueKeys } from '$lib/utils/unique-keys.js';
	/* eslint-disable svelte/no-navigation-without-resolve -- every anchor here points
	   at a backend artifact URL (presigned MinIO / the reviewed site / generated HTML)
	   or a download link, never an internal route. */
	import { Button, Pill } from '$lib/components/ui';
	import VideoPlayer from '$lib/components/video/VideoPlayer.svelte';
	import ChapterMarkers from '$lib/components/video/ChapterMarkers.svelte';
	import ChapterEditor from '$lib/components/video/ChapterEditor.svelte';
	import ThumbnailPicker from '$lib/components/video/ThumbnailPicker.svelte';
	import AudioPlayer from '$lib/components/audio/AudioPlayer.svelte';
	import StageOutputJson from './StageOutputJson.svelte';
	import {
		findResultStage,
		isVideoStage,
		isAudioStage,
		isCritiqueStage,
		isRedesignStage,
		isReviewStage,
		isAuditStage
	} from '$lib/utils/stage-output';
	import { resolveRenderer } from './renderers/registry';
	import { auditProjectType } from '$lib/utils/audit-kind';
	import { downloads } from '$lib/api/downloads.js';
	import { scopedMediaUrl } from '$lib/api/client.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import { extractHostname, fileSafeHost } from '$lib/utils/format.js';
	import type { RunDetail } from '$lib/types/runs';
	import type { CourseChapter, StorylineChapter } from '$lib/types';
	import { Play, Download, Pencil, MonitorPlay, Link } from '@lucide/svelte';

	let {
		run,
		onPublish,
		videoTitle = 'Video',
		downloadBaseName = 'video',
		shareUrl,
		headingLevel = 2
	}: {
		run: RunDetail;
		onPublish?: () => void;
		/** Heading of the video result — what the person asked for ("Promo video"). */
		videoTitle?: string;
		/** File name stem for downloads, e.g. the project's name — not "video.mp4". */
		downloadBaseName?: string;
		/** When set, a "Copy link" action shares this page with workspace members. */
		shareUrl?: string;
		/** Heading level of each result section — 3 when embedded under a page h2. */
		headingLevel?: 2 | 3;
	} = $props();
	const headingTag = $derived(`h${headingLevel}`);

	async function copyShareLink() {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			toastSuccess('Link copied', 'Anyone in this workspace can open it.');
		} catch {
			toastError('Could not copy the link', shareUrl);
		}
	}

	const runId = $derived(run.id);

	// Result sections are resolved by stage OUTPUT SHAPE (see $lib/utils/stage-output),
	// not by stage name — each project type emits different terminal stage names but
	// the payloads are stable. A single run can carry several (a website_review run
	// produces a redesign + a review + a video), so each section renders independently.
	const videoStage = $derived(findResultStage(run, isVideoStage));
	const audioStage = $derived(findResultStage(run, isAudioStage));
	const reportStage = $derived(findResultStage(run, isCritiqueStage));
	const redesignStage = $derived(findResultStage(run, isRedesignStage));
	const reviewStage = $derived(findResultStage(run, isReviewStage));
	// SEO/CRO audit scorecard — the audit's entire deliverable. Hero'd first (above the
	// storyboard + the demoted inspector) by reusing the registry scorecard renderer
	// (AuditScorecard dispatches on project_type), so there's zero new render code here.
	const auditStage = $derived(findResultStage(run, isAuditStage));
	const auditOutput = $derived((auditStage?.output ?? {}) as Record<string, unknown>);
	const auditRenderer = $derived(auditStage ? resolveRenderer(auditOutput) : null);
	// The audit type comes from the output's own `project_type` (the same
	// auditProjectType AuditScorecard dispatches on); only a run older than that
	// field falls back to its breakdown-array key.
	const auditType = $derived(auditProjectType(auditOutput));
	let downloadingAuditPdf = $state(false);

	async function exportAuditReportPdf() {
		downloadingAuditPdf = true;
		try {
			const url = (auditOutput.url as string) || '';
			// Same host rule as the server's report filename (host_of).
			const host = url ? fileSafeHost(url) : runId.slice(0, 8);
			await downloads.auditReportPdf(runId, `${auditType}-${host}.pdf`);
		} catch (err) {
			toastError('PDF download failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloadingAuditPdf = false;
		}
	}
	const hasAny = $derived(
		Boolean(auditStage || videoStage || audioStage || reportStage || redesignStage || reviewStage)
	);

	// ── Video ──────────────────────────────────────────────────────────────
	// Writable $derived: re-derived on a new run, but reassignable so a
	// chapter/thumbnail PATCH can swap the fresh output in place and refresh
	// titles + poster without a full reload.
	let videoOutput = $derived((videoStage?.output ?? {}) as Record<string, unknown>);
	// Player sources and download hrefs are fetched by the browser itself, which
	// cannot carry the X-Active-Tenant-Id header a fetch() would — so an admin's
	// tenant switch has to travel in the URL (scopedMediaUrl; a no-op otherwise).
	const videoUrl = $derived(
		scopedMediaUrl(
			(videoOutput.video_url || videoOutput.artifact_url || videoOutput.url || '') as string
		) ?? ''
	);
	const videoDurationSeconds = $derived(Number(videoOutput.duration_seconds ?? 0));
	// An operator override beats the auto AI cover.
	const thumbnailUrl = $derived(
		scopedMediaUrl(
			(videoOutput.thumbnail_override_url || videoOutput.thumbnail_url || '') as string
		) ?? ''
	);
	const hasThumbnailOverride = $derived(Boolean(videoOutput.thumbnail_override_url));
	// Only a course's stitched output is editable (chapters + cover).
	const isCourse = $derived(videoStage?.stage_name === 'course_stitch');
	// `chapters[]` is NOT one shape. `course_stitch` emits the full CourseChapter
	// (sequence + start_seconds + duration_seconds + lesson_project_id), but
	// demo_video's `final_critique` — which also carries an `artifact_url` and so
	// wins `findResultStage(isVideoStage)` as the LAST video-bearing stage — emits
	// the minimal scene-cut form `{start, title}`: no sequence, no start_seconds.
	// Typing that as CourseChapter was a lie; every field must be treated as
	// optional here or the adapter silently produces `number: undefined` rows.
	type RawChapter = Partial<CourseChapter> & { start?: number };
	const rawChapters = $derived((videoOutput.chapters ?? []) as RawChapter[]);
	// Adapt to the StorylineChapter shape ChapterMarkers renders (it seeks by
	// start_seconds), preserving level/parent_sequence for 2-level rendering.
	// Operator-hidden sub-chapters are dropped from the player here (the editor
	// keeps the full rawChapters so they can be un-hidden).
	const chapters = $derived(
		rawChapters
			.filter((c) => !c.hidden)
			.map((c, i): StorylineChapter => ({
				// Position is the fallback identity for a producer that does not number
				// its chapters — a bare `c.sequence` made all N rows key as `undefined`,
				// and the resulting each_key_duplicate blanked the entire run page.
				number: c.sequence ?? i + 1,
				title: c.title ?? `Chapter ${i + 1}`,
				subtitle: '',
				estimated_duration_seconds: c.duration_seconds ?? 0,
				start_seconds: c.start_seconds ?? c.start,
				duration_seconds: c.duration_seconds,
				level: c.level ?? 0,
				parent_sequence: c.parent_sequence ?? null
			}))
	);
	const hasChapters = $derived(chapters.length >= 2);
	// Editable only when there is at least one level-0 marker keyed by a pid.
	const hasEditableChapters = $derived(
		rawChapters.some((c) => (c.level ?? 0) === 0 && c.lesson_project_id)
	);

	let player = $state<ReturnType<typeof VideoPlayer>>();
	let currentTime = $state(0);
	let editingChapters = $state(false);

	function applyVideoOutput(next: Record<string, unknown>) {
		videoOutput = next;
	}

	// ── Audiobook ──────────────────────────────────────────────────────────
	type AudioChapter = {
		id?: string;
		title?: string;
		sequence?: number;
		artifact_url?: string;
		seconds?: number;
	};
	const audioOutput = $derived((audioStage?.output ?? {}) as Record<string, unknown>);
	const audioCombined = $derived(
		(audioOutput.combined ?? {}) as { artifact_url?: string; total_seconds?: number }
	);
	const audioCombinedUrl = $derived(
		scopedMediaUrl(
			(audioCombined.artifact_url || (audioOutput.artifact_url as string) || '') as string
		) ?? ''
	);
	const audioTotalSeconds = $derived(
		Number(audioCombined.total_seconds ?? audioOutput.duration_seconds ?? 0)
	);
	const audioChapters = $derived(
		((audioOutput.chapters ?? []) as AudioChapter[])
			.slice()
			.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
			.map((c) => ({ ...c, artifact_url: scopedMediaUrl(c.artifact_url) ?? undefined }))
	);

	function fmtDuration(s: number): string {
		if (!s || !isFinite(s)) return '';
		const m = Math.floor(s / 60);
		const sec = Math.round(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	// ── Critique report ──────────────────────────────────────────────────────
	const reportOutput = $derived((reportStage?.output ?? {}) as Record<string, unknown>);
	const reportMarkdown = $derived(
		(reportOutput.markdown || reportOutput.report_markdown || reportOutput.body || '') as string
	);
	const reportSummary = $derived((reportOutput.summary || reportOutput.title || '') as string);
	const reportFindings = $derived(
		Array.isArray(reportOutput.findings) ? (reportOutput.findings as unknown[]) : []
	);
	const reportScore = $derived(
		typeof reportOutput.score === 'number' ? (reportOutput.score as number) : null
	);
	const reportPdfUrl = $derived(scopedMediaUrl((reportOutput.pdf_url || '') as string) ?? '');
	// website_critique stores the analysis_service job id (not a direct pdf_url);
	// the PDF is minted on demand at /api/critique/{job_id}/report/pdf. Routed
	// through `downloads` so the request carries the Keycloak JWT + X-Tenant-Id
	// headers a bare anchor href would drop.
	const critiqueJobId = $derived((reportOutput.critique_job_id || '') as string);
	const reportUrl = $derived((reportOutput.url || '') as string);
	let downloadingPdf = $state(false);

	async function exportCritiquePdf() {
		if (!critiqueJobId) return;
		downloadingPdf = true;
		try {
			const host = reportUrl ? extractHostname(reportUrl) : critiqueJobId.slice(0, 8);
			await downloads.critiqueReportPdf(critiqueJobId, `critique-report-${host}.pdf`);
		} catch (err) {
			toastError('PDF export failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloadingPdf = false;
		}
	}

	// Findings arrive as structured objects (title / severity / category /
	// description / recommendation) from website_critique / app_critique. Render
	// those fields; fall back to a readable blob for legacy string findings or an
	// unknown shape so nothing silently disappears.
	type Finding = {
		title?: string;
		severity?: string;
		category?: string;
		description?: string;
		recommendation?: string;
	};
	const asStr = (v: unknown): string | undefined =>
		typeof v === 'string' && v.length > 0 ? v : undefined;
	function asFinding(f: unknown): { fields: Finding; raw: string | null } {
		if (typeof f === 'string') return { fields: {}, raw: f };
		if (f && typeof f === 'object') {
			const o = f as Record<string, unknown>;
			const fields: Finding = {
				title: asStr(o.title),
				severity: asStr(o.severity),
				category: asStr(o.category),
				description: asStr(o.description),
				recommendation: asStr(o.recommendation)
			};
			const hasAnyField = Object.values(fields).some((v) => v !== undefined);
			return { fields, raw: hasAnyField ? null : JSON.stringify(f, null, 2) };
		}
		return { fields: {}, raw: JSON.stringify(f) };
	}
	function severityTone(sev: string | undefined): 'danger' | 'warning' | 'neutral' {
		const s = (sev ?? '').toLowerCase();
		if (s === 'critical' || s === 'high') return 'danger';
		if (s === 'medium') return 'warning';
		return 'neutral';
	}

	// ── Redesign / Design ───────────────────────────────────────────────────────
	const redesignOutput = $derived((redesignStage?.output ?? {}) as Record<string, unknown>);
	// The web_design / web_design_v2 types emit the same output shape but are a
	// brand-new design, not a redesign of an existing site — label the section
	// accordingly. web_design_v2's redesign-shaped output comes from its `design`
	// / `assemble` stages (the assemble stage wins as the terminal one).
	const isDesignStage = $derived(
		redesignStage?.stage_name === 'web_design' ||
			redesignStage?.stage_name === 'design' ||
			redesignStage?.stage_name === 'assemble'
	);
	const redesignHeading = $derived(isDesignStage ? 'Design' : 'Redesign');
	// web_design reuses the redesign output shape, whose visual labels/roles read
	// "redesign desktop" (from the engine's role strings). Relabel them to "design"
	// for a web_design run so the card text matches the section heading.
	const visualText = (s: string | undefined): string => {
		const t = s ?? 'design';
		return isDesignStage ? t.replace(/redesign/gi, 'design') : t;
	};
	const redesignUrl = $derived((redesignOutput.url || '') as string);
	const redesignStyle = $derived((redesignOutput.style || '') as string);
	const redesignHtmlPath = $derived(
		scopedMediaUrl((redesignOutput.redesigned_html_path || '') as string) ?? ''
	);
	const redesignA11y = $derived(
		typeof redesignOutput.accessibility_score === 'number'
			? (redesignOutput.accessibility_score as number)
			: null
	);
	const redesignVisuals = $derived(
		Array.isArray(redesignOutput.visuals)
			? (
					redesignOutput.visuals as {
						label?: string;
						role?: string;
						image_url?: string;
						video_url?: string;
					}[]
				)
					.filter((v) => typeof v.image_url === 'string' && v.image_url.length > 0)
					.map((v) => ({
						...v,
						image_url: scopedMediaUrl(v.image_url) ?? undefined,
						video_url: scopedMediaUrl(v.video_url) ?? undefined
					}))
			: []
	);
	const redesignHtmlIsLink = $derived(
		redesignHtmlPath.startsWith('http://') || redesignHtmlPath.startsWith('https://')
	);
	// The redesigned HTML is stored on html_render_service (not a public URL); it's
	// minted on demand at /api/designs/jobs/{job_id}/html. Download via the auth-
	// carrying helper, keyed on the redesign job id the stage surfaced.
	const redesignJobId = $derived((redesignOutput.redesign_job_id || '') as string);
	let downloadingHtml = $state(false);

	let downloadingDesignPdf = $state(false);
	const redesignSlug = $derived(
		redesignUrl ? extractHostname(redesignUrl) : redesignJobId.slice(0, 8)
	);

	async function exportRedesignHtml() {
		if (!redesignJobId) return;
		downloadingHtml = true;
		try {
			await downloads.redesignHtml(redesignJobId, `design-${redesignSlug}.html`);
		} catch (err) {
			toastError('HTML download failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloadingHtml = false;
		}
	}

	async function exportRedesignPdf() {
		if (!redesignJobId) return;
		downloadingDesignPdf = true;
		try {
			await downloads.redesignPdf(redesignJobId, `design-${redesignSlug}.pdf`);
		} catch (err) {
			toastError('PDF download failed', err instanceof Error ? err.message : 'Unknown error');
		} finally {
			downloadingDesignPdf = false;
		}
	}

	// ── Rubric review ──────────────────────────────────────────────────────────
	const reviewOutput = $derived((reviewStage?.output ?? {}) as Record<string, unknown>);
	const reviewItems = $derived(
		Array.isArray(reviewOutput.items)
			? (reviewOutput.items as { criterion?: string; score?: number; rationale?: string }[])
			: []
	);
	const reviewOverall = $derived(
		typeof reviewOutput.overall_score === 'number' ? (reviewOutput.overall_score as number) : null
	);
	const reviewSummary = $derived((reviewOutput.summary || '') as string);
</script>

{#if hasAny}
	<div class="space-y-4" data-testid="run-output-panel">
		<!-- ── SEO / CRO Audit scorecard (hero — the audit's deliverable) ── -->
		{#if auditStage && auditRenderer}
			{@const AuditScorecard = auditRenderer.component}
			<section
				class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
				data-output-kind="audit"
			>
				<div class="flex justify-end">
					<Button
						variant="secondary"
						size="sm"
						loading={downloadingAuditPdf}
						onclick={exportAuditReportPdf}
					>
						<Download class="h-4 w-4" />
						{downloadingAuditPdf ? 'Preparing…' : 'Download PDF'}
					</Button>
				</div>
				<AuditScorecard output={auditOutput} {runId} />
			</section>
		{/if}

		<!-- ── Video ── -->
		{#if videoStage}
			<section
				class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
				data-output-kind="video"
			>
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<div class="flex items-center gap-2">
						<Play class="h-4 w-4 text-[var(--color-accent)]" />
						<svelte:element
							this={headingTag}
							class="text-base font-semibold text-[var(--color-text)]"
						>
							{videoTitle}
						</svelte:element>
						{#if videoDurationSeconds}
							<span class="text-xs text-[var(--color-text-muted)]">
								{fmtDuration(videoDurationSeconds)}
							</span>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#if shareUrl}
							<Button variant="ghost" size="sm" onclick={copyShareLink}>
								<Link class="h-4 w-4" />
								Copy link
							</Button>
						{/if}
						{#if onPublish}
							<Button variant="secondary" size="sm" onclick={onPublish}>
								<MonitorPlay class="h-4 w-4" />
								Publish to YouTube
							</Button>
						{/if}
					</div>
				</div>

				{#if videoUrl}
					<div class="grid gap-4 {hasChapters ? 'md:grid-cols-[1fr_18rem]' : ''}">
						<div class="space-y-3">
							<VideoPlayer
								bind:this={player}
								src={videoUrl}
								title={videoTitle}
								poster={thumbnailUrl || undefined}
								onTimeUpdate={(t) => (currentTime = t)}
							/>
							{#if isCourse}
								<div>
									<h3 class="text-sm font-medium text-[var(--color-text)] mb-2">Thumbnail</h3>
									<ThumbnailPicker
										{runId}
										hasOverride={hasThumbnailOverride}
										captureFrame={() => player?.captureFrame() ?? Promise.resolve(null)}
										onSaved={applyVideoOutput}
									/>
								</div>
							{/if}
						</div>
						{#if hasChapters}
							<aside class="min-w-0">
								<div class="flex items-center justify-between mb-2">
									<h3 class="text-sm font-medium text-[var(--color-text)]">Chapters</h3>
									{#if isCourse && hasEditableChapters && !editingChapters}
										<Button size="sm" variant="ghost" onclick={() => (editingChapters = true)}>
											<Pencil class="h-3.5 w-3.5" /> Edit
										</Button>
									{/if}
								</div>
								{#if editingChapters}
									<ChapterEditor
										{runId}
										chapters={rawChapters as CourseChapter[]}
										onSaved={applyVideoOutput}
										onClose={() => (editingChapters = false)}
									/>
								{:else}
									<ChapterMarkers {chapters} {currentTime} onSeek={(t) => player?.seekTo(t)} />
								{/if}
							</aside>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<!-- Direct MP4 download via the artifact proxy already resolved into
						     videoUrl (no kubectl / minio.test reachability needed). -->
						<a
							href={safeHref(videoUrl)}
							download={`${downloadBaseName}.mp4`}
							rel="noopener"
							data-testid="run-mp4-download"
							class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-on-primary)] hover:bg-[var(--color-accent-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
						>
							<Download class="h-4 w-4" /> Download video (MP4)
						</a>
						<!-- Soft-CC track minted on demand from narration timing; always
						     available for a video run, independent of YouTube publish. -->
						<a
							href={scopedMediaUrl(`/api/runs/${runId}/captions.srt`)}
							download={`${downloadBaseName}-captions.srt`}
							rel="noopener"
							data-testid="run-captions-download"
							class="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
						>
							<Download class="h-4 w-4" /> Download captions (.srt)
						</a>
					</div>
				{:else}
					<p class="text-sm text-[var(--color-text-muted)]">
						The video file for this run is not available. The raw output is below for support.
					</p>
					<StageOutputJson output={videoOutput} title="Raw output" />
				{/if}
			</section>
		{/if}

		<!-- ── Audiobook ── -->
		{#if audioStage}
			<section
				class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
				data-output-kind="audio"
			>
				<div class="flex items-center justify-between">
					<svelte:element
						this={headingTag}
						class="text-base font-semibold text-[var(--color-text)]"
					>
						Audiobook
					</svelte:element>
					{#if audioTotalSeconds}
						<span class="text-xs text-[var(--color-text-muted)]">
							{fmtDuration(audioTotalSeconds)}
						</span>
					{/if}
				</div>

				{#if audioCombinedUrl}
					<div class="space-y-2">
						<AudioPlayer src={audioCombinedUrl} />
						<a
							class="inline-block text-xs text-[var(--color-accent)] hover:underline"
							href={safeHref(audioCombinedUrl)}
							download
							rel="noopener"
						>
							Download full audiobook
						</a>
					</div>
				{:else}
					<p class="text-sm text-[var(--color-text-muted)]">No combined audio in stage output.</p>
				{/if}

				{#if audioChapters.length > 0}
					<div class="space-y-3 border-t border-[var(--color-border)] pt-4">
						<h3 class="text-sm font-medium text-[var(--color-text)]">Chapters</h3>
						<ol class="space-y-4">
							<!-- `ch.id ?? i` did NOT harden this: `??` passes an EMPTY STRING
					     through, and two chapters carrying `id: ''` (or the same id) throw
					     each_key_duplicate — which blanks the panel in prod. Same payload,
					     same treatment as AudiobookPlan. -->
							{#each withUniqueKeys(audioChapters, (c) => c.id) as { item: ch, index: i, key } (key)}
								<li class="space-y-1.5">
									<div class="flex items-center justify-between">
										<p class="text-sm font-medium text-[var(--color-text)]">
											{i + 1}. {ch.title || `Chapter ${i + 1}`}
										</p>
										{#if ch.seconds}
											<span class="text-xs text-[var(--color-text-muted)]">
												{fmtDuration(ch.seconds)}
											</span>
										{/if}
									</div>
									{#if ch.artifact_url}
										<AudioPlayer src={ch.artifact_url} />
										<a
											class="inline-block text-xs text-[var(--color-accent)] hover:underline"
											href={safeHref(ch.artifact_url)}
											download
											rel="noopener"
										>
											Download
										</a>
									{/if}
								</li>
							{/each}
						</ol>
					</div>
				{/if}
			</section>
		{/if}

		<!-- ── Redesign ── -->
		{#if redesignStage}
			<section
				class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
				data-output-kind="redesign"
			>
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<svelte:element
						this={headingTag}
						class="text-base font-semibold text-[var(--color-text)]"
					>
						{redesignHeading}
					</svelte:element>
					<div class="flex items-center gap-3">
						<p class="text-xs text-[var(--color-text-muted)]">
							{#if redesignStyle}style {redesignStyle}{/if}
							{#if redesignA11y !== null}· a11y {redesignA11y.toFixed(0)}{/if}
						</p>
						{#if redesignJobId}
							<Button
								variant="secondary"
								size="sm"
								loading={downloadingHtml}
								onclick={exportRedesignHtml}
							>
								<Download class="h-4 w-4" />
								{downloadingHtml ? 'Preparing…' : 'Download HTML'}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								loading={downloadingDesignPdf}
								onclick={exportRedesignPdf}
							>
								<Download class="h-4 w-4" />
								{downloadingDesignPdf ? 'Preparing…' : 'Download PDF'}
							</Button>
						{/if}
					</div>
				</div>

				{#if redesignUrl || redesignHtmlIsLink}
					<div class="flex flex-wrap items-center gap-4 text-sm">
						{#if redesignUrl}
							<a
								class="text-[var(--color-accent)] hover:underline font-mono break-all"
								href={safeHref(redesignUrl)}
								target="_blank"
								rel="noopener noreferrer"
							>
								{redesignUrl}
							</a>
						{/if}
						{#if redesignHtmlIsLink}
							<a
								class="text-[var(--color-accent)] hover:underline"
								href={safeHref(redesignHtmlPath)}
								target="_blank"
								rel="noopener noreferrer"
							>
								Open redesigned HTML →
							</a>
						{/if}
					</div>
				{/if}

				{#if redesignVisuals.length}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#each redesignVisuals as v, i (i)}
							<div
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2"
							>
								<div class="flex items-center justify-between">
									<h3 class="text-sm font-semibold text-[var(--color-text)]">
										{visualText(v.label)}
									</h3>
									{#if v.role}
										<span class="text-xs text-[var(--color-text-muted)] uppercase">
											{visualText(v.role)}
										</span>
									{/if}
								</div>
								{#if v.video_url}
									<!-- Animated scroll-through hero (opt-in redesign_motion); the
									     still image_url is the poster/degrade path. -->
									<video
										src={v.video_url}
										poster={v.image_url}
										controls
										loop
										muted
										playsinline
										class="w-full rounded-lg border border-[var(--color-border)]"
									></video>
								{:else}
									<img
										src={v.image_url}
										alt={visualText(v.label)}
										class="w-full rounded-lg border border-[var(--color-border)]"
										loading="lazy"
									/>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<StageOutputJson output={redesignOutput} title="Raw output" />
				{/if}
			</section>
		{/if}

		<!-- ── Critique report ── -->
		{#if reportStage}
			<section
				class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
				data-output-kind="report"
			>
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<svelte:element
						this={headingTag}
						class="text-base font-semibold text-[var(--color-text)]"
					>
						Critique report
					</svelte:element>
					{#if reportPdfUrl}
						<Button variant="secondary" size="sm" href={safeHref(reportPdfUrl)}>
							<Download class="h-4 w-4" /> Download PDF
						</Button>
					{:else if critiqueJobId}
						<Button
							variant="secondary"
							size="sm"
							loading={downloadingPdf}
							onclick={exportCritiquePdf}
						>
							<Download class="h-4 w-4" />
							{downloadingPdf ? 'Generating PDF…' : 'Export PDF'}
						</Button>
					{/if}
				</div>

				{#if reportSummary || reportScore !== null}
					<div>
						{#if reportSummary}
							<h3 class="text-sm font-semibold text-[var(--color-text)]">{reportSummary}</h3>
						{/if}
						{#if reportScore !== null}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">Score: {reportScore}/10</p>
						{/if}
					</div>
				{/if}

				{#if reportMarkdown}
					<pre
						class="text-sm leading-relaxed text-[var(--color-text)] whitespace-pre-wrap font-sans">{reportMarkdown}</pre>
				{/if}

				{#if reportFindings.length}
					<div>
						<h3 class="text-sm font-semibold text-[var(--color-text)] mb-3">
							Findings ({reportFindings.length})
						</h3>
						<ul class="space-y-2">
							{#each reportFindings as f, i (i)}
								{@const finding = asFinding(f)}
								<li
									class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-1.5"
								>
									{#if finding.raw !== null}
										<pre
											class="text-xs text-[var(--color-text-muted)] whitespace-pre-wrap font-mono">{finding.raw}</pre>
									{:else}
										<div class="flex items-start justify-between gap-2">
											<p class="text-sm font-semibold text-[var(--color-text)]">
												{finding.fields.title ?? 'Finding'}
											</p>
											{#if finding.fields.severity}
												<Pill tone={severityTone(finding.fields.severity)}>
													{finding.fields.severity}
												</Pill>
											{/if}
										</div>
										{#if finding.fields.category}
											<p class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
												{finding.fields.category}
											</p>
										{/if}
										{#if finding.fields.description}
											<p class="text-sm text-[var(--color-text)]">{finding.fields.description}</p>
										{/if}
										{#if finding.fields.recommendation}
											<p class="text-sm text-[var(--color-text-muted)]">
												<span class="font-medium text-[var(--color-text)]">Fix:</span>
												{finding.fields.recommendation}
											</p>
										{/if}
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if !reportMarkdown && reportFindings.length === 0}
					<StageOutputJson output={reportOutput} title="Raw output" />
				{/if}
			</section>
		{/if}

		<!-- ── Rubric review ── -->
		{#if reviewStage}
			<section
				class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:p-6 space-y-4"
				data-output-kind="review"
			>
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<svelte:element
						this={headingTag}
						class="text-base font-semibold text-[var(--color-text)]"
					>
						Review
					</svelte:element>
					{#if reviewOverall !== null}
						<span class="text-xs text-[var(--color-text-muted)]">
							overall {reviewOverall.toFixed(1)}/5
						</span>
					{/if}
				</div>

				{#if reviewSummary}
					<p class="text-sm text-[var(--color-text)] whitespace-pre-wrap">{reviewSummary}</p>
				{/if}

				{#if reviewItems.length}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#each reviewItems as item, i (i)}
							<div
								class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-2"
							>
								<div class="flex items-center justify-between gap-2">
									{#if item.criterion}
										<h3 class="text-sm font-semibold text-[var(--color-text)] capitalize">
											{item.criterion.replace(/_/g, ' ')}
										</h3>
									{/if}
									{#if typeof item.score === 'number'}
										<span class="text-xs text-[var(--color-text-muted)] shrink-0">
											{item.score}/5
										</span>
									{/if}
								</div>
								{#if item.rationale}
									<p class="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">
										{item.rationale}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<StageOutputJson output={reviewOutput} title="Raw output" />
				{/if}
			</section>
		{/if}
	</div>
{/if}

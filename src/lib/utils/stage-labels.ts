// Human-readable stage labels + a one-line output summary, shared by the run
// detail page widgets. The label map was previously triplicated (StageDetail,
// PipelineProgress, LiveProgressStoryboard) and silently missed every blueprint
// stage it didn't enumerate (promo_*, website_review_*, course_*, lesson_*) —
// those rendered as raw snake_case. Here a curated map covers the common stages
// and an automatic title-case fallback keeps unknown / future stages readable.

import { isVideoOutput, isAudioOutput, isCritiqueOutput, isReviewOutput } from './stage-output';

const STAGE_LABELS: Record<string, string> = {
	// shared / source
	source_ingest: 'Source Ingest',
	site_capture: 'Site Capture',
	media_discovery: 'Media Discovery',
	ingest: 'Document Ingest',
	crawl: 'Crawl',
	brand_extract: 'Brand Extract',
	ai_image_gen: 'AI Image Gen',
	ai_video_gen: 'AI Video Gen',
	growth_bundle: 'Growth Bundle',
	// promo
	promo_analyze: 'Promo Analyze',
	promo_script: 'Promo Script',
	promo_storyboard: 'Promo Storyboard',
	promo_visual_director: 'Promo Visual Director',
	promo_slides: 'Promo Slides',
	promo_html: 'Promo HTML',
	promo_narrate: 'Promo Narrate',
	promo_review: 'Promo Review',
	promo_render: 'Promo Render',
	// website review
	website_critique: 'Website Critique',
	website_redesign: 'Website Redesign',
	website_review_script: 'Website Review Script',
	website_review_record: 'Website Review Record',
	website_review_visual_director: 'Website Review Visual Director',
	website_review_slides: 'Website Review Slides',
	website_review_compile: 'Website Review Compile',
	// app review
	app_inspect: 'App Inspect',
	app_critique: 'App Critique',
	app_review_script: 'App Review Script',
	app_review_record: 'App Review Record',
	app_review_compile: 'App Review Compile',
	// course / lesson
	course_outline: 'Course Outline',
	course_compile_lessons: 'Compile Lessons',
	course_thumbnail: 'Course Thumbnail',
	course_stitch: 'Course Stitch',
	lesson_script: 'Lesson Script',
	lesson_slides: 'Lesson Slides',
	lesson_narrate: 'Lesson Narrate',
	lesson_record: 'Lesson Record',
	lesson_compile: 'Lesson Compile',
	// action reel (action_reel_v1) — `narrate` / `compile` are shared names, already
	// mapped below. The title-case fallback would render these readably anyway; they
	// are enumerated so the editorial gates read as decisions ("Cut Plan", not
	// "Cut_plan"-ish guesswork) in the pause UI.
	footage_probe: 'Footage Probe',
	shot_analysis: 'Shot Analysis',
	segment_select: 'Segment Select',
	music_select: 'Music Select',
	cut_plan: 'Cut Plan',
	graphics_design: 'Graphics Design',
	render_manifest: 'Render Manifest',
	// generic
	brief_intake: 'Brief Intake',
	script_draft: 'Script Draft',
	storyboard_draft: 'Storyboard Draft',
	narrate: 'Narrate',
	record: 'Record',
	compile: 'Compile'
};

/** Map a snake_case stage name to a display label; title-case unknown names. */
export function stageLabel(name: string): string {
	const known = STAGE_LABELS[name];
	if (known) return known;
	return name
		.split('_')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return '--';
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return `${m}m ${s}s`;
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

/**
 * A short, human one-liner describing what a stage produced — shown on the
 * collapsed inspector panel so the pipeline reads at a glance without expanding
 * every stage. Resolved by output SHAPE (reusing the run-output predicates) and
 * the common list keys, falling back to a field count.
 */
export function stageOutputSummary(output: Record<string, unknown> | null | undefined): string {
	if (!output || typeof output !== 'object') return '';
	const o = output as Record<string, unknown>;
	const dur = typeof o.duration_seconds === 'number' ? o.duration_seconds : null;

	if (isAudioOutput(o)) {
		const chapters = Array.isArray(o.chapters) ? o.chapters.length : 0;
		return chapters ? `audiobook · ${chapters} chapters` : 'audiobook';
	}
	if (isVideoOutput(o)) {
		return dur ? `video · ${formatDurationSeconds(dur)}` : 'video';
	}
	if (isCritiqueOutput(o)) {
		return `${(o.findings as unknown[]).length} findings`;
	}
	if (isReviewOutput(o)) {
		const n = (o.items as unknown[]).length;
		const overall = typeof o.overall_score === 'number' ? ` · ${o.overall_score}/5` : '';
		return `${n} criteria${overall}`;
	}

	// Common list-shaped outputs (scripts, slides, screens, chapters, visuals).
	for (const key of [
		'lines',
		'slides',
		'screens',
		'visuals',
		'chapters',
		'assignments',
		'sections'
	]) {
		if (isArr(o[key])) {
			const n = (o[key] as unknown[]).length;
			const total =
				key === 'lines' && typeof o.total_seconds === 'number'
					? ` · ${formatDurationSeconds(o.total_seconds)}`
					: '';
			return `${n} ${key}${total}`;
		}
	}

	const keys = Object.keys(o).length;
	return keys ? `${keys} field${keys === 1 ? '' : 's'}` : '';
}

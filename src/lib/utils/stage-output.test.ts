import { describe, it, expect } from 'vitest';
import type { RunDetail } from '$lib/types/runs';
import {
	isVideoStage,
	isCritiqueStage,
	isRedesignStage,
	isReviewStage,
	isAuditStage,
	findResultStage,
	runHasResult
} from './stage-output';

type StageOutput = NonNullable<RunDetail['stage_outputs']>[number];

function stage(
	stage_name: string,
	output: Record<string, unknown> | null,
	status: StageOutput['status'] = 'completed'
): StageOutput {
	return {
		id: `id-${stage_name}`,
		run_id: 'run-1',
		stage_name,
		status,
		output,
		error: null,
		started_at: null,
		completed_at: null,
		// `attempts` became REQUIRED when the OpenAPI pin moved to
		// 0.0.0-b6f96f8d (2026-08-27). It is not optional in the generated type, so
		// omitting it here is a compile error, not a lint nit. 0 = never retried,
		// which is what every fixture below means: these stages are constructed
		// directly, not replayed from a run that failed and was retried.
		attempts: 0,
		degraded: false
	};
}

function run(...stages: StageOutput[]): RunDetail {
	return { stage_outputs: stages } as RunDetail;
}

// The terminal video stage of every project type — the exact shape each
// blueprint's compile/render/stitch stage emits. This is THE regression guard:
// if a blueprint renames its terminal stage, detection still works (output
// shape is stable); if the output payload key changes, this test catches it.
const VIDEO_STAGE_BY_TYPE: Record<string, string> = {
	promo: 'promo_render',
	generic: 'video_render',
	lesson: 'lesson_compile',
	course: 'course_stitch',
	app_review: 'app_review_compile',
	website_review: 'website_review_compile'
};

describe('stage-output shape resolvers', () => {
	it.each(Object.entries(VIDEO_STAGE_BY_TYPE))(
		'%s: terminal stage %s (artifact_url) is detected as video',
		(_type, stageName) => {
			const s = stage(stageName, { artifact_url: 'minio://out.mp4', duration_seconds: 30 });
			expect(isVideoStage(s)).toBe(true);
			expect(runHasResult(run(s), isVideoStage)).toBe(true);
		}
	);

	it('also accepts a video_url key', () => {
		expect(isVideoStage(stage('x', { video_url: 'http://v/out.mp4' }))).toBe(true);
	});

	it('does not treat a bare url (critique target) as a video', () => {
		expect(isVideoStage(stage('website_critique', { url: 'https://example.com' }))).toBe(false);
	});

	it('critique findings → critique; redesign visuals/html → redesign; promo items → review', () => {
		expect(isCritiqueStage(stage('website_critique', { findings: [{ id: '1' }] }))).toBe(true);
		expect(isCritiqueStage(stage('app_critique', { findings: [{ id: '1' }] }))).toBe(true);
		expect(isRedesignStage(stage('website_redesign', { visuals: [{ image_url: 'x' }] }))).toBe(
			true
		);
		expect(isRedesignStage(stage('website_redesign', { redesigned_html_path: 'http://h' }))).toBe(
			true
		);
		expect(
			isReviewStage(stage('promo_review', { items: [{ criterion: 'a' }], overall_score: 4 }))
		).toBe(true);
	});

	it('matchers are disjoint enough: a critique is not a review and vice versa', () => {
		const critique = stage('website_critique', { findings: [{}], overall_score: 3 });
		const review = stage('promo_review', { items: [{}], overall_score: 4 });
		expect(isReviewStage(critique)).toBe(false); // no `items`
		expect(isCritiqueStage(review)).toBe(false); // no `findings`
	});

	it('audit scans match isAuditStage (seo groups / cro subsections + grade) and nothing else', () => {
		const seo = stage('seo_audit_scan', {
			grade: 'A',
			overall_score: 93,
			groups: [{ group: 'on_page', score: 90 }]
		});
		const cro = stage('cro_audit_scan', {
			grade: 'B',
			overall_score: 78,
			subsections: [{ section: 'hero', score: 80 }]
		});
		const marketing = stage('marketing_scorecard_scan', {
			grade: 'B',
			overall_score: 74,
			dimensions: [{ dimension: 'growth', score: 68 }]
		});
		expect(isAuditStage(seo)).toBe(true);
		expect(isAuditStage(cro)).toBe(true);
		expect(isAuditStage(marketing)).toBe(true); // dimensions[] is an audit shape too
		// Disjoint from the other matchers (no artifact_url / findings / visuals / items).
		expect(isVideoStage(seo)).toBe(false);
		expect(isCritiqueStage(seo)).toBe(false);
		expect(isReviewStage(seo)).toBe(false);
		// A promo review (items + overall_score, no grade/groups) is NOT an audit.
		expect(isAuditStage(stage('promo_review', { items: [{}], overall_score: 4 }))).toBe(false);
	});

	it('ignores stages that are not completed', () => {
		const running = stage('website_review_compile', { artifact_url: 'x' }, 'running');
		expect(runHasResult(run(running), isVideoStage)).toBe(false);
		expect(findResultStage(run(running), isVideoStage)).toBeNull();
	});

	it('findResultStage returns the LAST matching stage (terminal wins over fan-out)', () => {
		const perLesson = stage('course_compile_lessons', { artifact_url: 'a.mp4' });
		const stitched = stage('course_stitch', { artifact_url: 'final.mp4' });
		const found = findResultStage(run(perLesson, stitched), isVideoStage);
		expect(found?.stage_name).toBe('course_stitch');
	});

	it('runHasResult is false on an empty / output-less run', () => {
		expect(runHasResult(run(), isVideoStage)).toBe(false);
		expect(runHasResult(run(stage('brief_intake', null)), isVideoStage)).toBe(false);
	});
});

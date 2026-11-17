import { isAuditProjectType } from './audit-kind';
import type { RunDetail } from '$lib/types/runs';

export type StageOutput = NonNullable<RunDetail['stage_outputs']>[number];

/**
 * Predicate over a completed stage's output. Result viewers resolve their
 * stage by OUTPUT SHAPE, not by a hard-coded stage name: the per-type
 * blueprints emit different terminal stage names (promo_render, lesson_compile,
 * website_review_compile, course_stitch, …) but a produced video always carries
 * an `artifact_url`, a critique always carries `findings`, etc. Matching on the
 * payload keeps this layer correct across blueprint renames.
 */
export type StageMatcher = (stage: StageOutput) => boolean;

/**
 * The same predicate over a bare output payload.
 *
 * ⚠️ EVERY matcher below reads NOTHING but `stage.output`, so the payload form is
 * the primitive and the StageMatcher is derived from it via `onOutput`. Callers
 * that hold only a payload (stage-labels.ts `stageOutputSummary`, the renderer
 * registry) call the `*Output` form DIRECTLY. They used to fabricate
 * `({ output }) as unknown as StageOutput` — a cast that laundered an object
 * missing `id`/`run_id`/`stage_name`/`status` into the full row type, so the day
 * a matcher started reading any of those it would have read `undefined` with the
 * compiler asserting the field was present. Do not reintroduce that wrapper.
 */
export type OutputMatcher = (output: Record<string, unknown>) => boolean;

const onOutput =
	(match: OutputMatcher): StageMatcher =>
	(s) =>
		match(s.output ?? {});

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isArr = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/**
 * A produced audiobook: audiobook_stitch emits a `combined.artifact_url` plus a
 * `chapters[]` array of per-chapter audio. Checked BEFORE video because the
 * stitch output also carries a top-level `artifact_url` (the combined book) that
 * would otherwise match isVideoStage and route an MP3 into the <video> player.
 */
export const isAudioOutput: OutputMatcher = (o) => {
	const combined = (o.combined ?? {}) as Record<string, unknown>;
	const chapters = (o.chapters ?? []) as Array<Record<string, unknown>>;
	return isStr(combined.artifact_url) || (isArr(chapters) && isStr(chapters[0]?.artifact_url));
};
export const isAudioStage: StageMatcher = onOutput(isAudioOutput);

/** A produced video: any terminal compile/render/stitch stage with a playable URL. */
export const isVideoOutput: OutputMatcher = (o) =>
	(isStr(o.video_url) || isStr(o.artifact_url)) && !isAudioOutput(o);
export const isVideoStage: StageMatcher = onOutput(isVideoOutput);

/**
 * A critique report: app_critique / website_critique emit `findings`. Audit scans
 * (seo/cro/marketing `*_scan`) ALSO carry `findings[]` since orchestrator #1118, so
 * they are excluded explicitly — otherwise every audit run grew a second
 * "Critique report" repeating each finding under the scorecard hero.
 */
export const isCritiqueOutput: OutputMatcher = (o) =>
	isArr(o.findings) && !isAuditScorecardOutput(o);
export const isCritiqueStage: StageMatcher = onOutput(isCritiqueOutput);

/** A website redesign: website_redesign emits `visuals` and/or `redesigned_html_path`. */
export const isRedesignOutput: OutputMatcher = (o) =>
	isArr(o.visuals) || isStr(o.redesigned_html_path);
export const isRedesignStage: StageMatcher = onOutput(isRedesignOutput);

/** A rubric review: promo_review emits scored `items` plus an `overall_score`. */
export const isReviewOutput: OutputMatcher = (o) =>
	isArr(o.items) && typeof o.overall_score === 'number';
export const isReviewStage: StageMatcher = onOutput(isReviewOutput);

/**
 * A scorecard audit scan: emits a letter `grade` plus either its `project_type`
 * (new outputs) or a per-category breakdown (older outputs) —
 * seo_audit_scan carries `groups[]`, cro_audit_scan carries `subsections[]`,
 * marketing_scorecard_scan carries `dimensions[]`. NOT disjoint from the critique
 * matcher by shape: since orchestrator #1118 audit scans also carry `findings[]`,
 * so `isCritiqueOutput` excludes this predicate explicitly. Audits use
 * `groups`/`subsections`/`dimensions`, not review's `items`.
 *
 * This is the SINGLE predicate shared with the `audit-scorecard` renderer matcher
 * (registry.ts). They MUST agree: RunOutputPanel finds the audit stage with
 * `isAuditStage` but renders it via the registry matcher, so if the registry
 * matcher were stricter it could reject a stage RunOutputPanel already committed
 * to — hiding the hero + Download-PDF with no fallback.
 */
export const isAuditScorecardOutput: OutputMatcher = (o) =>
	isStr(o.grade) &&
	(isAuditProjectType(o.project_type) ||
		isArr(o.groups) ||
		isArr(o.subsections) ||
		isArr(o.dimensions));

export const isAuditStage: StageMatcher = onOutput(isAuditScorecardOutput);

/**
 * Last completed stage matching `match`. "Last" so that when several stages
 * carry a video (e.g. course_compile_lessons fans out per-lesson MP4s before
 * course_stitch produces the single final cut) the terminal one wins.
 */
export function findResultStage(run: RunDetail, match: StageMatcher): StageOutput | null {
	const matches = (run.stage_outputs ?? []).filter((s) => s.status === 'completed' && match(s));
	return matches.length > 0 ? matches[matches.length - 1] : null;
}

/** True if the run produced at least one stage matching `match`. */
export const runHasResult = (run: RunDetail, match: StageMatcher): boolean =>
	findResultStage(run, match) !== null;

// Per-type visibility of the create-wizard controls whose value only matters for
// SOME project types. One table instead of `type === … ||` checks scattered over
// the step components: a control is shown only where a pipeline stage reads it
// (ui-review 2026-10-17, X5 — controls nothing reads).
//
// Each `false` is a verified dead read in w2v_orchestrator:
//  - deliverableDuration: the audit chain (seo/cro/marketing scan + audit_video)
//    never reads deliverable.target_duration_seconds; web_design* and audiobook
//    have no duration; course lessons carry their own.
//  - kenBurns: only the shared compile tail reads brief.ken_burns; course/stitch.py
//    never does and buildLessonChildren does not propagate it.
//  - look (theme / resolution / video options): audiobook is audio-only — no
//    audiobook stage reads theme or resolution.
//  - verbatim: the wizard's Verbatim editor is promo-only (BriefForm).

import type { PickType } from './project-request';

export interface WizardControls {
	/** Deliverable "Target duration" — read as the ordered length of the video. */
	deliverableDuration: boolean;
	/** Ken Burns block (brief.ken_burns) — still images animated at compile. */
	kenBurns: boolean;
	/** Theme / resolution / video options ("Look" + Advanced theme sections). */
	look: boolean;
	/** Verbatim narration phrases editor. */
	verbatim: boolean;
}

const VIDEO: WizardControls = {
	deliverableDuration: true,
	kenBurns: false,
	look: true,
	verbatim: false
};
const AUDIT: WizardControls = {
	deliverableDuration: false,
	kenBurns: false,
	look: true,
	verbatim: false
};
const NONE: WizardControls = {
	deliverableDuration: false,
	kenBurns: false,
	look: false,
	verbatim: false
};

export const WIZARD_CONTROLS: Record<PickType, WizardControls> = {
	promo: { ...VIDEO, kenBurns: true, verbatim: true },
	generic: { ...VIDEO, kenBurns: true },
	app_review: VIDEO,
	website_review: VIDEO,
	demo_video: VIDEO,
	showcase: VIDEO,
	action_reel: VIDEO,
	course: { ...VIDEO, deliverableDuration: false },
	audiobook: NONE,
	web_design: NONE,
	web_design_v2: NONE,
	seo_audit: AUDIT,
	cro_audit: AUDIT,
	marketing_scorecard: NONE
};

/** The visibility row for `type`; unknown types (never pickable) show nothing optional. */
export function wizardControls(type: PickType): WizardControls {
	return WIZARD_CONTROLS[type] ?? NONE;
}

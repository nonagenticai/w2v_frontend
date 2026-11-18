// Master-detail Project workspace — section descriptor + per-type helpers.
//
// One workspace shell serves every project type (session 5 of the fr
// rearchitecture). The left nav lists these sections; the active one is held
// in the URL (`?section=`) so it's linkable and survives back/forward. The
// course variant swaps the Deliverables section for Lessons.
//
// The default (first) section deliberately carries the blueprint-stages
// preview + the per-deliverable run launchers, because the post-promote e2e
// specs (e2e/tests/pr*-run.spec.ts) assert the `<type>-home` testid, the
// blueprint `stage-row` count, and a clickable `start-run-btn` are all present
// on the initial /projects/[pid] load with no navigation.

import type { Component } from 'svelte';
import {
	Clapperboard,
	FileText,
	Film,
	GraduationCap,
	History,
	Quote,
	Sparkles
} from '@lucide/svelte';
import type { ProjectDetailResponse } from '$lib/types';

export type SectionId =
	'deliverables' | 'lessons' | 'brief' | 'verbatim' | 'storyboard' | 'outputs' | 'history';

// Types whose blueprints render from an authored storyboard (generic
// script_draft + demo_video gen short-circuit on brief.storyboard / the
// storyboard panels table). Only these surface the Storyboard section.
const STORYBOARD_TYPES = new Set(['generic', 'demo_video']);

// Types whose pipelines never read verbatim phrases: web_design / web_design_v2
// render a site (no narration) and a course's narration is authored per lesson
// child, not on the course parent. The tab would edit data nothing consumes
// (ui-review 2026-10-17). This is deliberately NOT the wizard's
// `wizardControls().verbatim` — that flag is "the create wizard shows its
// verbatim editor" (promo-only), while the workspace tab stays for every type
// whose narration stages can read the phrases.
const NO_VERBATIM_TYPES = new Set(['web_design', 'web_design_v2', 'course']);

/**
 * A demo_video with no recording package. For such a project, persisted
 * storyboard panels flip the run onto the authored path (orchestrator
 * run_setup folds them into brief.storyboard; demo_video gen then skips test
 * generation, and record has no package_url to play) — the result is a
 * narrated text-card video with no screen recording.
 */
export function demoVideoLacksRecording(
	project: Pick<ProjectDetailResponse, 'type' | 'brief'>
): boolean {
	if (project.type !== 'demo_video') return false;
	const pkg = (project.brief as Record<string, unknown> | null | undefined)?.package_url;
	return !(typeof pkg === 'string' && pkg.trim().length > 0);
}

export interface WorkspaceSection {
	id: SectionId;
	label: string;
	icon: Component<any>;
	/** Optional count badge (deliverables / lessons). */
	count?: number;
}

/**
 * The ordered section list for a project. Courses surface Lessons in place of
 * Deliverables (deliverable-config.feature @course); every type gets Brief,
 * Outputs and History, and Verbatim except where nothing reads it. The first entry is the default section —
 * History is appended last so the default never shifts (the post-promote e2e
 * specs assert testids/stage-rows on the default section's initial load).
 */
export function sectionsFor(project: ProjectDetailResponse): WorkspaceSection[] {
	const isCourse = project.type === 'course';
	const primary: WorkspaceSection = isCourse
		? { id: 'lessons', label: 'Lessons', icon: GraduationCap, count: project.children.length }
		: { id: 'deliverables', label: 'Deliverables', icon: Film, count: project.deliverables.length };
	return [
		primary,
		{ id: 'brief', label: 'Brief', icon: FileText },
		...(NO_VERBATIM_TYPES.has(project.type)
			? []
			: [{ id: 'verbatim' as const, label: 'Verbatim', icon: Quote }]),
		...(STORYBOARD_TYPES.has(project.type)
			? [{ id: 'storyboard' as const, label: 'Storyboard', icon: Clapperboard }]
			: []),
		{ id: 'outputs', label: 'Outputs', icon: Sparkles },
		{ id: 'history', label: 'History', icon: History }
	];
}

/**
 * Resolve the `?section=` query value to a section that exists for this
 * project. Unknown/missing → the default (first) section; a stale
 * `deliverables`↔`lessons` value from a link to a different project type
 * collapses to the default too.
 */
export function resolveSection(param: string | null, sections: WorkspaceSection[]): SectionId {
	const match = param ? sections.find((s) => s.id === param) : undefined;
	return match ? match.id : sections[0].id;
}

/**
 * Blueprint stage names for a project's home preview. Always the live
 * `/api/blueprints` list for the project's type (loaded by +page.ts and passed
 * in) — for EVERY type, including course/lesson/app_review.
 *
 * These used to be hard-coded per type "so the e2e stage-row counts hold", but
 * that froze the preview out of sync with the deployed blueprint: a course
 * promote grew the BE blueprint to 8 stages while the FE kept rendering a stale
 * 5, and the post-promote matrix caught it. The single source of truth is the
 * API the backend already serves; an empty list just hides the preview (see the
 * +page.ts loader), it never blocks the page.
 */
export function blueprintStagesFor(
	_project: ProjectDetailResponse,
	blueprintStages: string[]
): string[] {
	return blueprintStages;
}

/**
 * The legacy per-type home testid the e2e specs key on. course → course-home,
 * lesson → lesson-home, app_review → app-review-home, everything else (promo /
 * generic / website_review / audiobook) → promo-home.
 */
export function homeTestId(type: string): string {
	switch (type) {
		case 'course':
			return 'course-home';
		case 'lesson':
			return 'lesson-home';
		case 'app_review':
			return 'app-review-home';
		default:
			return 'promo-home';
	}
}

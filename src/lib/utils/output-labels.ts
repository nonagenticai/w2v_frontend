/**
 * Person-facing names for a finished run's deliverable.
 *
 * The output panel used to title every video "Demo Video" and download it as
 * `video.mp4` — for a promo, a course or a website review alike — so a person
 * who downloaded three runs got three indistinguishable `video.mp4` files.
 */

import type { ProjectType } from '$lib/types/api';

// Exhaustive over ProjectType: a new type fails the type check here instead of
// silently falling back to a generic title. Types whose deliverable is not a
// video (audits, design, audiobook) still get a sensible heading in case a run
// of theirs carries one.
const VIDEO_TITLES: Record<ProjectType, string> = {
	promo: 'Promo video',
	course: 'Course video',
	app_review: 'App review video',
	generic: 'Video',
	lesson: 'Lesson video',
	website_review: 'Website review video',
	audiobook: 'Audiobook video',
	web_design: 'Design walkthrough',
	web_design_v2: 'Design walkthrough',
	demo_video: 'Demo video',
	showcase: 'Showcase video',
	growth_bundle: 'Growth video',
	seo_audit: 'SEO audit video',
	cro_audit: 'CRO audit video',
	marketing_scorecard: 'Marketing scorecard video',
	action_reel: 'Action reel'
};

/** Heading for the video a run of this project type produced. */
export function videoTitleFor(projectType: string | null | undefined): string {
	return (projectType && VIDEO_TITLES[projectType as ProjectType]) || 'Video';
}

/**
 * A download-safe file stem from the project's name: lowercase, ASCII
 * letters/digits joined by single dashes, at most 60 characters. Falls back to
 * `video` when nothing usable is left (an all-emoji title, say).
 */
export function downloadBaseName(title: string | null | undefined): string {
	const stem = (title ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/g, '');
	return stem || 'video';
}

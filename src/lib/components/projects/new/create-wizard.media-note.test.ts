import { describe, it, expect, beforeEach } from 'vitest';
import { createWizard } from './create-wizard.svelte.js';

/**
 * The Find-media caption told website_review operators that pinned media "is
 * ingested but not shown on screen yet". That is FALSE: the compile stage
 * (`website_review/compile.py` `collect_real_media_urls` +
 * `assign_real_media_by_line`) overlays pinned / discovered real media onto the
 * full-page SCROLL fallback lines — so it IS on screen. Viewport screenshots
 * and reveal clips are protected and never displaced, which the copy must not
 * over-promise either.
 *
 * promo / generic composite it (no caveat at all) and the remaining
 * multi-source types genuinely only ingest it, so all three branches are pinned
 * here.
 */
describe('createWizard.pinnedMediaNote', () => {
	beforeEach(() => {
		createWizard.projectType = 'promo';
	});

	it('says nothing extra for promo and generic — the media is composited', () => {
		createWizard.projectType = 'promo';
		expect(createWizard.pinnedMediaNote).toBeNull();
		createWizard.projectType = 'generic';
		expect(createWizard.pinnedMediaNote).toBeNull();
	});

	it('tells website_review the media IS shown on screen', () => {
		createWizard.projectType = 'website_review';
		const note = createWizard.pinnedMediaNote!;
		expect(note).toContain('Shown on screen');
		// The retired claim must not come back for this type.
		expect(note).not.toContain('not shown on screen');
		// It replaces the scrolling fallback, and only that.
		expect(note).toContain('scrolling shots');
	});

	it('keeps the ingest-only caveat for the types that really do not render it', () => {
		createWizard.projectType = 'course';
		const note = createWizard.pinnedMediaNote!;
		expect(note).toContain('not shown on screen yet');
	});
});

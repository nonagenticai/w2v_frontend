import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ui-review 2026-10-17 wizard defects X2 / X4 / X6 + course lessons + step-rail
// gates, pinned on the state machine directly (the page-level flow lives in
// routes/projects/new/create-flow.test.ts).
const { removeMock, getMock, createDraftMock, updateMock } = vi.hoisted(() => ({
	removeMock: vi.fn(),
	getMock: vi.fn(),
	createDraftMock: vi.fn(),
	updateMock: vi.fn()
}));
vi.mock('$lib/api', () => ({
	projects: { remove: removeMock, get: getMock },
	uploads: { listVideoSources: vi.fn().mockResolvedValue({ items: [] }) },
	ApiError: class ApiError extends Error {}
}));
vi.mock('$lib/stores/projects.svelte.js', () => ({
	createDraft: createDraftMock,
	update: updateMock
}));

import { createWizard as cw, defaultDeliverablesFor } from './create-wizard.svelte.js';
import { wizard } from '$lib/stores/wizard.svelte.js';
import { buildProjectRequest } from '$lib/studio/project-request';
import { WIZARD_CONTROLS } from '$lib/studio/create-wizard-controls';

const KEY = 'w2v:create-wizard';

beforeEach(() => {
	vi.clearAllMocks();
	removeMock.mockResolvedValue(undefined);
	cw.reset();
	cw.clearPersisted();
	wizard.url = '';
});

describe('X2 — changing type after a draft exists', () => {
	it('drops the old-type draft (soft delete) and every type-specific piece of state', () => {
		cw.setProjectType('showcase');
		cw.projectId = 'old-draft';
		cw.draftProject = { id: 'old-draft' } as never;
		cw.brief = { package_url: 'pkg.zip', lines: [{ id: 'clip-1', text: 'hi', seconds: 2 }] };
		cw.showcaseMode = 'authored';
		cw.cast = [{ name: 'Mark', voice: 'am_adam' }];
		cw.clipRoster = ['clip-1'];
		cw.videoSources = [{ source_id: 's' } as never];
		cw.title = 'Kept';

		cw.setProjectType('demo_video');

		expect(removeMock).toHaveBeenCalledWith('old-draft');
		expect(cw.projectId).toBeNull();
		expect(cw.draftProject).toBeNull();
		expect(cw.brief).toEqual({});
		expect(cw.showcaseMode).toBe('generated');
		expect(cw.cast).toEqual([]);
		expect(cw.clipRoster).toEqual([]);
		expect(cw.videoSources).toEqual([]);
		expect(cw.title).toBe('Kept');
		// The submit therefore takes the CREATE path with the new type.
		const req = buildProjectRequest(cw.buildInput());
		expect(req.type).toBe('demo_video');
		expect(req.brief?.package_url).toBeUndefined();
		expect(req.brief?.lines).toBeUndefined();
	});

	it('re-selecting the same type is a no-op (no delete, state kept)', () => {
		cw.setProjectType('generic');
		cw.projectId = 'd1';
		cw.brief = { angle: 'x' };
		cw.setProjectType('generic');
		expect(removeMock).not.toHaveBeenCalled();
		expect(cw.projectId).toBe('d1');
		expect(cw.brief).toEqual({ angle: 'x' });
	});

	it('a URL typed for a single-source type does not leak into a type without that step', () => {
		cw.setProjectType('website_review');
		wizard.url = 'https://site.example';
		cw.setProjectType('promo');
		expect(buildProjectRequest(cw.buildInput()).brief?.source_url).toBeUndefined();
	});
});

describe('X4 — no hidden "60s 16:9" deliverable', () => {
	it.each(['marketing_scorecard', 'cro_audit', 'seo_audit', 'web_design'] as const)(
		'%s without video sends one non-video deliverable with no duration',
		(type) => {
			cw.setProjectType(type);
			const req = buildProjectRequest(cw.buildInput());
			expect(req.deliverables).toHaveLength(1);
			expect(req.deliverables[0].target_duration_seconds).toBeUndefined();
			expect(req.deliverables[0].name).not.toMatch(/60s/);
			expect(req.deliverables[0].captions_mode).toBe('none');
		}
	);

	it('critique-only website_review sends no video deliverable', () => {
		cw.setProjectType('website_review');
		const req = buildProjectRequest(cw.buildInput());
		expect(req.deliverables[0].name).toBe('Review report');
		expect(req.deliverables[0].target_duration_seconds).toBeUndefined();
	});

	it('cro_audit WITH video sends the edited deliverable but never a duration', () => {
		cw.setProjectType('cro_audit');
		cw.brief = { generate_video: true };
		cw.deliverables = [{ name: 'Walkthrough', format: '9x16', target_duration_seconds: 90 }];
		const req = buildProjectRequest(cw.buildInput());
		expect(req.deliverables).toEqual([{ name: 'Walkthrough', format: '9x16' }]);
	});

	it.each(['demo_video', 'showcase'] as const)(
		'%s orders NO length unless the operator types one',
		(type) => {
			cw.setProjectType(type);
			expect(defaultDeliverablesFor(type)[0].target_duration_seconds).toBeNull();
			let req = buildProjectRequest(cw.buildInput());
			expect(req.deliverables[0].target_duration_seconds ?? null).toBeNull();
			cw.deliverables = [{ ...cw.deliverables[0], target_duration_seconds: 45 }];
			req = buildProjectRequest(cw.buildInput());
			expect(req.deliverables[0].target_duration_seconds).toBe(45);
		}
	);

	it('promo keeps its editable 60s default', () => {
		const req = buildProjectRequest(cw.buildInput());
		expect(req.deliverables[0].target_duration_seconds).toBe(60);
	});
});

describe('X5 — one per-type visibility table', () => {
	it('hides controls nothing reads', () => {
		for (const t of ['seo_audit', 'cro_audit', 'marketing_scorecard'] as const) {
			expect(WIZARD_CONTROLS[t].deliverableDuration).toBe(false);
		}
		expect(WIZARD_CONTROLS.course.kenBurns).toBe(false);
		expect(WIZARD_CONTROLS.audiobook.look).toBe(false);
		expect(WIZARD_CONTROLS.web_design.verbatim).toBe(false);
		expect(WIZARD_CONTROLS.course.verbatim).toBe(false);
		expect(WIZARD_CONTROLS.promo.kenBurns).toBe(true);
	});
});

describe('step order + gates', () => {
	it.each([
		['promo', ['type', 'sources', 'brief', 'shotlist', 'review']],
		['generic', ['type', 'sources', 'brief', 'storyboard', 'review']]
	] as const)('%s: authoring steps come after the Brief', (type, steps) => {
		cw.setProjectType(type);
		expect(cw.steps).toEqual(steps);
	});

	it('the step rail cannot jump past website_review with no output selected', () => {
		cw.setProjectType('website_review');
		wizard.url = 'https://site.example';
		cw.generateCritique = false;
		cw.generateRedesign = false;
		cw.generateVideo = false;
		const review = cw.steps.indexOf('review');
		expect(cw.stepReachable(review)).toBe(false);
		cw.goToStep(review);
		expect(cw.stepIndex).toBe(0);
		cw.generateCritique = true;
		cw.title = 'T';
		expect(cw.stepReachable(review)).toBe(true);
	});

	it('course: a titled lesson with a 0 / blank / >60 minute duration blocks submit', () => {
		cw.setProjectType('course');
		cw.lessons = [{ title: 'Indexing', learning_objective: '', duration_minutes: 0 }];
		expect(cw.lessonsValid).toBe(false);
		cw.lessons = [
			{ title: 'Indexing', learning_objective: '', duration_minutes: null as unknown as number }
		];
		expect(cw.lessonsValid).toBe(false);
		cw.lessons = [{ title: 'Indexing', learning_objective: '', duration_minutes: 61 }];
		expect(cw.lessonsValid).toBe(false);
		cw.lessons = [{ title: 'Indexing', learning_objective: '', duration_minutes: 6 }];
		expect(cw.lessonsValid).toBe(true);
	});
});

describe('X6 — reload restores the whole wizard', () => {
	/** Write the snapshot, then re-create a "fresh page load" singleton state. */
	function reload() {
		cw.persist();
		const raw = sessionStorage.getItem(KEY);
		cw.reset();
		if (raw) sessionStorage.setItem(KEY, raw);
	}

	it('a non-draft wizard past the Type step survives a reload with sources, deliverables, lessons and settings', async () => {
		await cw.resume(null); // arms persistence
		cw.setProjectType('course');
		cw.stepIndex = 2;
		cw.title = 'Postgres';
		cw.brief = { audience: 'devs', outcome: 'run it' };
		cw.sources = [{ kind: 'url', ref: 'https://docs.example' } as never];
		cw.mediaDiscovery = true;
		cw.lessons = [{ title: 'Indexing', learning_objective: 'b-trees', duration_minutes: 8 }];
		cw.cloneFrom = 'p-old';
		wizard.voice = 'am_adam';
		wizard.resolution = '4k';
		reload();

		await cw.resume(cw.takePersisted());
		expect(getMock).not.toHaveBeenCalled(); // no draft to verify
		expect(cw.projectType).toBe('course');
		expect(cw.title).toBe('Postgres');
		expect(cw.brief).toEqual({ audience: 'devs', outcome: 'run it' });
		expect(cw.sources).toEqual([{ kind: 'url', ref: 'https://docs.example' }]);
		expect(cw.mediaDiscovery).toBe(true);
		expect(cw.lessons[0]).toMatchObject({ title: 'Indexing', duration_minutes: 8 });
		expect(cw.cloneFrom).toBe('p-old');
		expect(wizard.voice).toBe('am_adam');
		expect(wizard.resolution).toBe('4k');
		expect(cw.stepIndex).toBe(2);
	});

	it('restores showcase cast + clip roster and edited deliverables', async () => {
		await cw.resume(null);
		cw.setProjectType('showcase');
		cw.stepIndex = 1;
		cw.cast = [{ name: 'Lisa', voice: 'af_heart' }];
		cw.clipRoster = ['clip-1', 'clip-2'];
		cw.deliverables = [{ name: 'Vertical', format: '9x16', target_duration_seconds: 30 }];
		reload();
		await cw.resume(cw.takePersisted());
		expect(cw.cast).toEqual([{ name: 'Lisa', voice: 'af_heart' }]);
		expect(cw.clipRoster).toEqual(['clip-1', 'clip-2']);
		expect(cw.deliverables).toEqual([
			{ name: 'Vertical', format: '9x16', target_duration_seconds: 30 }
		]);
	});

	it('never resumes onto a step whose gate the restored state fails', async () => {
		await cw.resume(null);
		cw.setProjectType('web_design'); // type, brief, review
		cw.stepIndex = 2; // review, but the brief is empty (no title/description)
		reload();
		await cw.resume(cw.takePersisted());
		expect(cw.projectType).toBe('web_design');
		expect(cw.stepIndex).toBe(1); // back on the Brief, not Review
	});

	describe('ui-review 2026-10-18 — an abandoned wizard never comes back on a NEW visit', () => {
		/** Stub the document's Navigation Timing entry (jsdom has none). */
		function arrivedBy(type: NavigationTimingType, path = location.pathname) {
			vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
				{ type, name: new URL(path, location.origin).href } as PerformanceNavigationTiming
			]);
		}
		async function abandonAtStep2() {
			await cw.resume(null);
			cw.setProjectType('website_review');
			cw.stepIndex = 2;
			cw.title = 'Abandoned';
			reload(); // snapshot left behind, singleton pristine
		}
		afterEach(() => vi.restoreAllMocks());

		it('a fresh navigation (typed URL / link) starts clean and drops the stale snapshot', async () => {
			await abandonAtStep2();
			arrivedBy('navigate');
			await cw.resume(cw.takePersisted());
			expect(cw.stepIndex).toBe(0);
			expect(cw.projectType).toBe('promo');
			expect(cw.title).toBe('');
			expect(sessionStorage.getItem(KEY)).toBeNull();
		});

		it('a reload of a DIFFERENT page, then a visit to the wizard, starts clean', async () => {
			await abandonAtStep2();
			arrivedBy('reload', '/projects/some-other-page');
			await cw.resume(cw.takePersisted());
			expect(cw.stepIndex).toBe(0);
			expect(cw.title).toBe('');
		});

		it('a reload of the wizard page itself still resumes', async () => {
			await abandonAtStep2();
			arrivedBy('reload');
			await cw.resume(cw.takePersisted());
			expect(cw.projectType).toBe('website_review');
			expect(cw.title).toBe('Abandoned');
		});
	});

	it('a wizard still on the Type step persists nothing', async () => {
		await cw.resume(null);
		cw.setProjectType('promo');
		cw.persist();
		expect(sessionStorage.getItem(KEY)).toBeNull();
	});
});

describe('X3 — "Clone settings from" reaches the draft create', () => {
	it('sends clone_from_project_id on POST /projects/draft when a source is picked', async () => {
		createDraftMock.mockResolvedValue({ id: 'draft-1', brief: {} });
		updateMock.mockResolvedValue({});
		cw.setProjectType('action_reel');
		cw.cloneFrom = 'src-proj';
		await cw.ensureDraftProject();
		expect(createDraftMock).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'action_reel', clone_from_project_id: 'src-proj' })
		);
		expect(cw.projectId).toBe('draft-1');
	});

	it('omits it when no source is picked', async () => {
		createDraftMock.mockResolvedValue({ id: 'draft-2', brief: {} });
		cw.setProjectType('action_reel');
		await cw.ensureDraftProject();
		expect(createDraftMock.mock.calls[0][0]).not.toHaveProperty('clone_from_project_id');
	});

	it('a clone 404 on the draft create shows the clone-specific message', async () => {
		createDraftMock.mockRejectedValue({ status: 404, details: { code: 'clone_source_not_found' } });
		cw.setProjectType('action_reel');
		cw.cloneFrom = 'gone';
		await cw.ensureDraftProject();
		expect(cw.projectId).toBeNull();
		expect(cw.draftError).toMatch(/Clone settings from/);
	});
});

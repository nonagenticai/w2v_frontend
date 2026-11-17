import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the side-effecting edges; keep stores/utils real. Factories are hoisted,
// so the vi.fn()s are created inside them and imported back below.
vi.mock('$lib/api', () => ({
	runs: { start: vi.fn() },
	projects: { addChild: vi.fn(), addDeliverable: vi.fn(), get: vi.fn(), remove: vi.fn() },
	uploads: {
		document: vi.fn(),
		listVideoSources: vi.fn(),
		videoSourceAuto: vi.fn(),
		deleteVideoSource: vi.fn()
	},
	media: { search: vi.fn() },
	ApiError: class ApiError extends Error {}
}));
// Workspace defaults (P6 FE-1): rejected by default (an orchestrator without the
// route) so every flow below runs on the wizard's factory values; the prefill test
// resolves it.
const { defaultsGet } = vi.hoisted(() => ({ defaultsGet: vi.fn() }));
vi.mock('$lib/api/tenant-defaults.js', async () => {
	const actual: typeof import('$lib/api/tenant-defaults.js') = await vi.importActual(
		'$lib/api/tenant-defaults.js'
	);
	return { ...actual, tenantDefaults: { get: defaultsGet, put: vi.fn() } };
});
vi.mock('$lib/stores/projects.svelte.js', () => ({
	create: vi.fn(),
	createDraft: vi.fn(),
	update: vi.fn()
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn().mockResolvedValue(undefined),
	afterNavigate: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/projects/new') } }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
// Stub the two storyboard boards with dependency-free components so the wizard
// tests assert only the wiring (draft pre-create + which board renders), never
// the heavy storyboard-store / network internals of the real components.
vi.mock('$lib/components/workspace/sections/StoryboardSection.svelte', async () => ({
	default: (await import('$lib/test-stubs/StoryboardSectionStub.svelte')).default
}));
vi.mock('$lib/components/studio/storyboard/StoryboardBoard.svelte', async () => ({
	default: (await import('$lib/test-stubs/StoryboardBoardStub.svelte')).default
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterNavigate, goto } from '$app/navigation';
import { runs, projects, uploads, media } from '$lib/api';
import { create, createDraft, update } from '$lib/stores/projects.svelte.js';
import Page from './+page.svelte';
import { createWizard as cw } from '$lib/components/projects/new/create-wizard.svelte.js';
import { wizard } from '$lib/stores/wizard.svelte.js';
import { updateTheme } from '$lib/stores/settings.svelte.js';
import { buildProjectRequest } from '$lib/studio/project-request';
import { detailsFromBody } from '$lib/api/client.js';
import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';

const runsStart = vi.mocked(runs.start);
const addChild = vi.mocked(projects.addChild);
const addDeliverable = vi.mocked(projects.addDeliverable);
const uploadDoc = vi.mocked(uploads.document);
const projectsGet = vi.mocked(projects.get);
const listVideoSources = vi.mocked(uploads.listVideoSources);
const mediaSearch = vi.mocked(media.search);
const createMock = vi.mocked(create);
const createDraftMock = vi.mocked(createDraft);
const updateMock = vi.mocked(update);
// `resolve` is mocked as the identity above, so gotoMock receives the raw path.
const gotoMock = vi.mocked(goto);

function makeProject(type: string) {
	return {
		id: 'p-1',
		type,
		title: 'T',
		deliverables: [{ id: 'd-1', name: 'x', format: '16x9', captions_mode: 'none' }]
	} as never;
}

const props = { data: { cloneables: [] } } as never;

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const fill = (placeholder: string, value: string) =>
	fireEvent.input(screen.getByPlaceholderText(placeholder), { target: { value } });

beforeEach(() => {
	runsStart.mockReset();
	runsStart.mockResolvedValue({ id: 'run-1' } as never);
	addChild.mockReset();
	addChild.mockResolvedValue({ id: 'child-1' } as never);
	uploadDoc.mockReset();
	uploadDoc.mockResolvedValue({
		document_ref: 'documents/t/book.pdf',
		document_name: 'book.pdf',
		bytes: 10
	} as never);
	addDeliverable.mockReset();
	addDeliverable.mockResolvedValue({ id: 'd-1' } as never);
	createDraftMock.mockReset();
	updateMock.mockReset();
	updateMock.mockResolvedValue({ id: 'p-1' } as never);
	mediaSearch.mockReset();
	mediaSearch.mockResolvedValue({
		results: [
			{
				id: 'm1',
				title: 'A hero shot',
				url: 'https://img/hero.jpg',
				thumbnail_url: 'https://img/hero-t.jpg',
				media_type: 'image',
				source: 'unsplash',
				author_name: 'Jane',
				quality_score: 0.9
			}
		],
		total: 1,
		sources_queried: ['unsplash'],
		sources_failed: []
	} as never);
	createMock.mockReset();
	projectsGet.mockReset();
	listVideoSources.mockReset();
	listVideoSources.mockResolvedValue({ items: [] } as never);
	// mockClear, not mockReset: the resolved-undefined impl must survive so the
	// `await goto(...)` in submit() still awaits a promise.
	gotoMock.mockClear();
	// The wizard store is a module singleton shared by every test in this file;
	// clear it (and the recovery snapshot) so one test's draft can't be resumed
	// by the next one's mount.
	cw.reset();
	cw.clearPersisted();
	defaultsGet.mockReset();
	defaultsGet.mockRejectedValue(new Error('404 Not Found'));
});

describe('new project — type-aware wizard maps inputs to blueprint keys', () => {
	it('promo: multi-source step skipped (no sources); sends brief fields + voice_id and starts a run', async () => {
		createMock.mockResolvedValue(makeProject('promo'));
		render(Page, { props });
		await tick(); // onMount resets the wizard first

		// promo now uses the universal multi-source Sources step (websites + docs +
		// pinned media). Leaving it empty is valid → no sources, no source_url.
		await next(); // type -> sources
		expect(screen.queryByRole('button', { name: 'Add URL' })).not.toBeNull();
		await next(); // sources -> brief

		await fill('e.g. Launch promo', 'My promo');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await fill('The core offer and the pain it solves', 'ship faster');
		await fill('e.g. Start your free trial', 'Start free trial');
		await tick();

		await next(); // brief -> shotlist (promo; left empty — optional)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const req = createMock.mock.calls[0][0];
		const brief = req.brief as Record<string, unknown>;
		expect(req.type).toBe('promo');
		expect(brief.source_url).toBeUndefined();
		expect(brief.sources).toBeUndefined();
		expect(brief.value_proposition).toBe('ship faster');
		expect(brief.call_to_action).toBe('Start free trial');
		expect(brief.target_duration_seconds).toBe(60); // from the default deliverable
		expect((req.voice as Record<string, unknown>).voice_id).toBe('af_heart');

		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
		expect(runsStart.mock.calls[0][0]).toBe('d-1');
		expect(runsStart.mock.calls[0][1]).toEqual({});

		// The start-run exit lands on the run viewer — NOT on `?section=brief`.
		// Only the "Save draft" exit redirects to Brief (see the course test).
		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(gotoMock.mock.calls[0][0]).toBe('/projects/p-1/runs/run-1');
	});

	it('prefills the workspace default voice and leaves an unpicked captions mode to the server', async () => {
		defaultsGet.mockResolvedValue({
			version: 3,
			voice: { voice_id: 'bm_george', speed: 1.25 },
			brand: { primary_color: '#112233' },
			captions: { mode: 'burned_in' },
			deployment: {
				captions_mode: 'none',
				captions_karaoke: false,
				voice_direction_tone: 'confident',
				retention_mode: 'critique_only',
				timing_director_model_tier: null
			}
		});
		createMock.mockResolvedValue(makeProject('promo'));
		render(Page, { props });
		await tick();
		await waitFor(() => expect(wizard.voice).toBe('bm_george'));
		expect(wizard.narrationSpeed).toBe(1.25);
		expect(wizard.brandColor).toBe('#112233');
		expect(cw.defaultCaptionsMode).toBe('burned_in');

		await next(); // type -> sources
		await next(); // sources -> brief
		// The captions select offers the workspace default and starts on it.
		const captions = screen.getByLabelText('Captions') as HTMLSelectElement;
		expect(captions.value).toBe('');
		expect(captions.selectedOptions[0].textContent).toContain('Workspace default (Burned-in');
		await fill('e.g. Launch promo', 'My promo');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await fill('The core offer and the pain it solves', 'ship faster');
		await fill('e.g. Start your free trial', 'Start free trial');
		await tick();
		await next(); // brief -> shotlist (promo; left empty — optional)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const req = createMock.mock.calls[0][0];
		expect((req.voice as Record<string, unknown>).voice_id).toBe('bm_george');
		expect((req.voice as Record<string, unknown>).speed).toBe(1.25);
		expect(req.deliverables?.[0]).not.toHaveProperty('captions_mode');
	});

	it('promo: an added URL source → brief.sources[] + mirrored source_url (site_capture target)', async () => {
		createMock.mockResolvedValue(makeProject('promo'));
		render(Page, { props });
		await tick();

		await next(); // type -> sources
		await fireEvent.click(screen.getByRole('button', { name: 'Add URL' }));
		await tick();
		// Fill the new URL row. Title auto-defaults to the hostname on leaving Sources.
		await fill('https://example.com', 'https://w2v.nonagentic.ai');
		await tick();

		await next(); // sources -> brief
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await fill('The core offer and the pain it solves', 'ship faster');
		await fill('e.g. Start your free trial', 'Start free trial');
		await tick();

		await next(); // brief -> shotlist (promo; left empty — optional)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const brief = createMock.mock.calls[0][0].brief as Record<string, unknown>;
		expect(brief.source_url).toBe('https://w2v.nonagentic.ai');
		expect(brief.target_url).toBeUndefined();
		const srcs = brief.sources as Array<{ kind: string; ref: string }>;
		expect(srcs).toHaveLength(1);
		expect(srcs[0]).toMatchObject({ kind: 'url', ref: 'https://w2v.nonagentic.ai' });
	});

	it('promo: uploaded document + pinned media land in brief.sources; toggle sets media_discovery', async () => {
		createMock.mockResolvedValue(makeProject('promo'));
		render(Page, { props });
		await tick();

		await next(); // type -> sources

		// Upload a source document → uploads.document() → a `document` source.
		const file = new File(['%PDF body'], 'book.pdf', { type: 'application/pdf' });
		await fireEvent.change(screen.getByTestId('source-document-input'), {
			target: { files: [file] }
		});
		await waitFor(() => expect(uploadDoc).toHaveBeenCalledTimes(1));

		// Search media and pin the first result → a `media` source.
		await fireEvent.input(screen.getByTestId('media-search-input'), {
			target: { value: 'hero' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Find' }));
		await waitFor(() => expect(mediaSearch).toHaveBeenCalledTimes(1));
		await fireEvent.click(await screen.findByText('A hero shot'));

		// Enable pipeline auto media-discovery.
		await fireEvent.click(
			screen.getByLabelText('Also let the pipeline auto-discover extra media during the run')
		);
		await tick();

		await next(); // sources -> brief
		await fill('e.g. Launch promo', 'My promo');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await fill('The core offer and the pain it solves', 'ship faster');
		await fill('e.g. Start your free trial', 'Start free trial');
		await tick();

		await next(); // brief -> shotlist (promo; left empty — optional)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const brief = createMock.mock.calls[0][0].brief as Record<string, unknown>;
		const srcs = brief.sources as Array<{ kind: string; ref: string }>;
		expect(srcs.map((s) => s.kind).sort()).toEqual(['document', 'media']);
		expect(srcs.find((s) => s.kind === 'document')?.ref).toBe('documents/t/book.pdf');
		expect(srcs.find((s) => s.kind === 'media')?.ref).toBe('https://img/hero.jpg');
		expect(brief.media_discovery).toEqual({});
	});

	// app_review is a DORMANT / future project type (hidden 2026-06-03). It is blocked
	// from the wizard at three deliberate layers: excluded from CREATABLE_PROJECT_TYPES
	// (the ProjectTypePicker never renders its option) AND rejected by +page.svelte's
	// `?type=app_review` / `?mode=critique_only` deep-link (see the `requested !==
	// 'app_review'` guard). So the create wizard can no longer be DOM-driven to it, and
	// re-exposing that UI is explicitly out of scope. The URL→brief contract the wizard
	// SUBMITS is still real, so we assert it against the exact production builder the
	// wizard calls at submit — `buildProjectRequest(buildInput())` (+page.svelte line
	// ~439) — with an app_review-shaped input mirroring +page.svelte's buildInput().
	//
	// The required key is `brief.target_url` — verified against w2v_orchestrator
	// src/services/stages/app_review/inspect.py:111-113, which reads
	// `brief.get("target_url")` and raises "brief.target_url required for app_review".
	it('app_review: the submitted request writes the URL to brief.target_url (the key the inspect stage requires)', () => {
		// Mirror +page.svelte buildInput() for an app_review project: a urlToTargetUrl
		// type, so sourceUrl (wizard.url) is the inspection target and the deliverable's
		// duration is mirrored onto brief.duration_seconds (app_review's own duration key).
		const req = buildProjectRequest({
			type: 'app_review',
			title: 'T',
			titleHint: 'app.example.com',
			briefFields: { review_lens: 'onboarding UX', audience: 'product managers' },
			sourceUrl: 'https://app.example.com',
			deliverables: [
				{ name: 'x', format: '16x9', captions_mode: 'none', target_duration_seconds: 60 }
			],
			voice: { provider: 'kokoro', voice_id: 'af_heart', speed: 1 },
			brand: {},
			theme: { name: 'default' }
		});

		expect(req.type).toBe('app_review');
		const brief = req.brief as Record<string, unknown>;
		expect(brief.target_url).toBe('https://app.example.com');
		expect(brief.source_url).toBeUndefined();
		expect(brief.duration_seconds).toBe(60);
		expect((req.voice as Record<string, unknown>).voice_id).toBe('af_heart');
	});

	it('website_review (default): critique-only — only Source + Brief steps, no video config', async () => {
		createMock.mockResolvedValue(makeProject('website_review'));
		render(Page, { props });
		await tick();

		await fireEvent.click(screen.getByText(/Critique a website/));
		await tick();
		wizard.url = 'https://reviewme.com';
		await tick();

		await next(); // type -> source (the required Target URL)
		// The video opt-in defaults OFF → the fast critique path.
		expect(screen.getByTestId('generate-video-toggle')).not.toBeChecked();
		// With video off there is NO References (sources) step and NO shotlist step:
		// source -> brief directly. Confirm the grounding-sources UI is absent.
		await next(); // source -> brief
		expect(screen.queryByRole('button', { name: 'Add URL' })).toBeNull();

		await next(); // brief -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const brief = createMock.mock.calls[0][0].brief as Record<string, unknown>;
		expect(brief.target_url).toBe('https://reviewme.com');
		// Critique on by default; redesign + video off.
		expect(brief.generate_critique).toBe(true);
		expect(brief.generate_redesign).toBe(false);
		expect(brief.generate_video).toBe(false);
		// No video-only config leaks into a critique-only brief.
		expect(brief.sources).toBeUndefined();
		expect(brief.shotlist).toBeUndefined();
		expect(brief.source_url).toBeUndefined();
		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
	});

	it('website_review (redesign only): no video steps, brief.generate_redesign=true', async () => {
		createMock.mockResolvedValue(makeProject('website_review'));
		render(Page, { props });
		await tick();

		await fireEvent.click(screen.getByText(/Critique a website/));
		await tick();
		wizard.url = 'https://reviewme.com';
		await tick();

		await next(); // type -> source
		// Turn off critique, turn on redesign → redesign-only run.
		await fireEvent.click(screen.getByTestId('generate-critique-toggle'));
		await fireEvent.click(screen.getByTestId('generate-redesign-toggle'));
		await tick();
		// Redesign adds no wizard steps (it's not a video): source -> brief directly.
		await next(); // source -> brief
		expect(screen.queryByRole('button', { name: 'Add URL' })).toBeNull();

		await next(); // brief -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const brief = createMock.mock.calls[0][0].brief as Record<string, unknown>;
		expect(brief.generate_critique).toBe(false);
		expect(brief.generate_redesign).toBe(true);
		expect(brief.generate_video).toBe(false);
		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
	});

	it('website_review (video on): reveals the shotlist step + sends brief.generate_video=true', async () => {
		createMock.mockResolvedValue(makeProject('website_review'));
		render(Page, { props });
		await tick();

		await fireEvent.click(screen.getByText(/Critique a website/));
		await tick();
		wizard.url = 'https://reviewme.com';
		await tick();

		await next(); // type -> source
		// Opt into the narrated review video — this reveals the shotlist step.
		await fireEvent.click(screen.getByTestId('generate-video-toggle'));
		await tick();

		await next(); // source -> sources
		await next(); // sources -> brief
		await next(); // brief -> shotlist (now present because the video is on; left empty)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const brief = createMock.mock.calls[0][0].brief as Record<string, unknown>;
		expect(brief.target_url).toBe('https://reviewme.com');
		expect(brief.generate_video).toBe(true);
		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
	});

	it('web_design: Brief-only flow → brief.description, no source/deliverable steps', async () => {
		createMock.mockResolvedValue(makeProject('web_design'));
		render(Page, { props });
		await tick();

		await fireEvent.click(screen.getByText(/Describe a design/));
		await tick();

		// No Source step and no References — straight to Brief.
		await next(); // type -> brief
		expect(screen.queryByRole('button', { name: 'Add URL' })).toBeNull();
		await fill('e.g. Launch promo', 'Bakery site');
		await fireEvent.input(screen.getByPlaceholderText(/What is this page for/), {
			target: { value: 'A warm landing page for a neighbourhood bakery' }
		});
		await tick();

		await next(); // brief -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const req = createMock.mock.calls[0][0];
		expect(req.type).toBe('web_design');
		const brief = req.brief as Record<string, unknown>;
		expect(brief.description).toBe('A warm landing page for a neighbourhood bakery');
		expect(brief).not.toHaveProperty('generate_video');
		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
	});

	it('demo_video: Source (Target URL) → Brief → run, writes brief.target_url', async () => {
		createMock.mockResolvedValue(makeProject('demo_video'));
		render(Page, { props });
		await tick();

		await fireEvent.click(screen.getByText(/Auto-generate a narrated/));
		await tick();
		wizard.url = 'https://app.example.com';
		await tick();

		await next(); // type -> source (the required Target URL)
		// No website_review video toggles for demo_video; no References step.
		expect(screen.queryByTestId('generate-video-toggle')).toBeNull();
		await next(); // source -> brief
		expect(screen.queryByRole('button', { name: 'Add URL' })).toBeNull();

		await next(); // brief -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const req = createMock.mock.calls[0][0];
		expect(req.type).toBe('demo_video');
		const brief = req.brief as Record<string, unknown>;
		expect(brief.target_url).toBe('https://app.example.com');
		expect(brief.source_url).toBeUndefined();
		expect(brief).not.toHaveProperty('generate_video');
		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
	});

	it('course: collects lessons and creates each as a child (no run on Save draft)', async () => {
		createMock.mockResolvedValue(makeProject('course'));
		render(Page, { props });
		await tick();

		await fireEvent.click(screen.getByText('Course of multiple lessons, each a child project.'));
		await tick();

		// Course has no single-URL Source step (it owns lessons); it does have the
		// multi-source Sources step, which grounds the outline + every lesson.
		expect(screen.queryByText('Source')).toBeNull();

		await next(); // type -> sources
		await next(); // sources -> brief (no grounding added)
		await fill('e.g. Postgres for engineers', 'Postgres course');
		await fill('Who is this course for? Their level and goals', 'developers');
		await fill('What should learners be able to do after the course?', 'run Postgres in prod');
		await tick();

		await next(); // brief -> lessons
		await fill('e.g. Indexing strategies', 'Indexing');
		await tick();

		await next(); // lessons -> review
		await fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		const req = createMock.mock.calls[0][0];
		expect(req.type).toBe('course');
		expect(req.title).toBe('Postgres course');
		expect((req.brief as Record<string, unknown>).outcome).toBe('run Postgres in prod');
		expect(req.deliverables).toEqual([
			{ name: 'placeholder', format: '16x9', captions_mode: 'none' }
		]);

		await waitFor(() => expect(addChild).toHaveBeenCalledTimes(1));
		const [parentId, child] = addChild.mock.calls[0];
		expect(parentId).toBe('p-1');
		expect(child.type).toBe('lesson');
		expect(child.title).toBe('Indexing');
		expect(child.deliverables).toHaveLength(1);

		expect(runsStart).not.toHaveBeenCalled();

		// "Save draft" means the user declined to run, so the redirect must carry
		// the Brief section rather than fall through to the workspace default
		// (Deliverables, whose primary action is "Start run").
		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(gotoMock.mock.calls[0][0]).toBe('/projects/p-1?section=brief');
	});
});

describe('new project — "New project" clicked while already in the wizard', () => {
	type Nav = Parameters<Parameters<typeof afterNavigate>[0]>[0];
	const navigate = (type: string, fromPath: string) => {
		const cb = vi.mocked(afterNavigate).mock.calls.at(-1)![0];
		cb({
			type,
			from: { url: new URL(`http://localhost${fromPath}`) },
			to: { url: new URL('http://localhost/projects/new') }
		} as unknown as Nav);
	};

	it('a link from /projects/new to /projects/new starts a fresh wizard', async () => {
		render(Page, { props });
		await tick();
		cw.setProjectType('website_review');
		cw.title = 'Half done';
		cw.stepIndex = 2;
		cw.persist();

		navigate('link', '/projects/new');
		await tick();

		expect(cw.stepIndex).toBe(0);
		expect(cw.projectType).toBe('promo');
		expect(cw.title).toBe('');
		expect(sessionStorage.getItem('w2v:create-wizard')).toBeNull();
	});

	it('back/forward within the wizard route does not wipe it', async () => {
		render(Page, { props });
		await tick();
		cw.setProjectType('website_review');
		cw.stepIndex = 2;

		navigate('popstate', '/projects/new');
		await tick();

		expect(cw.projectType).toBe('website_review');
		expect(cw.stepIndex).toBe(2);
	});
});

describe('new project — deep links', () => {
	it('?type=growth_bundle (no wizard wiring) falls back to the picker instead of crashing', async () => {
		const { page } = await import('$app/state');
		const original = page.url;
		(page as { url: URL }).url = new URL('http://localhost/projects/new?type=growth_bundle');
		try {
			render(Page, { props });
			await tick();
			expect(cw.projectType).toBe('promo');
			expect(cw.currentStep).toBe('type');
		} finally {
			(page as { url: URL }).url = original;
		}
	});

	it('?type=demo_video starts with an unordered (no-duration) deliverable', async () => {
		const { page } = await import('$app/state');
		const original = page.url;
		(page as { url: URL }).url = new URL('http://localhost/projects/new?type=demo_video');
		try {
			render(Page, { props });
			await tick();
			expect(cw.projectType).toBe('demo_video');
			expect(cw.deliverables[0].target_duration_seconds).toBeNull();
		} finally {
			(page as { url: URL }).url = original;
		}
	});
});

describe('generic storyboard path — draft pre-create + finalize (gated on usesStoryboard)', () => {
	// Drive type -> sources -> brief -> storyboard for a generic project. The
	// Brief comes FIRST (ui-review X1): on reaching the storyboard step the wizard
	// pre-creates a `drafting` project via the store's createDraft (mocked), PATCHes
	// the typed brief onto it (so "Draft from brief" has a server brief), and
	// StoryboardStep renders the live StoryboardSection (stubbed) against it.
	async function reachStoryboard() {
		createDraftMock.mockResolvedValue({
			id: 'p-1',
			title: '',
			type: 'generic',
			deliverables: []
		} as never);
		render(Page, { props });
		await tick(); // onMount resets the wizard first
		await fireEvent.click(screen.getByText(/Long-form narrative/));
		await tick();
		await next(); // type -> sources
		await next(); // sources -> brief
		// generic requires angle + audience (+ title) to leave the Brief.
		await fill('e.g. Launch promo', 'My generic');
		await fill('e.g. explainer, announcement, deep-dive tutorial', 'explainer');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await tick();
		await next(); // brief -> storyboard
		await waitFor(() => expect(createDraftMock).toHaveBeenCalledTimes(1));
		await screen.findByTestId('storyboard-section-stub');
	}

	it('the storyboard step comes AFTER the brief (X1)', () => {
		cw.setProjectType('generic');
		expect(cw.steps).toEqual(['type', 'sources', 'brief', 'storyboard', 'review']);
	});

	it('reaching the storyboard step pre-creates a draft exactly once, PATCHes the brief onto it, and renders StoryboardSection', async () => {
		await reachStoryboard();
		expect(createDraftMock).toHaveBeenCalledTimes(1);
		expect(createDraftMock.mock.calls[0][0]).toMatchObject({ type: 'generic' });
		// The brief typed in the Brief step reaches the server draft BEFORE the
		// operator can click "Draft from brief" — the 422 the owner hit.
		await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
		expect(updateMock.mock.calls[0][0]).toBe('p-1');
		expect(updateMock.mock.calls[0][1].brief).toMatchObject({
			angle: 'explainer',
			audience: 'developers'
		});
		expect(cw.draftProject?.brief).toMatchObject({ angle: 'explainer' });
		expect(screen.queryByTestId('storyboard-section-stub')).not.toBeNull();
		// The in-memory fallback board is NOT rendered on the happy path.
		expect(screen.queryByTestId('storyboard-board-stub')).toBeNull();
		// Containment: no create-at-submit yet.
		expect(createMock).not.toHaveBeenCalled();
	});

	it('submit with a pre-created draft finalizes via update + addDeliverable + run (create NOT called)', async () => {
		await reachStoryboard();
		await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1)); // brief push

		await next(); // storyboard -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		// Finalize: PATCH the draft with the authored config.
		await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
		expect(updateMock.mock.calls[1][0]).toBe('p-1');
		const patch = updateMock.mock.calls[1][1];
		expect(patch.title).toBe('My generic');
		expect(patch.brief).toBeDefined();

		// Add the deliverable(s) to the existing draft.
		await waitFor(() => expect(addDeliverable).toHaveBeenCalledTimes(1));
		expect(addDeliverable.mock.calls[0][0]).toBe('p-1');

		// Start the run against the created deliverable.
		await waitFor(() => expect(runsStart).toHaveBeenCalledTimes(1));
		expect(runsStart.mock.calls[0][0]).toBe('d-1');

		// The create-at-submit path is never taken on the storyboard path.
		expect(createMock).not.toHaveBeenCalled();
	});

	it('finalize PATCH carries clone_from_project_id (the draft flow never POSTs /projects)', async () => {
		await reachStoryboard();
		await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1)); // brief push
		cw.cloneFrom = 'src-9';

		await next(); // storyboard -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
		expect(updateMock.mock.calls[1][1]).toMatchObject({ clone_from_project_id: 'src-9' });
		expect(createMock).not.toHaveBeenCalled();
	});

	it('promo (containment): still create-at-submit — no draft pre-create, no finalize PATCH', async () => {
		createMock.mockResolvedValue(makeProject('promo'));
		render(Page, { props });
		await tick();

		await next(); // type -> sources
		await next(); // sources -> brief
		await fill('e.g. Launch promo', 'My promo');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await fill('The core offer and the pain it solves', 'ship faster');
		await fill('e.g. Start your free trial', 'Start free trial');
		await tick();

		await next(); // brief -> shotlist (promo; left empty — optional)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));

		await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
		// The storyboard-only pre-create + finalize surface is untouched for promo.
		expect(createDraftMock).not.toHaveBeenCalled();
		expect(updateMock).not.toHaveBeenCalled();
		expect(addDeliverable).not.toHaveBeenCalled();
	});
});

// Two dead ends the operator could not escape without reloading the page — and
// the reload itself was the second one, because it orphaned the draft holding
// their already-uploaded footage. Both are action_reel (usesVideoSources), the
// only wizard path where the pre-created draft holds gigabytes.
describe('action_reel footage step — draft pre-create failure + reload recovery', () => {
	const CLIP = {
		source_id: 's-1',
		filename: 'drone.mp4',
		bytes: 1024,
		content_type: 'video/mp4',
		preview_status: 'ready'
	};
	const draft = { id: 'p-1', title: '', type: 'action_reel', deliverables: [] };

	/** Pick "Action reel" and step onto the Footage step, where the draft
	 *  pre-create effect fires. */
	async function reachFootage() {
		const view = render(Page, { props });
		await tick(); // onMount resets the wizard first
		await fireEvent.click(screen.getByText(/Cut your own footage/));
		await tick();
		await next(); // type -> source (Footage)
		await waitFor(() => expect(createDraftMock).toHaveBeenCalled());
		return view;
	}

	const retryButton = () => screen.getByRole('button', { name: 'Retry' });

	it('a failed pre-create surfaces the real reason with a Retry that unblocks the step', async () => {
		createDraftMock.mockRejectedValueOnce(new Error('502 Bad Gateway from projects'));
		await reachFootage();

		// The dead end: the effect keyed on `!projectId` cannot re-fire, and Next
		// is gated on >= 1 uploaded clip, so without a retry the only escape is a
		// reload.
		const alert = await screen.findByTestId('draft-create-error');
		expect(alert.textContent).toContain('502 Bad Gateway from projects');
		expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

		// Retry succeeds -> the draft exists, the error clears, and the clip the
		// uploader lists against it unblocks Next.
		createDraftMock.mockResolvedValueOnce(draft as never);
		listVideoSources.mockResolvedValue({ items: [CLIP] } as never);
		await fireEvent.click(retryButton());

		await waitFor(() => expect(createDraftMock).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.queryByTestId('draft-create-error')).toBeNull());
		await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
	});

	it('retry cannot create a second draft while one is in flight, nor after one succeeded', async () => {
		createDraftMock.mockRejectedValueOnce(new Error('boom'));
		await reachFootage();
		await screen.findByTestId('draft-create-error');
		expect(createDraftMock).toHaveBeenCalledTimes(1);

		// Two overlapping retries (impatient double-click / a re-fired effect):
		// the in-flight guard must collapse them into ONE POST.
		let release!: (v: unknown) => void;
		createDraftMock.mockImplementationOnce(
			() => new Promise((resolve) => (release = resolve)) as never
		);
		const first = cw.ensureDraftProject();
		const second = cw.ensureDraftProject();
		expect(createDraftMock).toHaveBeenCalledTimes(2); // 1 failure + 1 retry, not 3
		release(draft);
		await Promise.all([first, second]);
		expect(createDraftMock).toHaveBeenCalledTimes(2);

		// And once a draft exists, further retries are no-ops.
		await cw.ensureDraftProject();
		expect(createDraftMock).toHaveBeenCalledTimes(2);
		expect(cw.projectId).toBe('p-1');
	});

	it('a reload resumes the live draft with the already-uploaded clips still attached', async () => {
		createDraftMock.mockResolvedValue(draft as never);
		listVideoSources.mockResolvedValue({ items: [CLIP] } as never);
		const view = await reachFootage();
		await waitFor(() => expect(cw.videoSources).toHaveLength(1));
		await next(); // source -> brief; the operator gets this far, then hits F5
		expect(cw.stepIndex).toBe(2);

		// A reload re-evaluates the store module, so the singleton comes back at
		// its defaults while sessionStorage survives — reproduce exactly that.
		view.unmount();
		const persisted = sessionStorage.getItem('w2v:create-wizard');
		expect(persisted).not.toBeNull();
		cw.reset();
		sessionStorage.setItem('w2v:create-wizard', persisted as string);

		projectsGet.mockResolvedValue({ ...draft, status: 'drafting' } as never);
		createDraftMock.mockClear();
		render(Page, { props });
		await tick();

		// Resumed: same draft, same clips, same step — and NO second draft POST
		// (which is what silently abandoned the operator's gigabytes before).
		await waitFor(() => expect(cw.projectId).toBe('p-1'));
		expect(projectsGet).toHaveBeenCalledWith('p-1');
		expect(cw.videoSources.map((s) => s.source_id)).toEqual(['s-1']);
		expect(cw.projectType).toBe('action_reel');
		expect(cw.stepIndex).toBe(2);
		expect(createDraftMock).not.toHaveBeenCalled();
	});

	it('a reload whose draft no longer exists falls back to a clean wizard', async () => {
		createDraftMock.mockResolvedValue(draft as never);
		listVideoSources.mockResolvedValue({ items: [CLIP] } as never);
		const view = await reachFootage();
		await waitFor(() => expect(cw.videoSources).toHaveLength(1));

		view.unmount();
		const persisted = sessionStorage.getItem('w2v:create-wizard') as string;
		cw.reset();
		sessionStorage.setItem('w2v:create-wizard', persisted);

		// Deleted server-side, or owned by a tenant the operator no longer acts as.
		projectsGet.mockRejectedValue(new Error('404 Project not found'));
		createDraftMock.mockClear();
		render(Page, { props });
		await tick();
		await waitFor(() => expect(projectsGet).toHaveBeenCalledWith('p-1'));

		// Clean wizard on the type step — never a step pointed at a dead id.
		expect(cw.projectId).toBeNull();
		expect(cw.videoSources).toEqual([]);
		expect(cw.projectType).toBe('promo');
		expect(cw.stepIndex).toBe(0);
		expect(createDraftMock).not.toHaveBeenCalled();
	});

	it('a client-side navigation back into the wizard starts clean, not resumed', async () => {
		createDraftMock.mockResolvedValue(draft as never);
		listVideoSources.mockResolvedValue({ items: [CLIP] } as never);
		const view = await reachFootage();
		await waitFor(() => expect(cw.projectId).toBe('p-1'));

		// No reload: the singleton keeps the previous wizard's draft id, which is
		// how the store tells "new project" apart from "resume after F5".
		view.unmount();
		projectsGet.mockResolvedValue(draft as never);
		createDraftMock.mockClear();
		render(Page, { props });
		await tick();
		await tick();

		expect(projectsGet).not.toHaveBeenCalled();
		expect(cw.projectType).toBe('promo');
		expect(cw.stepIndex).toBe(0);
		expect(sessionStorage.getItem('w2v:create-wizard')).toBeNull();
	});
});

// w2v_orchestrator#1108: the start-run preflight refuses a byo_required tenant
// with a 402 whose body is a BARE `{detail: {...}}`. By then the project EXISTS,
// so the wizard must land on it (with the notice) rather than stay on a form whose
// retry would create a duplicate project.
describe('new project — start-run 402 byo_provider_required', () => {
	// The error exactly as the JSON client builds it from the bare-detail body.
	const startRefusal = (body: unknown) =>
		Object.assign(new Error('402 Payment Required'), {
			status: 402,
			detail: 'Configure your own TTS provider to continue',
			details: detailsFromBody(body)
		});
	const BYO_BODY = {
		detail: {
			code: 'byo_provider_required',
			modality: 'tts',
			message: 'Configure your own TTS provider to continue'
		}
	};

	async function createAndStartPromo() {
		createMock.mockResolvedValue(makeProject('promo'));
		render(Page, { props });
		await tick();
		await next(); // type -> sources
		await next(); // sources -> brief
		await fill('e.g. Launch promo', 'My promo');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await fill('The core offer and the pain it solves', 'ship faster');
		await fill('e.g. Start your free trial', 'Start free trial');
		await tick();
		await next(); // brief -> shotlist (promo; left empty — optional)
		await next(); // shotlist -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));
	}

	beforeEach(() => {
		vi.mocked(toastError).mockClear();
		vi.mocked(toastSuccess).mockClear();
	});

	it('lands on the CREATED project with ?byo_required=<modality>, no failure toast', async () => {
		runsStart.mockRejectedValue(startRefusal(BYO_BODY));
		await createAndStartPromo();
		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(gotoMock.mock.calls[0][0]).toBe('/projects/p-1?byo_required=tts');
		expect(createMock).toHaveBeenCalledTimes(1);
		expect(toastError).not.toHaveBeenCalled();
		expect(vi.mocked(toastSuccess).mock.calls[0][0]).toBe('Project created');
	});

	it('the #1150 multi-slot refusal carries EVERY slot to the project page', async () => {
		runsStart.mockRejectedValue(
			startRefusal({
				detail: {
					code: 'byo_provider_required',
					modality: 'llm',
					slots: 'llm,tts,image',
					message: 'Configure your own LLM, TTS and image providers to continue'
				}
			})
		);
		await createAndStartPromo();
		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(gotoMock.mock.calls[0][0]).toBe(
			`/projects/p-1?byo_required=${encodeURIComponent('llm,tts,image')}`
		);
		expect(toastError).not.toHaveBeenCalled();
	});

	it('the storyboard-draft finalize path lands on the draft project the same way', async () => {
		runsStart.mockRejectedValue(
			startRefusal({ detail: { ...BYO_BODY.detail, modality: 'image' } })
		);
		createDraftMock.mockResolvedValue({
			id: 'p-1',
			title: '',
			type: 'generic',
			deliverables: []
		} as never);
		render(Page, { props });
		await tick();
		await fireEvent.click(screen.getByText(/Long-form narrative/));
		await tick();
		await next(); // type -> sources
		await next(); // sources -> brief
		await fill('e.g. Launch promo', 'My generic');
		await fill('e.g. explainer, announcement, deep-dive tutorial', 'explainer');
		await fill('Who is this for? Their role, prior knowledge, motivation', 'developers');
		await tick();
		await next(); // brief -> storyboard
		await screen.findByTestId('storyboard-section-stub');
		await next(); // storyboard -> review
		await fireEvent.click(screen.getByRole('button', { name: /create & start run/i }));
		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(gotoMock.mock.calls[0][0]).toBe('/projects/p-1?byo_required=image');
		expect(toastError).not.toHaveBeenCalled();
	});

	it('a plain licence 402 keeps the existing failure path (toast, stays on the form)', async () => {
		runsStart.mockRejectedValue(startRefusal({ detail: 'Licence required' }));
		await createAndStartPromo();
		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		expect(vi.mocked(toastError).mock.calls[0][0]).toBe('Project creation failed');
		expect(gotoMock).not.toHaveBeenCalled();
	});
});

describe('video theme vs interface theme', () => {
	it('does NOT seed the video theme from the interface (UI) theme', async () => {
		// A dark-mode browser used to silently get a "dark" VIDEO default.
		updateTheme({ name: 'dark' });
		try {
			render(Page, { props });
			await tick();
			expect(wizard.theme).toBe('default');
		} finally {
			updateTheme({ name: 'default' });
		}
	});
});

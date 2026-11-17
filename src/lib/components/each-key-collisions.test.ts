import { describe, it, expect, vi } from 'vitest';

/*
 * REGRESSION — `each_key_duplicate` blanks a whole panel in PRODUCTION.
 *
 * Svelte THROWS `each_key_duplicate` when a keyed `{#each}` sees the same key
 * twice, and an uncaught throw during render tears down the whole component
 * tree, not just the offending list — the user sees a blank panel with no
 * error. Every block below was keyed on a value that is NOT unique in real
 * payloads:
 *
 *   • FeatureReviewPanel — keyed on raw LLM-authored feature NAMES. Two
 *     `missing_features` rows sharing a name with different `reason`s is
 *     completely normal model output.
 *   • FindingsList — keyed on `finding.finding_id`, while its sibling
 *     `BackendSecuritySection` writes `f.finding_id?.startsWith(...)` —
 *     admitting the field is absent at runtime, so every such row keys the
 *     same.
 *   • RunOutputPanel audio chapters — `(ch.id ?? i)` does NOT harden: `??`
 *     passes an EMPTY STRING straight through, so two `id: ''` chapters
 *     collide. The same payload's `AudiobookPlan` already guards with `str()`.
 *   • AssetEditor reference images — keyed on the URL from a stored,
 *     unfiltered array, so the same URL twice blanks the editor.
 *
 * These renders must not throw AND must render every row. The row count is the
 * load-bearing half: `withUniqueKeys` disambiguates rather than de-duplicates,
 * so a collision must still produce N rows, not N-1.
 */

vi.mock('$lib/services/keycloak.js', () => ({ ensureFreshToken: vi.fn() }));
vi.mock('$lib/api/downloads.js', () => ({ downloads: { auditReportPdf: vi.fn() } }));
vi.mock('$lib/stores/storyboard.svelte.js', () => ({
	createAsset: vi.fn().mockResolvedValue({}),
	updateAsset: vi.fn().mockResolvedValue({}),
	loadAssets: vi.fn().mockResolvedValue(undefined),
	getAssetList: () => [],
	deleteAsset: vi.fn().mockResolvedValue(undefined)
}));

import { render } from '@testing-library/svelte';
import FeatureReviewPanel from './reviews/FeatureReviewPanel.svelte';
import FindingsList from './critique/FindingsList.svelte';
import RunOutputPanel from './runs/RunOutputPanel.svelte';
import AssetEditor from './studio/storyboard/AssetEditor.svelte';
import ClipBeatEditor from './studio/ClipBeatEditor.svelte';
import SlideGallery from './runs/renderers/SlideGallery.svelte';
import type { CritiqueFinding, FeatureReview, StoryboardAssetResponse } from '$lib/types';
import type { RunDetail } from '$lib/types/runs';

describe('FeatureReviewPanel survives repeated LLM feature names', () => {
	// Same feature name twice in every list, with DIFFERENT bodies — the shape
	// the model actually emits.
	const review = {
		vertical: 'fintech',
		feature_completeness_score: 7,
		present_features: {
			core: { features: ['Export', 'Export', 'Search'], completeness: 'partial', notes: '' }
		},
		missing_features: [
			{ feature: 'Audit log', importance: 'high', reason: 'no tamper-evident trail' },
			{ feature: 'Audit log', importance: 'medium', reason: 'not surfaced in the UI' }
		],
		differentiators: [
			{ feature: 'Instant settle', impact: 'high', description: 'sub-second' },
			{ feature: 'Instant settle', impact: 'low', description: 'only on the paid tier' }
		],
		suggestions: [
			{ feature: 'SSO', priority: 'high', rationale: 'enterprise blocker' },
			{ feature: 'SSO', priority: 'low', rationale: 'SCIM can wait' }
		]
	} satisfies FeatureReview;

	it('renders BOTH rows of every duplicate-named list instead of blanking', () => {
		const { getAllByText, container } = render(FeatureReviewPanel, { props: { review } });

		// The panel rendered at all (a throw would leave the container empty).
		expect(container.textContent).toContain('fintech');
		// Both occurrences survive — disambiguated, not de-duplicated.
		expect(getAllByText('Export')).toHaveLength(2);
		expect(getAllByText('Audit log')).toHaveLength(2);
		expect(getAllByText('no tamper-evident trail')).toBeTruthy();
		expect(getAllByText('not surfaced in the UI')).toBeTruthy();
		expect(getAllByText('Instant settle')).toHaveLength(2);
		expect(getAllByText('SSO')).toHaveLength(2);
	});
});

describe('FindingsList survives findings without a finding_id', () => {
	function finding(over: Partial<CritiqueFinding>): CritiqueFinding {
		return {
			finding_id: 'f-1',
			category: 'security',
			severity: 'high',
			title: 'A finding',
			description: 'd',
			...over
		} as CritiqueFinding;
	}

	it('renders every card when finding_id is absent on more than one row', () => {
		// `BackendSecuritySection` writes `f.finding_id?.startsWith` — the optional
		// chain is the admission that this is absent at runtime. Two absent ids
		// used to key identically and blank the whole findings list.
		const findings = [
			finding({ finding_id: undefined as unknown as string, title: 'No id A' }),
			finding({ finding_id: undefined as unknown as string, title: 'No id B' }),
			finding({ finding_id: 'dup', title: 'Dup id A' }),
			finding({ finding_id: 'dup', title: 'Dup id B' })
		];
		const { getByText } = render(FindingsList, { props: { findings } });
		for (const t of ['No id A', 'No id B', 'Dup id A', 'Dup id B']) {
			expect(getByText(t)).toBeTruthy();
		}
	});
});

describe('RunOutputPanel survives audio chapters with empty/repeated ids', () => {
	it('renders every chapter when ids are empty strings', () => {
		// `(ch.id ?? i)` let `''` through: two chapters both keyed `''`.
		const run = {
			id: 'run-1',
			stage_outputs: [
				{
					id: 'so-1',
					run_id: 'run-1',
					stage_name: 'audiobook_stitch',
					status: 'completed',
					output: {
						combined: { artifact_url: 'https://x/book.mp3', total_seconds: 120 },
						chapters: [
							{ id: '', sequence: 1, title: 'Opening', seconds: 60 },
							{ id: '', sequence: 2, title: 'Closing', seconds: 60 }
						]
					},
					error: null,
					started_at: null,
					completed_at: null
				}
			]
		} as unknown as RunDetail;

		const { getByText, getByTestId } = render(RunOutputPanel, { props: { run } });
		expect(getByTestId('run-output-panel')).toBeTruthy();
		expect(getByText(/Opening/)).toBeTruthy();
		expect(getByText(/Closing/)).toBeTruthy();
	});
});

describe('AssetEditor survives a duplicated reference image URL', () => {
	it('renders a thumbnail per stored entry when the same URL appears twice', () => {
		const asset = {
			id: 'a1',
			kind: 'character',
			name: 'Hero',
			canonical_descriptor: 'a brave knight',
			reference_images: ['/api/media/ref-1.png', '/api/media/ref-1.png']
		} as unknown as StoryboardAssetResponse;

		const { container } = render(AssetEditor, {
			props: { asset, projectId: 'proj-1', onDone: () => {} } as never
		});
		expect(container.querySelectorAll('[data-testid="asset-reference-thumb"]')).toHaveLength(2);
	});
});

describe('ClipBeatEditor survives two cast rows sharing a name', () => {
	// The "Voice cast" rows and this editor render on the SAME wizard step
	// (BeatsStep.svelte), and `setName` writes raw input on every keystroke. So
	// the moment a user names a second role the same as the first — a rename, a
	// typo, a paste — `castRoles` held ['Mark','Mark'] and the keyed speaker
	// `{#each … (role)}` threw `each_key_duplicate` in a production build,
	// blanking the whole step mid-typing. Dev builds tolerate it, so this never
	// showed locally.
	it('renders ONE option per distinct role name, and does not throw', () => {
		const { container } = render(ClipBeatEditor, {
			props: {
				lines: [{ id: 'l1', speaker: 'Mark', text: 'hello', seconds: 2 }],
				clipRoster: [],
				cast: [
					{ name: 'Mark', voice: 'am_adam' },
					{ name: 'Mark', voice: 'am_michael' },
					{ name: 'Jess', voice: 'af_bella' }
				]
			} as never
		});

		const select = container.querySelector('[data-testid="beat-0-speaker"]');
		expect(select).toBeTruthy();
		const values = [...select!.querySelectorAll('option')].map((o) => o.textContent?.trim());
		// '— none —' plus exactly one 'Mark' and one 'Jess'. Two 'Mark' options
		// would set the same value anyway, so the duplicate was never meaningful.
		expect(values.filter((v) => v === 'Mark')).toHaveLength(1);
		expect(values.filter((v) => v === 'Jess')).toHaveLength(1);
	});

	// CONTROL: deduping must not collapse genuinely DISTINCT roles, and the
	// beat's own since-renamed speaker must still be offered.
	it('keeps every distinct role, including a speaker no longer in the cast', () => {
		const { container } = render(ClipBeatEditor, {
			props: {
				lines: [{ id: 'l1', speaker: 'Narrator', text: 'hello', seconds: 2 }],
				clipRoster: [],
				cast: [
					{ name: 'Mark', voice: 'am_adam' },
					{ name: 'Jess', voice: 'af_bella' }
				]
			} as never
		});

		const select = container.querySelector('[data-testid="beat-0-speaker"]');
		const values = [...select!.querySelectorAll('option')].map((o) => o.textContent?.trim());
		expect(values).toContain('Mark');
		expect(values).toContain('Jess');
		expect(values).toContain('Narrator');
	});
});

describe('SlideGallery survives two AI images with the same media id', () => {
	// `ai_image_gen` mints `id = deterministic_media_id(prompt, job_key, line_id)`
	// (w2v_orchestrator src/services/stages/generic/ai_image_gen.py:131) — content
	// addressed, with NO index term — and `_resolve_prompts` returns one
	// `(prompt, line_id)` pair per entry WITHOUT deduping, while `stage_gather`
	// emits one `GeneratedImage` per pair. So a repeated prompt on the same line
	// (normal LLM output from a `prompts_from_stage` stage, or the same string
	// twice in a static `cfg["prompts"]`) puts two images with an IDENTICAL id in
	// `output.images`, and the grid keyed `img-${im.id}` threw `each_key_duplicate`
	// — blanking the entire run page, not just this grid.
	it('renders BOTH tiles when two images share an id', () => {
		const output = {
			images: [
				{ id: 'sha-dup', line_id: 'line-1', image_url: '/api/media/a.png' },
				{ id: 'sha-dup', line_id: 'line-1', image_url: '/api/media/b.png' }
			]
		} as unknown as Record<string, unknown>;

		const { getByTestId, container } = render(SlideGallery, { props: { output } as never });
		expect(getByTestId('slide-gallery')).toBeTruthy();
		// Both survive — disambiguated, not de-duplicated. N rows, never N-1.
		expect(container.querySelectorAll('button[data-line-id="line-1"]')).toHaveLength(2);
	});
});

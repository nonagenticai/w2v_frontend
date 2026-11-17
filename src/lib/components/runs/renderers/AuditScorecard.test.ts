import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AuditScorecard from './AuditScorecard.svelte';

const marketing = {
	url: 'https://example.com',
	overall_score: 78,
	grade: 'C',
	llm_enriched: true,
	dimensions: [
		{ dimension: 'content', score: 90, weight: 0.25, count: 0, top_severity: 'info' },
		{ dimension: 'growth', score: 60, weight: 0.1, count: 2, top_severity: 'medium' }
	],
	quick_wins: [
		{
			check_id: 'mkt-growth-no-pricing-visibility',
			dimension: 'growth',
			title: 'No visible pricing',
			severity: 'medium'
		}
	],
	strategic: [
		{
			check_id: 'mkt-competitive-weak-differentiation',
			dimension: 'competitive',
			title: 'No differentiation claim',
			severity: 'high'
		}
	],
	llm_assessments: [
		{
			element: 'headline',
			dimension: 'content',
			score: 60,
			assessment: 'Weak',
			suggestion: 'Lead with value'
		}
	]
};

const seo = {
	url: 'https://example.com',
	overall_score: 84,
	grade: 'B',
	groups: [
		{ group: 'on_page', score: 90, weight: 0.22, count: 1, top_severity: 'low' },
		{ group: 'technical', score: 70, weight: 0.18, count: 2, top_severity: 'medium' }
	],
	quick_wins: [
		{
			check_id: 'seo-title-too-short',
			group: 'on_page',
			title: 'Title too short',
			severity: 'medium'
		}
	],
	strategic: []
};

const cro = {
	url: 'https://example.com',
	overall_score: 82,
	grade: 'A',
	llm_enriched: true,
	subsections: [{ section: 'hero', score: 90, weight: 0.18, count: 0, top_severity: 'info' }],
	quick_wins: [
		{ check_id: 'cro-cta-generic', section: 'cta', title: 'Generic CTA copy', severity: 'medium' }
	],
	strategic: [],
	llm_judgments: [
		{ element: 'headline', score: 55, assessment: 'Vague', suggestion: 'Be specific' }
	]
};

describe('AuditScorecard — one renderer, three scorecard shapes', () => {
	it('detects the marketing shape (dimensions[]) and renders its testid + AI assessments', () => {
		const { getByText, getByTestId } = render(AuditScorecard, { output: marketing });
		expect(getByTestId('marketing-scorecard')).toBeTruthy();
		expect(getByText('Go-to-market scorecard')).toBeTruthy();
		expect(getByText('C')).toBeTruthy();
		expect(getByText('No visible pricing')).toBeTruthy();
		expect(getByText('Lead with value', { exact: false })).toBeTruthy();
	});

	it('detects the SEO shape (groups[]) and renders its testid + title', () => {
		const { getByText, getByTestId } = render(AuditScorecard, { output: seo });
		expect(getByTestId('seo-audit-scorecard')).toBeTruthy();
		expect(getByText('Search & AI discoverability audit')).toBeTruthy();
		expect(getByText('Title too short')).toBeTruthy();
	});

	it('detects the CRO shape (subsections[]) and renders its testid + llm_judgments', () => {
		const { getByText, getByTestId } = render(AuditScorecard, { output: cro });
		expect(getByTestId('cro-audit-scorecard')).toBeTruthy();
		expect(getByText('Conversion audit')).toBeTruthy();
		expect(getByText('Be specific', { exact: false })).toBeTruthy();
	});

	it('does not crash on duplicate bucket / check_id / assessment keys', () => {
		const dup = {
			...marketing,
			dimensions: [
				{ dimension: 'content', score: 90, weight: 0.25, count: 1 },
				{ dimension: 'content', score: 30, weight: 0.25, count: 1 }
			],
			quick_wins: [
				{ check_id: 'dup', dimension: 'growth', title: 'First', severity: 'low' },
				{ check_id: 'dup', dimension: 'growth', title: 'Second', severity: 'low' }
			]
		};
		const { getByText } = render(AuditScorecard, { output: dup });
		expect(getByText('First')).toBeTruthy();
		expect(getByText('Second')).toBeTruthy();
	});

	it('renders the header on a partial payload without crashing', () => {
		const { getByText } = render(AuditScorecard, {
			output: { url: 'https://example.com', grade: 'A-' }
		});
		expect(getByText('A-')).toBeTruthy();
	});

	it('bar tone matches the displayed (rounded) score — a 79.6 shows 80 with a green bar', () => {
		const { container, getByText } = render(AuditScorecard, {
			output: {
				url: 'https://example.com',
				grade: 'B',
				dimensions: [{ dimension: 'content', score: 79.6, weight: 0.25, count: 1 }]
			}
		});
		expect(getByText('80')).toBeTruthy();
		expect(container.innerHTML).toContain('var(--color-success)');
		expect(container.innerHTML).not.toContain('var(--color-warning)');
	});
});

const enriched = {
	url: 'https://example.com',
	overall_score: 72,
	grade: 'B',
	llm_enriched: true,
	subsections: [{ section: 'hero', score: 60, weight: 0.2, count: 1 }],
	quick_wins: [
		{
			check_id: 'cro-hero-headline',
			section: 'hero',
			title: 'Weak hero headline',
			severity: 'high',
			rank: 1,
			recommendation: {
				fix_prose: 'Rewrite the H1 to lead with the core benefit.',
				rationale: 'The H1 anchors intent.',
				example: 'Ship videos 10x faster'
			}
		}
	],
	strategic: [],
	exec_summary: {
		summary: 'Strong base but the hero underperforms.',
		so_what: 'Fixing the hero is the highest-leverage win.',
		roadmap: ['cro-hero-headline']
	},
	projection: { baseline: 72, projected: 80, delta: 8, removed: ['cro-hero-headline'] },
	grounding: [{ check_id: 'cro-hero-headline', supported: true, evidence_ref: '<h1> found' }]
};

describe('AuditScorecard — enriched "great report" blocks (presence-gated)', () => {
	it('renders exec summary + roadmap-as-title + projection + prose + rank + grounded badge', () => {
		const { getByText, getByTestId, container } = render(AuditScorecard, { output: enriched });
		expect(getByTestId('audit-exec-summary')).toBeTruthy();
		expect(getByText('Strong base but the hero underperforms.')).toBeTruthy();
		expect(getByText('Do these first')).toBeTruthy();
		// the roadmap renders the finding TITLE, never the raw check_id
		expect(container.innerHTML).not.toContain('cro-hero-headline');
		expect(getByTestId('audit-projection')).toBeTruthy();
		expect(getByText('(+8 pts)', { exact: false })).toBeTruthy();
		expect(getByText('Rewrite the H1 to lead with the core benefit.')).toBeTruthy();
		expect(getByText('#1')).toBeTruthy();
		expect(getByText('grounded')).toBeTruthy();
	});

	it('renders NONE of the enriched blocks when absent (same as today)', () => {
		const { queryByTestId, queryByText } = render(AuditScorecard, { output: cro });
		expect(queryByTestId('audit-exec-summary')).toBeNull();
		expect(queryByTestId('audit-projection')).toBeNull();
		expect(queryByText('grounded')).toBeNull();
		expect(queryByText('Do these first')).toBeNull();
	});

	it('shows "unverified" (not "grounded") when the grounding verdict is unsupported', () => {
		const { getByText, queryByText } = render(AuditScorecard, {
			output: { ...enriched, grounding: [{ check_id: 'cro-hero-headline', supported: false }] }
		});
		expect(getByText('unverified')).toBeTruthy();
		expect(queryByText('grounded')).toBeNull();
	});

	it('hides the projection when it models no fixes (empty removed[] / all-zero)', () => {
		const { queryByTestId } = render(AuditScorecard, {
			output: { ...enriched, projection: { baseline: 0, projected: 0, delta: 0, removed: [] } }
		});
		expect(queryByTestId('audit-projection')).toBeNull();
	});

	it('renders a negative projection delta as "(-N pts)", never "(+-N pts)"', () => {
		const { getByText, queryByText } = render(AuditScorecard, {
			output: {
				...enriched,
				projection: { baseline: 80, projected: 75, delta: -5, removed: ['cro-hero-headline'] }
			}
		});
		expect(getByText('(-5 pts)', { exact: false })).toBeTruthy();
		expect(queryByText('(+-5 pts)', { exact: false })).toBeNull();
	});
});

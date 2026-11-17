import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AuditScorecard from './AuditScorecard.svelte';
import { aiStatusLine, auditProjectType } from '$lib/utils/audit-kind';
import { isAuditScorecardOutput } from '$lib/utils/stage-output';

// Real analysis_service responses (one per type × AI off / ok / failed), captured
// for the orchestrator audit-templates work. The orchestrator scan stage mirrors
// them into its output and adds `url` (from `source`) and `project_type`; do the
// same here so the renderer sees exactly what a new run's stage output carries.
import seoOff from './__fixtures__/audit/seo_audit_ai_off.json';
import seoOk from './__fixtures__/audit/seo_audit_ai_ok.json';
import seoFailed from './__fixtures__/audit/seo_audit_ai_failed.json';
import croOff from './__fixtures__/audit/cro_audit_ai_off.json';
import croOk from './__fixtures__/audit/cro_audit_ai_ok.json';
import mktOff from './__fixtures__/audit/marketing_scorecard_ai_off.json';
import mktFailed from './__fixtures__/audit/marketing_scorecard_ai_failed.json';

type Raw = Record<string, unknown> & { source?: string };
const asOutput = (raw: unknown, project_type: string) => {
	const r = raw as Raw;
	return { ...r, url: r.source, project_type };
};

const seo = asOutput(seoOff, 'seo_audit');
const cro = asOutput(croOff, 'cro_audit');
const mkt = asOutput(mktOff, 'marketing_scorecard');

describe('AuditScorecard — dispatch on project_type', () => {
	it('each type renders its own view: title, testid and signature section', () => {
		const a = render(AuditScorecard, { output: seo });
		expect(a.getByTestId('seo-audit-scorecard')).toBeTruthy();
		expect(a.getByTestId('audit-title').textContent).toBe('Search & AI discoverability audit');
		expect(a.container.querySelector('[data-section="serp-preview"]')).not.toBeNull();
		expect(a.getByText('Indexable')).toBeTruthy();
		expect(a.container.querySelector('[data-section="conversion-journey"]')).toBeNull();
		a.unmount();

		const b = render(AuditScorecard, { output: cro });
		expect(b.getByTestId('cro-audit-scorecard')).toBeTruthy();
		expect(b.getByTestId('audit-title').textContent).toBe('Conversion audit');
		const funnel = b.container.querySelector('[data-section="conversion-journey"]');
		expect(funnel?.querySelectorAll('li').length).toBe(6);
		expect(b.getByTestId('cro-experiments')).toBeTruthy();
		expect(b.container.querySelector('[data-section="serp-preview"]')).toBeNull();
		b.unmount();

		const c = render(AuditScorecard, { output: mkt });
		expect(c.getByTestId('marketing-scorecard')).toBeTruthy();
		expect(c.getByTestId('audit-title').textContent).toBe('Go-to-market scorecard');
		const weights = c.getByTestId('mkt-weights');
		expect(weights.textContent).toContain('See the SEO audit');
		expect(weights.textContent).toContain('See the CRO audit');
		expect(c.container.querySelector('[data-section="serp-preview"]')).toBeNull();
	});

	it('project_type wins over the breakdown arrays (no array sniffing for new outputs)', () => {
		// A CRO-typed output that happens to carry `groups` is still a CRO audit.
		expect(auditProjectType({ project_type: 'cro_audit', groups: [{}] })).toBe('cro_audit');
		const { getByTestId } = render(AuditScorecard, {
			output: { ...cro, groups: [{ group: 'x', score: 1, weight: 1 }] }
		});
		expect(getByTestId('cro-audit-scorecard')).toBeTruthy();
	});

	it('is matched by the shared audit predicate even with no breakdown array', () => {
		expect(isAuditScorecardOutput({ grade: 'B', project_type: 'seo_audit' })).toBe(true);
	});
});

describe('AuditScorecard — AI status line', () => {
	const statusOf = (output: unknown) => {
		const r = render(AuditScorecard, { output: output as Record<string, unknown> });
		const el = r.getByTestId('audit-ai-status');
		const out = { status: el.getAttribute('data-status'), text: el.textContent?.trim() };
		r.unmount();
		return out;
	};

	it('not requested (AI off)', () => {
		expect(statusOf(seo)).toEqual({
			status: 'not_requested',
			text: 'AI analysis: not requested'
		});
	});

	it('complete (AI on, healthy)', () => {
		expect(statusOf(asOutput(seoOk, 'seo_audit'))).toEqual({
			status: 'complete',
			text: 'AI analysis: complete'
		});
		expect(statusOf(asOutput(croOk, 'cro_audit')).status).toBe('complete');
	});

	it('unavailable names the reason (AI on, WM 401)', () => {
		const s = statusOf(asOutput(seoFailed, 'seo_audit'));
		expect(s.status).toBe('unavailable');
		expect(s.text).toMatch(/^AI analysis: unavailable: .*WM 401 Unauthorized/);
		expect(statusOf(asOutput(mktFailed, 'marketing_scorecard')).status).toBe('unavailable');
	});

	it('partial names the reason', () => {
		const partial = {
			...seo,
			ai: { requested: true, status: 'partial', reason: 'seo_eeat: timeout', layers: [] }
		};
		expect(statusOf(partial)).toEqual({
			status: 'partial',
			text: 'AI analysis: partial: seo_eeat: timeout'
		});
	});

	it('an unknown status is stated, never shown as success', () => {
		expect(aiStatusLine({ status: 'skipped', reason: 'no WM client' })).toEqual({
			status: 'skipped',
			text: 'AI analysis: skipped: no WM client',
			tone: 'warning'
		});
	});
});

describe('AuditScorecard — not measured is never a number', () => {
	it('a null-score bucket renders "Not measured — <reason>", with no bar and no 0/100', () => {
		// The real SEO fixture: groups[performance] has score null + measured false.
		const { getAllByTestId, container } = render(AuditScorecard, { output: seo });
		const notMeasured = getAllByTestId('audit-bucket-not-measured');
		expect(notMeasured).toHaveLength(1);
		expect(notMeasured[0].textContent).toMatch(
			/^Not measured — performance: not measured — no Lighthouse/
		);
		const row = notMeasured[0].parentElement!;
		expect(row.querySelector('.rounded-full')).toBeNull();
		expect(row.textContent).not.toMatch(/\b(0|100)\b/);
		expect(container.textContent).not.toContain('NaN');
	});

	it('a null score without a note still says not measured', () => {
		const { getByTestId } = render(AuditScorecard, {
			output: {
				...mkt,
				dimensions: [{ dimension: 'growth', score: null, weight: 0.1 }]
			}
		});
		expect(getByTestId('audit-bucket-not-measured').textContent).toBe(
			'Not measured — no data returned for this check'
		);
	});
});

describe('AuditScorecard — old run outputs still render', () => {
	it('an output without project_type / ai / facts renders via its breakdown key', () => {
		const old = {
			url: 'https://example.com',
			overall_score: 84,
			grade: 'B',
			groups: [{ group: 'on_page', score: 90, weight: 0.22, count: 1 }],
			quick_wins: [{ check_id: 'seo-title', group: 'on_page', title: 'Title too short' }],
			strategic: []
		};
		const { getByTestId, getByText, queryByTestId, container } = render(AuditScorecard, {
			output: old
		});
		expect(getByTestId('seo-audit-scorecard')).toBeTruthy();
		expect(getByText('Title too short')).toBeTruthy();
		expect(getByText('90')).toBeTruthy();
		// No ai block ⇒ no status line (not a guess); no facts ⇒ no signature section.
		expect(queryByTestId('audit-ai-status')).toBeNull();
		expect(container.querySelector('[data-section="serp-preview"]')).toBeNull();
	});
});

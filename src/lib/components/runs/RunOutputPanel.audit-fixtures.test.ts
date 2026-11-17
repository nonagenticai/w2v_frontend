import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/api/downloads.js', () => ({ downloads: { auditReportPdf: vi.fn() } }));

import { render } from '@testing-library/svelte';
import RunOutputPanel from './RunOutputPanel.svelte';
import type { RunDetail } from '$lib/types/runs';

// Every real analysis_service fixture (3 types × AI off / ok / failed), shaped as
// the orchestrator scan stage emits it (url + project_type added). Since
// orchestrator #1118 each carries `findings[]` — which the critique matcher used to
// claim, rendering a second "Critique report" under the scorecard.
const fixtures = import.meta.glob('./renderers/__fixtures__/audit/*.json', {
	eager: true,
	import: 'default'
}) as Record<string, Record<string, unknown>>;

const stageOf = (name: string, output: Record<string, unknown>) =>
	({
		stage_name: name,
		status: 'completed',
		output,
		started_at: null,
		completed_at: null
	}) as never;

const runOf = (...stage_outputs: unknown[]) =>
	({
		id: 'run-1',
		project_id: 'p-1',
		status: 'completed',
		stage_outputs
	}) as unknown as RunDetail;

const kinds = (container: HTMLElement) =>
	Array.from(container.querySelectorAll('[data-output-kind]')).map((el) =>
		el.getAttribute('data-output-kind')
	);

describe('RunOutputPanel — audit scans are never also a critique', () => {
	const entries = Object.entries(fixtures);

	it('has all 9 real fixtures', () => {
		expect(entries).toHaveLength(9);
	});

	for (const [path, raw] of entries) {
		const file = path.split('/').pop()!.replace('.json', '');
		const projectType = file.replace(/_ai_(off|ok|failed)$/, '');
		it(`${file}: exactly one audit section, no critique section`, () => {
			expect(Array.isArray(raw.findings) && (raw.findings as unknown[]).length).toBeTruthy();
			const output = { ...raw, url: raw.source, project_type: projectType };
			const { container, queryByText } = render(RunOutputPanel, {
				run: runOf(stageOf(`${projectType}_scan`, output))
			});
			expect(kinds(container)).toEqual(['audit']);
			expect(queryByText('Critique report')).toBeNull();
		});
	}

	it('a website_critique output (orchestrator WebsiteCritiqueOutput shape) still renders as a critique', () => {
		const { container, getByText } = render(RunOutputPanel, {
			run: runOf(
				stageOf('website_critique', {
					critique_job_id: 'job-1',
					url: 'https://example.com/pricing',
					overall_score: 71,
					summary: 'Solid page, weak CTA.',
					category_scores: { ux: 70, seo: 80 },
					findings: [
						{
							id: 'f1',
							category: 'ux',
							severity: 'high',
							title: 'No CTA above the fold',
							description: 'Visitors must scroll to act.',
							recommendation: 'Move the primary CTA into the hero.'
						}
					]
				})
			)
		});
		expect(kinds(container)).toEqual(['report']);
		expect(getByText('Critique report')).toBeTruthy();
		expect(getByText('No CTA above the fold')).toBeTruthy();
	});
});

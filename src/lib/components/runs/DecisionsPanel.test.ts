import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import DecisionsPanel from './DecisionsPanel.svelte';
import type { RunDetail } from '$lib/types/runs';

// Minimal RunDetail factory — the panel only reads `id` + `stage_outputs`, so we
// cast a partial shape rather than construct the full generated wire type.
function runWith(
	stages: Array<{ stage_name: string; status?: string; output: Record<string, unknown> }>
): RunDetail {
	return {
		id: 'run-1',
		stage_outputs: stages.map((s) => ({ status: 'completed', ...s }))
	} as unknown as RunDetail;
}

const HEADER = 'Editorial decisions';

describe('DecisionsPanel — surfaces decision-bearing stages by output shape', () => {
	// Each render lives in its OWN `it`: @testing-library/svelte bound queries are
	// document.body-scoped and cleanup runs between blocks, so two renders in one
	// test would leak the first render's DOM into the second's assertions.

	it('renders the header + manifest content for a render-manifest stage', () => {
		const run = runWith([
			{
				stage_name: 'render',
				output: {
					manifest: {
						master_seed: 42,
						override_ledger: [{ key: 'music.track', value: 'upbeat', source: 'default' }]
					}
				}
			}
		]);
		const { getByText, getByTestId } = render(DecisionsPanel, { run });
		expect(getByText(HEADER)).toBeTruthy();
		// The RenderManifestCard renderer (not a duplicate) is what draws the ledger.
		expect(getByTestId('ledger-row')).toBeTruthy();
		expect(getByText('music.track')).toBeTruthy();
	});

	it('renders the pacing timeline for an annotated-pacing stage', () => {
		const run = runWith([
			{
				stage_name: 'retention_plan',
				output: {
					lines: [
						{ id: 'L1', text: 'Ever wasted an afternoon on this?', seconds: 3, beat_role: 'hook' }
					]
				}
			}
		]);
		const { getByText, getByTestId } = render(DecisionsPanel, { run });
		expect(getByText(HEADER)).toBeTruthy();
		// The ScriptPacingTimeline renderer draws the annotated line.
		expect(getByTestId('script-pacing-timeline')).toBeTruthy();
		expect(getByText('Ever wasted an afternoon on this?')).toBeTruthy();
	});

	it('renders NOTHING when no stage carries a decision payload', () => {
		const run = runWith([
			// A plain script (no annotations) resolves to `script`, not `script-pacing`.
			{
				stage_name: 'script_generation',
				output: { lines: [{ text: 'Plain line, no decisions.' }] }
			},
			// Unrelated scalar output.
			{ stage_name: 'ingest', output: { status: 'ok' } }
		]);
		const { queryByText, queryByTestId } = render(DecisionsPanel, { run });
		expect(queryByText(HEADER)).toBeNull();
		expect(queryByTestId('decisions-panel')).toBeNull();
	});
});

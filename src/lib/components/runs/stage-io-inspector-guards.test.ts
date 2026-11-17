import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import StageIOInspector from './StageIOInspector.svelte';
import type { StageExecutionResponse } from '$lib/types';

// Regression: when a run fails to load (foreign-tenant 404), array/map inputs
// arrive undefined and used to crash with "Cannot read properties of undefined
// (reading 'get')" (dependsOn.get) / "(reading 'map')" (outputs.map).
//
// ⚠️ `stages` MUST be non-empty. `outputByStage`/`degradedByStage`/`usageByStage`
// are `$derived` and `dependsOn.get(...)` lives inside the per-stage snippet, so
// with an empty stage list NOTHING reads them and the render cannot fail however
// the defaults are broken. Measured 2026-09-05: with `stages: []`, deleting BOTH
// `outputs = []` and `dependsOn = new Map()` from the props destructure still
// passed — the guard was vacuous. One rendered stage row is what makes it real.
const STAGE: StageExecutionResponse = {
	stage_name: 'script',
	status: 'completed',
	service_name: null,
	service_job_id: null,
	duration_seconds: 1,
	retry_count: 0,
	error: null
};

describe('StageIOInspector tolerates missing array/map inputs', () => {
	it('renders a stage row when every optional data prop is omitted', () => {
		const { container } = render(StageIOInspector, {
			props: { stages: [STAGE], usage: null }
		});
		// The row actually rendered — a component that silently rendered nothing
		// would satisfy "did not throw" while proving nothing about the defaults.
		expect(container.textContent).toMatch(/Script\b.*Completed/is);
	});

	it('renders when dependsOn/outputs are EXPLICITLY undefined', () => {
		const { container } = render(StageIOInspector, {
			props: {
				stages: [STAGE],
				outputs: undefined,
				config: undefined,
				dependsOn: undefined,
				usage: null
			}
		});
		expect(container.textContent).toMatch(/Script\b.*Completed/is);
	});
});

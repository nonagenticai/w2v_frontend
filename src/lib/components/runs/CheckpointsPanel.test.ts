import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CheckpointsPanel from './CheckpointsPanel.svelte';

// A finished run can no longer pause and the backend 409s every checkpoint
// PATCH on it. The panel used to stay editable, so each toggle produced an
// error toast and a rollback.
describe('CheckpointsPanel — terminal runs', () => {
	const base = {
		value: ['script'],
		availableStages: ['script', 'render'],
		presets: [{ label: 'None', stages: [] }],
		onChange: vi.fn()
	};

	it('disables editing and says why when readOnly', () => {
		const { getByTestId, container } = render(CheckpointsPanel, {
			props: { ...base, readOnly: true }
		});
		expect(getByTestId('checkpoints-read-only')).toBeInTheDocument();
		const controls = container.querySelectorAll('button, input');
		expect(controls.length).toBeGreaterThan(0);
		for (const el of controls) expect((el as HTMLButtonElement).disabled).toBe(true);
	});

	it('stays editable for a live run', () => {
		const { queryByTestId } = render(CheckpointsPanel, { props: { ...base } });
		expect(queryByTestId('checkpoints-read-only')).toBeNull();
	});
});

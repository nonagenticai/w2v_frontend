import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ScriptPacingTimeline from './ScriptPacingTimeline.svelte';

const annotated = {
	lines: [
		{
			id: 'L1',
			text: 'Ever wasted a whole afternoon on this?',
			speaker: 'a',
			seconds: 4,
			beat_role: 'hook',
			hook_role: 'question',
			clip_anchor: 'start',
			pin_position: 1,
			doctor_note: 'Tightened to land the hook in the first 3 seconds.'
		},
		{ id: 'L2', text: 'Here is the fix.', speaker: 'a', seconds: 2, beat_role: 'build' },
		{ id: 'L3', text: 'Ship it today.', speaker: 'a', seconds: 3 }
	]
};

describe('ScriptPacingTimeline — annotated pacing timeline', () => {
	it('renders every line', () => {
		const { getAllByTestId } = render(ScriptPacingTimeline, { output: annotated });
		expect(getAllByTestId('pacing-line')).toHaveLength(3);
	});

	it('shows a cold-open marker ONLY on lines with clip_anchor / pin_position', () => {
		const { getAllByTestId } = render(ScriptPacingTimeline, { output: annotated });
		const markers = getAllByTestId('cold-open-marker');
		expect(markers).toHaveLength(1);
		expect(markers[0].textContent).toContain('anchored to start');
	});

	it('shows a script-doctor note chip ONLY where doctor_note is present', () => {
		const { getAllByTestId } = render(ScriptPacingTimeline, { output: annotated });
		const notes = getAllByTestId('doctor-note');
		expect(notes).toHaveLength(1);
		expect(notes[0].textContent).toContain('Tightened to land the hook');
	});

	it('renders beat/hook badges when present', () => {
		const { getByText } = render(ScriptPacingTimeline, { output: annotated });
		expect(getByText('hook')).toBeTruthy();
		expect(getByText('question')).toBeTruthy();
		expect(getByText('build')).toBeTruthy();
	});

	it('summarizes total runtime and line count', () => {
		const { getByText } = render(ScriptPacingTimeline, { output: annotated });
		expect(getByText('3 lines')).toBeTruthy();
	});

	it('degrades gracefully for lines with no annotations (text + bar only)', () => {
		const { getAllByTestId, queryAllByTestId, getByText } = render(ScriptPacingTimeline, {
			output: { lines: [{ text: 'Plain line, no decisions.', seconds: 5 }] }
		});
		expect(getAllByTestId('pacing-line')).toHaveLength(1);
		expect(queryAllByTestId('cold-open-marker')).toHaveLength(0);
		expect(queryAllByTestId('doctor-note')).toHaveLength(0);
		expect(getByText('Plain line, no decisions.')).toBeTruthy();
	});

	it('marks a cold open from pin_position alone (no clip_anchor)', () => {
		const { getAllByTestId } = render(ScriptPacingTimeline, {
			output: { lines: [{ text: 'Open here.', seconds: 2, pin_position: 0 }] }
		});
		const markers = getAllByTestId('cold-open-marker');
		expect(markers).toHaveLength(1);
		expect(markers[0].textContent).toContain('pin 0');
	});
});

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SyllabusEditor from './SyllabusEditor.svelte';
import { createReactiveBriefStore } from './__fixtures__/reactive-brief.svelte';

describe('SyllabusEditor', () => {
	it('disables Save until brief differs from props', async () => {
		const onSave = vi.fn();
		const { container, getByText } = render(SyllabusEditor, {
			props: { brief: { audience: 'devs' }, onSave }
		});
		const saveBtn = getByText('Save syllabus').closest('button');
		expect(saveBtn).toBeTruthy();
		expect(saveBtn?.disabled).toBe(true);

		const ta = container.querySelector('textarea');
		expect(ta).not.toBeNull();
		await fireEvent.input(ta!, { target: { value: 'engineers' } });

		const saveBtn2 = getByText('Save syllabus').closest('button');
		expect(saveBtn2?.disabled).toBe(false);
	});

	it('shows no topic-outline editor (nothing on the backend reads brief.outline)', () => {
		const { queryByText } = render(SyllabusEditor, {
			props: { brief: { audience: '', outline: ['kept'] } }
		});
		expect(queryByText('Add topic')).toBeNull();
		expect(queryByText('Outline')).toBeNull();
	});

	it('preserves an existing brief.outline on save', async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		const { container, getByText } = render(SyllabusEditor, {
			props: { brief: { audience: 'devs', outline: ['a', 'b'] }, onSave }
		});
		await fireEvent.input(container.querySelector('textarea')!, { target: { value: 'eng' } });
		await fireEvent.click(getByText('Save syllabus').closest('button')!);
		expect(onSave.mock.calls[0][0]).toMatchObject({ audience: 'eng', outline: ['a', 'b'] });
	});

	it('forwards Save with the edited brief payload', async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		const { container, getByText } = render(SyllabusEditor, {
			props: { brief: { audience: 'devs' }, onSave }
		});
		const ta = container.querySelector('textarea')!;
		await fireEvent.input(ta, { target: { value: 'engineers' } });
		const saveBtn = getByText('Save syllabus').closest('button')!;
		await fireEvent.click(saveBtn);
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0][0]).toMatchObject({ audience: 'engineers' });
	});

	// Regression: prior to 2026-05-20, line 18 ran structuredClone(brief),
	// which threw DataCloneError when brief was a Svelte 5 deep-reactive
	// proxy (real provenance: projects.svelte.ts byId is $state<...>). Every
	// course-project detail page broke. Fixed by switching to $state.snapshot.
	// This test sources brief from a $state container so a reintroduction of
	// structuredClone trips here instead of in prod.
	it('mounts without DataCloneError when brief is sourced from a $state proxy', () => {
		const store = createReactiveBriefStore({ audience: 'devs', outline: [] });
		expect(() => render(SyllabusEditor, { props: { brief: store.brief } })).not.toThrow();
	});
});

// The wizard writes `outcome` and the course outline stage reads `outcome`;
// this editor used to read/write `learning_outcome`, so every wizard-made
// course showed a blank outcome and edits were ignored by the run.
describe('SyllabusEditor — outcome key', () => {
	it('shows the wizard-written `outcome`', () => {
		const { container } = render(SyllabusEditor, {
			props: { brief: { audience: 'devs', outcome: 'Ship a feature' } }
		});
		const input = container.querySelector('input[type="text"]') as HTMLInputElement;
		expect(input.value).toBe('Ship a feature');
	});

	it('saves the edit under `outcome` and drops the legacy key', async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		const { container, getByText } = render(SyllabusEditor, {
			props: { brief: { audience: 'devs', learning_outcome: 'old' }, onSave }
		});
		const input = container.querySelector('input[type="text"]') as HTMLInputElement;
		expect(input.value).toBe('old');
		await fireEvent.input(input, { target: { value: 'new outcome' } });
		await fireEvent.click(getByText('Save syllabus').closest('button')!);
		expect(onSave).toHaveBeenCalledWith({ audience: 'devs', outcome: 'new outcome' });
	});
});

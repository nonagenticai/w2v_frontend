import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import FieldsSection from './FieldsSection.svelte';

// FieldsSection's own contract comment states the invariant: "Each field maps to
// a brief key the type's blueprint actually reads". `cta_url` breaks it — no
// orchestrator stage reads `brief["cta_url"]` (verified on
// w2v_orchestrator origin/main: every `cta_url` hit is slide/snippet OUTPUT, and
// the only brief key the promo + growth-bundle stages read is `call_to_action`).
// The value persists (brief is extra='allow') and reaches the model only inside
// growth_bundle's `f"Brief: {brief}"` raw dump. A control that looks like a
// generation input but is not must SAY so.
describe('FieldsSection — promo brief fields disclose what generation reads', () => {
	// FieldsSection renders <div>{<Input/>}{#if field.hint}<p>{hint}</p>{/if}</div>,
	// and Input's own root is `div.flex.flex-col`. Walking from the input to that
	// root's parent is what ties a hint to ITS field rather than to the section.
	function hintFor(container: HTMLElement, name: string): string {
		const input = container.querySelector(`input[name="${name}"]`);
		expect(input, `expected a control named ${name}`).toBeTruthy();
		const wrapper = input!.closest('div.flex.flex-col')?.parentElement;
		return wrapper?.querySelector('p')?.textContent?.trim() ?? '';
	}

	it('explains the spoken CTA field (positive control — proves the hint lookup works)', () => {
		const { container } = render(FieldsSection, { props: { type: 'promo', brief: {} } });
		expect(hintFor(container, 'brief-call_to_action')).toMatch(/spoken verbatim/i);
	});

	it('discloses that the CTA link is not read by any stage', () => {
		const { container } = render(FieldsSection, { props: { type: 'promo', brief: {} } });
		expect(hintFor(container, 'brief-cta_url')).toMatch(/\bnot (read|used)\b/i);
	});

	it('still renders an existing cta_url value so saved input stays visible and editable', () => {
		// The field is kept rather than removed precisely because briefs already
		// carry values for it; dropping the control would strand that data.
		const { container } = render(FieldsSection, {
			props: { type: 'promo', brief: { cta_url: 'https://example.com/trial' } }
		});
		const input = container.querySelector<HTMLInputElement>('input[name="brief-cta_url"]');
		expect(input?.value).toBe('https://example.com/trial');
	});
});

describe('FieldsSection — web_design_v2 interactivity', () => {
	// web_design_v2/design.py honours ONLY the exact strings "static" /
	// "interactive"; free text silently became static.
	it('is a select offering exactly static / interactive, defaulting to static', () => {
		const { container } = render(FieldsSection, { props: { type: 'web_design_v2', brief: {} } });
		const select = container.querySelector<HTMLSelectElement>('select[name="brief-interactivity"]');
		expect(select).toBeTruthy();
		expect([...select!.options].map((o) => o.value)).toEqual(['static', 'interactive']);
		expect(select!.value).toBe('static');
		expect(container.querySelector('input[name="brief-interactivity"]')).toBeNull();
	});

	it('writes the exact value to brief.interactivity', async () => {
		let brief: Record<string, unknown> = {};
		const { container } = render(FieldsSection, {
			props: {
				type: 'web_design_v2',
				get brief() {
					return brief;
				},
				set brief(v: Record<string, unknown>) {
					brief = v;
				}
			}
		});
		const select = container.querySelector<HTMLSelectElement>(
			'select[name="brief-interactivity"]'
		)!;
		await fireEvent.change(select, { target: { value: 'interactive' } });
		expect(brief.interactivity).toBe('interactive');
	});
});

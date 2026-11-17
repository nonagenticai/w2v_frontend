import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import LlmAccessSelect from './LlmAccessSelect.svelte';

const sel = () => screen.getByLabelText('Service access') as HTMLSelectElement;
const labels = () => [...sel().options].map((o) => o.textContent?.trim());

describe('LlmAccessSelect', () => {
	it('offers all three modes by default, with a hint for the chosen one', () => {
		render(LlmAccessSelect, { props: { name: 'x', value: 'local_allowed' } });
		expect(labels()).toEqual([
			'Platform services allowed',
			'Own providers required',
			'Platform services only'
		]);
		expect(sel().value).toBe('local_allowed');
		expect(screen.getByTestId('llm-access-hint').textContent).toMatch(
			/falls back to the platform/i
		);
	});

	it('`allowed` restricts the options', () => {
		render(LlmAccessSelect, {
			props: { name: 'x', value: 'local_allowed', allowed: ['local_allowed', 'platform_only'] }
		});
		expect(labels()).toEqual(['Platform services allowed', 'Platform services only']);
	});

	it('calls onchange with the mode and updates the hint', async () => {
		const onchange = vi.fn();
		render(LlmAccessSelect, { props: { name: 'x', value: 'local_allowed', onchange } });
		await fireEvent.change(sel(), { target: { value: 'platform_only' } });
		expect(onchange).toHaveBeenCalledWith('platform_only');
		expect(screen.getByTestId('llm-access-hint').textContent).toMatch(
			/tenant providers are disabled/i
		);
		await fireEvent.change(sel(), { target: { value: 'byo_required' } });
		expect(onchange).toHaveBeenCalledWith('byo_required');
		expect(screen.getByTestId('llm-access-hint').textContent).toMatch(/must register every/);
	});

	it('reverts when onchange returns false', async () => {
		render(LlmAccessSelect, {
			props: { name: 'x', value: 'platform_only', onchange: async () => false }
		});
		await fireEvent.change(sel(), { target: { value: 'byo_required' } });
		await Promise.resolve();
		expect(sel().value).toBe('platform_only');
	});

	it('unknown value shows the placeholder and no hint', () => {
		render(LlmAccessSelect, { props: { name: 'x', value: '', placeholder: 'Unknown' } });
		expect(labels()[0]).toBe('Unknown');
		expect(screen.queryByTestId('llm-access-hint')).toBeNull();
	});
});

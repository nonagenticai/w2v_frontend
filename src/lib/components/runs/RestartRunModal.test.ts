import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The Restart confirmation must show — BEFORE the person pays for a new run —
// which finished steps are kept and which run again, from the server's own plan;
// and a failed preview must show the server's words, never just a console 400.
const restartPlan = vi.fn();
vi.mock('$lib/api', async () => {
	const client = await vi.importActual<typeof import('$lib/api/client')>('$lib/api/client');
	return {
		ApiError: client.ApiError,
		runs: { restartPlan: (...a: unknown[]) => restartPlan(...a) }
	};
});

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { ApiError } from '$lib/api/client';
import RestartRunModal from './RestartRunModal.svelte';

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
});

beforeEach(() => restartPlan.mockReset());

const reason = (code: string, extra: Record<string, unknown> = {}) => ({
	code,
	message: code,
	stage: null,
	inputs: [],
	...extra
});

describe('RestartRunModal', () => {
	it('lists kept and re-run steps with their reasons', async () => {
		restartPlan.mockResolvedValue({
			run_id: 'r1',
			mode: 'partial',
			full_reasons: [],
			changed_inputs: ['brand'],
			stages: [
				{
					stage_name: 'promo_script',
					action: 'reuse',
					reasons: [reason('edit_kept')],
					edited: true
				},
				{
					stage_name: 'promo_html',
					action: 'rerun',
					reasons: [reason('input_changed', { inputs: ['brand'] })],
					edited: false
				},
				{
					stage_name: 'promo_render',
					action: 'rerun',
					reasons: [reason('cancelled')],
					edited: false
				}
			]
		});
		const onconfirm = vi.fn();
		render(RestartRunModal, { props: { open: true, runId: 'r1', onconfirm } });

		await waitFor(() => expect(screen.getByTestId('restart-plan-headline')).toBeInTheDocument());
		expect(restartPlan).toHaveBeenCalledWith('r1');
		expect(screen.getByTestId('restart-plan-headline').textContent).toContain(
			'1 finished step is kept; 2 steps run again.'
		);
		expect(screen.getByTestId('restart-plan-changed').textContent).toContain('the brand');
		const kept = screen.getByTestId('restart-plan-reused').textContent ?? '';
		expect(kept).toContain('Your edited version is kept.');
		const again = screen.getByTestId('restart-plan-rerun').textContent ?? '';
		expect(again).toContain('It uses the brand, which you changed.');
		expect(again).toContain('cancelled, so it starts over');
		// Never the server's internal key names.
		expect(again).not.toContain('promo_html');

		await fireEvent.click(screen.getByRole('button', { name: /Restart run/ }));
		expect(onconfirm).toHaveBeenCalledOnce();
	});

	it("shows a refused preview in the server's words and still allows the restart", async () => {
		restartPlan.mockRejectedValue(
			new ApiError(500, 'Internal Server Error', 'the project could not be read')
		);
		const onconfirm = vi.fn();
		render(RestartRunModal, { props: { open: true, runId: 'r1', onconfirm } });

		const alert = await screen.findByTestId('restart-plan-error');
		expect(alert.textContent).toContain('the project could not be read');
		expect(alert.textContent).not.toMatch(/^\s*500\s*$/);

		restartPlan.mockResolvedValue({
			run_id: 'r1',
			mode: 'full',
			full_reasons: [reason('nothing_reusable')],
			changed_inputs: [],
			stages: [
				{ stage_name: 'a', action: 'rerun', reasons: [reason('nothing_reusable')], edited: false }
			]
		});
		await fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
		await waitFor(() =>
			expect(screen.getByTestId('restart-plan-headline').textContent).toContain(
				'None of the finished steps can be kept'
			)
		);
		await fireEvent.click(screen.getByRole('button', { name: /Restart run/ }));
		expect(onconfirm).toHaveBeenCalledOnce();
	});
});

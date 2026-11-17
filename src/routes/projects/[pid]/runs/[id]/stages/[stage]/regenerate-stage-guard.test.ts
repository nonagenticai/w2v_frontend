import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// The stage review gate has TWO controls that spend money, and until this fix
// neither said so:
//
//   1. "Regenerate this stage" called `runs.regenerate(id, {from_stage})` on the
//      FIRST click — a fresh sibling run plus a navigation away, no
//      confirmation. It was also enabled purely on `stageStatus === 'completed'`,
//      so it fired while the parent run was still executing (paying for two
//      pipelines over one deliverable).
//   2. The restamp disclosure's checkbox defaulted to TRUE and called
//      `runs.regenerate(id, {})` — no `from_stage`, i.e. the WHOLE pipeline —
//      under a label ("Auto-trigger run regenerate") that named neither the
//      scope nor the cost.
//
// Everything below is asserted through the user-visible affordance (the button,
// the checkbox, the modal), never an internal variable.
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));

const goto = vi.fn();
const invalidateAll = vi.fn().mockResolvedValue(undefined);
vi.mock('$app/navigation', () => ({
	goto: (...a: unknown[]) => goto(...a),
	invalidateAll: (...a: unknown[]) => invalidateAll(...a)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

const regenerate = vi.fn();
vi.mock('$lib/api', () => ({
	ApiError: class ApiError extends Error {
		detail = 'x';
	},
	runs: {
		regenerate: (...a: unknown[]) => regenerate(...a),
		// "Rerun from here" previews its plan (RestartRunModal).
		restartPlan: vi.fn().mockResolvedValue({
			run_id: 'r1',
			mode: 'partial',
			full_reasons: [],
			changed_inputs: [],
			stages: []
		})
	}
}));

const restampElement = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/stores/elements.svelte.js', () => ({
	restamp: (...a: unknown[]) => restampElement(...a)
}));

vi.mock('$lib/utils/run-restart', () => ({ performRestart: vi.fn().mockResolvedValue(undefined) }));

import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import Page from './+page.svelte';

// jsdom implements no <dialog> showModal/close — give the shared Dialog
// something to call so its open/close $effect doesn't throw.
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
});

/**
 * Reachable stage statuses are pending | running | completed | failed | skipped
 * | cancelled. `completed` is the ONLY one the pre-existing gate allows, so
 * every fixture here uses it: a test that regenerate is not offered must fail
 * because of the guard under test, not because the stage had no output anyway.
 *
 * `runStatus` is the variable. `completed` = the parent pipeline has stopped,
 * regenerating is legitimate. `running` = the value that DEFEATS a missing
 * active-run guard: the stage is done, the button was enabled, and the click
 * spawned a sibling run alongside the live one.
 */
// `Button.svelte` forwards NO rest props (the same trap as `Card.svelte`), so a
// data-testid on one is silently dropped. Every button here is therefore found
// by its accessible NAME — which is what a user reads anyway.
const regenerateStageButton = () =>
	screen.getByRole('button', { name: /Rerun from here/ }) as HTMLButtonElement;
const restampButton = () => screen.getByRole('button', { name: /^Restamp/ }) as HTMLButtonElement;
const autoRegenerateCheckbox = () =>
	screen.getByTestId('restamp-auto-regenerate') as HTMLInputElement;

// The confirmation lives in a <dialog>; both it and the restamp disclosure have
// a "Cancel", so modal clicks are scoped to the dialog rather than the document.
const dialogEl = () => document.querySelector('dialog') as HTMLDialogElement;
const dialogIsOpen = () => Boolean(dialogEl()?.open);
async function openDialog(): Promise<HTMLElement> {
	await waitFor(() => expect(dialogIsOpen()).toBe(true));
	// Says WHICH paid action is being confirmed: re-running this step, or saving
	// the restamp and starting a new run.
	expect(
		within(dialogEl()).getByRole('heading', {
			name: /^(Rerun from “.+”\?|Save this element and start a new run\?)$/
		})
	).toBeTruthy();
	return dialogEl();
}

function makeData(runStatus: string) {
	return {
		project: { id: 'p1', title: 'Proj' },
		run: {
			id: 'r1',
			status: runStatus,
			current_stage: 'storyline',
			pause_after_stages: [],
			stage_outputs: [
				{
					stage_name: 'storyline',
					status: 'completed',
					output: { text: 'a storyline' },
					completed_at: '2026-09-01T00:00:00Z'
				}
			]
		},
		stage: 'storyline',
		draftList: { drafts: [] },
		draftListError: null,
		annotations: { annotations: [], total: 0 },
		annotationsError: null
	} as never;
}

const STOPPED = () => makeData('completed');
const STILL_RUNNING = () => makeData('running');

beforeEach(() => {
	vi.clearAllMocks();
	regenerate.mockResolvedValue({ id: 'child-1' });
	restampElement.mockResolvedValue(undefined);
});

describe('stage review — "Regenerate this stage" is confirmed, not one-click', () => {
	it('opens the confirmation instead of calling the API on the first click', async () => {
		render(Page, { data: STOPPED() });

		const btn = regenerateStageButton();
		expect(btn.disabled).toBe(false);
		await fireEvent.click(btn);

		expect(regenerate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
		expect(await screen.findByRole('heading', { name: /^Rerun from “.+”\?$/ })).toBeTruthy();
	});

	it('calls regenerate with from_stage and navigates to the child only on confirm', async () => {
		render(Page, { data: STOPPED() });

		await fireEvent.click(regenerateStageButton());
		await fireEvent.click(within(await openDialog()).getByRole('button', { name: 'Start rerun' }));

		await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
		expect(regenerate.mock.calls[0][0]).toBe('r1');
		expect(regenerate.mock.calls[0][1]).toEqual({ from_stage: 'storyline' });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/projects/p1/runs/child-1'));
	});

	it('a 402 byo_provider_required (#1150) shows the provider notice, closes the dialog, stays put', async () => {
		regenerate.mockRejectedValue(
			Object.assign(new Error('402'), {
				status: 402,
				details: {
					code: 'byo_provider_required',
					modality: 'llm',
					slots: 'llm,tts,image',
					message: 'Configure your own LLM, TTS and image providers to continue'
				}
			})
		);
		render(Page, { data: STOPPED() });

		await fireEvent.click(regenerateStageButton());
		await fireEvent.click(within(await openDialog()).getByRole('button', { name: 'Start rerun' }));

		const notice = await screen.findByTestId('byo-provider-required');
		expect(notice.getAttribute('data-slots')).toBe('llm,tts,image');
		expect(screen.getByTestId('byo-provider-required-message').textContent?.trim()).toBe(
			'Configure your own LLM, TTS and image providers to continue'
		);
		await waitFor(() => expect(dialogIsOpen()).toBe(false));
		expect(goto).not.toHaveBeenCalled();
	});

	it('calls nothing when the confirmation is dismissed', async () => {
		render(Page, { data: STOPPED() });

		await fireEvent.click(regenerateStageButton());
		await fireEvent.click(within(await openDialog()).getByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(dialogIsOpen()).toBe(false));
		expect(regenerate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('stage review — regenerate is withheld while the parent run is executing', () => {
	it('disables the control, says why, and stays inert on a forced click', async () => {
		render(Page, { data: STILL_RUNNING() });

		const btn = regenerateStageButton();
		expect(btn.disabled).toBe(true);
		expect(screen.getByTestId('regenerate-stage-unavailable').textContent).toContain(
			'Run is still running'
		);

		// Defence in depth: a DOM/keyboard path must not reach the confirmation.
		await fireEvent.click(btn);
		expect(dialogIsOpen()).toBe(false);
		expect(regenerate).not.toHaveBeenCalled();
	});
});

/**
 * Fills the restamp form with a VALID element id and VALID JSON. A test that
 * left these blank would pass on the early validation return rather than on the
 * guard — the whole point is that this submit really would have launched a
 * full-pipeline regenerate.
 */
async function fillRestamp() {
	await fireEvent.input(screen.getByLabelText(/Element id/), { target: { value: 'shot_1' } });
	await fireEvent.input(screen.getByLabelText(/New value/), {
		target: { value: '{"text":"hi"}' }
	});
}

describe('stage review — restamp does not silently launch a full-run regenerate', () => {
	it('is OFF by default, and Restamp then restamps WITHOUT any regenerate', async () => {
		render(Page, { data: STOPPED() });

		const cb = autoRegenerateCheckbox();
		expect(cb.checked).toBe(false);
		// The label names the scope and the cost, not "auto-trigger".
		expect(cb.closest('label')?.textContent).toContain('whole run');

		await fillRestamp();
		await fireEvent.click(restampButton());

		await waitFor(() => expect(restampElement).toHaveBeenCalledTimes(1));
		expect(regenerate).not.toHaveBeenCalled();
	});

	it('confirms first when the checkbox IS on — nothing is written before confirm', async () => {
		render(Page, { data: STOPPED() });

		await fireEvent.click(autoRegenerateCheckbox());
		await fillRestamp();
		await fireEvent.click(restampButton());

		await openDialog();
		expect(restampElement).not.toHaveBeenCalled();
		expect(regenerate).not.toHaveBeenCalled();

		await fireEvent.click(within(await openDialog()).getByRole('button', { name: 'Save and run' }));

		await waitFor(() => expect(regenerate).toHaveBeenCalledTimes(1));
		expect(restampElement).toHaveBeenCalledTimes(1);
		// Whole-pipeline: no `from_stage`. Pinned so a future "fix" that quietly
		// narrows this to from_stage still has to update the copy that promises
		// the whole run.
		expect(regenerate.mock.calls[0][1]).toEqual({});
	});

	it('writes nothing when the whole-run confirmation is dismissed', async () => {
		render(Page, { data: STOPPED() });

		await fireEvent.click(autoRegenerateCheckbox());
		await fillRestamp();
		await fireEvent.click(restampButton());
		await fireEvent.click(within(await openDialog()).getByRole('button', { name: 'Cancel' }));

		expect(restampElement).not.toHaveBeenCalled();
		expect(regenerate).not.toHaveBeenCalled();
	});
});

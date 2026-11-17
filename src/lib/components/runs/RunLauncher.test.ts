import { describe, it, expect, vi, beforeEach } from 'vitest';

// Covers the launcher click → runs.start → navigate flow that the heavy
// post-promote e2e specs used to assert via the UI button. Those specs now
// launch in autopilot via the API (the UI button omits pause_after_stages, so
// the orchestrator seeds the blueprint's default checkpoints and the run pauses
// — incompatible with an unattended completion test). This keeps the UI
// launcher's behaviour under test.

const m = vi.hoisted(() => ({
	goto: vi.fn().mockResolvedValue(undefined),
	start: vi.fn()
}));
const goto = m.goto;
const start = m.start;
vi.mock('$app/navigation', () => ({ goto: m.goto }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/api', () => ({
	runs: { start: m.start },
	ApiError: class ApiError extends Error {}
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastError: vi.fn() }));
const authHolder = vi.hoisted(() => ({ tenantAdmin: true }));
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => authHolder.tenantAdmin }));

import { render } from '@testing-library/svelte';
import { fireEvent, waitFor } from '@testing-library/dom';
import RunLauncher from './RunLauncher.svelte';
import { detailsFromBody } from '$lib/api/client.js';
import { toastError } from '$lib/stores/toast.svelte.js';

beforeEach(() => {
	goto.mockClear();
	start.mockReset();
});

describe('RunLauncher', () => {
	it('starts the run for its deliverable and navigates to the run page', async () => {
		start.mockResolvedValue({ id: 'run-123' });
		const { getByRole } = render(RunLauncher, { props: { deliverableId: 'deliv-7' } });

		await fireEvent.click(getByRole('button', { name: /start run/i }));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/runs/run-123'));
		expect(start).toHaveBeenCalledWith('deliv-7');
	});

	it('surfaces a launch failure inline instead of navigating', async () => {
		start.mockRejectedValue(new Error('boom'));
		const { getByRole, findByTestId } = render(RunLauncher, { props: { deliverableId: 'd' } });

		await fireEvent.click(getByRole('button', { name: /start run/i }));

		expect(await findByTestId('run-launcher-error')).toBeTruthy();
		expect(goto).not.toHaveBeenCalled();
	});
	// The guard the local `starting` flag never provided: a deliverable whose run
	// is already in flight must not be launched again (a second concurrent PAID
	// run). Note the fixtures below are non-blank on purpose — `runs.start` is
	// wired to RESOLVE, so a missing guard would visibly navigate.
	it.each([['running'], ['awaiting_review'], ['paused']] as const)(
		'refuses a second start while a run is in flight (status=%s)',
		async (status) => {
			start.mockResolvedValue({ id: 'run-should-not-exist' });
			const { getByRole, findByTestId } = render(RunLauncher, {
				props: { deliverableId: 'deliv-7', deliverableStatus: status }
			});

			await fireEvent.click(getByRole('button', { name: /start run/i }));

			expect(start).not.toHaveBeenCalled();
			expect(goto).not.toHaveBeenCalled();
			// It says WHY rather than silently doing nothing.
			const note = await findByTestId('run-launcher-blocked');
			expect(note.textContent).toMatch(/already has a run/i);
			// The shared words: a checkpoint pause "needs review", a manual one is paused.
			if (status === 'awaiting_review') expect(note.textContent).toMatch(/needs review/i);
			if (status === 'paused') {
				expect(note.textContent).toMatch(/is paused/i);
				expect(note.textContent).not.toMatch(/review/i);
			}
		}
	);

	it.each([['idle'], ['completed'], ['failed']] as const)(
		'permits a start when no run is in flight (status=%s)',
		async (status) => {
			start.mockResolvedValue({ id: 'run-456' });
			const { getByRole, queryByTestId } = render(RunLauncher, {
				props: { deliverableId: 'deliv-7', deliverableStatus: status }
			});

			await fireEvent.click(getByRole('button', { name: /start run/i }));

			await waitFor(() => expect(goto).toHaveBeenCalledWith('/runs/run-456'));
			expect(start).toHaveBeenCalledWith('deliv-7');
			expect(queryByTestId('run-launcher-blocked')).toBeNull();
		}
	);

	it('refuses with the caller-supplied reason when blockedReason is set', async () => {
		start.mockResolvedValue({ id: 'run-should-not-exist' });
		const { getByRole, findByTestId } = render(RunLauncher, {
			props: { deliverableId: 'd', deliverableStatus: 'idle', blockedReason: 'No recording.' }
		});
		await fireEvent.click(getByRole('button', { name: /start run/i }));
		expect(start).not.toHaveBeenCalled();
		expect((await findByTestId('run-launcher-blocked')).textContent).toContain('No recording.');
	});

	// w2v_orchestrator#1108: the start_run preflight answers a byo_required tenant
	// with 402 and a BARE `{detail: {...}}` body. Error = what the JSON client builds.
	const refusal = (body: unknown) =>
		Object.assign(new Error('402 Payment Required'), {
			status: 402,
			detail: 'x',
			details: detailsFromBody(body)
		});

	it('a 402 byo_provider_required shows the BYO notice + provider link, not the failure toast', async () => {
		vi.mocked(toastError).mockClear();
		start.mockRejectedValue(
			refusal({
				detail: {
					code: 'byo_provider_required',
					modality: 'image',
					message: 'Configure your own Image provider to continue'
				}
			})
		);
		const { getByRole, findByTestId, queryByTestId, getByTestId } = render(RunLauncher, {
			props: { deliverableId: 'd' }
		});
		await fireEvent.click(getByRole('button', { name: /start run/i }));
		const notice = await findByTestId('byo-provider-required');
		expect(notice.textContent).toContain('Configure your own Image provider to continue');
		expect(getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=image#provider-slot-image'
		);
		expect(queryByTestId('run-launcher-error')).toBeNull();
		expect(toastError).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	it('a plain licence 402 still takes the existing failure path', async () => {
		vi.mocked(toastError).mockClear();
		start.mockRejectedValue(refusal({ detail: 'Licence required' }));
		const { getByRole, findByTestId, queryByTestId } = render(RunLauncher, {
			props: { deliverableId: 'd' }
		});
		await fireEvent.click(getByRole('button', { name: /start run/i }));
		expect(await findByTestId('run-launcher-error')).toBeTruthy();
		expect(toastError).toHaveBeenCalledTimes(1);
		expect(queryByTestId('byo-provider-required')).toBeNull();
	});
});

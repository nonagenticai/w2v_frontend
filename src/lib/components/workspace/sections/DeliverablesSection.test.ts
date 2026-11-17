import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Store mutations the component drives — captured so we can assert call args.
const updateMock = vi.fn().mockResolvedValue({});
const removeMock = vi.fn().mockResolvedValue(undefined);
const addMock = vi.fn().mockResolvedValue({});
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));
const startMock = vi.fn();
const listPanelsMock = vi.fn();
vi.mock('$lib/api', () => ({
	runs: { start: (...a: unknown[]) => startMock(...a) },
	storyboard: { listPanels: (...a: unknown[]) => listPanelsMock(...a) },
	ApiError: class ApiError extends Error {}
}));
vi.mock('$lib/stores/deliverables.svelte.js', () => ({
	add: (...a: unknown[]) => addMock(...a),
	update: (...a: unknown[]) => updateMock(...a),
	remove: (...a: unknown[]) => removeMock(...a)
}));
const getOneMock = vi.fn<(id: string) => unknown>();
const loadOneMock = vi.fn<(id: string) => Promise<unknown>>();
vi.mock('$lib/stores/projects.svelte.js', () => ({
	getOne: (id: string) => getOneMock(id),
	loadOne: (id: string) => loadOneMock(id)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccess(...a),
	toastError: (...a: unknown[]) => toastError(...a)
}));

import { render, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import DeliverablesSection from './DeliverablesSection.svelte';
import { ApiError } from '$lib/api';
import type { ProjectDetailResponse } from '$lib/types';

// jsdom has no <dialog> showModal/close — give the fr Dialog something to call
// so its open/close $effect doesn't throw and the open attribute reflects.
beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	getOneMock.mockReturnValue(undefined);
	loadOneMock.mockResolvedValue(undefined);
});

const NOW = '2026-06-11T00:00:00Z';

function makeProject(over: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		id: 'p1',
		tenant_id: 't',
		owner_subject_id: 's',
		visibility: 'tenant',
		title: 'My Project',
		type: 'promo',
		brief: {},
		brand: {},
		voice: {},
		theme: {},
		status: 'drafting',
		deliverables: [
			{
				id: 'd1',
				project_id: 'p1',
				name: 'Hero Reel',
				format: '16x9',
				captions_mode: 'none',
				target_duration_seconds: null,
				status: 'idle',
				created_at: NOW,
				updated_at: NOW
			},
			{
				id: 'd2',
				project_id: 'p1',
				name: 'Promo Cut',
				format: '9x16',
				captions_mode: 'burned_in',
				target_duration_seconds: 30,
				status: 'idle',
				created_at: NOW,
				updated_at: NOW
			}
		],
		children: [],
		created_at: NOW,
		updated_at: NOW,
		...over
	} as ProjectDetailResponse;
}

describe('DeliverablesSection — edit', () => {
	it('opens the edit dialog pre-filled from the row and saves the edited fields', async () => {
		const { getAllByTestId, getByTestId } = render(DeliverablesSection, {
			project: makeProject()
		});

		const editTrigger = getAllByTestId('edit-deliverable-btn').find(
			(el) => el.getAttribute('data-deliverable-id') === 'd1'
		)!;
		await fireEvent.click(within(editTrigger).getByRole('button'));
		await tick();

		const dialog = getByTestId('edit-deliverable-dialog');
		const nameInput = within(dialog).getByLabelText('Name') as HTMLInputElement;
		// Pre-filled from the row.
		expect(nameInput.value).toBe('Hero Reel');

		await fireEvent.input(nameInput, { target: { value: 'Hero Reel v2' } });
		await tick();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
		await tick();

		expect(updateMock).toHaveBeenCalledTimes(1);
		expect(updateMock).toHaveBeenCalledWith('p1', 'd1', {
			name: 'Hero Reel v2',
			format: '16x9',
			target_duration_seconds: null,
			captions_mode: 'none'
		});
		expect(toastSuccess).toHaveBeenCalled();
	});

	it('blocks a name that collides with a different deliverable but allows keeping its own', async () => {
		const { getAllByTestId, getByTestId, queryByTestId } = render(DeliverablesSection, {
			project: makeProject()
		});

		const editTrigger = getAllByTestId('edit-deliverable-btn').find(
			(el) => el.getAttribute('data-deliverable-id') === 'd1'
		)!;
		await fireEvent.click(within(editTrigger).getByRole('button'));
		await tick();

		const dialog = getByTestId('edit-deliverable-dialog');
		const nameInput = within(dialog).getByLabelText('Name') as HTMLInputElement;
		const saveBtn = within(dialog).getByRole('button', { name: 'Save changes' });

		// Collide with the OTHER deliverable's name → error + disabled save.
		await fireEvent.input(nameInput, { target: { value: 'Promo Cut' } });
		await tick();
		expect(queryByTestId('edit-deliverable-name-error')).not.toBeNull();
		expect(saveBtn).toBeDisabled();

		// Restore its own name → no error, save enabled (self is excluded).
		await fireEvent.input(nameInput, { target: { value: 'Hero Reel' } });
		await tick();
		expect(queryByTestId('edit-deliverable-name-error')).toBeNull();
		expect(saveBtn).not.toBeDisabled();
	});

	// A server-rejected duration used to land ONLY in a toast, which self-dismisses
	// and leaves the still-open dialog saying nothing — indistinguishable from a
	// generic failure. The typed 400's `detail` must be pinned inline too.
	it('pins the server’s typed 400 detail inline when the save is rejected', async () => {
		// The runtime `ApiError` here is the bare `vi.mock` stub, which ignores its
		// constructor args — so `detail` is assigned explicitly. The 3-arg call
		// keeps the REAL signature satisfied for svelte-check.
		const rejection = new ApiError(
			400,
			'Bad Request',
			'target_duration_seconds: must be at least 10 seconds'
		);
		rejection.detail = 'target_duration_seconds: must be at least 10 seconds';
		updateMock.mockRejectedValueOnce(rejection);

		const { getAllByTestId, getByTestId, queryByTestId } = render(DeliverablesSection, {
			project: makeProject()
		});

		const editTrigger = getAllByTestId('edit-deliverable-btn').find(
			(el) => el.getAttribute('data-deliverable-id') === 'd1'
		)!;
		await fireEvent.click(within(editTrigger).getByRole('button'));
		await tick();

		const dialog = getByTestId('edit-deliverable-dialog');
		expect(queryByTestId('edit-deliverable-error')).toBeNull();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
		await tick();
		await tick();

		const inline = getByTestId('edit-deliverable-error');
		expect(inline.textContent).toContain('must be at least 10 seconds');
		// The toast is kept — the inline message is an addition, not a replacement.
		expect(toastError).toHaveBeenCalled();
		// The dialog stays open so the operator can correct the value.
		expect(queryByTestId('edit-deliverable-dialog')).not.toBeNull();
	});
});

describe('DeliverablesSection — empty', () => {
	// The old zero-state was `No deliverables yet. Add one above.` — and "above"
	// is the COLLAPSED add-form toggle, i.e. an instruction pointing at something
	// that is not on screen. These two assertions are the dead-end check: the
	// state exists, and it actually leads somewhere.
	it('renders the empty state with an explanation instead of a dead-end line', () => {
		const { getByTestId, queryByTestId } = render(DeliverablesSection, {
			project: makeProject({ deliverables: [] })
		});

		expect(getByTestId('deliverables-empty-state')).toBeTruthy();
		expect(getByTestId('add-first-deliverable-btn')).toBeTruthy();
		// The form is genuinely collapsed to begin with, so the CTA below is not
		// clicking something already visible.
		expect(queryByTestId('add-deliverable-form')).toBeNull();
	});

	it('opens the collapsed add form when the empty-state CTA is clicked', async () => {
		const { getByTestId } = render(DeliverablesSection, {
			project: makeProject({ deliverables: [] })
		});

		await fireEvent.click(within(getByTestId('add-first-deliverable-btn')).getByRole('button'));
		await tick();

		expect(getByTestId('add-deliverable-form')).toBeTruthy();
	});

	// The ADD path is the one with NO client-side floor: its DeliverableConfig is
	// rendered without a `minDurationSeconds` prop, so for an operator adding a
	// deliverable to an existing project the server's typed 400 is the ONLY
	// feedback a sub-floor duration ever gets. That makes this inline pin the
	// whole error surface here, not a nicety on top of a local check — a refactor
	// dropping it silently restores the self-dismissing-toast behaviour.
	it('pins the server’s typed 400 detail inline when the add is rejected', async () => {
		const rejection = new ApiError(
			400,
			'Bad Request',
			'target_duration_seconds: must be at least 10 seconds'
		);
		// The runtime `ApiError` is the bare `vi.mock` stub, which ignores its
		// constructor args — so `detail` is assigned explicitly.
		rejection.detail = 'target_duration_seconds: must be at least 10 seconds';
		addMock.mockRejectedValueOnce(rejection);

		const { getByTestId, queryByTestId } = render(DeliverablesSection, {
			project: makeProject({ deliverables: [] })
		});

		await fireEvent.click(within(getByTestId('add-first-deliverable-btn')).getByRole('button'));
		await tick();

		const form = getByTestId('add-deliverable-form');
		expect(queryByTestId('add-deliverable-error')).toBeNull();

		// A name is required before the submit button leaves its disabled state.
		await fireEvent.input(within(form).getByLabelText('Name'), {
			target: { value: 'Short Cut' }
		});
		await tick();

		await fireEvent.click(within(form).getByRole('button', { name: 'Add deliverable' }));
		await tick();
		await tick();

		const inline = getByTestId('add-deliverable-error');
		expect(inline.textContent).toContain('must be at least 10 seconds');
		// The toast is kept — the inline message is an addition, not a replacement.
		expect(toastError).toHaveBeenCalled();
		// The form stays open so the operator can correct the value.
		expect(queryByTestId('add-deliverable-form')).not.toBeNull();
	});
});

describe('DeliverablesSection — blueprint stages', () => {
	it('explains the absence instead of vanishing when no blueprint is published', () => {
		const { getByTestId, queryAllByTestId } = render(DeliverablesSection, {
			project: makeProject(),
			stages: []
		});

		expect(getByTestId('stages-empty-state')).toBeTruthy();
		// Non-`stage-row` markup only — several e2e specs assert exact counts.
		expect(queryAllByTestId('stage-row')).toHaveLength(0);
	});

	it('still renders one row per stage when a blueprint IS published', () => {
		const { queryByTestId, getAllByTestId } = render(DeliverablesSection, {
			project: makeProject(),
			stages: ['promo_analyze', 'promo_script']
		});

		expect(getAllByTestId('stage-row')).toHaveLength(2);
		expect(queryByTestId('stages-empty-state')).toBeNull();
	});
});

describe('DeliverablesSection — remove', () => {
	it('confirms via the dialog and calls the store remove with the ids', async () => {
		const { getAllByTestId, getByTestId } = render(DeliverablesSection, {
			project: makeProject()
		});

		const removeTrigger = getAllByTestId('remove-deliverable-btn').find(
			(el) => el.getAttribute('data-deliverable-id') === 'd2'
		)!;
		await fireEvent.click(within(removeTrigger).getByRole('button'));
		await tick();

		const dialog = getByTestId('remove-deliverable-dialog');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
		await tick();

		expect(removeMock).toHaveBeenCalledTimes(1);
		expect(removeMock).toHaveBeenCalledWith('p1', 'd2');
		expect(toastSuccess).toHaveBeenCalled();
	});
});

// The lesson banner is a breadcrumb into the PARENT course. The component is
// rendered unkeyed, so same-route nav swaps `project` on the live instance:
// every path through the parent-loading effect must write `parent`, and a
// superseded response must not land.
describe('DeliverablesSection — parent breadcrumb across an unkeyed prop swap', () => {
	const course = (id: string, title: string) =>
		makeProject({
			id,
			title,
			type: 'course',
			deliverables: [],
			children: [makeProject({ id: 'l1', type: 'lesson' })]
		});
	const lesson = (id: string, parentId: string) =>
		makeProject({
			id,
			title: `Lesson of ${parentId}`,
			type: 'lesson',
			parent_project_id: parentId,
			position: 1,
			deliverables: []
		});

	it('drops the breadcrumb when the prop swaps to the course itself', async () => {
		getOneMock.mockImplementation((id) => (id === 'cA' ? course('cA', 'Course A') : undefined));
		const { container, queryByRole, rerender } = render(DeliverablesSection, {
			project: lesson('l1', 'cA')
		});
		await tick();
		expect(queryByRole('link')?.textContent).toContain('Course A');

		// Click the banner → you are now ON course A. It must not breadcrumb to
		// itself.
		await rerender({ project: course('cA', 'Course A') });
		await tick();

		expect(queryByRole('link')).toBeNull();
		expect(container.querySelector('a[href="/projects/cA"]')).toBeNull();
	});

	it('re-points the breadcrumb when the prop swaps to a lesson of another course', async () => {
		getOneMock.mockImplementation((id) =>
			id === 'cA' ? course('cA', 'Course A') : id === 'cB' ? course('cB', 'Course B') : undefined
		);
		const { queryByRole, rerender } = render(DeliverablesSection, { project: lesson('l1', 'cA') });
		await tick();
		expect(queryByRole('link')?.getAttribute('href')).toBe('/projects/cA');

		await rerender({ project: lesson('l9', 'cB') });
		await tick();

		expect(queryByRole('link')?.getAttribute('href')).toBe('/projects/cB');
		expect(queryByRole('link')?.textContent).toContain('Course B');
	});

	it('discards a superseded parent response that lands after a faster one', async () => {
		// Nothing cached: both navigations go through loadOne. A's response is
		// slow and resolves LAST, after we have already navigated to B's lesson.
		const resolvers: Record<string, (v: unknown) => void> = {};
		loadOneMock.mockImplementation(
			(id) => new Promise((res) => (resolvers[id] = res as (v: unknown) => void))
		);

		const { queryByRole, rerender } = render(DeliverablesSection, { project: lesson('l1', 'cA') });
		await tick();
		await rerender({ project: lesson('l9', 'cB') });
		await tick();

		resolvers['cB'](course('cB', 'Course B'));
		await tick();
		resolvers['cA'](course('cA', 'Course A'));
		await tick();
		await tick();

		expect(queryByRole('link')?.getAttribute('href')).toBe('/projects/cB');
		expect(queryByRole('link')?.textContent).toContain('Course B');
	});
});

// The launcher's in-flight guard only fires when it is GIVEN the deliverable's
// status. The row used to render `<RunLauncher deliverableId=… />` alone, so a
// second paid run could start on a running/paused deliverable.
describe('DeliverablesSection — run launch guards', () => {
	function launchButton(container: HTMLElement, id: string): HTMLElement {
		const slot = container.querySelector(
			`[data-testid="start-run-btn"][data-deliverable-id="${id}"]`
		)!;
		return within(slot as HTMLElement).getByRole('button', { name: /start run/i });
	}

	it.each(['running', 'awaiting_review', 'paused'] as const)(
		'refuses to start a second run on a %s deliverable',
		async (status) => {
			startMock.mockResolvedValue({ id: 'nope' });
			const project = makeProject();
			project.deliverables[0].status = status;
			const { container, findByTestId } = render(DeliverablesSection, { project });
			await fireEvent.click(launchButton(container, 'd1'));
			expect(startMock).not.toHaveBeenCalled();
			expect((await findByTestId('run-launcher-blocked')).textContent).toMatch(
				/already has a run/i
			);
		}
	);

	it('blocks a demo_video launch that has storyboard panels but no recording package', async () => {
		startMock.mockResolvedValue({ id: 'nope' });
		listPanelsMock.mockResolvedValue({ items: [{ id: 'panel' }], total: 1 });
		const { container, findByTestId } = render(DeliverablesSection, {
			project: makeProject({ type: 'demo_video', brief: { target_url: 'https://x.test' } })
		});
		await vi.waitFor(() => expect(listPanelsMock).toHaveBeenCalledWith('p1'));
		await tick();
		await fireEvent.click(launchButton(container, 'd1'));
		expect(startMock).not.toHaveBeenCalled();
		expect((await findByTestId('run-launcher-blocked')).textContent).toMatch(
			/no screen recording/i
		);
	});

	it('does not check panels for a demo_video that has a recording package', async () => {
		render(DeliverablesSection, {
			project: makeProject({ type: 'demo_video', brief: { package_url: 'https://pkg.test/a.zip' } })
		});
		await tick();
		expect(listPanelsMock).not.toHaveBeenCalled();
	});
});

// The deliverable pill printed the raw enum ("awaiting_review"). It uses the same
// words as every other surface: a checkpoint pause "Needs review", a manual one "Paused".
describe('DeliverablesSection — status words', () => {
	it.each([
		['awaiting_review', 'Needs review'],
		['paused', 'Paused'],
		['running', 'Running'],
		['idle', 'Idle']
	] as const)('shows %s as "%s"', async (status, label) => {
		const project = makeProject();
		project.deliverables[0].status = status;
		const { container } = render(DeliverablesSection, { project });
		await tick();
		expect(container.textContent).toContain(label);
		expect(container.textContent).not.toContain('awaiting_review');
	});
});

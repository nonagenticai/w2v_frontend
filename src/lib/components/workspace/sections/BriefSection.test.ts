import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const updateMock = vi.fn();
const previewMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('$lib/stores/projects.svelte.js', () => ({
	update: (...a: unknown[]) => updateMock(...a)
}));
vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastSuccess: (...a: unknown[]) => toastSuccess(...a),
	toastError: (...a: unknown[]) => toastError(...a)
}));
vi.mock('$lib/api', () => ({
	tts: { previewVoice: (...a: unknown[]) => previewMock(...a) },
	ApiError: class ApiError extends Error {
		detail: string;
		constructor(detail = '') {
			super(detail);
			this.detail = detail;
		}
	}
}));

import { render, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import BriefSection from './BriefSection.svelte';
import type { ProjectDetailResponse } from '$lib/types';

beforeAll(() => {
	URL.createObjectURL = vi.fn(() => 'blob:preview');
	URL.revokeObjectURL = vi.fn();
	HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
	HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
	vi.clearAllMocks();
	updateMock.mockResolvedValue({});
	previewMock.mockResolvedValue(new Blob(['x'], { type: 'audio/wav' }));
});

const NOW = '2026-06-12T00:00:00Z';

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
		deliverables: [],
		children: [],
		created_at: NOW,
		updated_at: NOW,
		...over
	} as ProjectDetailResponse;
}

describe('BriefSection — Brand/Voice/Theme editor', () => {
	it('saves an edited brand color while preserving auto-extracted keys', async () => {
		const { getByTestId } = render(BriefSection, {
			project: makeProject({ brand: { accent_color: '#111111', palette: ['x'] } })
		});
		const group = getByTestId('brand-group');
		const accent = within(group).getByLabelText('Accent') as HTMLInputElement;
		expect(accent.value).toBe('#111111');

		await fireEvent.input(accent, { target: { value: '#222222' } });
		await tick();
		await fireEvent.click(within(group).getByRole('button', { name: 'Save brand' }));
		await tick();

		expect(updateMock).toHaveBeenCalledWith('p1', {
			brand: { accent_color: '#222222', palette: ['x'] }
		});
		expect(toastSuccess).toHaveBeenCalledWith('Brand saved');
	});

	it('previews a voice without saving, then saves the selection separately', async () => {
		const { getByTestId } = render(BriefSection, { project: makeProject() });
		const group = getByTestId('voice-group');

		await fireEvent.click(within(group).getByRole('button', { name: /Preview/ }));
		await tick();
		expect(previewMock).toHaveBeenCalledTimes(1);
		expect(updateMock).not.toHaveBeenCalled();

		const select = within(group).getByLabelText('Narration voice') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'am_puck' } });
		await tick();
		await fireEvent.click(within(group).getByRole('button', { name: 'Save voice' }));
		await tick();

		expect(updateMock).toHaveBeenCalledWith('p1', { voice: { voice_id: 'am_puck' } });
		expect(toastSuccess).toHaveBeenCalledWith('Voice saved');
	});

	it('saves a theme color hint', async () => {
		const { getByTestId } = render(BriefSection, { project: makeProject() });
		const group = getByTestId('theme-group');
		const bg = within(group).getByLabelText('Background') as HTMLInputElement;

		await fireEvent.input(bg, { target: { value: '#0b1437' } });
		await tick();
		await fireEvent.click(within(group).getByRole('button', { name: 'Save theme' }));
		await tick();

		expect(updateMock).toHaveBeenCalledWith('p1', { theme: { background: '#0b1437' } });
		expect(toastSuccess).toHaveBeenCalledWith('Theme saved');
	});
});

describe('BriefSection — Source/Target URL edit', () => {
	it('edits a website_review target_url and preserves other brief keys', async () => {
		const { getByLabelText, getByRole } = render(BriefSection, {
			project: makeProject({
				type: 'website_review',
				brief: { target_url: 'https://old.example', critique_categories: ['ux'] }
			})
		});
		const url = getByLabelText('Target URL') as HTMLInputElement;
		expect(url.value).toBe('https://old.example');

		await fireEvent.input(url, { target: { value: 'https://new.example' } });
		await tick();
		await fireEvent.click(getByRole('button', { name: 'Save brief' }));
		await tick();

		expect(updateMock).toHaveBeenCalledWith('p1', {
			brief: { target_url: 'https://new.example', critique_categories: ['ux'] }
		});
		expect(toastSuccess).toHaveBeenCalledWith('Brief saved');
	});

	it('labels the field "Source URL" and binds source_url for a promo project', async () => {
		const { getByLabelText, getByRole, queryByLabelText } = render(BriefSection, {
			project: makeProject({ type: 'promo', brief: {} })
		});
		expect(queryByLabelText('Target URL')).toBeNull();
		const url = getByLabelText('Source URL') as HTMLInputElement;

		await fireEvent.input(url, { target: { value: 'https://promo.example' } });
		await tick();
		await fireEvent.click(getByRole('button', { name: 'Save brief' }));
		await tick();

		expect(updateMock).toHaveBeenCalledWith('p1', {
			brief: { source_url: 'https://promo.example' }
		});
	});

	it('renders no URL field for a multi-source type (generic)', () => {
		const { queryByLabelText } = render(BriefSection, {
			project: makeProject({ type: 'generic', brief: {} })
		});
		expect(queryByLabelText('Source URL')).toBeNull();
		expect(queryByLabelText('Target URL')).toBeNull();
	});
});

// The component is rendered unkeyed (ProjectWorkspace.svelte) and same-route
// navigation — course → lesson (LessonsSection), lesson → parent course
// (DeliverablesSection / BranchBanner) — swaps `project` on the LIVE instance.
// The title buffer used to be seeded once and never resynced, so the input kept
// the OLD project's title, `titleDirty` went true, Save armed itself, and a
// click wrote the old title onto the new project.
describe('BriefSection — title buffer resync across an unkeyed prop swap', () => {
	const titleInput = (c: HTMLElement) => c.querySelector('input[name="project-title"]')!;

	it('shows the new project title and leaves Save unarmed after the prop swaps', async () => {
		const { container, getByRole, rerender } = render(BriefSection, {
			project: makeProject({ id: 'p1', title: 'Course A' })
		});
		expect((titleInput(container) as HTMLInputElement).value).toBe('Course A');

		// Same-route nav to a lesson of that course.
		await rerender({ project: makeProject({ id: 'p2', title: 'Lesson B' }) });
		await tick();

		expect((titleInput(container) as HTMLInputElement).value).toBe('Lesson B');
		const save = getByRole('button', { name: 'Save title' }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		await fireEvent.click(save);
		await tick();
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('does not clobber an in-progress edit when the same project re-renders', async () => {
		const { container, getByRole, rerender } = render(BriefSection, {
			project: makeProject({ id: 'p1', title: 'Course A' })
		});
		const input = titleInput(container) as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Course A rewritten' } });
		await tick();
		// A re-render of the SAME project (any parent-driven update) must not
		// reach into the buffer the user is typing into.
		await rerender({ project: makeProject({ id: 'p1', title: 'Course A' }) });
		await tick();

		expect(input.value).toBe('Course A rewritten');
		const save = getByRole('button', { name: 'Save title' }) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		await fireEvent.click(save);
		await tick();
		expect(updateMock).toHaveBeenCalledWith('p1', { title: 'Course A rewritten' });
	});

	it('keeps a mid-keystroke trailing space (an edit, even though trim() hides it)', async () => {
		const { container, rerender } = render(BriefSection, {
			project: makeProject({ id: 'p1', title: 'Course A' })
		});
		const input = titleInput(container) as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Course A ' } });
		await tick();
		await rerender({ project: makeProject({ id: 'p1', title: 'Course A' }) });
		await tick();

		expect(input.value).toBe('Course A ');
	});

	it('adopts a remote title change on the same project while the buffer is untouched', async () => {
		const { container, rerender } = render(BriefSection, {
			project: makeProject({ id: 'p1', title: 'Course A' })
		});
		await rerender({ project: makeProject({ id: 'p1', title: 'Course A (renamed)' }) });
		await tick();

		expect((titleInput(container) as HTMLInputElement).value).toBe('Course A (renamed)');
	});
});

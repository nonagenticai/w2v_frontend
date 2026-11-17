import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const patchChapters = vi.fn();
vi.mock('$lib/api', () => ({
	course: { patchChapters: (...a: unknown[]) => patchChapters(...a) },
	ApiError: class ApiError extends Error {}
}));

import ChapterEditor from './ChapterEditor.svelte';

const CHAPTERS = [
	{
		sequence: 1,
		title: 'Intro',
		start_seconds: 0,
		duration_seconds: 60,
		level: 0,
		lesson_project_id: 'p1'
	},
	{
		sequence: 2,
		title: 'Core',
		start_seconds: 60,
		duration_seconds: 60,
		level: 0,
		lesson_project_id: 'p2'
	},
	// a legacy sub-chapter (level 1, no chapter_key) is NOT individually
	// addressable, so it must NOT be offered for editing
	{
		sequence: 3,
		title: 'Sub',
		start_seconds: 80,
		duration_seconds: 40,
		level: 1,
		parent_sequence: 2,
		lesson_project_id: 'p2'
	}
];

// Chapters stitched with stable per-chapter keys: every marker — including the
// level-1 slide — is editable, keyed by its chapter_key.
const CHAPTERS_WITH_KEYS = [
	{
		sequence: 1,
		title: 'Intro',
		start_seconds: 0,
		duration_seconds: 60,
		level: 0,
		lesson_project_id: 'p1',
		chapter_key: 'p1'
	},
	{
		sequence: 2,
		title: 'Slide One',
		start_seconds: 30,
		duration_seconds: 30,
		level: 1,
		parent_sequence: 1,
		lesson_project_id: 'p1',
		chapter_key: 'p1#1'
	},
	{
		sequence: 3,
		title: 'Core',
		start_seconds: 60,
		duration_seconds: 60,
		level: 0,
		lesson_project_id: 'p2',
		chapter_key: 'p2'
	}
];

describe('ChapterEditor', () => {
	beforeEach(() => patchChapters.mockReset());

	it('renders only keyed markers as inputs (legacy keyless subs are skipped)', () => {
		const { getAllByRole } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS,
			onSaved: vi.fn(),
			onClose: vi.fn()
		});
		expect(getAllByRole('textbox').length).toBe(2);
	});

	it('renders level-1 sub-chapters as inputs when they carry a chapter_key', () => {
		const { getAllByRole } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS_WITH_KEYS,
			onSaved: vi.fn(),
			onClose: vi.fn()
		});
		// 2 lessons + 1 keyed slide = 3 editable rows
		expect(getAllByRole('textbox').length).toBe(3);
	});

	it('saves a changed slide title as an override keyed by its chapter_key', async () => {
		patchChapters.mockResolvedValue({ output: { chapters: [] } });
		const { getAllByRole, getByText } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS_WITH_KEYS,
			onSaved: vi.fn(),
			onClose: vi.fn()
		});
		// row order is [Intro (p1), Slide One (p1#1), Core (p2)]
		await fireEvent.input(getAllByRole('textbox')[1], { target: { value: 'Renamed Slide' } });
		await fireEvent.click(getByText('Save titles'));
		await tick();
		expect(patchChapters).toHaveBeenCalledWith('run-1', { 'p1#1': 'Renamed Slide' });
	});

	it('saves only changed titles as an override map keyed by lesson_project_id', async () => {
		patchChapters.mockResolvedValue({ output: { chapters: [] } });
		const onSaved = vi.fn();
		const onClose = vi.fn();
		const { getAllByRole, getByText } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS,
			onSaved,
			onClose
		});
		await fireEvent.input(getAllByRole('textbox')[0], { target: { value: 'New Intro' } });
		await fireEvent.click(getByText('Save titles'));
		await tick();
		expect(patchChapters).toHaveBeenCalledWith('run-1', { p1: 'New Intro' });
		expect(onSaved).toHaveBeenCalledWith({ chapters: [] });
		expect(onClose).toHaveBeenCalled();
	});

	it('closes without calling the API when nothing changed', async () => {
		const onClose = vi.fn();
		const { getByText } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS,
			onSaved: vi.fn(),
			onClose
		});
		await fireEvent.click(getByText('Save titles'));
		await tick();
		expect(patchChapters).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('offers a hide toggle only on level-1 sub-chapters', () => {
		const { queryAllByLabelText } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS_WITH_KEYS,
			onSaved: vi.fn(),
			onClose: vi.fn()
		});
		// only the single keyed slide (p1#1) gets a hide toggle; lessons don't
		expect(queryAllByLabelText('Hide sub-chapter').length).toBe(1);
	});

	it('sends the hidden key when a sub is hidden (even with no title edit)', async () => {
		patchChapters.mockResolvedValue({ output: { chapters: [] } });
		const { getByLabelText, getByText } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: CHAPTERS_WITH_KEYS,
			onSaved: vi.fn(),
			onClose: vi.fn()
		});
		await fireEvent.click(getByLabelText('Hide sub-chapter'));
		await fireEvent.click(getByText('Save titles'));
		await tick();
		expect(patchChapters).toHaveBeenCalledWith('run-1', {}, ['p1#1']);
	});

	it('renders a hidden sub as disabled + shows it on un-hide saves an empty hidden set', async () => {
		patchChapters.mockResolvedValue({ output: { chapters: [] } });
		const hiddenSlide = CHAPTERS_WITH_KEYS.map((c) =>
			c.chapter_key === 'p1#1' ? { ...c, hidden: true } : c
		);
		const { getAllByRole, getByLabelText, getByText } = render(ChapterEditor, {
			runId: 'run-1',
			chapters: hiddenSlide,
			onSaved: vi.fn(),
			onClose: vi.fn()
		});
		// row order [Intro, Slide One (hidden), Core] → the slide input is disabled
		expect((getAllByRole('textbox')[1] as HTMLInputElement).disabled).toBe(true);
		// the toggle reads "Show" while hidden; clicking un-hides it
		await fireEvent.click(getByLabelText('Show sub-chapter'));
		await fireEvent.click(getByText('Save titles'));
		await tick();
		expect(patchChapters).toHaveBeenCalledWith('run-1', {}, []);
	});
});

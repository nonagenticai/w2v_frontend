import { describe, it, expect, vi, beforeEach } from 'vitest';

// The workspace mounts one section at a time; switching section is a
// `?section=` navigation that unmounts BriefSection and drops its buffers.
// BriefSection must ask before that navigation when there are unsaved edits.
const nav = vi.hoisted(() => ({
	cb: null as null | ((n: { type: string; cancel: () => void }) => void)
}));
vi.mock('$app/navigation', () => ({
	beforeNavigate: (cb: (n: { type: string; cancel: () => void }) => void) => {
		nav.cb = cb;
	}
}));
vi.mock('$lib/stores/projects.svelte.js', () => ({ update: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('$lib/api', () => ({
	tts: { previewVoice: vi.fn() },
	ApiError: class ApiError extends Error {}
}));

import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import BriefSection from './BriefSection.svelte';
import type { ProjectDetailResponse } from '$lib/types';

const NOW = '2026-06-12T00:00:00Z';
function lesson(): ProjectDetailResponse {
	return {
		id: 'p1',
		tenant_id: 't',
		owner_subject_id: 's',
		visibility: 'tenant',
		title: 'Lesson 1',
		type: 'lesson',
		brief: { learning_objective: 'Wizard objective' },
		brand: {},
		voice: {},
		theme: {},
		status: 'drafting',
		deliverables: [],
		children: [],
		created_at: NOW,
		updated_at: NOW
	} as unknown as ProjectDetailResponse;
}

beforeEach(() => {
	nav.cb = null;
});

describe('BriefSection — unsaved-edit guard', () => {
	it('lets a clean section navigate away without asking', () => {
		const confirmSpy = vi.fn();
		vi.stubGlobal('confirm', confirmSpy);
		render(BriefSection, { project: lesson() });
		const cancel = vi.fn();
		nav.cb!({ type: 'goto', cancel });
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('asks before dropping an unsaved edit, and cancels when declined', async () => {
		const confirmSpy = vi.fn().mockReturnValue(false);
		vi.stubGlobal('confirm', confirmSpy);
		const { container } = render(BriefSection, { project: lesson() });
		const ta = container.querySelector('#lesson-objective') as HTMLTextAreaElement;
		// The lesson field reads the key the wizard writes and the script reads.
		expect(ta.value).toBe('Wizard objective');
		await fireEvent.input(ta, { target: { value: 'Edited objective' } });
		await tick();
		const cancel = vi.fn();
		nav.cb!({ type: 'goto', cancel });
		expect(confirmSpy).toHaveBeenCalled();
		expect(cancel).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BriefStep from './BriefStep.svelte';
import type { ProjectType } from '$lib/types';
import { createWizard } from './create-wizard.svelte.js';

const opts = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		id: `p${i}`,
		title: `Project ${i}`,
		type: 'promo' as ProjectType
	}));

describe('BriefStep — clone-settings picker states', () => {
	it('renders the picker with one option per cloneable project', () => {
		render(BriefStep, { props: { cloneables: opts(3) } });
		const select = screen.getByTestId('clone-from');
		// 3 projects + the "Start blank" sentinel.
		expect(select.querySelectorAll('option')).toHaveLength(4);
		expect(screen.queryByTestId('cloneables-truncated')).toBeNull();
		expect(screen.queryByTestId('cloneables-error')).toBeNull();
	});

	// REGRESSION: with ~4374 projects the picker showed a silent 50-row slice and
	// said nothing about the other 4324.
	it('says the list is partial when the tenant has more projects than were fetched', () => {
		render(BriefStep, {
			props: { cloneables: opts(200), cloneablesTotal: 4374, cloneablesTruncated: true }
		});
		const hint = screen.getByTestId('cloneables-truncated');
		expect(hint.textContent).toContain('200');
		expect(hint.textContent).toContain('4374');
	});

	// REGRESSION: a caught-and-ignored load failure removed the control entirely,
	// which is indistinguishable from "you have no projects to clone".
	it('shows a distinct failure message instead of silently hiding the control', () => {
		render(BriefStep, { props: { cloneables: [], cloneablesFailed: true } });
		expect(screen.getByTestId('cloneables-error')).toBeTruthy();
		expect(screen.queryByTestId('clone-from')).toBeNull();
	});

	it('renders NOTHING (no error) when the tenant genuinely has no projects', () => {
		render(BriefStep, { props: { cloneables: [], cloneablesFailed: false } });
		expect(screen.queryByTestId('cloneables-error')).toBeNull();
		expect(screen.queryByTestId('clone-from')).toBeNull();
	});
});

// The orchestrator seeds NO review gates on a website_review run without video
// (`run_engine.py` returns [] when `generate_video` is false), so offering "Pause
// for my review after the redesign" on a redesign-only run promised a pause that
// never came.
describe('BriefStep — review-checkpoint toggle', () => {
	afterEach(() => {
		createWizard.reset();
	});

	it('is hidden for a redesign-only website_review (no gates are seeded)', () => {
		createWizard.projectType = 'website_review';
		createWizard.generateRedesign = true;
		createWizard.generateVideo = false;
		render(BriefStep, { props: { cloneables: [] } });
		expect(screen.queryByTestId('pause-for-review')).toBeNull();
	});

	it('is shown when the website_review produces a video', () => {
		createWizard.projectType = 'website_review';
		createWizard.generateVideo = true;
		render(BriefStep, { props: { cloneables: [] } });
		expect(screen.getByTestId('pause-for-review')).toBeTruthy();
	});
});

// Round 9: a generic film with no source invented a "London 14-day deposit rule".
// The orchestrator now forbids unsupported specifics, so the Brief step tells the
// operator a factual topic needs a source — and links back to the Sources step.
describe('BriefStep — no-source grounding hint', () => {
	afterEach(() => {
		createWizard.reset();
	});

	it('shows on a generic project with no source and jumps to the Sources step', async () => {
		createWizard.projectType = 'generic';
		createWizard.stepIndex = createWizard.steps.indexOf('brief');
		render(BriefStep, { props: { cloneables: [] } });
		const hint = screen.getByTestId('grounding-hint');
		expect(hint.textContent).toContain('Add a source so the script can cite real facts');
		await fireEvent.click(screen.getByTestId('grounding-hint-add-source'));
		expect(createWizard.currentStep).toBe('sources');
	});

	it('is hidden once a url/document source is attached', () => {
		createWizard.projectType = 'generic';
		createWizard.sources = [{ kind: 'url', ref: 'https://example.com/facts' }];
		render(BriefStep, { props: { cloneables: [] } });
		expect(screen.queryByTestId('grounding-hint')).toBeNull();
	});

	it('still shows when only pinned media (pictures, not facts) is attached', () => {
		createWizard.projectType = 'generic';
		createWizard.sources = [{ kind: 'media', ref: 'https://example.com/a.jpg' }];
		render(BriefStep, { props: { cloneables: [] } });
		expect(screen.getByTestId('grounding-hint')).toBeTruthy();
	});

	it('is not shown for other project types', () => {
		createWizard.projectType = 'promo';
		render(BriefStep, { props: { cloneables: [] } });
		expect(screen.queryByTestId('grounding-hint')).toBeNull();
	});
});

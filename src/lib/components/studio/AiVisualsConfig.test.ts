/**
 * AiVisualsConfig tests — opt-in AI image/video generation config.
 *
 * Covers the brief-mutation contract:
 *  - toggling a section ON adds a truthy `{ enabled: true }` block → opt-in
 *    (an empty {} is falsy and the orchestrator would skip the stage)
 *  - filling prompts (lines → string[]) and a numeric duration_s
 *  - toggling OFF deletes the key → stage stays `skipped`
 *
 * The bound `brief` is exposed to the component via a getter/setter pair
 * (the same two-way-bind test pattern used by LessonList.test.ts); the
 * component reassigns it immutably and we read the closed-over variable
 * back after each interaction.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

import AiVisualsConfig from './AiVisualsConfig.svelte';
import type { ProjectBrief } from '$lib/types';

/** Render with a two-way-bound `brief`, returning a live accessor. */
function setup(initial: ProjectBrief = {}) {
	let brief: ProjectBrief = initial;
	const utils = render(AiVisualsConfig, {
		get brief() {
			return brief;
		},
		set brief(v: ProjectBrief) {
			brief = v;
		}
	});
	return { ...utils, getBrief: () => brief };
}

describe('AiVisualsConfig — AI image opt-in', () => {
	it('starts with no image fields and no ai_image_gen key', () => {
		const { container, getBrief } = setup();
		expect(getBrief().ai_image_gen).toBeUndefined();
		expect(container.querySelector('textarea[name="ai-image-prompts"]')).toBeNull();
	});

	it('toggling "Generate AI images" on adds a truthy { enabled: true } block (opt-in)', async () => {
		// MUST be truthy — run_setup lifts brief.ai_image_gen only when truthy
		// and the stage skips on a falsy config, so {} would be a silent no-op.
		const { container, getBrief } = setup();
		const checkbox = container.querySelector('input[name="ai-image-enabled"]') as HTMLInputElement;
		expect(checkbox).not.toBeNull();
		await fireEvent.change(checkbox, { target: { checked: true } });
		expect(getBrief().ai_image_gen).toEqual({ enabled: true });
	});

	it('filling two prompt lines sets ai_image_gen.prompts to a 2-element array', async () => {
		const { container, getBrief } = setup({ ai_image_gen: {} });
		const prompts = container.querySelector(
			'textarea[name="ai-image-prompts"]'
		) as HTMLTextAreaElement;
		expect(prompts).not.toBeNull();
		await fireEvent.input(prompts, {
			target: { value: 'a red car\n  a blue sky  \n' }
		});
		expect(getBrief().ai_image_gen).toEqual({ prompts: ['a red car', 'a blue sky'] });
	});

	it('setting provider includes only the filled key', async () => {
		const { container, getBrief } = setup({ ai_image_gen: {} });
		const provider = container.querySelector('input[name="ai-image-provider"]') as HTMLInputElement;
		await fireEvent.input(provider, { target: { value: 'flux' } });
		expect(getBrief().ai_image_gen).toEqual({ provider: 'flux' });
	});

	it('toggling images off removes the ai_image_gen key', async () => {
		const { container, getBrief } = setup({ ai_image_gen: { provider: 'flux' } });
		const checkbox = container.querySelector('input[name="ai-image-enabled"]') as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
		await fireEvent.change(checkbox, { target: { checked: false } });
		expect('ai_image_gen' in getBrief()).toBe(false);
	});
});

describe('AiVisualsConfig — AI video opt-in', () => {
	it('toggling "Generate AI video" on adds a truthy { enabled: true } block (opt-in)', async () => {
		// MUST be truthy — run_setup lifts brief.ai_video_gen only when truthy
		// and the stage skips on a falsy config, so {} would be a silent no-op.
		const { container, getBrief } = setup();
		const checkbox = container.querySelector('input[name="ai-video-enabled"]') as HTMLInputElement;
		await fireEvent.change(checkbox, { target: { checked: true } });
		expect(getBrief().ai_video_gen).toEqual({ enabled: true });
	});

	it('filling prompts + a numeric duration_s sets the typed block', async () => {
		const { container, getBrief } = setup({ ai_video_gen: {} });
		const prompts = container.querySelector(
			'textarea[name="ai-video-prompts"]'
		) as HTMLTextAreaElement;
		await fireEvent.input(prompts, { target: { value: 'pan across a city\n' } });
		const duration = container.querySelector('input[name="ai-video-duration"]') as HTMLInputElement;
		await fireEvent.input(duration, { target: { value: '5' } });
		expect(getBrief().ai_video_gen).toEqual({
			prompts: ['pan across a city'],
			duration_s: 5
		});
		// duration_s is a number, not the string "5"
		expect(typeof (getBrief().ai_video_gen as Record<string, unknown>).duration_s).toBe('number');
	});

	it('a blank/invalid duration is omitted', async () => {
		const { container, getBrief } = setup({ ai_video_gen: {} });
		const duration = container.querySelector('input[name="ai-video-duration"]') as HTMLInputElement;
		await fireEvent.input(duration, { target: { value: '' } });
		expect(getBrief().ai_video_gen).toEqual({});
	});

	it('toggling video off removes the ai_video_gen key', async () => {
		const { container, getBrief } = setup({ ai_video_gen: { duration_s: 5 } });
		const checkbox = container.querySelector('input[name="ai-video-enabled"]') as HTMLInputElement;
		await fireEvent.change(checkbox, { target: { checked: false } });
		expect('ai_video_gen' in getBrief()).toBe(false);
	});
});

describe('AiVisualsConfig — branded motion graphics opt-in', () => {
	it('starts with no motion_graphics key', () => {
		const { container, getBrief } = setup();
		expect(getBrief().motion_graphics).toBeUndefined();
		expect(container.querySelector('select[name="motion-graphics-template"]')).toBeNull();
	});

	it('toggling on writes a truthy block WITH a default template_id (opt-in + renderable)', async () => {
		// MUST be truthy AND carry a template_id — run_setup lifts only truthy
		// blocks, and motion_graphics_gen skips when neither template_id nor html
		// is present, so a bare { enabled: true } would be a silent no-op.
		const { container, getBrief } = setup();
		const checkbox = container.querySelector(
			'input[name="motion-graphics-enabled"]'
		) as HTMLInputElement;
		expect(checkbox).not.toBeNull();
		await fireEvent.change(checkbox, { target: { checked: true } });
		expect(getBrief().motion_graphics).toEqual({ enabled: true, template_id: 'pipeline_story' });
	});

	it('changing the template select updates template_id', async () => {
		const { container, getBrief } = setup({
			motion_graphics: { enabled: true, template_id: 'pipeline_story' }
		});
		const select = container.querySelector(
			'select[name="motion-graphics-template"]'
		) as HTMLSelectElement;
		expect(select).not.toBeNull();
		await fireEvent.change(select, { target: { value: 'kinetic_typography' } });
		expect((getBrief().motion_graphics as Record<string, unknown>).template_id).toBe(
			'kinetic_typography'
		);
	});

	it('setting fps writes a number, blank is omitted', async () => {
		const { container, getBrief } = setup({ motion_graphics: { enabled: true } });
		const fps = container.querySelector('input[name="motion-graphics-fps"]') as HTMLInputElement;
		await fireEvent.input(fps, { target: { value: '24' } });
		expect((getBrief().motion_graphics as Record<string, unknown>).fps).toBe(24);
		await fireEvent.input(fps, { target: { value: '' } });
		expect('fps' in (getBrief().motion_graphics as Record<string, unknown>)).toBe(false);
	});

	it('toggling motion off removes the motion_graphics key', async () => {
		const { container, getBrief } = setup({
			motion_graphics: { enabled: true, template_id: 'social_card' }
		});
		const checkbox = container.querySelector(
			'input[name="motion-graphics-enabled"]'
		) as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
		await fireEvent.change(checkbox, { target: { checked: false } });
		expect('motion_graphics' in getBrief()).toBe(false);
	});
});

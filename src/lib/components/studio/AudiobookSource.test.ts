/**
 * AudiobookSource tests — manuscript source step + voice-acting opt-in.
 *
 * Focus is the brief-mutation contract for the new voice-acting controls
 * (the upload + chapter/format selects already shipped):
 *  - toggling "Voice acting" ON adds voice_acting:true
 *  - toggling OFF drops BOTH voice_acting and voice_cast
 *  - per-character pin rows serialize into brief.voice_cast (name → voice_id)
 *  - blank-name rows are skipped; the picker offers exactly the 54 catalog ids
 *
 * Same two-way-bind accessor pattern as AiVisualsConfig.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

import AudiobookSource from './AudiobookSource.svelte';
import { KOKORO_VOICE_IDS } from '$lib/studio/kokoro-voices';
import type { ProjectBrief } from '$lib/types';

function setup(initial: ProjectBrief = {}) {
	let brief: ProjectBrief = initial;
	const utils = render(AudiobookSource, {
		get brief() {
			return brief;
		},
		set brief(v: ProjectBrief) {
			brief = v;
		}
	});
	return { ...utils, getBrief: () => brief };
}

const toggle = (c: HTMLElement) =>
	c.querySelector('input[name="voice-acting-enabled"]') as HTMLInputElement;

describe('AudiobookSource — voice-acting toggle', () => {
	it('has no voice_acting key and no pin rows by default', () => {
		const { container, getBrief } = setup();
		expect(getBrief().voice_acting).toBeUndefined();
		expect(container.querySelector('input[name="cast-name"]')).toBeNull();
	});

	it('toggling on sets voice_acting:true', async () => {
		const { container, getBrief } = setup();
		await fireEvent.change(toggle(container), { target: { checked: true } });
		expect(getBrief().voice_acting).toBe(true);
	});

	it('the pin editor is shown when voice_acting is already on', () => {
		// Reveal-on-seed (the established pattern — a parent-bound prop reassigned
		// from inside the component does not round-trip to re-render in this test
		// harness, so the toggle-then-reveal path is covered by seeding instead).
		const { container } = setup({ voice_acting: true });
		expect(container.querySelector('button')).not.toBeNull();
	});

	it('toggling off drops both voice_acting and voice_cast', async () => {
		const { container, getBrief } = setup({
			voice_acting: true,
			voice_cast: { Alice: 'bf_emma' }
		});
		expect(toggle(container).checked).toBe(true);
		await fireEvent.change(toggle(container), { target: { checked: false } });
		expect('voice_acting' in getBrief()).toBe(false);
		expect('voice_cast' in getBrief()).toBe(false);
	});
});

describe('AudiobookSource — per-character pins', () => {
	it('adding a row + naming a character serializes into voice_cast', async () => {
		const { container, getBrief } = setup({ voice_acting: true });
		await fireEvent.click(container.querySelector('button') as HTMLButtonElement); // "Add character"
		const name = container.querySelector('input[name="cast-name"]') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Alice' } });
		const voice = container.querySelector('select[name="cast-voice"]') as HTMLSelectElement;
		await fireEvent.change(voice, { target: { value: 'bf_emma' } });
		expect(getBrief().voice_cast).toEqual({ Alice: 'bf_emma' });
	});

	it('blank-name rows are skipped (no empty-key pollution)', async () => {
		const { container, getBrief } = setup({ voice_acting: true });
		await fireEvent.click(container.querySelector('button') as HTMLButtonElement);
		// Row added but never named → voice_cast must not appear.
		expect('voice_cast' in getBrief()).toBe(false);
	});

	it('removing the last named row clears voice_cast', async () => {
		const { container, getBrief } = setup({
			voice_acting: true,
			voice_cast: { Alice: 'bf_emma' }
		});
		const remove = container.querySelector(
			'button[aria-label="Remove character"]'
		) as HTMLButtonElement;
		await fireEvent.click(remove);
		expect('voice_cast' in getBrief()).toBe(false);
	});

	it('the voice picker offers exactly the 54 catalog ids', async () => {
		const { container } = setup({ voice_acting: true });
		await fireEvent.click(container.querySelector('button') as HTMLButtonElement);
		const options = [
			...(container.querySelector('select[name="cast-voice"]') as HTMLSelectElement).options
		].map((o) => o.value);
		expect(options.length).toBe(54);
		expect(new Set(options)).toEqual(new Set(KOKORO_VOICE_IDS));
	});
});

describe('AudiobookSource — one-command-lift opt-ins (PR-8c)', () => {
	const propose = (c: HTMLElement) =>
		c.querySelector('input[name="propose-pronunciations"]') as HTMLInputElement;
	const skipReview = (c: HTMLElement) =>
		c.querySelector('input[name="skip-review"]') as HTMLInputElement;
	const direction = (c: HTMLElement) =>
		c.querySelector('textarea[name="narration-direction"]') as HTMLTextAreaElement;

	it('both toggles default OFF and no audiobook opt-in keys are set', () => {
		const { container, getBrief } = setup();
		expect(propose(container).checked).toBe(false);
		expect(skipReview(container).checked).toBe(false);
		expect(direction(container).value).toBe('');
		expect(getBrief().audiobook).toBeUndefined();
	});

	it('toggling propose_pronunciations on sets brief.audiobook.propose_pronunciations', async () => {
		const { container, getBrief } = setup();
		await fireEvent.change(propose(container), { target: { checked: true } });
		expect(getBrief().audiobook?.propose_pronunciations).toBe(true);
	});

	it('toggling propose_pronunciations off drops the key (off-pattern)', async () => {
		const { container, getBrief } = setup({ audiobook: { propose_pronunciations: true } });
		expect(propose(container).checked).toBe(true);
		await fireEvent.change(propose(container), { target: { checked: false } });
		expect('propose_pronunciations' in (getBrief().audiobook ?? {})).toBe(false);
	});

	it('toggling skip-review on sets brief.audiobook.pause_for_review to false (autopilot)', async () => {
		const { container, getBrief } = setup();
		await fireEvent.change(skipReview(container), { target: { checked: true } });
		// Backend autopilots ONLY on an explicit false; absent keeps today's pauses.
		expect(getBrief().audiobook?.pause_for_review).toBe(false);
	});

	it('toggling skip-review off drops the key (restores default review pauses)', async () => {
		const { container, getBrief } = setup({ audiobook: { pause_for_review: false } });
		expect(skipReview(container).checked).toBe(true);
		await fireEvent.change(skipReview(container), { target: { checked: false } });
		expect('pause_for_review' in (getBrief().audiobook ?? {})).toBe(false);
	});

	it('preserves output_format when adding an opt-in', async () => {
		const { container, getBrief } = setup({ audiobook: { output_format: 'wav' } });
		await fireEvent.change(skipReview(container), { target: { checked: true } });
		expect(getBrief().audiobook).toEqual({ output_format: 'wav', pause_for_review: false });
	});

	it('direction text writes to brief.audiobook.direction', async () => {
		const { container, getBrief } = setup();
		await fireEvent.input(direction(container), { target: { value: 'warm and unhurried' } });
		expect(getBrief().audiobook?.direction).toBe('warm and unhurried');
	});

	it('whitespace-only direction is omitted (no noise)', async () => {
		const { container, getBrief } = setup({ audiobook: { direction: 'old' } });
		await fireEvent.input(direction(container), { target: { value: '   ' } });
		expect('direction' in (getBrief().audiobook ?? {})).toBe(false);
	});
});

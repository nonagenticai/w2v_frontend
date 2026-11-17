/**
 * ClipBeatEditor tests — the authored clip↔beat spine editor.
 *
 * Focus: the Footage-clip field. With a parsed `clipRoster` it renders a <select>
 * of real clips; without one it falls back to a free-text input. Same bound-array
 * pattern as ShotlistEditor.test.ts (read the closed-over `lines` back after each
 * action).
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

import ClipBeatEditor from './ClipBeatEditor.svelte';
import type { ShowcaseLine } from '$lib/types';

function setup(initial: ShowcaseLine[] = [], clipRoster: string[] = []) {
	let lines: ShowcaseLine[] = initial;
	const utils = render(ClipBeatEditor, {
		clipRoster,
		get lines() {
			return lines;
		},
		set lines(v: ShowcaseLine[]) {
			lines = v;
		}
	});
	return { ...utils, get: () => lines };
}

const beat = (over: Partial<ShowcaseLine> = {}): ShowcaseLine => ({
	id: 'clip-1',
	text: 'Welcome.',
	seconds: 0,
	...over
});

describe('ClipBeatEditor clip field', () => {
	it('renders a free-text input when no roster was parsed', () => {
		const { getByTestId } = setup([beat()]);
		const el = getByTestId('beat-0-clip') as HTMLElement;
		expect(el.tagName).toBe('INPUT');
	});

	it('renders a <select> of the roster clips when one is present', () => {
		const { getByTestId } = setup([beat()], ['clip-1', 'clip-2']);
		const el = getByTestId('beat-0-clip') as HTMLSelectElement;
		expect(el.tagName).toBe('SELECT');
		const values = Array.from(el.options).map((o) => o.value);
		// '' is the "— none —" option (value={undefined} serializes to '').
		expect(values).toEqual(['', 'clip-1', 'clip-2']);
	});

	it('selecting a roster clip writes the join key onto the bound line', async () => {
		const { getByTestId, get } = setup([beat()], ['clip-1', 'clip-2']);
		await fireEvent.change(getByTestId('beat-0-clip'), { target: { value: 'clip-2' } });
		expect(get()[0].clip).toBe('clip-2');
	});

	it('keeps an out-of-roster clip as a selectable option (no blanking)', () => {
		const { getByTestId } = setup([beat({ clip: 'legacy-clip' })], ['clip-1']);
		const el = getByTestId('beat-0-clip') as HTMLSelectElement;
		const opts = Array.from(el.options).map((o) => ({ v: o.value, t: o.textContent?.trim() }));
		expect(opts.find((o) => o.v === 'legacy-clip')?.t).toBe('legacy-clip (not in package)');
		expect(el.value).toBe('legacy-clip');
	});
});

describe('ClipBeatEditor speaker field', () => {
	function setupCast(cast: { name: string; voice: string }[], initial: ShowcaseLine[] = [beat()]) {
		let lines = initial;
		const utils = render(ClipBeatEditor, {
			cast,
			get lines() {
				return lines;
			},
			set lines(v: ShowcaseLine[]) {
				lines = v;
			}
		});
		return { ...utils, get: () => lines };
	}

	it('falls back to the a/b narrator/newcomer options when no cast is defined', () => {
		const { getByTestId } = setup([beat()]);
		const el = getByTestId('beat-0-speaker') as HTMLSelectElement;
		const values = Array.from(el.options).map((o) => o.value);
		expect(values).toEqual(['', 'a', 'b']);
	});

	it('lists the named cast roles when a cast is present', () => {
		const { getByTestId } = setupCast([
			{ name: 'Mark', voice: 'am_michael' },
			{ name: 'Lisa', voice: 'af_bella' }
		]);
		const el = getByTestId('beat-0-speaker') as HTMLSelectElement;
		const values = Array.from(el.options).map((o) => o.value);
		expect(values).toEqual(['', 'Mark', 'Lisa']);
	});

	it('keeps a since-removed speaker role as a selectable option (no blanking)', () => {
		const { getByTestId } = setupCast(
			[{ name: 'Mark', voice: 'am_michael' }],
			[beat({ speaker: 'Daniel' })]
		);
		const el = getByTestId('beat-0-speaker') as HTMLSelectElement;
		expect(el.value).toBe('Daniel');
		expect(Array.from(el.options).map((o) => o.value)).toContain('Mark');
	});
});

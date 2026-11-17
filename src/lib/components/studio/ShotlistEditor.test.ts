/**
 * ShotlistEditor tests — the authored, ordered shotlist editor.
 *
 * Two-way-bound `shotlist` accessor (same pattern as AiVisualsConfig.test.ts):
 * the component reassigns the array on add/remove/move and mutates entries in
 * place on field edits; we read the closed-over variable back after each action.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

import ShotlistEditor from './ShotlistEditor.svelte';
import type { Shot, UrlShot, SlideShot } from '$lib/types';

function setup(initial: Shot[] = []) {
	let shotlist: Shot[] = initial;
	const utils = render(ShotlistEditor, {
		get shotlist() {
			return shotlist;
		},
		set shotlist(v: Shot[]) {
			shotlist = v;
		}
	});
	return { ...utils, get: () => shotlist };
}

describe('ShotlistEditor', () => {
	it('renders the empty state with both add buttons', () => {
		const { getByTestId, getByText } = setup();
		expect(getByText('No shots yet')).toBeTruthy();
		expect(getByTestId('add-url-shot')).toBeTruthy();
		expect(getByTestId('add-slide-shot')).toBeTruthy();
	});

	it('"Add URL shot" appends a url shot with defaults', async () => {
		const { getByTestId, get } = setup();
		await fireEvent.click(getByTestId('add-url-shot'));
		const shots = get();
		expect(shots).toHaveLength(1);
		const s = shots[0] as UrlShot;
		expect(s.kind).toBe('url');
		expect(s.directives.hold_ms).toBe(3000);
		expect(s.directives.viewport).toBe('desktop');
	});

	it('"Add slide" appends a slide shot on the title template', async () => {
		const { getByTestId, get } = setup();
		await fireEvent.click(getByTestId('add-slide-shot'));
		expect((get()[0] as SlideShot).slide.template).toBe('title');
	});

	it('typing url + narration updates the bound array', async () => {
		const { getByTestId, get } = setup([
			{ kind: 'url', url: '', narration: '', directives: { hold_ms: 3000, viewport: 'desktop' } }
		]);
		await fireEvent.input(getByTestId('shot-0-url'), {
			target: { value: 'https://x.com/pricing' }
		});
		await fireEvent.input(getByTestId('shot-0-narration'), { target: { value: 'See pricing.' } });
		const s = get()[0] as UrlShot;
		expect(s.url).toBe('https://x.com/pricing');
		expect(s.narration).toBe('See pricing.');
	});

	it('switching kind url→slide preserves narration', async () => {
		const { getByTestId, get } = setup([
			{
				kind: 'url',
				url: 'https://x',
				narration: 'keep me',
				directives: { hold_ms: 3000, viewport: 'desktop' }
			}
		]);
		await fireEvent.change(getByTestId('shot-0-kind'), { target: { value: 'slide' } });
		const s = get()[0];
		expect(s.kind).toBe('slide');
		expect(s.narration).toBe('keep me');
	});

	it('bullets textarea splits newlines into a trimmed string[]', async () => {
		const { getByTestId, get } = setup([
			{ kind: 'slide', narration: 'n', slide: { template: 'bullets' } }
		]);
		await fireEvent.input(getByTestId('shot-0-bullets'), {
			target: { value: 'Fast\n  \nSimple\n' }
		});
		expect((get()[0] as SlideShot).slide.bullets).toEqual(['Fast', 'Simple']);
	});

	it('remove deletes the targeted shot', async () => {
		const { getByTestId, get } = setup([
			{ kind: 'url', url: 'a', narration: 'a', directives: { hold_ms: 3000, viewport: 'desktop' } },
			{ kind: 'url', url: 'b', narration: 'b', directives: { hold_ms: 3000, viewport: 'desktop' } }
		]);
		await fireEvent.click(getByTestId('shot-0-remove'));
		const shots = get();
		expect(shots).toHaveLength(1);
		expect((shots[0] as UrlShot).url).toBe('b');
	});

	it('move-down reorders shots', async () => {
		const { getByTestId, get } = setup([
			{ kind: 'url', url: 'a', narration: 'a', directives: { hold_ms: 3000, viewport: 'desktop' } },
			{ kind: 'url', url: 'b', narration: 'b', directives: { hold_ms: 3000, viewport: 'desktop' } }
		]);
		await fireEvent.click(getByTestId('shot-0-move-down'));
		expect((get()[0] as UrlShot).url).toBe('b');
		expect((get()[1] as UrlShot).url).toBe('a');
	});
});

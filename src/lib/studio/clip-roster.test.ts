import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractClipTags, parsePackageClipRoster } from './clip-roster';

describe('extractClipTags', () => {
	it('pulls a single @clip tag and strips the @', () => {
		const feature = `Feature: Tour
  @clip-1 @smoke
  Scenario: Landing
    Given I open the app
`;
		expect(extractClipTags([feature])).toEqual(['clip-1']);
	});

	it('preserves first-seen order and de-dupes across scenarios and files', () => {
		const a = `@clip-2
Scenario: one
@clip-1
Scenario: two`;
		const b = `@clip-2
Scenario: three
@clip-3`;
		expect(extractClipTags([a, b])).toEqual(['clip-2', 'clip-1', 'clip-3']);
	});

	it('handles Scenario Outline tags', () => {
		const feature = `Feature: Grid
  @clip-grid
  Scenario Outline: room <n>
    Then room <n> renders
    Examples:
      | n |
      | 1 |`;
		expect(extractClipTags([feature])).toEqual(['clip-grid']);
	});

	it('does NOT match @clip without a trailing hyphen', () => {
		const feature = `@clipboard @clip @clipper
Scenario: nope`;
		expect(extractClipTags([feature])).toEqual([]);
	});

	it('returns [] for a feature with no clip tags', () => {
		expect(extractClipTags(['Feature: bare\n  Scenario: x\n'])).toEqual([]);
	});

	it('ignores @clip- occurrences that are not on a Gherkin tag line', () => {
		const feature = `Feature: tour
  # steer with @clip-cmt in this comment
  @clip-1
  Scenario: real
    When I type "@clip-step" into the box
    Then I see the "@clip-doc" hint
    """
    a docstring mentioning @clip-inline
    """`;
		// Only the actual tag line contributes; the comment / step / docstring
		// mentions are phantom and excluded.
		expect(extractClipTags([feature])).toEqual(['clip-1']);
	});

	it('reads every clip tag on a multi-tag line', () => {
		expect(extractClipTags(['@smoke @clip-1 @clip-2 @wip\nScenario: x'])).toEqual([
			'clip-1',
			'clip-2'
		]);
	});
});

describe('parsePackageClipRoster', () => {
	function fileFrom(entries: Record<string, string>): File {
		const zipped = zipSync(
			Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))
		);
		// Copy into a fresh ArrayBuffer so `File`/`arrayBuffer()` sees exact bytes.
		return new File([zipped.slice().buffer], 'package.zip', { type: 'application/zip' });
	}

	it('reads clip tags only from .feature entries in a real zip', async () => {
		const file = fileFrom({
			'features/tour.feature': '@clip-1\nScenario: a\n@clip-2\nScenario: b',
			'steps/tour.ts': '// @clip-99 not a feature file',
			'playwright.config.ts': 'export default {}'
		});
		expect(await parsePackageClipRoster(file)).toEqual({
			tags: ['clip-1', 'clip-2'],
			unreadable: false
		});
	});

	it('reports a readable package with no clip tags as readable, not unreadable', async () => {
		const file = fileFrom({ 'features/bare.feature': 'Feature: bare\n  Scenario: x' });
		expect(await parsePackageClipRoster(file)).toEqual({ tags: [], unreadable: false });
	});

	it('flags a non-zip / corrupt file as unreadable instead of claiming it has no clips', async () => {
		const bad = new File([strToU8('not a zip at all').slice().buffer], 'x.zip');
		expect(await parsePackageClipRoster(bad)).toEqual({ tags: [], unreadable: true });
	});

	it('does not throw on an unreadable package (its caller would report a false upload failure)', async () => {
		const bad = new File([strToU8('nope').slice().buffer], 'x.zip');
		await expect(parsePackageClipRoster(bad)).resolves.toBeDefined();
	});
});

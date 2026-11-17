import { describe, it, expect } from 'vitest';
import { downloadBaseName, videoTitleFor } from './output-labels';
import shared from './download-name-vectors.json';

describe('videoTitleFor', () => {
	it('names the video after what the person asked for', () => {
		expect(videoTitleFor('promo')).toBe('Promo video');
		expect(videoTitleFor('course')).toBe('Course video');
	});
	it('falls back to a neutral title, never "Demo Video" for everything', () => {
		expect(videoTitleFor('generic')).toBe('Video');
		expect(videoTitleFor(null)).toBe('Video');
	});
});

describe('downloadBaseName', () => {
	it('turns a project title into a file stem', () => {
		expect(downloadBaseName('commonpractice-app.nonagentic.ai')).toBe(
			'commonpractice-app-nonagentic-ai'
		);
		expect(downloadBaseName('  Café Launch — Q4!  ')).toBe('cafe-launch-q4');
	});
	it('falls back to "video" when nothing usable is left', () => {
		expect(downloadBaseName('🎬🎬')).toBe('video');
		expect(downloadBaseName(undefined)).toBe('video');
	});
	it('caps the length without leaving a trailing dash', () => {
		const stem = downloadBaseName(`${'a'.repeat(59)} bcd`);
		expect(stem.length).toBeLessThanOrEqual(60);
		expect(stem.endsWith('-')).toBe(false);
	});
});

// The orchestrator names the captions file with the same algorithm, asserted
// against the IDENTICAL vector file (w2v_orchestrator
// tests/fixtures/download-name-vectors.json) — change both together.
describe('downloadBaseName — vectors shared with the orchestrator', () => {
	it.each(shared.vectors)('$title → $stem', ({ title, stem }) => {
		expect(downloadBaseName(title)).toBe(stem);
	});
	it('covers the cases that used to diverge between the two repos', () => {
		const byTitle = new Map(shared.vectors.map((v) => [v.title, v.stem]));
		expect(byTitle.get('Straße')).toBe('stra-e');
		expect(byTitle.get('a日b')).toBe('a-b');
	});
});

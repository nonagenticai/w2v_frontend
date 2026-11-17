import { describe, expect, it } from 'vitest';
import type { MediaResult } from '$lib/api';
import { mediaResultRef, mediaResultToSource } from './media-source';

const result = (overrides: Partial<MediaResult> = {}): MediaResult => ({
	id: 'm1',
	title: 'Team collaboration',
	url: 'https://cdn/photo.jpg',
	thumbnail_url: 'https://cdn/photo-thumb.jpg',
	media_type: 'image',
	source: 'unsplash',
	author_name: 'Jane',
	quality_score: 0.9,
	...overrides
});

describe('mediaResultRef', () => {
	it('uses the URL when present', () => {
		expect(mediaResultRef(result())).toBe('https://cdn/photo.jpg');
	});

	it('falls back to the id when there is no URL', () => {
		expect(mediaResultRef(result({ url: '' }))).toBe('m1');
	});
});

describe('mediaResultToSource', () => {
	it('carries the thumbnail + media_type so Review can preview the pin', () => {
		expect(mediaResultToSource(result())).toEqual({
			kind: 'media',
			ref: 'https://cdn/photo.jpg',
			label: 'Team collaboration',
			thumbnail_url: 'https://cdn/photo-thumb.jpg',
			media_type: 'image'
		});
	});

	it('marks a pinned clip as a video', () => {
		const src = mediaResultToSource(
			result({ url: 'https://cdn/clip.mp4', media_type: 'video', thumbnail_url: '' })
		);
		expect(src.media_type).toBe('video');
		expect(src.thumbnail_url).toBeUndefined();
		expect(src.ref).toBe('https://cdn/clip.mp4');
	});

	it('falls back to the source name for the label', () => {
		expect(mediaResultToSource(result({ title: '' })).label).toBe('unsplash');
	});
});

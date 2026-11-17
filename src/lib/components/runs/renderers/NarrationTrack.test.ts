import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import NarrationTrack from './NarrationTrack.svelte';
import { setActiveTenantId } from '$lib/api/client.js';

const output = {
	clips: [
		{
			id: 'c1',
			line_id: 'line-aaaaaa',
			artifact_url: '/api/runs/r1/artifact/vo-1.mp3',
			seconds: 3
		},
		{ id: 'c2', line_id: 'line-bbbbbb', artifact_url: '/api/runs/r1/artifact/vo-2.mp3', seconds: 4 }
	]
};

const srcs = (container: HTMLElement) =>
	[...container.querySelectorAll('[data-testid="audio-player"]')].map((el) =>
		el.getAttribute('src')
	);

describe('NarrationTrack — per-line voiceover audio', () => {
	it('renders one audio player per clip with an untouched src when no tenant switch is active', () => {
		const { container } = render(NarrationTrack, { output });
		expect(srcs(container)).toEqual([
			'/api/runs/r1/artifact/vo-1.mp3',
			'/api/runs/r1/artifact/vo-2.mp3'
		]);
	});

	// <audio> is browser-initiated and carries no X-Active-Tenant-Id header, so a
	// super-admin browsing another tenant needs the switch in the query string —
	// otherwise every per-line voiceover 404s.
	it('carries an active tenant switch in the audio src', () => {
		setActiveTenantId('tenant-x');
		try {
			const { container } = render(NarrationTrack, { output });
			expect(srcs(container)).toEqual([
				'/api/runs/r1/artifact/vo-1.mp3?active_tenant=tenant-x',
				'/api/runs/r1/artifact/vo-2.mp3?active_tenant=tenant-x'
			]);
		} finally {
			setActiveTenantId(null);
		}
	});
});

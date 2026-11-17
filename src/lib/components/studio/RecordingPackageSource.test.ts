/**
 * RecordingPackageSource — the upload succeeds, but can we read its clips?
 *
 * The bug this covers: a package whose zip fflate cannot open used to come back as
 * an empty roster, which is indistinguishable from a package that legitimately
 * declares no `@clip-` tags. The Beats step then hides the clip picker and the user
 * hand-types clip keys; one typo and the orchestrator's `valid_clip_tags` join drops
 * that beat at render, silently. The upload itself is fine, so the warning must NOT
 * be reported as an upload failure (that would wipe package_url on a good upload).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';

const recordingPackage = vi.fn();
vi.mock('$lib/api', () => ({ uploads: { recordingPackage: (f: File) => recordingPackage(f) } }));

import RecordingPackageSource from './RecordingPackageSource.svelte';
import type { ProjectBrief } from '$lib/types';

function setup() {
	let brief: ProjectBrief = {};
	let clipRoster: string[] = [];
	const utils = render(RecordingPackageSource, {
		get brief() {
			return brief;
		},
		set brief(v: ProjectBrief) {
			brief = v;
		},
		get clipRoster() {
			return clipRoster;
		},
		set clipRoster(v: string[]) {
			clipRoster = v;
		}
	});
	return { ...utils, getBrief: () => brief, getRoster: () => clipRoster };
}

function zipFile(entries: Record<string, string>): File {
	const zipped = zipSync(
		Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)]))
	);
	return new File([zipped.slice().buffer], 'package.zip', { type: 'application/zip' });
}

async function upload(container: HTMLElement, file: File) {
	const input = container.querySelector('[data-testid="package-input"]') as HTMLInputElement;
	Object.defineProperty(input, 'files', { value: [file], configurable: true });
	await fireEvent.change(input);
}

beforeEach(() => {
	recordingPackage.mockReset();
	recordingPackage.mockResolvedValue({ package_url: 's3://bucket/package.zip' });
});

describe('RecordingPackageSource — clip roster readability', () => {
	it('warns that the clip tags could not be read while KEEPING the successful upload', async () => {
		const { container, getBrief, getRoster } = setup();
		await upload(container, new File([strToU8('not a zip').slice().buffer], 'package.zip'));

		await waitFor(() =>
			expect(container.querySelector('[data-testid="package-roster-warning"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="package-roster-warning"]')?.textContent).toMatch(
			/read the clip tags/i
		);
		// The upload stands: package_url kept, no upload error.
		expect(getBrief().package_url).toBe('s3://bucket/package.zip');
		expect(container.textContent).not.toMatch(/Upload failed/i);
		expect(getRoster()).toEqual([]);
	});

	it('shows no warning for a readable package and threads its roster out', async () => {
		const { container, getBrief, getRoster } = setup();
		await upload(container, zipFile({ 'features/a.feature': '@clip-1\nScenario: a' }));

		await waitFor(() => expect(getRoster()).toEqual(['clip-1']));
		expect(container.querySelector('[data-testid="package-roster-warning"]')).toBeNull();
		expect(getBrief().package_url).toBe('s3://bucket/package.zip');
	});

	it('shows no warning for a readable package that simply declares no clip tags', async () => {
		const { container, getRoster } = setup();
		await upload(container, zipFile({ 'features/bare.feature': 'Feature: bare\n Scenario: x' }));

		await waitFor(() =>
			expect(container.querySelector('[data-testid="package-name"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="package-roster-warning"]')).toBeNull();
		expect(getRoster()).toEqual([]);
	});

	it('reports a real upload failure as an upload error and drops package_url', async () => {
		recordingPackage.mockRejectedValue(new Error('Upload failed'));
		const { container, getBrief } = setup();
		await upload(container, zipFile({ 'features/a.feature': '@clip-1\nScenario: a' }));

		await waitFor(() => expect(container.textContent).toMatch(/Upload failed/i));
		expect(getBrief().package_url).toBeUndefined();
		expect(container.querySelector('[data-testid="package-roster-warning"]')).toBeNull();
	});

	it('clears a prior unreadable warning once a readable package replaces it', async () => {
		const { container } = setup();
		await upload(container, new File([strToU8('not a zip').slice().buffer], 'package.zip'));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="package-roster-warning"]')).not.toBeNull()
		);

		await upload(container, zipFile({ 'features/a.feature': '@clip-2\nScenario: a' }));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="package-roster-warning"]')).toBeNull()
		);
	});
});

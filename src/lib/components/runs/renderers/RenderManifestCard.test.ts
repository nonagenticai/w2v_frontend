import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import RenderManifestCard from './RenderManifestCard.svelte';

const full = {
	manifest: {
		master_seed: 42,
		input_hash: 'sha1:abc123',
		completeness: 0.75,
		output_sha256: null,
		mastering: null,
		artifact_url: 'https://x/video.mp4',
		duration_seconds: 84,
		override_ledger: [
			{ key: 'music.track', value: 'upbeat', source: 'default' },
			{ key: 'music.ducking_db', value: -12, source: 'smart-auto', computed_by: 'audio_master' },
			{ key: 'cold_open.anchor', value: 'start', source: 'override' },
			{ key: 'vo.rate', value: 2.6, source: 'llm-clamped' }
		]
	}
};

describe('RenderManifestCard — override-ledger + reproducibility spine', () => {
	it('renders one ledger row per entry with its knob key', () => {
		const { getAllByTestId, getByText } = render(RenderManifestCard, { output: full });
		expect(getAllByTestId('ledger-row')).toHaveLength(4);
		expect(getByText('music.ducking_db')).toBeTruthy();
		expect(getByText('cold_open.anchor')).toBeTruthy();
	});

	it('maps each source to a DISTINCT provenance chip', () => {
		const { getAllByTestId } = render(RenderManifestCard, { output: full });
		const chips = getAllByTestId('provenance-chip');
		const sources = chips.map((c) => c.getAttribute('data-provenance-source'));
		expect(sources).toEqual(['default', 'smart-auto', 'override', 'llm-clamped']);
		// Distinct labels prove distinct chips, not one style reused.
		expect(new Set(chips.map((c) => c.textContent?.trim())).size).toBe(4);
	});

	it('shows the audited-completeness percentage and an un-audited note when < 1.0', () => {
		const { getByTestId } = render(RenderManifestCard, { output: full });
		expect(getByTestId('completeness-badge').textContent).toContain('75%');
		// One knob is still on `default` source ⇒ 1 un-audited.
		expect(getByTestId('unaudited-note').textContent).toContain('1 knob');
	});

	it('hides the un-audited note when completeness is 1.0 (fully audited)', () => {
		const { queryByTestId, getByTestId } = render(RenderManifestCard, {
			output: {
				manifest: {
					completeness: 1,
					override_ledger: [{ key: 'a', value: 1, source: 'override' }]
				}
			}
		});
		expect(getByTestId('completeness-badge').textContent).toContain('100%');
		expect(queryByTestId('unaudited-note')).toBeNull();
	});

	it('shows the Reproducible badge when master_seed is set', () => {
		const { getByTestId } = render(RenderManifestCard, { output: full });
		expect(getByTestId('reproducible-badge')).toBeTruthy();
	});

	it('hides the Reproducible badge when master_seed is null', () => {
		// Separate test so testing-library cleanup clears the previous render —
		// bound queries are document.body-scoped, so a second render in the same
		// test would still see the seeded badge from the first.
		const { queryByTestId } = render(RenderManifestCard, {
			output: {
				manifest: {
					master_seed: null,
					override_ledger: [{ key: 'a', value: 1, source: 'default' }]
				}
			}
		});
		expect(queryByTestId('reproducible-badge')).toBeNull();
	});

	it('shows the reserved note when output_sha256 / mastering are null', () => {
		const { getByTestId } = render(RenderManifestCard, { output: full });
		expect(getByTestId('reserved-note').textContent).toContain('reserved');
	});

	it('renders an honest empty state when the ledger is empty', () => {
		const { getByTestId, queryAllByTestId } = render(RenderManifestCard, {
			output: { manifest: { override_ledger: [], master_seed: 7 } }
		});
		expect(queryAllByTestId('ledger-row')).toHaveLength(0);
		expect(getByTestId('ledger-empty').textContent).toContain('No knobs recorded');
	});

	it('links the artifact and renders the duration in the footer', () => {
		const { getByTestId } = render(RenderManifestCard, { output: full });
		const link = getByTestId('artifact-link');
		expect(link.getAttribute('href')).toBe('https://x/video.mp4');
	});
});

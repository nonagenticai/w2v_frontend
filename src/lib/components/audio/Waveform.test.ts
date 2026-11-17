import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

// wavesurfer needs a real Web Audio stack + canvas measurement, neither of which
// happy-dom has. The mock records every instance it hands out so the lifecycle
// (create / destroy on unmount / re-create on a new src) can be asserted.
const { create, instances } = vi.hoisted(() => {
	const instances: {
		options: Record<string, unknown>;
		destroy: ReturnType<typeof vi.fn>;
		playPause: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		load: ReturnType<typeof vi.fn>;
	}[] = [];
	const create = vi.fn((options: Record<string, unknown>) => {
		const instance = {
			options,
			destroy: vi.fn(),
			playPause: vi.fn(),
			on: vi.fn(),
			load: vi.fn()
		};
		instances.push(instance);
		return instance;
	});
	return { create, instances };
});
vi.mock('wavesurfer.js', () => ({ default: { create } }));
vi.mock('$app/environment', () => ({ browser: true }));

import Waveform from './Waveform.svelte';

describe('Waveform', () => {
	beforeEach(() => {
		create.mockClear();
		instances.length = 0;
	});

	it('renders the waveform container and constructs wavesurfer when a src is given', async () => {
		const { getByTestId, queryByTestId } = render(Waveform, {
			props: { src: 'https://cdn/vo.mp3', title: 'Voiceover' }
		});
		expect(getByTestId('waveform-canvas')).toBeTruthy();
		expect(queryByTestId('waveform-empty')).toBeNull();
		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0][0].url).toBe('https://cdn/vo.mp3');
		// Play/pause control + a current-time / duration readout.
		expect(getByTestId('waveform-play')).toBeTruthy();
		expect(getByTestId('waveform-time').textContent).toContain('0:00 / 0:00');
	});

	it('renders a placeholder and never constructs wavesurfer when src is empty or null', async () => {
		// testing-library binds queries to document.body, so the null case must be
		// unmounted before the '' case renders or both placeholders match.
		const nullCase = render(Waveform, { props: { src: null } });
		expect(nullCase.getByTestId('waveform-empty')).toBeTruthy();
		expect(nullCase.queryByTestId('waveform-canvas')).toBeNull();
		await waitFor(() => expect(create).not.toHaveBeenCalled());
		nullCase.unmount();

		const emptyCase = render(Waveform, { props: { src: '' } });
		expect(emptyCase.getByTestId('waveform-empty')).toBeTruthy();
		expect(emptyCase.queryByTestId('waveform-canvas')).toBeNull();
		expect(create).not.toHaveBeenCalled();
	});

	it('destroys the wavesurfer instance on unmount (no leaked audio)', async () => {
		const { unmount } = render(Waveform, { props: { src: 'https://cdn/vo.mp3' } });
		await waitFor(() => expect(instances).toHaveLength(1));
		expect(instances[0].destroy).not.toHaveBeenCalled();
		unmount();
		await waitFor(() => expect(instances[0].destroy).toHaveBeenCalledTimes(1));
	});

	it('tears down and re-creates when src changes, so clip A audio never plays under clip B', async () => {
		const { rerender } = render(Waveform, { props: { src: 'https://cdn/a.mp3' } });
		await waitFor(() => expect(instances).toHaveLength(1));

		await rerender({ src: 'https://cdn/b.mp3' });
		await waitFor(() => expect(create).toHaveBeenCalledTimes(2));

		// The old instance is gone — not merely left in place pointing at A.
		expect(instances[0].destroy).toHaveBeenCalledTimes(1);
		expect(instances[0].options.url).toBe('https://cdn/a.mp3');
		expect(instances[1].options.url).toBe('https://cdn/b.mp3');
		expect(instances[1].destroy).not.toHaveBeenCalled();
	});

	it('destroys the instance and shows the placeholder when src is cleared', async () => {
		const { rerender, getByTestId } = render(Waveform, { props: { src: 'https://cdn/a.mp3' } });
		await waitFor(() => expect(instances).toHaveLength(1));
		await rerender({ src: null });
		await waitFor(() => expect(instances[0].destroy).toHaveBeenCalledTimes(1));
		expect(create).toHaveBeenCalledTimes(1);
		expect(getByTestId('waveform-empty')).toBeTruthy();
	});
});

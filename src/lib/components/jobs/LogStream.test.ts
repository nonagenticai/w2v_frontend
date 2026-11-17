import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// The whole point of this file: "Copy logs" used to `catch {}`, so wherever the
// clipboard is refused (insecure origin, no focus, restrictive permissions
// policy) the button was inert with no explanation. `toastError` is the signal,
// so it is what must be asserted.
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('$lib/stores/toast.svelte.js', () => ({
	toastError: (...a: unknown[]) => toastError(...a),
	toastSuccess: (...a: unknown[]) => toastSuccess(...a)
}));

import { render, fireEvent, waitFor } from '@testing-library/svelte';
import LogStream from './LogStream.svelte';

const writeText = vi.fn();

beforeAll(() => {
	// jsdom implements neither of these; the auto-scroll $effect calls scrollTo
	// on every log change, and the component reads navigator.clipboard directly.
	Element.prototype.scrollTo = () => {};
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText: (...a: unknown[]) => writeText(...a) },
		configurable: true
	});
});

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

const LOGS = ['stage started', 'stage completed'];

describe('LogStream — copy', () => {
	it('surfaces a toast when the clipboard write is refused', async () => {
		writeText.mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
		const { getByTestId } = render(LogStream, { logs: LOGS });

		await fireEvent.click(getByTestId('copy-logs-btn'));

		await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
		// The message has to be about copying, not a generic "something failed".
		expect(String(toastError.mock.calls[0][0])).toMatch(/copy/i);
	});

	it('does not toast on a successful copy — the check icon is the only signal', async () => {
		writeText.mockResolvedValue(undefined);
		const { getByTestId } = render(LogStream, { logs: LOGS });

		await fireEvent.click(getByTestId('copy-logs-btn'));

		await waitFor(() => expect(writeText).toHaveBeenCalledWith(LOGS.join('\n')));
		expect(toastError).not.toHaveBeenCalled();
		// Guards against "fix the silence by toasting twice".
		expect(toastSuccess).not.toHaveBeenCalled();
	});
});

describe('LogStream — accessible names', () => {
	// Both toolbar buttons are icon-only; without an aria-label a screen reader
	// announces them as just "button".
	it('names the icon-only copy and clear buttons', () => {
		const { getByRole } = render(LogStream, { logs: LOGS, onclear: () => {} });
		expect(getByRole('button', { name: 'Copy logs' })).toBeTruthy();
		expect(getByRole('button', { name: 'Clear logs' })).toBeTruthy();
	});
});

import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import ErrorBoundary from './ErrorBoundary.svelte';

describe('ErrorBoundary', () => {
	it('renders children when no error', () => {
		render(ErrorBoundary, {
			props: { error: null, onRetry: vi.fn() },
			context: new Map()
		});
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('renders error state with message and retry button when error is set', () => {
		const onRetry = vi.fn();
		render(ErrorBoundary, {
			props: { error: new Error('boom'), onRetry }
		});
		expect(screen.getByRole('alert')).toBeInTheDocument();
		expect(screen.getByText(/boom/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /retry/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('toggles stack trace visibility', async () => {
		const err = new Error('boom');
		err.stack = 'Error: boom\n    at test.ts:1';
		render(ErrorBoundary, { props: { error: err, onRetry: vi.fn(), showStack: true } });

		expect(screen.queryByText(/at test\.ts/)).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /details/i }));
		expect(screen.getByText(/at test\.ts/)).toBeInTheDocument();
	});

	it('never offers the stack trace outside dev', () => {
		const err = new Error('boom');
		err.stack = 'Error: boom\n    at test.ts:1';
		render(ErrorBoundary, { props: { error: err, onRetry: vi.fn(), showStack: false } });
		expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
		expect(screen.queryByText(/at test\.ts/)).toBeNull();
	});

	it('renders children snippet when no error', () => {
		const children = createRawSnippet(() => ({
			render: () => `<p data-testid="child">child content</p>`
		}));
		render(ErrorBoundary, { props: { error: null, onRetry: vi.fn(), children } });
		expect(screen.getByTestId('child')).toHaveTextContent('child content');
	});
});

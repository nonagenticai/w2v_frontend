import { describe, it, expect, vi, beforeEach } from 'vitest';

// The create wizard lands here as `/projects/{id}?byo_required=<modality>` when the
// project was created but its first run was refused with 402 byo_provider_required
// (w2v_orchestrator#1108). The page must say what to do; the heavy workspace and
// the SSE subscription are stubbed — only the notice wiring is under test.
const pageHolder = vi.hoisted(() => ({ url: new URL('http://localhost/projects/p-1') }));
vi.mock('$app/state', () => ({
	get page() {
		return { url: pageHolder.url };
	}
}));
vi.mock('$app/paths', () => ({ resolve: (p: string) => p }));
vi.mock('$lib/stores/auth.svelte', () => ({ isTenantAdmin: () => true }));
vi.mock('$lib/stores/projects-events', () => ({
	subscribeProjectEvents: () => ({ close: () => undefined })
}));
vi.mock('$lib/stores/projects.svelte.js', () => ({ getOne: () => undefined }));
vi.mock('$lib/components/workspace', async () => ({
	ProjectWorkspace: (await import('$lib/test-stubs/WorkspaceStub.svelte')).default
}));

import { render, screen } from '@testing-library/svelte';
import Page from './+page.svelte';

const data = { project: { id: 'p-1', title: 'T' }, blueprintStages: [] } as never;

beforeEach(() => {
	pageHolder.url = new URL('http://localhost/projects/p-1');
});

describe('projects/[pid] — ?byo_required notice', () => {
	it('?byo_required=tts renders the TTS notice with the provider-slot link', () => {
		pageHolder.url = new URL('http://localhost/projects/p-1?byo_required=tts');
		render(Page, { props: { data } });
		expect(screen.getByTestId('byo-provider-required-message').textContent?.trim()).toBe(
			'Configure your own TTS provider to continue'
		);
		expect(screen.getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=tts#provider-slot-tts'
		);
		expect(screen.getByTestId('workspace-stub')).toBeTruthy();
	});

	it('no query param → no notice, just the workspace', () => {
		render(Page, { props: { data } });
		expect(screen.queryByTestId('byo-provider-required')).toBeNull();
		expect(screen.getByTestId('workspace-stub')).toBeTruthy();
	});
});

describe('projects/[pid] — multi-slot ?byo_required (#1150)', () => {
	it('lists every slot and links /providers?missing=<all>', () => {
		pageHolder.url = new URL('http://localhost/projects/p-1?byo_required=llm%2Ctts%2Cimage');
		render(Page, { props: { data } });
		expect(screen.getByTestId('byo-provider-required-message').textContent?.trim()).toBe(
			'Configure your own LLM, TTS and image providers to continue'
		);
		expect(screen.getByTestId('byo-provider-settings-link').getAttribute('href')).toBe(
			'/providers?missing=llm,tts,image#provider-slot-llm'
		);
	});
});

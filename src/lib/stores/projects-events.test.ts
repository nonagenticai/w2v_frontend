import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api', () => ({
	projects: {
		list: vi.fn(),
		get: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		addDeliverable: vi.fn(),
		addChild: vi.fn(),
		reorderChildren: vi.fn()
	},
	deliverables: {
		get: vi.fn(),
		start: vi.fn()
	},
	// projects-events now routes `panel_image_status` into the storyboard store,
	// which named-imports `storyboard` from $lib/api — the mock must export it or
	// the module graph fails to link (even though nothing here calls it).
	storyboard: {
		listPanels: vi.fn(),
		generatePanelImage: vi.fn(),
		getPanelImageJob: vi.fn()
	}
}));

import { projects as projectsApi } from '$lib/api';
import { invalidate, getOne, setOneSnapshot } from './projects.svelte.js';
import { subscribeProjectEvents } from './projects-events.js';
import type { ProjectDetailResponse, ProjectResponse } from '$lib/types';

// ---------------------------------------------------------------------------
// Fake EventSource: captures named listeners and lets tests dispatch events.
// ---------------------------------------------------------------------------

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
	url: string;
	listeners: Record<string, Listener[]> = {};
	closed = false;

	constructor(url: string) {
		this.url = url;
		FakeEventSource.lastInstance = this;
	}

	addEventListener(name: string, listener: Listener): void {
		(this.listeners[name] ??= []).push(listener);
	}

	close(): void {
		this.closed = true;
	}

	dispatch(name: string, data: unknown): void {
		const event = { data: JSON.stringify(data) } as MessageEvent<string>;
		for (const listener of this.listeners[name] ?? []) listener(event);
	}

	static lastInstance: FakeEventSource | null = null;
}

const realEventSource = globalThis.EventSource;

beforeEach(() => {
	(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
	FakeEventSource.lastInstance = null;
	invalidate();
	vi.mocked(projectsApi.get).mockReset();
});

afterEach(() => {
	(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = realEventSource;
});

const T_ID = '00000000-0000-0000-0000-00000000000a';
const S_ID = '00000000-0000-0000-0000-00000000000b';
const NOW = '2026-05-08T00:00:00Z';

// Seed a parent into the store. addChild relies on it being cached.
const parent: ProjectDetailResponse = {
	id: 'p1',
	tenant_id: T_ID,
	owner_subject_id: S_ID,
	visibility: 'tenant',
	title: 'Parent',
	type: 'course',
	brief: { audience: 'devs', key_messages: [] },
	brand: {},
	voice: {},
	theme: {},
	parent_project_id: null,
	position: null,
	is_branch: false,
	status: 'drafting',
	created_at: NOW,
	updated_at: NOW,
	open_notes_count: 0,
	deliverable_count: 0,
	deliverables: [],
	children: []
};

function makeChild(
	id: string,
	position: number,
	status: ProjectResponse['status'] = 'drafting'
): ProjectResponse {
	return {
		id,
		tenant_id: T_ID,
		owner_subject_id: S_ID,
		visibility: 'tenant',
		title: `Child ${id}`,
		type: 'lesson',
		parent_project_id: 'p1',
		position,
		is_branch: false,
		status,
		created_at: NOW,
		updated_at: NOW,
		deliverable_count: 0
	};
}

describe('subscribeProjectEvents', () => {
	it('opens an EventSource at the project events endpoint', () => {
		const handle = subscribeProjectEvents('p1');
		expect(FakeEventSource.lastInstance?.url).toBe('/api/projects/p1/events');
		handle.close();
		expect(FakeEventSource.lastInstance?.closed).toBe(true);
	});

	it('child_added fetches the new child and applies it to the cached parent', async () => {
		setOneSnapshot(parent);
		const newChild: ProjectDetailResponse = {
			...parent,
			id: 'c1',
			title: 'Child c1',
			type: 'lesson',
			parent_project_id: 'p1',
			position: 1,
			children: []
		};
		vi.mocked(projectsApi.get).mockResolvedValueOnce(newChild);

		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_added', { child_id: 'c1' });

		// Allow the awaited fetch + applyChildAdded to settle.
		await vi.waitFor(() => {
			expect(getOne('p1')?.children).toHaveLength(1);
		});
		expect(projectsApi.get).toHaveBeenCalledWith('c1');
		expect(getOne('p1')?.children[0]?.id).toBe('c1');
		handle.close();
	});

	it('child_added swallows fetch errors so a transient 404 cannot crash the stream', async () => {
		setOneSnapshot(parent);
		vi.mocked(projectsApi.get).mockRejectedValueOnce(new Error('404'));

		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_added', { child_id: 'c-gone' });

		// Wait a tick for the rejected promise to resolve.
		await Promise.resolve();
		await Promise.resolve();
		expect(getOne('p1')?.children).toEqual([]);
		handle.close();
	});

	it('child_added ignores payloads without child_id', async () => {
		setOneSnapshot(parent);
		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_added', { foo: 'bar' });
		await Promise.resolve();
		expect(projectsApi.get).not.toHaveBeenCalled();
		handle.close();
	});

	it('child_reordered re-orders the cached children using the order array', () => {
		setOneSnapshot({
			...parent,
			children: [makeChild('a', 1), makeChild('b', 2), makeChild('c', 3)]
		});
		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_reordered', { order: ['c', 'a', 'b'] });
		const ids = (getOne('p1')?.children ?? []).map((c) => c.id);
		expect(ids).toEqual(['c', 'a', 'b']);
		handle.close();
	});

	it('child_reordered ignores a payload without an order array', () => {
		setOneSnapshot({
			...parent,
			children: [makeChild('a', 1), makeChild('b', 2)]
		});
		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_reordered', { order: 'not-an-array' });
		const ids = (getOne('p1')?.children ?? []).map((c) => c.id);
		expect(ids).toEqual(['a', 'b']);
		handle.close();
	});

	it('child_status_changed updates the matching child', () => {
		setOneSnapshot({
			...parent,
			children: [makeChild('a', 1, 'drafting'), makeChild('b', 2, 'drafting')]
		});
		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_status_changed', {
			child_id: 'a',
			status: 'completed'
		});
		const cached = getOne('p1')?.children ?? [];
		expect(cached.find((c) => c.id === 'a')?.status).toBe('completed');
		expect(cached.find((c) => c.id === 'b')?.status).toBe('drafting');
		handle.close();
	});

	it('child_status_changed ignores payloads missing child_id or status', () => {
		setOneSnapshot({
			...parent,
			children: [makeChild('a', 1, 'drafting')]
		});
		const handle = subscribeProjectEvents('p1');
		FakeEventSource.lastInstance?.dispatch('child_status_changed', { status: 'completed' });
		FakeEventSource.lastInstance?.dispatch('child_status_changed', { child_id: 'a' });
		expect(getOne('p1')?.children[0]?.status).toBe('drafting');
		handle.close();
	});

	it('handle.close() is safe to call more than once', () => {
		const handle = subscribeProjectEvents('p1');
		handle.close();
		handle.close();
		expect(FakeEventSource.lastInstance?.closed).toBe(true);
	});

	it('skips malformed JSON without throwing', async () => {
		setOneSnapshot(parent);
		const handle = subscribeProjectEvents('p1');
		// Drive a child_reordered listener with a non-string event payload.
		const listener = FakeEventSource.lastInstance?.listeners['child_reordered']?.[0];
		expect(listener).toBeDefined();
		expect(() => listener?.({ data: 'not-json{' } as MessageEvent<string>)).not.toThrow();
		handle.close();
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	}
}));

import { projects as projectsApi } from '$lib/api';
import {
	addChild,
	applyChildAdded,
	applyChildReordered,
	applyChildStatusChanged,
	create,
	getList,
	getOne,
	invalidate,
	loadList,
	loadOne,
	reorderChildren,
	setOneSnapshot,
	update
} from './projects.svelte.js';
import type { ProjectDetailResponse, ProjectListResponse, ProjectResponse } from '$lib/types';

const T_ID = '00000000-0000-0000-0000-00000000000a';
const S_ID = '00000000-0000-0000-0000-00000000000b';
const NOW = '2026-05-08T00:00:00Z';

const sampleProject: ProjectDetailResponse = {
	id: 'p1',
	tenant_id: T_ID,
	owner_subject_id: S_ID,
	visibility: 'tenant',
	title: 'App-A launch promo',
	type: 'promo',
	brief: { audience: 'Indie devs', key_messages: ['Fast', 'Cheap'] },
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

const sampleList: ProjectListResponse = {
	items: [sampleProject],
	total: 1,
	limit: 20,
	offset: 0
};

describe('projects store', () => {
	beforeEach(() => {
		invalidate();
		vi.mocked(projectsApi.list).mockReset();
		vi.mocked(projectsApi.get).mockReset();
		vi.mocked(projectsApi.create).mockReset();
		vi.mocked(projectsApi.update).mockReset();
	});

	it('loadList caches the list and getList returns it', async () => {
		vi.mocked(projectsApi.list).mockResolvedValueOnce(sampleList);
		const result = await loadList({ limit: 20, offset: 0 });
		expect(result).toEqual(sampleList);
		expect(getList()).toEqual(sampleList);
	});

	it('loadOne caches the project by id and getOne returns it', async () => {
		vi.mocked(projectsApi.get).mockResolvedValueOnce(sampleProject);
		const result = await loadOne('p1');
		expect(result.id).toBe('p1');
		expect(getOne('p1')?.title).toBe('App-A launch promo');
	});

	it('loadList: a slow earlier response does not clobber a newer one', async () => {
		// Out-of-order guard: fire two loads; resolve the NEWER (second) first,
		// then the OLDER (first). The store must keep the newer result.
		const older = { ...sampleList, total: 1 };
		const newer = { ...sampleList, total: 99 };
		let resolveOlder!: (v: ProjectListResponse) => void;
		const olderP = new Promise<ProjectListResponse>((r) => (resolveOlder = r));
		vi.mocked(projectsApi.list)
			.mockReturnValueOnce(olderP) // first call (older) — resolves last
			.mockResolvedValueOnce(newer); // second call (newer) — resolves first

		const p1 = loadList(); // older, still pending
		const p2 = loadList(); // newer, resolves immediately
		await p2;
		expect(getList()?.total).toBe(99); // newer wins
		resolveOlder(older);
		await p1;
		expect(getList()?.total).toBe(99); // older must NOT overwrite newer
	});

	it('create populates the by-id cache and invalidates the list cache', async () => {
		vi.mocked(projectsApi.list).mockResolvedValueOnce(sampleList);
		await loadList();
		expect(getList()).not.toBeNull();

		vi.mocked(projectsApi.create).mockResolvedValueOnce({
			...sampleProject,
			id: 'p2',
			title: 'App-B launch promo'
		});
		const created = await create({
			title: 'App-B launch promo',
			type: 'promo',
			visibility: 'tenant',
			deliverables: [{ name: 'd', format: '16x9', captions_mode: 'none' }]
		});
		expect(created.id).toBe('p2');
		expect(getOne('p2')).toBeDefined();
		// list cache cleared so next view re-fetches
		expect(getList()).toBeNull();
	});

	it('create returns deliverables on the response (FE relies on .deliverables.length)', async () => {
		// Regression guard: the new-project page reads project.deliverables.length
		// off the create response to render its success toast. The BE was silently
		// dropping the deliverables[] field on create until 2026-05-08; FE saw
		// undefined.length and threw, surfacing as "Project creation failed" while
		// the project was actually created. Pin the contract: create() resolves
		// to a ProjectDetailResponse whose .deliverables matches what we sent.
		vi.mocked(projectsApi.create).mockResolvedValueOnce({
			...sampleProject,
			id: 'p3',
			title: 'Multi-variant promo',
			deliverables: [
				{
					id: 'd1',
					project_id: 'p3',
					name: '60s horizontal',
					format: '16x9',
					target_duration_seconds: 60,
					captions_mode: 'none',
					status: 'idle',
					created_at: NOW,
					updated_at: NOW
				}
			]
		});
		const created = await create({
			title: 'Multi-variant promo',
			type: 'promo',
			visibility: 'tenant',
			deliverables: [
				{
					name: '60s horizontal',
					format: '16x9',
					target_duration_seconds: 60,
					captions_mode: 'none'
				}
			]
		});
		expect(created.deliverables).toBeDefined();
		expect(created.deliverables).toHaveLength(1);
		expect(created.deliverables[0].name).toBe('60s horizontal');
		// FE-side typeguard: code paths that read .length on create response
		// must not throw.
		expect(() => created.deliverables.length).not.toThrow();
	});

	it('update merges the patched fields back into the cached detail tree', async () => {
		vi.mocked(projectsApi.get).mockResolvedValueOnce(sampleProject);
		await loadOne('p1');

		const patched: ProjectResponse = { ...sampleProject, title: 'New title' };
		vi.mocked(projectsApi.update).mockResolvedValueOnce(patched);
		const result = await update('p1', { title: 'New title' });
		expect(result.title).toBe('New title');
		expect(getOne('p1')?.title).toBe('New title');
		// deliverables (which are not on UpdateProjectRequest) survive the merge
		expect(getOne('p1')?.deliverables).toEqual([]);
	});

	it('addChild appends the returned child to the cached parent detail', async () => {
		setOneSnapshot({ ...sampleProject, children: [] });
		const child: ProjectResponse = {
			id: 'c1',
			tenant_id: T_ID,
			owner_subject_id: S_ID,
			visibility: 'tenant',
			title: 'Lesson 1',
			type: 'lesson',
			parent_project_id: 'p1',
			position: 1,
			is_branch: false,
			status: 'drafting',
			created_at: NOW,
			updated_at: NOW,
			deliverable_count: 0
		};
		vi.mocked(projectsApi.addChild).mockResolvedValueOnce(child);

		const returned = await addChild('p1', {
			type: 'lesson',
			title: 'Lesson 1',
			brief: {},
			deliverables: [{ name: 'd', format: '16x9', captions_mode: 'none' }]
		});

		expect(returned).toEqual(child);
		expect(getOne('p1')?.children.map((c) => c.id)).toEqual(['c1']);
	});

	it('reorderChildren replaces children order in cache + updates positions', async () => {
		const make = (id: string, position: number): ProjectResponse => ({
			id,
			tenant_id: T_ID,
			owner_subject_id: S_ID,
			visibility: 'tenant',
			title: id.toUpperCase(),
			type: 'lesson',
			parent_project_id: 'p1',
			position,
			is_branch: false,
			status: 'drafting',
			created_at: NOW,
			updated_at: NOW,
			deliverable_count: 0
		});
		setOneSnapshot({
			...sampleProject,
			children: [make('a', 1), make('b', 2), make('c', 3)]
		});
		vi.mocked(projectsApi.reorderChildren).mockResolvedValueOnce(undefined);

		await reorderChildren('p1', { ordered_child_ids: ['c', 'a', 'b'] });

		expect(getOne('p1')?.children.map((c) => c.id)).toEqual(['c', 'a', 'b']);
		expect(getOne('p1')?.children.map((c) => c.position)).toEqual([1, 2, 3]);
	});

	it('create with clone_from_project_id forwards the field to the API', async () => {
		const created: ProjectDetailResponse = { ...sampleProject, id: 'cloned' };
		vi.mocked(projectsApi.create).mockResolvedValueOnce(created);

		await create({
			title: 'Cloned',
			type: 'promo',
			visibility: 'tenant',
			deliverables: [{ name: 'd', format: '16x9', captions_mode: 'none' }],
			clone_from_project_id: '00000000-0000-0000-0000-0000000005c1'
		});

		expect(projectsApi.create).toHaveBeenCalledWith(
			expect.objectContaining({ clone_from_project_id: '00000000-0000-0000-0000-0000000005c1' }),
			undefined
		);
	});

	it('invalidate(id) drops the per-id cache; invalidate() drops everything', async () => {
		vi.mocked(projectsApi.get).mockResolvedValueOnce(sampleProject);
		await loadOne('p1');
		expect(getOne('p1')).toBeDefined();

		invalidate('p1');
		expect(getOne('p1')).toBeUndefined();

		vi.mocked(projectsApi.list).mockResolvedValueOnce(sampleList);
		vi.mocked(projectsApi.get).mockResolvedValueOnce(sampleProject);
		await loadList();
		await loadOne('p1');
		invalidate();
		expect(getList()).toBeNull();
		expect(getOne('p1')).toBeUndefined();
	});

	describe('WS reconciliation helpers', () => {
		const makeChild = (id: string, position: number): ProjectResponse => ({
			id,
			tenant_id: T_ID,
			owner_subject_id: S_ID,
			visibility: 'tenant',
			title: id.toUpperCase(),
			type: 'lesson',
			parent_project_id: 'p1',
			position,
			is_branch: false,
			status: 'drafting',
			created_at: NOW,
			updated_at: NOW,
			deliverable_count: 0
		});

		it('applyChildAdded appends a new child to the cached parent', () => {
			setOneSnapshot({ ...sampleProject, children: [] });
			applyChildAdded('p1', makeChild('c1', 1));
			expect(getOne('p1')?.children.map((c) => c.id)).toEqual(['c1']);
		});

		it('applyChildAdded is idempotent on re-delivery', () => {
			setOneSnapshot({ ...sampleProject, children: [makeChild('c1', 1)] });
			applyChildAdded('p1', makeChild('c1', 1));
			expect(getOne('p1')?.children.length).toBe(1);
		});

		it('applyChildAdded is a no-op when the parent is not cached', () => {
			expect(() => applyChildAdded('p-unknown', makeChild('c1', 1))).not.toThrow();
			expect(getOne('p-unknown')).toBeUndefined();
		});

		it('applyChildReordered replaces the order + renumbers positions', () => {
			setOneSnapshot({
				...sampleProject,
				children: [makeChild('a', 1), makeChild('b', 2), makeChild('c', 3)]
			});
			applyChildReordered('p1', ['c', 'a', 'b']);
			expect(getOne('p1')?.children.map((c) => c.id)).toEqual(['c', 'a', 'b']);
			expect(getOne('p1')?.children.map((c) => c.position)).toEqual([1, 2, 3]);
		});

		it('applyChildReordered ignores ids that are not in the children set', () => {
			setOneSnapshot({
				...sampleProject,
				children: [makeChild('a', 1), makeChild('b', 2)]
			});
			applyChildReordered('p1', ['b', 'unknown', 'a']);
			expect(getOne('p1')?.children.map((c) => c.id)).toEqual(['b', 'a']);
			expect(getOne('p1')?.children.map((c) => c.position)).toEqual([1, 2]);
		});

		it('applyChildStatusChanged updates only the matching child', () => {
			setOneSnapshot({
				...sampleProject,
				children: [makeChild('a', 1), makeChild('b', 2)]
			});
			applyChildStatusChanged('p1', 'a', 'completed');
			const kids = getOne('p1')?.children;
			expect(kids?.find((c) => c.id === 'a')?.status).toBe('completed');
			expect(kids?.find((c) => c.id === 'b')?.status).toBe('drafting');
		});

		it('applyChildStatusChanged is a no-op when the parent is missing', () => {
			expect(() => applyChildStatusChanged('p-unknown', 'a', 'completed')).not.toThrow();
		});
	});
});

# Studio v2 Foundation (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse curricula into projects, introduce a type-aware project tree (`promo_video` / `video_course` / `lesson` / `generic`) with recursive child projects, add clone-settings-from-existing on creation, and split verbatim items into two side-by-side tracks (slide / tts).

**Architecture:** One entity tree — every video lives under a `Project` row with `project_type` and an optional `parent_project_id`. A video-course Project owns lesson Projects as children (each itself a Project that runs its own pipeline). The project home renders a type-specific view (`PromoProjectHome` / `CourseProjectHome` / `LessonProjectHome`) over a shared shell. Brand/voice/tone reuse is a creation-time clone, not a separate entity.

**Tech Stack:** Svelte 5 (runes), SvelteKit 2, TypeScript strict, vitest, svelte-dnd-action, bun (dev) + npm ci (CI). Repo: `nonagenticai/w2v_frontend`. Conventions are in [`CLAUDE.md`](../../CLAUDE.md) and the PR#4 handoff.

**Repo prerequisites:**

- PR https://github.com/nonagenticai/w2v_frontend/pull/4 must be merged first (this plan builds on its routes, stores, components, and the WS extension hook).
- Wizard cleanup (`src/lib/components/wizard/` deletion) merges with this plan or before.

**Backend prerequisites — must land in `w2v_orchestrator` before the FE tasks marked [BE]:**

- [BE-A] Rename column `projects.content_kind` → `projects.project_type` (data-preserving). Enum values unchanged: `promo`, `app_review`, `training_course`, `generic`. Add new value `lesson` for child rows.
- [BE-B] `projects.parent_project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE`, `projects.position int NULL`. Partial unique index `(parent_project_id, position) WHERE parent_project_id IS NOT NULL`.
- [BE-C] Drop `curricula` + `curriculum_lessons` tables (replace `curriculum_lessons` data by upserting parent_project_id+position onto the row's `project_id` Project; copy `accepted_summary_json` onto the lesson Project as `lesson_summary_json` JSONB column).
- [BE-D] Endpoint `POST /api/projects` accepts optional `clone_settings_from: UUID` (server-side copy of `brand_config` / `voice_config` / `theme_config` / brief defaults from the source project; never copies title or status).
- [BE-E] Endpoint `POST /api/projects/{id}/children` body `{project_type, position?, brief, deliverables?}` → returns the child ProjectDetailResponse. Auto-positions to end if `position` omitted.
- [BE-F] Endpoint `PATCH /api/projects/{id}/children/reorder` body `{order: [project_id, ...]}` → 204.
- [BE-G] WS event additions on the parent project's channel: `child_added` (payload: child id+position), `child_reordered` (payload: order), `child_status_changed` (payload: child id+status). Existing `project_completed` continues to fire on lesson Projects.
- [BE-H] `ProjectDetailResponse` adds `parent_project_id`, `position`, `children: ProjectResponse[]` (sorted by position), `lesson_summary_json` (only populated when `project_type=lesson` AND completed).

Tasks marked [FE-only] do not depend on BE. Tasks marked [BE] are blocked until the listed BE letters land.

---

## File Structure

```
src/
├── lib/
│   ├── api/
│   │   └── projects.ts                       # MODIFY  (clone_settings_from + children endpoints)
│   ├── components/
│   │   └── studio/
│   │       ├── BriefForm.svelte              # MODIFY  (clone-settings dropdown header)
│   │       ├── ChildProjectList.svelte       # CREATE  (generalises CurriculumLessonList)
│   │       ├── CourseProjectHome.svelte      # CREATE
│   │       ├── CurriculumLessonList.svelte   # DELETE
│   │       ├── LessonProjectHome.svelte      # CREATE
│   │       ├── ProjectTypePicker.svelte      # CREATE
│   │       ├── PromoProjectHome.svelte       # CREATE  (extracted from current /projects/[pid])
│   │       ├── SyllabusEditor.svelte         # CREATE
│   │       ├── VerbatimItemList.svelte       # KEEP   (single-track presentational; parent composes two)
│   │       ├── VerbatimTwoTrack.svelte       # CREATE  (renders two VerbatimItemList side-by-side)
│   │       └── index.ts                      # MODIFY  (exports)
│   ├── stores/
│   │   ├── projects.svelte.ts                # MODIFY  (children + clone + reorder + WS reconcile)
│   │   ├── projects.test.ts                  # MODIFY  (new tests)
│   │   └── curricula.svelte.ts               # DELETE
│   └── types/
│       ├── projects.ts                       # MODIFY  (project_type rename, parent fields, children)
│       └── curricula.ts                      # DELETE
└── routes/
    ├── curricula/                            # DELETE  (entire subtree)
    ├── projects/
    │   ├── +page.svelte                      # MODIFY  (type filter chips, hide lessons by default)
    │   ├── +page.ts                          # MODIFY  (read ?type from URL)
    │   ├── [pid]/
    │   │   ├── +page.svelte                  # MODIFY  (type-aware shell; delegates to *Home component)
    │   │   └── +page.ts                      # MODIFY  (no behavioural change, just type sync)
    │   └── new/
    │       ├── +page.svelte                  # MODIFY  (type-picker first step + clone dropdown)
    │       └── +page.ts                      # MODIFY  (load existing-projects list for clone dropdown)
```

---

## Task ordering and dependencies

| #   | Task                                                                    | BE deps                | FE deps |
| --- | ----------------------------------------------------------------------- | ---------------------- | ------- |
| 1   | Types: project_type rename + recursion fields                           | BE-A, BE-B             | —       |
| 2   | API client + store: children + clone + reorder                          | BE-D, BE-E, BE-F, BE-H | 1       |
| 3   | Drop /curricula routes + curricula store + curricula types              | BE-C                   | 1       |
| 4   | /projects list: type-filter chips + hide-lesson default                 | —                      | 1, 3    |
| 5   | Extract PromoProjectHome from current /projects/[pid]                   | —                      | 1       |
| 6   | ChildProjectList (generalised from CurriculumLessonList)                | —                      | 1       |
| 7   | SyllabusEditor (audience + outline + objectives panel)                  | —                      | 1       |
| 8   | CourseProjectHome composes 6+7                                          | BE-E, BE-F, BE-G, BE-H | 2, 6, 7 |
| 9   | LessonProjectHome (course banner + prior-summary block)                 | BE-H                   | 2, 5    |
| 10  | Type-aware project home shell                                           | —                      | 5, 8, 9 |
| 11  | ProjectTypePicker on /projects/new step 1                               | —                      | 1       |
| 12  | Clone-settings-from dropdown on /projects/new                           | BE-D                   | 2, 11   |
| 13  | VerbatimTwoTrack composition + wire into project home                   | —                      | 5       |
| 14  | WS reconciliation: child_added / child_reordered / child_status_changed | BE-G                   | 2, 8    |

Each task ends with green local checks (`bun run check`, `bun run test:run`) and a commit. After Task 14 the foundation is ready and Plan B (annotations + diff view) can begin.

---

### Task 1: Types — project_type rename + recursion fields

**Files:**

- Modify: `src/lib/types/projects.ts`
- Modify: `src/lib/types/index.ts` (drop curricula re-exports — also covered by Task 3)

- [ ] **Step 1: Inspect current types**

```bash
grep -n "content_kind\|ContentKind\|CONTENT_KIND" src/lib/types/projects.ts
```

Note every occurrence — they all rename to `project_type` / `ProjectType` / `PROJECT_TYPE`.

- [ ] **Step 2: Replace `content_kind` → `project_type` in `src/lib/types/projects.ts`**

```typescript
// src/lib/types/projects.ts — relevant exports

export type ProjectType =
	| 'promo' // promo videos
	| 'app_review' // future
	| 'training_course' // course root
	| 'generic'
	| 'lesson'; // child of a training_course project

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
	promo: 'Promo video',
	app_review: 'App review',
	training_course: 'Course',
	generic: 'Generic',
	lesson: 'Lesson'
};

export interface ProjectResponse {
	id: string;
	tenant_id: string;
	title: string;
	project_type: ProjectType;
	status: 'drafting' | 'producing' | 'completed' | 'archived';
	parent_project_id: string | null;
	position: number | null;
	brand_config: Record<string, unknown> | null;
	voice_config: Record<string, unknown> | null;
	theme_config: Record<string, unknown> | null;
	brief: ProjectBrief;
	created_at: string;
	updated_at: string;
}

export interface ProjectDetailResponse extends ProjectResponse {
	deliverables: DeliverableResponse[];
	children: ProjectResponse[]; // ordered by position
	lesson_summary_json: LessonSummary | null; // populated only on completed lesson rows
}

export interface LessonSummary {
	summary_text: string;
	key_points: string[];
	referenced_terms: string[];
}

export interface CreateProjectRequest {
	title: string;
	project_type: ProjectType;
	brief: ProjectBrief;
	brand_config?: Record<string, unknown> | null;
	voice_config?: Record<string, unknown> | null;
	theme_config?: Record<string, unknown> | null;
	clone_settings_from?: string | null;
	deliverables?: CreateDeliverableRequest[];
}

export interface CreateChildProjectRequest {
	project_type: ProjectType;
	position?: number;
	title: string;
	brief: ProjectBrief;
	deliverables?: CreateDeliverableRequest[];
}

export interface ReorderChildrenRequest {
	order: string[]; // child project ids in new order
}
```

Keep `CONTENT_KIND_LABELS` removed — replace **every consumer** with `PROJECT_TYPE_LABELS` in this same step:

```bash
grep -rn "CONTENT_KIND_LABELS\|content_kind" src/ --include="*.svelte" --include="*.ts" -l
```

For each file: rename the symbol/field. The list as of PR#4 merge: `src/routes/projects/+page.svelte`, `src/routes/projects/[pid]/+page.svelte`, `src/routes/projects/new/+page.svelte`. Type-check will catch any miss.

- [ ] **Step 3: Update `src/lib/types/index.ts` re-exports**

```typescript
// src/lib/types/index.ts
export type {
	ProjectType,
	ProjectResponse,
	ProjectDetailResponse,
	ProjectListResponse,
	CreateProjectRequest,
	UpdateProjectRequest,
	CreateChildProjectRequest,
	ReorderChildrenRequest,
	ProjectBrief,
	LessonSummary
} from './projects';
export { PROJECT_TYPE_LABELS } from './projects';
// Drop: any export from './curricula'
```

- [ ] **Step 4: Run type-check; expect breakage in curricula consumers (those go away in Task 3)**

Run: `bun run check`
Expected: errors limited to `src/routes/curricula/**`, `src/lib/stores/curricula.svelte.ts`, `src/lib/api/curricula.ts`, `src/lib/components/studio/CurriculumLessonList.svelte`. No errors anywhere else.

If errors leak elsewhere, you missed a `content_kind` rename — fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/projects.ts src/lib/types/index.ts \
  src/routes/projects/+page.svelte src/routes/projects/[pid]/+page.svelte src/routes/projects/new/+page.svelte
git commit -m "refactor(types): rename content_kind to project_type, add recursion fields"
```

---

### Task 2: API client + store — children, clone, reorder

**Files:**

- Modify: `src/lib/api/projects.ts`
- Modify: `src/lib/stores/projects.svelte.ts`
- Modify: `src/lib/stores/projects.test.ts`

- [ ] **Step 1: Write the failing tests in `src/lib/stores/projects.test.ts`**

Append to the existing test file:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as projectsStore from './projects.svelte';
import { projects as projectsApi } from '$lib/api';

describe('projects store — recursion + cloning', () => {
	beforeEach(() => {
		projectsStore.invalidate();
		vi.restoreAllMocks();
	});

	it('addChild appends a child to the cached parent detail', async () => {
		const parent = makeDetail({ id: 'p1', children: [] });
		projectsStore.setOneSnapshot(parent);

		const child = makeResponse({ id: 'c1', parent_project_id: 'p1', position: 1 });
		vi.spyOn(projectsApi, 'addChild').mockResolvedValue(makeDetail(child));

		await projectsStore.addChild('p1', { project_type: 'lesson', title: 'L1', brief: {} });

		expect(projectsStore.getOne('p1')!.children.map((c) => c.id)).toEqual(['c1']);
	});

	it('reorderChildren replaces children order in cache', async () => {
		const a = makeResponse({ id: 'a', parent_project_id: 'p1', position: 1 });
		const b = makeResponse({ id: 'b', parent_project_id: 'p1', position: 2 });
		const c = makeResponse({ id: 'c', parent_project_id: 'p1', position: 3 });
		projectsStore.setOneSnapshot(makeDetail({ id: 'p1', children: [a, b, c] }));

		vi.spyOn(projectsApi, 'reorderChildren').mockResolvedValue();

		await projectsStore.reorderChildren('p1', ['c', 'a', 'b']);

		expect(projectsStore.getOne('p1')!.children.map((x) => x.id)).toEqual(['c', 'a', 'b']);
		expect(projectsStore.getOne('p1')!.children.map((x) => x.position)).toEqual([1, 2, 3]);
	});

	it('create with clone_settings_from forwards to the API', async () => {
		const spy = vi.spyOn(projectsApi, 'create').mockResolvedValue(makeDetail({ id: 'new1' }));

		await projectsStore.create({
			title: 'New',
			project_type: 'promo',
			brief: {},
			clone_settings_from: 'src1'
		});

		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ clone_settings_from: 'src1' }));
	});
});

// ---- helpers ----
function makeResponse(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
	return {
		id: 'p',
		tenant_id: 't',
		title: 'P',
		project_type: 'promo',
		status: 'drafting',
		parent_project_id: null,
		position: null,
		brand_config: null,
		voice_config: null,
		theme_config: null,
		brief: {},
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...overrides
	};
}

function makeDetail(overrides: Partial<ProjectDetailResponse> = {}): ProjectDetailResponse {
	return {
		...makeResponse(overrides as Partial<ProjectResponse>),
		deliverables: [],
		children: [],
		lesson_summary_json: null,
		...overrides
	};
}
```

Add the `setOneSnapshot` import at top: `import type { ProjectDetailResponse, ProjectResponse } from '$lib/types';`. Also add `setOneSnapshot` export to the store in Step 3 — the curricula store already exposes it, project store does not yet.

- [ ] **Step 2: Run the tests; expect FAIL**

Run: `bun run test:run src/lib/stores/projects.test.ts`
Expected: FAIL — `addChild`, `reorderChildren`, `setOneSnapshot` not exported. `create` test passes only after the API client adds `clone_settings_from` (it does, since the type allows it; this one may pass already).

- [ ] **Step 3: Add the API client methods in `src/lib/api/projects.ts`**

```typescript
import type {
	ProjectResponse,
	ProjectDetailResponse,
	ProjectListResponse,
	CreateProjectRequest,
	UpdateProjectRequest,
	CreateDeliverableRequest,
	DeliverableResponse,
	CreateChildProjectRequest,
	ReorderChildrenRequest
} from '$lib/types';
import { api } from './client.js';

export const projects = {
	list(params?: {
		status?: string;
		type?: string;
		limit?: number;
		offset?: number;
	}): Promise<ProjectListResponse> {
		const qs = new URLSearchParams();
		if (params?.status) qs.set('status', params.status);
		if (params?.type) qs.set('type', params.type);
		if (params?.limit !== undefined) qs.set('limit', String(params.limit));
		if (params?.offset !== undefined) qs.set('offset', String(params.offset));
		const suffix = qs.toString() ? `?${qs}` : '';
		return api.get<ProjectListResponse>(`/projects${suffix}`);
	},
	get(id: string): Promise<ProjectDetailResponse> {
		return api.get<ProjectDetailResponse>(`/projects/${id}`);
	},
	create(req: CreateProjectRequest): Promise<ProjectDetailResponse> {
		return api.post<ProjectDetailResponse>('/projects', req);
	},
	update(id: string, req: UpdateProjectRequest): Promise<ProjectResponse> {
		return api.patch<ProjectResponse>(`/projects/${id}`, req);
	},
	addDeliverable(id: string, req: CreateDeliverableRequest): Promise<DeliverableResponse> {
		return api.post<DeliverableResponse>(`/projects/${id}/deliverables`, req);
	},
	addChild(id: string, req: CreateChildProjectRequest): Promise<ProjectDetailResponse> {
		return api.post<ProjectDetailResponse>(`/projects/${id}/children`, req);
	},
	reorderChildren(id: string, req: ReorderChildrenRequest): Promise<void> {
		return api.patch<void>(`/projects/${id}/children/reorder`, req);
	}
};
```

- [ ] **Step 4: Add the store methods in `src/lib/stores/projects.svelte.ts`**

Append to the existing file:

```typescript
import type {
	CreateChildProjectRequest,
	ProjectResponse,
	ReorderChildrenRequest
} from '$lib/types';

export function setOneSnapshot(detail: ProjectDetailResponse): void {
	byId = { ...byId, [detail.id]: detail };
}

export async function addChild(
	parentId: string,
	req: CreateChildProjectRequest
): Promise<ProjectDetailResponse> {
	const child = await projectsApi.addChild(parentId, req);
	// Cache the child by its own id and append to parent.children.
	byId = { ...byId, [child.id]: child };
	const parent = byId[parentId];
	if (parent) {
		const children = [...parent.children, projectionFromDetail(child)];
		byId = { ...byId, [parentId]: { ...parent, children } };
	}
	return child;
}

export async function reorderChildren(parentId: string, order: string[]): Promise<void> {
	await projectsApi.reorderChildren(parentId, { order });
	const parent = byId[parentId];
	if (!parent) return;
	const byChildId = new Map(parent.children.map((c) => [c.id, c]));
	const reordered: ProjectResponse[] = order
		.map((id, idx) => {
			const c = byChildId.get(id);
			return c ? { ...c, position: idx + 1 } : null;
		})
		.filter((x): x is ProjectResponse => x !== null);
	byId = { ...byId, [parentId]: { ...parent, children: reordered } };
}

// Strip the recursive child / deliverable fields when storing on a parent.children[].
function projectionFromDetail(detail: ProjectDetailResponse): ProjectResponse {
	const { deliverables: _d, children: _c, lesson_summary_json: _l, ...projection } = detail;
	void _d;
	void _c;
	void _l;
	return projection;
}
```

- [ ] **Step 5: Run the tests; expect PASS**

Run: `bun run test:run src/lib/stores/projects.test.ts`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/projects.ts src/lib/stores/projects.svelte.ts src/lib/stores/projects.test.ts
git commit -m "feat(projects): add child, reorder, clone-settings client + store"
```

---

### Task 3: Drop curricula

**Files:**

- Delete: `src/routes/curricula/` (entire subtree)
- Delete: `src/lib/stores/curricula.svelte.ts`, `src/lib/stores/curricula.test.ts`
- Delete: `src/lib/api/curricula.ts`
- Delete: `src/lib/types/curricula.ts`
- Modify: `src/lib/api/index.ts` (remove `export { curricula } from './curricula'`)
- Modify: `src/lib/types/index.ts` (remove curricula re-exports)
- Modify: any layout that links to `/curricula` (typically `src/routes/+layout.svelte` nav)

- [ ] **Step 1: Find every reference**

```bash
grep -rn "curricul" src/ --include="*.svelte" --include="*.ts" -l
```

- [ ] **Step 2: Delete the dead files**

```bash
rm -rf src/routes/curricula
rm src/lib/stores/curricula.svelte.ts src/lib/stores/curricula.test.ts
rm src/lib/api/curricula.ts
rm src/lib/types/curricula.ts
```

- [ ] **Step 3: Remove imports + nav links**

In `src/lib/api/index.ts` drop `export { curricula } from './curricula'`.
In `src/lib/types/index.ts` drop the `from './curricula'` block.
In `src/routes/+layout.svelte` (or wherever the nav is) drop the `Curricula` link. Course Projects will surface in the unified `/projects` list filtered by type.

- [ ] **Step 4: Run check + test**

```bash
bun run check && bun run test:run
```

Expected: 0 errors. Tests still 100% pass (the curricula tests are gone).

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat(projects): remove curricula routes/store/types — collapsed into projects"
```

---

### Task 4: /projects list — type-filter chips, hide lessons by default

**Files:**

- Modify: `src/routes/projects/+page.svelte`
- Modify: `src/routes/projects/+page.ts`

- [ ] **Step 1: Update the loader to read `?type=`**

```typescript
// src/routes/projects/+page.ts
import type { PageLoad } from './$types';
import { loadList } from '$lib/stores/projects.svelte';

export const load: PageLoad = async ({ url }) => {
	const status = url.searchParams.get('status') ?? '';
	const type = url.searchParams.get('type') ?? '';
	const page = Number(url.searchParams.get('page') ?? '1');
	const limit = 20;
	// Lesson rows show only when explicitly filtered to type=lesson;
	// otherwise the BE excludes them (parent_project_id IS NOT NULL).
	await loadList({
		status: status || undefined,
		type: type || undefined,
		limit,
		offset: (page - 1) * limit
	});
	return { currentStatus: status, currentType: type, currentPage: page };
};
```

(Server-side filter on `parent_project_id IS NULL` is enforced by the BE list endpoint when `type !== 'lesson'`. If you can't depend on that yet, filter client-side: `list.items.filter(p => p.project_type === 'lesson' ? currentType === 'lesson' : true)`.)

- [ ] **Step 2: Add type-filter chips above the status tabs in `+page.svelte`**

Replace the section that renders status tabs with a stacked `[Type chips] [Status tabs]`:

```svelte
<script lang="ts">
	// ... existing imports stay; add:
	import { PROJECT_TYPE_LABELS, type ProjectType } from '$lib/types';

	let activeType = $state<'' | ProjectType>('');
	let lastSyncedType: '' | ProjectType = '';

	$effect(() => {
		activeType = (data.currentType as ProjectType) || '';
		lastSyncedType = activeType;
	});

	$effect(() => {
		if (activeType !== lastSyncedType) {
			lastSyncedType = activeType;
			const params = new URLSearchParams();
			if (activeType) params.set('type', activeType);
			if (activeTab) params.set('status', activeTab);
			params.set('page', '1');
			goto(`/projects?${params}`, { replaceState: true, noScroll: true });
		}
	});

	const typeChips: ReadonlyArray<{ value: '' | ProjectType; label: string }> = [
		{ value: '', label: 'All' },
		{ value: 'promo', label: PROJECT_TYPE_LABELS.promo },
		{ value: 'training_course', label: PROJECT_TYPE_LABELS.training_course },
		{ value: 'generic', label: PROJECT_TYPE_LABELS.generic }
		// 'lesson' deliberately excluded — they nest under their course.
	];
</script>

<div class="mb-3 flex flex-wrap gap-2">
	{#each typeChips as chip (chip.value)}
		<button
			type="button"
			class="rounded-full px-3 py-1 text-xs font-medium transition
             {activeType === chip.value
				? 'bg-primary text-primary-fg'
				: 'bg-surface-2 text-text-secondary hover:bg-surface-3'}"
			onclick={() => (activeType = chip.value)}
		>
			{chip.label}
		</button>
	{/each}
</div>
```

- [ ] **Step 3: Surface project_type on each row card**

In the row template add a small badge between title and status:

```svelte
<Badge variant="default">{PROJECT_TYPE_LABELS[project.project_type]}</Badge>
```

- [ ] **Step 4: Run check + test + manual smoke**

```bash
bun run check && bun run test:run && bun run dev
```

Manual: open `/projects`, click each chip, confirm URL updates with `?type=…`, refresh persists state.

- [ ] **Step 5: Commit**

```bash
git add src/routes/projects/+page.svelte src/routes/projects/+page.ts
git commit -m "feat(projects): type-filter chips on list, hide lessons by default"
```

---

### Task 5: Extract `PromoProjectHome` from current /projects/[pid]

The current `/projects/[pid]/+page.svelte` is the de-facto promo home (deliverables grid + brief + verbatim + status). Move its body verbatim into a component. The page becomes a thin shell in Task 10.

**Files:**

- Create: `src/lib/components/studio/PromoProjectHome.svelte`
- Modify: `src/lib/components/studio/index.ts` (add export)
- Test: `src/lib/components/studio/PromoProjectHome.test.ts`

- [ ] **Step 1: Create the component shell**

```svelte
<!-- src/lib/components/studio/PromoProjectHome.svelte -->
<script lang="ts">
	import type { ProjectDetailResponse } from '$lib/types';

	let {
		project = $bindable<ProjectDetailResponse>()
	}: {
		project: ProjectDetailResponse;
	} = $props();

	// ... move every $state, $derived, helper, and async handler from
	//     src/routes/projects/[pid]/+page.svelte that operates on the
	//     project / deliverables / brief here.
</script>

<!-- Move the full template body from src/routes/projects/[pid]/+page.svelte here, replacing every reference to data.project with project. -->
```

Practical move: copy the entire `<script>` block and `<template>` from `src/routes/projects/[pid]/+page.svelte`; rename `let { data } = $props();` to `let { project = $bindable<ProjectDetailResponse>() } = $props();`; replace `data.project` with `project` throughout. The component is purely presentational + handles its own brief/deliverable mutations through the existing stores.

- [ ] **Step 2: Add the export**

```typescript
// src/lib/components/studio/index.ts
export { default as PromoProjectHome } from './PromoProjectHome.svelte';
// ... existing exports
```

- [ ] **Step 3: Add a render-smoke test**

```typescript
// src/lib/components/studio/PromoProjectHome.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PromoProjectHome from './PromoProjectHome.svelte';
import type { ProjectDetailResponse } from '$lib/types';

describe('PromoProjectHome', () => {
	it('renders the project title and at least the empty deliverables CTA', () => {
		const project = baseProject();
		const { getByText } = render(PromoProjectHome, { props: { project } });
		expect(getByText('Promo A')).toBeTruthy();
	});
});

function baseProject(): ProjectDetailResponse {
	return {
		id: 'p',
		tenant_id: 't',
		title: 'Promo A',
		project_type: 'promo',
		status: 'drafting',
		parent_project_id: null,
		position: null,
		brand_config: null,
		voice_config: null,
		theme_config: null,
		brief: {},
		deliverables: [],
		children: [],
		lesson_summary_json: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z'
	};
}
```

- [ ] **Step 4: Run tests**

```bash
bun run test:run src/lib/components/studio/PromoProjectHome.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/studio/PromoProjectHome.svelte \
        src/lib/components/studio/PromoProjectHome.test.ts \
        src/lib/components/studio/index.ts
git commit -m "feat(studio): extract PromoProjectHome from /projects/[pid] body"
```

---

### Task 6: `ChildProjectList` (generalises CurriculumLessonList)

**Files:**

- Create: `src/lib/components/studio/ChildProjectList.svelte`
- Delete: `src/lib/components/studio/CurriculumLessonList.svelte`
- Modify: `src/lib/components/studio/index.ts`
- Test: `src/lib/components/studio/ChildProjectList.test.ts`

The behaviour is the same as CurriculumLessonList (strict-ordered, prior-must-be-completed gate, drag-to-reorder), but the entity is `ProjectResponse` not `CurriculumLessonResponse`.

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/components/studio/ChildProjectList.svelte -->
<script lang="ts">
	import { Badge, Button } from '$lib/components/ui';
	import { PROJECT_TYPE_LABELS, type ProjectResponse } from '$lib/types';
	import { ChevronRight, ExternalLink, Loader2, Play, GripVertical } from 'lucide-svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';

	interface Props {
		children: ProjectResponse[];
		busy?: boolean;
		busyId?: string | null;
		/** Called when a child row's [Start] button is clicked. Parent decides whether to dispatch its first deliverable. */
		onStart?: (childId: string) => void;
		/** Called when the user drops after a drag — parent wires to projects.reorderChildren. */
		onReorder?: (order: string[]) => void;
	}

	let { children, busy = false, busyId = null, onStart, onReorder }: Props = $props();

	let working = $state<ProjectResponse[]>([]);
	$effect(() => {
		working = [...children].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	});

	function handleConsider(e: CustomEvent<DndEvent<ProjectResponse>>) {
		working = e.detail.items;
	}
	function handleFinalize(e: CustomEvent<DndEvent<ProjectResponse>>) {
		working = e.detail.items;
		onReorder?.(working.map((c) => c.id));
	}

	function canStart(child: ProjectResponse, idx: number): boolean {
		if (child.status !== 'drafting') return false;
		if (idx === 0) return true;
		return working[idx - 1]?.status === 'completed';
	}
</script>

{#if working.length === 0}
	<p class="text-sm text-text-muted">No children yet.</p>
{:else}
	<ul
		use:dndzone={{ items: working, dragDisabled: busy }}
		onconsider={handleConsider}
		onfinalize={handleFinalize}
		class="space-y-2"
	>
		{#each working as child, idx (child.id)}
			<li class="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
				<span class="cursor-grab text-text-muted"><GripVertical size={16} /></span>
				<span class="text-sm text-text-muted w-8 text-right">#{idx + 1}</span>
				<div class="flex-1 min-w-0">
					<p class="truncate text-sm font-medium text-text">{child.title}</p>
					<p class="text-xs text-text-muted">
						{PROJECT_TYPE_LABELS[child.project_type]}
					</p>
				</div>
				<Badge>{child.status}</Badge>
				{#if child.status === 'drafting'}
					<Button
						size="sm"
						disabled={!canStart(child, idx) || busy}
						onclick={() => onStart?.(child.id)}
					>
						{#if busyId === child.id}<Loader2 size={14} class="animate-spin" />{:else}<Play
								size={14}
							/>{/if}
						Start
					</Button>
				{:else}
					<Button as="a" href={`/projects/${child.id}`} size="sm" variant="ghost">
						Open <ChevronRight size={14} />
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
```

- [ ] **Step 2: Test (drag, gating)**

```typescript
// src/lib/components/studio/ChildProjectList.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ChildProjectList from './ChildProjectList.svelte';
import type { ProjectResponse } from '$lib/types';

describe('ChildProjectList', () => {
	it('disables Start on a row when its predecessor is not completed', () => {
		const items = [
			makeChild({ id: 'a', position: 1, status: 'drafting' }),
			makeChild({ id: 'b', position: 2, status: 'drafting' })
		];
		const { getAllByText } = render(ChildProjectList, { props: { children: items } });
		const startButtons = getAllByText('Start').map((el) => el.closest('button')!);
		expect(startButtons[0]).not.toBeDisabled();
		expect(startButtons[1]).toBeDisabled();
	});

	it('emits onReorder with new order after a finalize event', async () => {
		const onReorder = vi.fn();
		const items = [makeChild({ id: 'a', position: 1 }), makeChild({ id: 'b', position: 2 })];
		const { container } = render(ChildProjectList, { props: { children: items, onReorder } });
		const ul = container.querySelector('ul')!;
		await fireEvent(
			ul,
			new CustomEvent('finalize', {
				detail: { items: [items[1], items[0]], info: { trigger: 'drop' } as never }
			})
		);
		expect(onReorder).toHaveBeenCalledWith(['b', 'a']);
	});
});

function makeChild(overrides: Partial<ProjectResponse>): ProjectResponse {
	return {
		id: 'c',
		tenant_id: 't',
		title: 'Lesson',
		project_type: 'lesson',
		status: 'drafting',
		parent_project_id: 'p1',
		position: 1,
		brand_config: null,
		voice_config: null,
		theme_config: null,
		brief: {},
		created_at: '',
		updated_at: '',
		...overrides
	};
}
```

- [ ] **Step 3: Delete `CurriculumLessonList.svelte` and update `index.ts`**

```bash
rm src/lib/components/studio/CurriculumLessonList.svelte
```

```typescript
// src/lib/components/studio/index.ts — drop CurriculumLessonList; add ChildProjectList
export { default as ChildProjectList } from './ChildProjectList.svelte';
```

- [ ] **Step 4: Run check + test**

```bash
bun run check && bun run test:run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/studio/ChildProjectList.svelte \
        src/lib/components/studio/ChildProjectList.test.ts \
        src/lib/components/studio/index.ts
git commit -m "feat(studio): ChildProjectList replaces CurriculumLessonList"
```

---

### Task 7: `SyllabusEditor`

A simple editable panel for course-level metadata: audience, learning outcomes, ordered topic outline. Backed by `project.brief` JSON — no new endpoint needed; saves via the existing `PATCH /projects/{id}`.

**Files:**

- Create: `src/lib/components/studio/SyllabusEditor.svelte`
- Modify: `src/lib/components/studio/index.ts`
- Test: `src/lib/components/studio/SyllabusEditor.test.ts`

- [ ] **Step 1: Component**

```svelte
<!-- src/lib/components/studio/SyllabusEditor.svelte -->
<script lang="ts">
	import { Input, Button } from '$lib/components/ui';
	import { Trash2, Plus, Save } from 'lucide-svelte';
	import type { ProjectBrief } from '$lib/types';

	interface Props {
		brief: ProjectBrief;
		saving?: boolean;
		onSave?: (next: ProjectBrief) => Promise<void>;
	}

	let { brief, saving = false, onSave }: Props = $props();

	let working = $state<ProjectBrief>(structuredClone(brief));
	let dirty = $derived(JSON.stringify(working) !== JSON.stringify(brief));

	function getOutline(): string[] {
		return Array.isArray(working.outline) ? (working.outline as string[]) : [];
	}
	function setOutlineItem(i: number, v: string) {
		const list = [...getOutline()];
		list[i] = v;
		working = { ...working, outline: list };
	}
	function addOutlineItem() {
		working = { ...working, outline: [...getOutline(), ''] };
	}
	function removeOutlineItem(i: number) {
		const list = [...getOutline()];
		list.splice(i, 1);
		working = { ...working, outline: list };
	}
</script>

<section class="space-y-4 rounded-lg border border-border bg-surface p-4">
	<h3 class="text-sm font-semibold text-text">Syllabus</h3>

	<label class="block">
		<span class="text-xs font-medium text-text-secondary">Audience</span>
		<textarea
			rows="2"
			class="mt-1 w-full rounded border border-border bg-input-bg px-2 py-1 text-sm"
			value={(working.audience as string) ?? ''}
			oninput={(e) =>
				(working = { ...working, audience: (e.currentTarget as HTMLTextAreaElement).value })}
		></textarea>
	</label>

	<label class="block">
		<span class="text-xs font-medium text-text-secondary">Learning outcome (one sentence)</span>
		<Input
			value={(working.learning_outcome as string) ?? ''}
			oninput={(v) => (working = { ...working, learning_outcome: v })}
		/>
	</label>

	<div>
		<span class="text-xs font-medium text-text-secondary">Outline</span>
		<ul class="mt-1 space-y-1">
			{#each getOutline() as item, i (i)}
				<li class="flex gap-2">
					<Input value={item} oninput={(v) => setOutlineItem(i, v)} />
					<Button size="sm" variant="ghost" onclick={() => removeOutlineItem(i)}>
						<Trash2 size={14} />
					</Button>
				</li>
			{/each}
		</ul>
		<Button size="sm" variant="ghost" onclick={addOutlineItem}>
			<Plus size={14} /> Add topic
		</Button>
	</div>

	<div class="flex justify-end">
		<Button disabled={!dirty || saving} onclick={() => onSave?.(working)}>
			<Save size={14} /> Save syllabus
		</Button>
	</div>
</section>
```

- [ ] **Step 2: Test**

```typescript
// src/lib/components/studio/SyllabusEditor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SyllabusEditor from './SyllabusEditor.svelte';

describe('SyllabusEditor', () => {
	it('disables Save until brief differs from props', async () => {
		const onSave = vi.fn();
		const { getByRole, getByText } = render(SyllabusEditor, {
			props: { brief: { audience: 'devs' }, onSave }
		});
		const saveBtn = getByText('Save syllabus').closest('button')!;
		expect(saveBtn).toBeDisabled();

		const ta = getByRole('textbox') as HTMLTextAreaElement;
		await fireEvent.input(ta, { target: { value: 'engineers' } });
		expect(saveBtn).not.toBeDisabled();
	});
});
```

- [ ] **Step 3: Run + commit**

```bash
bun run test:run src/lib/components/studio/SyllabusEditor.test.ts && bun run check
git add src/lib/components/studio/SyllabusEditor.svelte src/lib/components/studio/SyllabusEditor.test.ts src/lib/components/studio/index.ts
git commit -m "feat(studio): SyllabusEditor for course briefs"
```

(Add `export { default as SyllabusEditor } from './SyllabusEditor.svelte';` to index.ts.)

---

### Task 8: `CourseProjectHome` composes ChildProjectList + SyllabusEditor

**Files:**

- Create: `src/lib/components/studio/CourseProjectHome.svelte`
- Modify: `src/lib/components/studio/index.ts`
- Test: `src/lib/components/studio/CourseProjectHome.test.ts`

- [ ] **Step 1: Component**

```svelte
<!-- src/lib/components/studio/CourseProjectHome.svelte -->
<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { Plus } from 'lucide-svelte';
	import { ApiError } from '$lib/api';
	import {
		addChild as addChildProject,
		reorderChildren as reorderChildProjects,
		update as updateProject
	} from '$lib/stores/projects.svelte';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import type { ProjectDetailResponse, ProjectBrief } from '$lib/types';
	import ChildProjectList from './ChildProjectList.svelte';
	import SyllabusEditor from './SyllabusEditor.svelte';

	let {
		project = $bindable<ProjectDetailResponse>()
	}: {
		project: ProjectDetailResponse;
	} = $props();

	let savingSyllabus = $state(false);
	let busyChild = $state<string | null>(null);

	async function handleSaveSyllabus(next: ProjectBrief) {
		savingSyllabus = true;
		try {
			await updateProject(project.id, { brief: next });
			project = { ...project, brief: next };
			toastSuccess('Syllabus saved');
		} catch (err) {
			toastError(err instanceof ApiError ? err.message : 'Failed to save syllabus');
		} finally {
			savingSyllabus = false;
		}
	}

	async function handleReorder(order: string[]) {
		try {
			await reorderChildProjects(project.id, order);
		} catch (err) {
			toastError(err instanceof ApiError ? err.message : 'Reorder failed');
		}
	}

	async function handleAddLesson() {
		try {
			const next = project.children.length + 1;
			await addChildProject(project.id, {
				project_type: 'lesson',
				title: `Lesson ${next}`,
				brief: {}
			});
			toastSuccess(`Lesson ${next} added`);
		} catch (err) {
			toastError(err instanceof ApiError ? err.message : 'Add lesson failed');
		}
	}

	async function handleStartLesson(childId: string) {
		busyChild = childId;
		try {
			// The first deliverable on a child project is created by the parent's
			// onAddChild path (BE adds a default 16x9 deliverable when none given).
			// Starting it follows the existing /deliverables/{id}/start pattern;
			// for simplicity, navigate the user into the child project home.
			window.location.href = `/projects/${childId}`;
		} finally {
			busyChild = null;
		}
	}
</script>

<div class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-2xl font-semibold text-text">{project.title}</h1>
			<p class="text-sm text-text-muted">
				Course · {project.children.length} lessons
			</p>
		</div>
		<Button onclick={handleAddLesson}>
			<Plus size={14} /> Add lesson
		</Button>
	</header>

	<SyllabusEditor brief={project.brief} saving={savingSyllabus} onSave={handleSaveSyllabus} />

	<section>
		<h2 class="mb-2 text-sm font-semibold text-text">Lessons</h2>
		<ChildProjectList
			children={project.children}
			busyId={busyChild}
			onStart={handleStartLesson}
			onReorder={handleReorder}
		/>
	</section>
</div>
```

- [ ] **Step 2: Test**

```typescript
// src/lib/components/studio/CourseProjectHome.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CourseProjectHome from './CourseProjectHome.svelte';
import type { ProjectDetailResponse } from '$lib/types';
import * as store from '$lib/stores/projects.svelte';

describe('CourseProjectHome', () => {
	it('renders a row per child', () => {
		const project = makeCourse(2);
		const { getByText } = render(CourseProjectHome, { props: { project } });
		expect(getByText('Lesson 1')).toBeTruthy();
		expect(getByText('Lesson 2')).toBeTruthy();
	});

	it('addChild is called with project_type=lesson on Add lesson', async () => {
		const spy = vi.spyOn(store, 'addChild').mockResolvedValue({} as never);
		const project = makeCourse(0);
		const { getByText } = render(CourseProjectHome, { props: { project } });
		getByText('Add lesson').closest('button')!.click();
		await Promise.resolve();
		expect(spy).toHaveBeenCalledWith(
			project.id,
			expect.objectContaining({ project_type: 'lesson' })
		);
	});
});

function makeCourse(n: number): ProjectDetailResponse {
	return {
		id: 'c',
		tenant_id: 't',
		title: 'Course X',
		project_type: 'training_course',
		status: 'drafting',
		parent_project_id: null,
		position: null,
		brand_config: null,
		voice_config: null,
		theme_config: null,
		brief: {},
		deliverables: [],
		children: Array.from({ length: n }, (_, i) => ({
			id: `l${i + 1}`,
			tenant_id: 't',
			title: `Lesson ${i + 1}`,
			project_type: 'lesson' as const,
			status: 'drafting' as const,
			parent_project_id: 'c',
			position: i + 1,
			brand_config: null,
			voice_config: null,
			theme_config: null,
			brief: {},
			created_at: '',
			updated_at: ''
		})),
		lesson_summary_json: null,
		created_at: '',
		updated_at: ''
	};
}
```

- [ ] **Step 3: Run + commit**

```bash
bun run test:run src/lib/components/studio/CourseProjectHome.test.ts && bun run check
git add src/lib/components/studio/CourseProjectHome.svelte src/lib/components/studio/CourseProjectHome.test.ts src/lib/components/studio/index.ts
git commit -m "feat(studio): CourseProjectHome composes children + syllabus"
```

---

### Task 9: `LessonProjectHome` (course banner + prior-summary)

A lesson is just a project — same body as a promo, plus a banner above and a prior-lesson-summary block below the brief.

**Files:**

- Create: `src/lib/components/studio/LessonProjectHome.svelte`
- Modify: `src/lib/components/studio/index.ts`
- Test: `src/lib/components/studio/LessonProjectHome.test.ts`

- [ ] **Step 1: Component (composes PromoProjectHome under banner + summary)**

```svelte
<!-- src/lib/components/studio/LessonProjectHome.svelte -->
<script lang="ts">
	import { ChevronLeft } from 'lucide-svelte';
	import type { ProjectDetailResponse } from '$lib/types';
	import { loadOne, getOne } from '$lib/stores/projects.svelte';
	import PromoProjectHome from './PromoProjectHome.svelte';

	let {
		project = $bindable<ProjectDetailResponse>()
	}: {
		project: ProjectDetailResponse;
	} = $props();

	// Load the parent course on mount so we can show "Lesson N of M" + the prior lesson's summary.
	let parent = $state<ProjectDetailResponse | undefined>(undefined);
	$effect(() => {
		if (project.parent_project_id) {
			const cached = getOne(project.parent_project_id);
			if (cached) {
				parent = cached;
			} else {
				loadOne(project.parent_project_id).then((p) => (parent = p));
			}
		}
	});

	let priorSummary = $derived.by(() => {
		if (!parent || project.position == null || project.position <= 1) return null;
		const prior = parent.children.find((c) => c.position === project.position! - 1);
		if (!prior) return null;
		return getOne(prior.id)?.lesson_summary_json ?? null;
	});

	// Trigger a load of the prior lesson once parent is known.
	$effect(() => {
		if (parent && project.position && project.position > 1) {
			const priorRow = parent.children.find((c) => c.position === project.position! - 1);
			if (priorRow && !getOne(priorRow.id)) loadOne(priorRow.id);
		}
	});
</script>

{#if parent}
	<a
		href={`/projects/${parent.id}`}
		class="mb-4 inline-flex items-center gap-1 rounded bg-surface-2 px-3 py-1 text-xs text-text-secondary hover:bg-surface-3"
	>
		<ChevronLeft size={14} />
		{parent.title} · Lesson {project.position} of {parent.children.length}
	</a>
{/if}

{#if priorSummary}
	<section class="mb-4 rounded-lg border border-border bg-surface-2 p-3">
		<h4 class="mb-1 text-xs font-semibold text-text-secondary">From the previous lesson</h4>
		<p class="text-sm text-text">{priorSummary.summary_text}</p>
		{#if priorSummary.key_points.length}
			<ul class="mt-2 list-disc pl-5 text-xs text-text-muted">
				{#each priorSummary.key_points as kp}<li>{kp}</li>{/each}
			</ul>
		{/if}
	</section>
{/if}

<PromoProjectHome bind:project />
```

- [ ] **Step 2: Test (renders banner when parent loads)**

```typescript
// src/lib/components/studio/LessonProjectHome.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import LessonProjectHome from './LessonProjectHome.svelte';
import * as store from '$lib/stores/projects.svelte';
import type { ProjectDetailResponse } from '$lib/types';

describe('LessonProjectHome', () => {
	it('renders the parent course banner once getOne resolves', async () => {
		vi.spyOn(store, 'getOne').mockImplementation((id) =>
			id === 'c'
				? ({
						id: 'c',
						title: 'Course X',
						children: [{ id: 'l1', position: 1 } as never],
						children_dummy: true
					} as never)
				: undefined
		);
		const project = lesson({ parent_project_id: 'c', position: 1 });
		const { findByText } = render(LessonProjectHome, { props: { project } });
		expect(await findByText(/Course X · Lesson 1/)).toBeTruthy();
	});
});

function lesson(over: Partial<ProjectDetailResponse>): ProjectDetailResponse {
	return {
		id: 'l1',
		tenant_id: 't',
		title: 'Lesson 1',
		project_type: 'lesson',
		status: 'drafting',
		parent_project_id: null,
		position: 1,
		brand_config: null,
		voice_config: null,
		theme_config: null,
		brief: {},
		deliverables: [],
		children: [],
		lesson_summary_json: null,
		created_at: '',
		updated_at: '',
		...over
	};
}
```

- [ ] **Step 3: Run + commit**

```bash
bun run test:run src/lib/components/studio/LessonProjectHome.test.ts && bun run check
git add src/lib/components/studio/LessonProjectHome.svelte src/lib/components/studio/LessonProjectHome.test.ts src/lib/components/studio/index.ts
git commit -m "feat(studio): LessonProjectHome with course banner + prior-summary"
```

---

### Task 10: Type-aware project home shell

**Files:**

- Modify: `src/routes/projects/[pid]/+page.svelte` (becomes a 20-line shell)

- [ ] **Step 1: Replace the body of `+page.svelte` with a switch on project_type**

```svelte
<script lang="ts">
	import { PromoProjectHome, CourseProjectHome, LessonProjectHome } from '$lib/components/studio';
	import type { ProjectDetailResponse } from '$lib/types';

	let { data } = $props();
	let project = $state<ProjectDetailResponse>(data.project);
	$effect(() => {
		project = data.project;
	});
</script>

{#if project.project_type === 'training_course'}
	<CourseProjectHome bind:project />
{:else if project.project_type === 'lesson'}
	<LessonProjectHome bind:project />
{:else}
	<PromoProjectHome bind:project />
{/if}
```

The `+page.ts` loader stays as it is (already returns `data.project`).

- [ ] **Step 2: Run check + tests + manual smoke**

```bash
bun run check && bun run test:run && bun run dev
```

Open three project URLs in the browser — promo, course, lesson — confirm correct view.

- [ ] **Step 3: Commit**

```bash
git add src/routes/projects/[pid]/+page.svelte
git commit -m "feat(projects): type-aware project home shell"
```

---

### Task 11: `ProjectTypePicker` on /projects/new step 1

**Files:**

- Create: `src/lib/components/studio/ProjectTypePicker.svelte`
- Modify: `src/lib/components/studio/index.ts`
- Modify: `src/routes/projects/new/+page.svelte`

- [ ] **Step 1: Component**

```svelte
<!-- src/lib/components/studio/ProjectTypePicker.svelte -->
<script lang="ts">
	import { Sparkles, GraduationCap, Box } from 'lucide-svelte';
	import { PROJECT_TYPE_LABELS, type ProjectType } from '$lib/types';

	let {
		value = $bindable<ProjectType>('promo')
	}: {
		value: ProjectType;
	} = $props();

	const options: ReadonlyArray<{
		value: Exclude<ProjectType, 'lesson' | 'app_review'>;
		icon: typeof Sparkles;
		blurb: string;
	}> = [
		{
			value: 'promo',
			icon: Sparkles,
			blurb: 'Short-form marketing video. Aspect variants as deliverables.'
		},
		{
			value: 'training_course',
			icon: GraduationCap,
			blurb: 'Course of 10–30 lessons, each a child project.'
		},
		{ value: 'generic', icon: Box, blurb: 'Long-form narrative. Default DAG, no extra structure.' }
	];
</script>

<div class="grid gap-3 md:grid-cols-3">
	{#each options as opt (opt.value)}
		<button
			type="button"
			class="rounded-lg border p-4 text-left transition
             {value === opt.value
				? 'border-primary bg-primary/5'
				: 'border-border hover:border-border-focus'}"
			onclick={() => (value = opt.value)}
		>
			<opt.icon size={20} class="mb-2 text-primary" />
			<p class="text-sm font-semibold text-text">{PROJECT_TYPE_LABELS[opt.value]}</p>
			<p class="mt-1 text-xs text-text-muted">{opt.blurb}</p>
		</button>
	{/each}
</div>
```

- [ ] **Step 2: Wire into /projects/new as step 1**

Refactor `src/routes/projects/new/+page.svelte` to a two-step flow: step 1 = type picker; step 2 = brief form (existing). Keep the existing brief logic; only add a step gate above it.

```svelte
<!-- src/routes/projects/new/+page.svelte (top of script) -->
<script lang="ts">
	import { ProjectTypePicker, BriefForm } from '$lib/components/studio';
	import { Button } from '$lib/components/ui';
	import type { ProjectType, ProjectBrief, CreateProjectRequest } from '$lib/types';
	import { create as createProject } from '$lib/stores/projects.svelte';

	let step = $state<1 | 2>(1);
	let projectType = $state<ProjectType>('promo');
	let title = $state('');
	let brief = $state<ProjectBrief>({});
	let submitting = $state(false);

	// ... handleSubmit unchanged in shape; passes project_type through
</script>

{#if step === 1}
	<h1 class="mb-3 text-xl font-semibold">What are you making?</h1>
	<ProjectTypePicker bind:value={projectType} />
	<div class="mt-6 flex justify-end">
		<Button onclick={() => (step = 2)}>Next</Button>
	</div>
{:else}
	<h1 class="mb-3 text-xl font-semibold">Brief</h1>
	<!-- existing title input + BriefForm + submit button -->
	<BriefForm bind:brief />
	<!-- ... -->
{/if}
```

- [ ] **Step 3: Manual smoke + commit**

```bash
bun run check && bun run test:run && bun run dev
# /projects/new → confirm step gate works, type carries into create payload
git add src/lib/components/studio/ProjectTypePicker.svelte src/lib/components/studio/index.ts src/routes/projects/new/+page.svelte
git commit -m "feat(projects): type-picker step on creation"
```

---

### Task 12: Clone-settings-from dropdown on /projects/new

**Files:**

- Modify: `src/routes/projects/new/+page.ts` (load existing-projects shortlist)
- Modify: `src/routes/projects/new/+page.svelte` (dropdown above BriefForm)

- [ ] **Step 1: Load a shortlist for the dropdown**

```typescript
// src/routes/projects/new/+page.ts
import type { PageLoad } from './$types';
import { loadList, getList } from '$lib/stores/projects.svelte';

export const load: PageLoad = async () => {
	await loadList({ limit: 50 });
	// Lessons can't be cloned (their settings are inherited); also drop drafting-only?
	const items = (getList()?.items ?? []).filter((p) => p.project_type !== 'lesson');
	return {
		cloneables: items.map((p) => ({ id: p.id, title: p.title, project_type: p.project_type }))
	};
};
```

- [ ] **Step 2: Dropdown above BriefForm**

In step 2 of `/projects/new/+page.svelte`:

```svelte
<label class="block">
	<span class="text-xs font-medium text-text-secondary">Clone settings from (optional)</span>
	<select
		class="mt-1 w-full rounded border border-border bg-input-bg px-2 py-1 text-sm"
		bind:value={cloneFrom}
	>
		<option value="">— Start blank —</option>
		{#each data.cloneables as opt (opt.id)}
			<option value={opt.id}>{opt.title} ({opt.project_type})</option>
		{/each}
	</select>
</label>
```

In `<script>`:

```typescript
let cloneFrom = $state<string>('');

async function handleSubmit() {
	submitting = true;
	try {
		const req: CreateProjectRequest = {
			title,
			project_type: projectType,
			brief,
			...(cloneFrom ? { clone_settings_from: cloneFrom } : {})
		};
		const project = await createProject(req);
		goto(`/projects/${project.id}`);
	} catch (err) {
		/* existing error handling */
	} finally {
		submitting = false;
	}
}
```

- [ ] **Step 3: Manual smoke + commit**

Browser: pick a source project, submit, verify the new project copies brand/voice/tone but keeps its own title.

```bash
bun run check && bun run test:run
git add src/routes/projects/new/+page.svelte src/routes/projects/new/+page.ts
git commit -m "feat(projects): clone-settings-from dropdown on creation"
```

---

### Task 13: VerbatimTwoTrack — split slide / tts side-by-side

**Files:**

- Create: `src/lib/components/studio/VerbatimTwoTrack.svelte`
- Modify: `src/lib/components/studio/PromoProjectHome.svelte` — replace single `VerbatimItemList` with `VerbatimTwoTrack`
- Modify: `src/lib/components/studio/index.ts`

`VerbatimItemList` already supports `fixedKind`; the wrapper just renders two of them.

- [ ] **Step 1: Wrapper**

```svelte
<!-- src/lib/components/studio/VerbatimTwoTrack.svelte -->
<script lang="ts">
	import VerbatimItemList from './VerbatimItemList.svelte';
	import type { VerbatimItemCreateRequest, VerbatimItemResponse, VerbatimScope } from '$lib/types';

	interface Props {
		items: VerbatimItemResponse[];
		defaultScope?: VerbatimScope;
		onCreate: (body: VerbatimItemCreateRequest) => Promise<void>;
		onDelete: (itemId: string) => Promise<void>;
		onPlacedClick?: (elementId: string) => void;
	}

	let { items, defaultScope = 'pipeline', onCreate, onDelete, onPlacedClick }: Props = $props();

	let slideItems = $derived(items.filter((i) => i.kind === 'slide'));
	let ttsItems = $derived(items.filter((i) => i.kind === 'tts'));
</script>

<div class="grid gap-4 md:grid-cols-2">
	<section>
		<h3 class="mb-2 text-sm font-semibold text-text">Slide verbatim</h3>
		<VerbatimItemList
			items={slideItems}
			fixedKind="slide"
			description="Text that must appear on a slide."
			{defaultScope}
			{onCreate}
			{onDelete}
			{onPlacedClick}
		/>
	</section>
	<section>
		<h3 class="mb-2 text-sm font-semibold text-text">TTS verbatim</h3>
		<VerbatimItemList
			items={ttsItems}
			fixedKind="tts"
			description="Text that must be spoken verbatim."
			{defaultScope}
			{onCreate}
			{onDelete}
			{onPlacedClick}
		/>
	</section>
</div>
```

- [ ] **Step 2: Replace single list usage in PromoProjectHome**

Find `<VerbatimItemList … />` and swap to `<VerbatimTwoTrack … />`. Same props (items + onCreate + onDelete) — the wrapper handles the kind split.

- [ ] **Step 3: Test (the wrapper splits items correctly)**

```typescript
// src/lib/components/studio/VerbatimTwoTrack.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import VerbatimTwoTrack from './VerbatimTwoTrack.svelte';

describe('VerbatimTwoTrack', () => {
	it('routes slide vs tts items into the two columns', () => {
		const items = [
			{ id: '1', kind: 'slide', text: 'A', status: 'pending', scope: 'pipeline' } as never,
			{ id: '2', kind: 'tts', text: 'B', status: 'pending', scope: 'pipeline' } as never
		];
		const { getByText } = render(VerbatimTwoTrack, {
			props: { items, onCreate: vi.fn(), onDelete: vi.fn() }
		});
		expect(getByText('A')).toBeTruthy();
		expect(getByText('B')).toBeTruthy();
	});
});
```

- [ ] **Step 4: Run + commit**

```bash
bun run test:run && bun run check
git add src/lib/components/studio/VerbatimTwoTrack.svelte \
        src/lib/components/studio/VerbatimTwoTrack.test.ts \
        src/lib/components/studio/PromoProjectHome.svelte \
        src/lib/components/studio/index.ts
git commit -m "feat(studio): two-track verbatim editor (slide / tts)"
```

---

### Task 14: WS reconciliation — child_added / child_reordered / child_status_changed

The `JobProgressState.onExtraEvent` hook (PR#4) is per-job; child events are project-level and don't ride a job channel. Project-level WS subscription opens when the project page mounts.

**Files:**

- Modify: `src/lib/stores/projects.svelte.ts` (add `applyChildAdded`, `applyChildReordered`, `applyChildStatusChanged`)
- Modify: `src/routes/projects/[pid]/+page.svelte` (subscribe on mount, unsubscribe on destroy)
- Modify: `src/lib/stores/projects.test.ts` (apply\* test cases)

- [ ] **Step 1: Tests for the apply\* helpers**

```typescript
// add to src/lib/stores/projects.test.ts
import * as projectsStore from './projects.svelte';

describe('projects store — WS reconciliation', () => {
	beforeEach(() => projectsStore.invalidate());

	it('applyChildAdded appends to the parent', () => {
		projectsStore.setOneSnapshot(makeDetail({ id: 'p', children: [] }));
		projectsStore.applyChildAdded(
			'p',
			makeResponse({ id: 'c1', parent_project_id: 'p', position: 1 })
		);
		expect(projectsStore.getOne('p')!.children.map((c) => c.id)).toEqual(['c1']);
	});

	it('applyChildReordered sorts by the given order', () => {
		projectsStore.setOneSnapshot(
			makeDetail({
				id: 'p',
				children: [
					makeResponse({ id: 'a', parent_project_id: 'p', position: 1 }),
					makeResponse({ id: 'b', parent_project_id: 'p', position: 2 })
				]
			})
		);
		projectsStore.applyChildReordered('p', ['b', 'a']);
		expect(projectsStore.getOne('p')!.children.map((c) => c.id)).toEqual(['b', 'a']);
	});

	it('applyChildStatusChanged updates the matching child', () => {
		projectsStore.setOneSnapshot(
			makeDetail({
				id: 'p',
				children: [makeResponse({ id: 'c1', parent_project_id: 'p', status: 'drafting' })]
			})
		);
		projectsStore.applyChildStatusChanged('p', 'c1', 'completed');
		expect(projectsStore.getOne('p')!.children[0].status).toBe('completed');
	});
});
```

- [ ] **Step 2: Implement**

```typescript
// src/lib/stores/projects.svelte.ts — append
export function applyChildAdded(parentId: string, child: ProjectResponse): void {
	const parent = byId[parentId];
	if (!parent) return;
	if (parent.children.some((c) => c.id === child.id)) return;
	byId = {
		...byId,
		[parentId]: { ...parent, children: [...parent.children, child] }
	};
}

export function applyChildReordered(parentId: string, order: string[]): void {
	const parent = byId[parentId];
	if (!parent) return;
	const byCid = new Map(parent.children.map((c) => [c.id, c]));
	const next = order
		.map((id, idx) => {
			const c = byCid.get(id);
			return c ? { ...c, position: idx + 1 } : null;
		})
		.filter((x): x is ProjectResponse => x !== null);
	byId = { ...byId, [parentId]: { ...parent, children: next } };
}

export function applyChildStatusChanged(
	parentId: string,
	childId: string,
	status: ProjectResponse['status']
): void {
	const parent = byId[parentId];
	if (!parent) return;
	const next = parent.children.map((c) => (c.id === childId ? { ...c, status } : c));
	byId = { ...byId, [parentId]: { ...parent, children: next } };
}
```

- [ ] **Step 3: Subscribe on the project page (lightweight EventSource)**

Add to `src/routes/projects/[pid]/+page.svelte`:

```svelte
<script lang="ts">
	// ... existing imports
	import {
		applyChildAdded,
		applyChildReordered,
		applyChildStatusChanged
	} from '$lib/stores/projects.svelte';
	import { onMount } from 'svelte';

	onMount(() => {
		const url = `/api/projects/${data.project.id}/events`; // SSE endpoint exposed by the orchestrator's notification_service.
		const es = new EventSource(url, { withCredentials: true });
		es.addEventListener('child_added', (e) => {
			const { child } = JSON.parse((e as MessageEvent).data);
			applyChildAdded(data.project.id, child);
		});
		es.addEventListener('child_reordered', (e) => {
			const { order } = JSON.parse((e as MessageEvent).data);
			applyChildReordered(data.project.id, order);
		});
		es.addEventListener('child_status_changed', (e) => {
			const { child_id, status } = JSON.parse((e as MessageEvent).data);
			applyChildStatusChanged(data.project.id, child_id, status);
		});
		return () => es.close();
	});
</script>
```

(If `EventSource` doesn't carry the auth header, fall back to a WS connection that uses the same `X-Tenant-Id: Bearer <token>` pattern as `JobProgressState`. Match whichever transport the orchestrator's project-channel uses — coordinate with BE-G.)

- [ ] **Step 4: Run check + tests**

```bash
bun run test:run && bun run check
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/projects.svelte.ts src/lib/stores/projects.test.ts src/routes/projects/[pid]/+page.svelte
git commit -m "feat(projects): live-reconcile child_added/reordered/status from project SSE"
```

---

## Final verification

- [ ] **Local checks (must all be green):**

```bash
bun run check
bun run test:run
bun run build
```

- [ ] **Critical CI gotcha — sync package-lock.json**

If any task added a dependency, the lockfile must be synced:

```bash
npm install --package-lock-only --no-audit --no-fund
git add package.json package-lock.json bun.lock
git commit -m "chore: sync package-lock with bun.lock"
```

(See PR#4 1736ed6 — CI runs `npm ci`; bun.lock alone breaks CI.)

- [ ] **Manual smoke (browser):**
  - `/projects` — type chips, create promo / course / generic, switch chips
  - `/projects/[promoId]` — PromoProjectHome unchanged behaviour
  - `/projects/[courseId]` — CourseProjectHome with SyllabusEditor + ChildProjectList; add lesson → row appears live; drag-reorder → live in another tab
  - `/projects/[lessonId]` — LessonProjectHome with course banner; clicking banner returns to course
  - `/projects/new` — type-picker → brief, with clone-from dropdown working

- [ ] **Open the PR.** Title: `feat: studio v2 foundation — type-aware projects + recursive children`. Body: copy `## Goals` from this plan and link to it. CI must run green: Lint & Type Check · Build AMD64 Image · Deploy & Smoke Test · Cleanup. Promote-to-Latest is skipped pre-merge.

---

## What this plan deliberately does NOT do (Plan B follows)

- Annotations table / element-pinned notes / open-applied-dismissed lifecycle.
- "Apply N notes · Regenerate" header button — RegenerateDialog stays as-is.
- Diff view between drafts.
- Project-level annotations summary on the catalog cards.
- Stage right-rail Notes/Drafts/Verbatim tabs.

These ride on a separate BE migration (`annotations` table + endpoint changes to `regenerate` taking `annotation_ids: []`) and merit their own plan with their own ship gate.

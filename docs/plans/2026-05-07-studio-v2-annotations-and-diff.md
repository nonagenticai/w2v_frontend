# Studio v2 Frontend — Annotations, apply-N-notes regenerate, draft diff view

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add a persistent element-level annotations layer to the stage editor, replace the one-shot RegenerateDialog with a header-driven "Apply N notes · Regenerate" flow whose scope is auto-derived from the selected annotations, and add a side-by-side draft diff overlay so reviewers can see what the LLM did with their notes.

**Architecture:** Annotations are pinned to elements (`scene_id` / `shot_id` / `slide_id` / `line_id`) or to the stage. They live in a per-stage queue with three states (`open` / `applied` / `dismissed`). The right rail of the stage editor gets a Notes tab (alongside Drafts and Verbatim). The header's [Apply N notes · Regenerate] button opens a confirmation popover, derives scope from the selected notes (single-element vs whole-stage), and submits the existing regenerate endpoint with `annotation_ids: []`. Diffs render two drafts side-by-side, keyed by stable element IDs, with word-level inner diff for narrate / slide_deck text.

**Tech Stack:** Svelte 5 (runes), SvelteKit 2, TypeScript, vitest, `diff` (jsdiff) for word-level diff.

**Repo prerequisites:**

- `2026-05-07-studio-v2-foundation.md` (FE-A) merged.

**Backend prerequisites — must land in `w2v_orchestrator`:**

- All tasks of `2026-05-07-studio-v2-be-annotations.md` (annotations CRUD endpoints + `regenerate` accepts `annotation_ids`).
- Notification events on `job:{job_id}` channel: `annotation_created`, `annotation_updated`, `annotation_dismissed`, `annotation_applied`.

---

## File Structure

```
src/lib/
├── api/
│   ├── annotations.ts                       # CREATE
│   ├── regenerate.ts                        # MODIFY  (annotation_ids body)
│   └── index.ts                             # MODIFY  (export)
├── components/
│   └── studio/
│       ├── AnnotationsPanel.svelte          # CREATE  (right-rail Notes tab)
│       ├── AnnotationItem.svelte            # CREATE  (one note row, edit/dismiss/select)
│       ├── ElementCard.svelte               # MODIFY  (annotation pin + count badge)
│       ├── ApplyNotesButton.svelte          # CREATE  (header dropdown trigger)
│       ├── ApplyNotesPopover.svelte         # CREATE  (selection + scope reveal)
│       ├── DiffOverlay.svelte               # CREATE
│       ├── DiffElementCard.svelte           # CREATE  (one element rendered with old/new)
│       ├── RegenerateDialog.svelte          # MODIFY  (kept only for ad-hoc regen)
│       ├── StageRightRail.svelte            # CREATE  (Notes / Drafts / Verbatim tabs)
│       └── index.ts                         # MODIFY  (exports)
├── stores/
│   ├── annotations.svelte.ts                # CREATE
│   └── annotations.test.ts                  # CREATE
├── types/
│   └── annotations.ts                       # CREATE
└── utils/
    └── diff.ts                              # CREATE  (element-keyed diff)
src/routes/projects/[pid]/runs/[jobId]/stages/[stage]/+page.svelte   # MODIFY  (rail + header button)
```

---

### Task 1: Types + API + store (annotations CRUD)

**Files:**

- Create: `src/lib/types/annotations.ts`, `src/lib/api/annotations.ts`, `src/lib/stores/annotations.svelte.ts`, `src/lib/stores/annotations.test.ts`
- Modify: `src/lib/types/index.ts`, `src/lib/api/index.ts`

- [ ] **Step 1: Types**

```typescript
// src/lib/types/annotations.ts
export type AnnotationStatus = 'open' | 'applied' | 'dismissed';

export interface AnnotationResponse {
	id: string;
	job_id: string;
	stage_name: string;
	target_element_id: string | null; // null = stage-pinned
	text: string;
	status: AnnotationStatus;
	applied_in_draft_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface CreateAnnotationRequest {
	text: string;
	target_element_id: string | null;
}

export interface UpdateAnnotationRequest {
	text: string;
}
```

Re-export from `src/lib/types/index.ts`.

- [ ] **Step 2: API client**

```typescript
// src/lib/api/annotations.ts
import { api } from './client.js';
import type {
	AnnotationResponse,
	CreateAnnotationRequest,
	UpdateAnnotationRequest,
	AnnotationStatus
} from '$lib/types';

export const annotations = {
	list(
		jobId: string,
		stage: string,
		status?: AnnotationStatus
	): Promise<{ items: AnnotationResponse[] }> {
		const qs = status ? `?status=${status}` : '';
		return api.get(`/pipeline/${jobId}/stages/${stage}/annotations${qs}`);
	},
	create(jobId: string, stage: string, req: CreateAnnotationRequest): Promise<AnnotationResponse> {
		return api.post(`/pipeline/${jobId}/stages/${stage}/annotations`, req);
	},
	update(
		jobId: string,
		stage: string,
		id: string,
		req: UpdateAnnotationRequest
	): Promise<AnnotationResponse> {
		return api.patch(`/pipeline/${jobId}/stages/${stage}/annotations/${id}`, req);
	},
	dismiss(jobId: string, stage: string, id: string): Promise<void> {
		return api.delete(`/pipeline/${jobId}/stages/${stage}/annotations/${id}`);
	}
};
```

- [ ] **Step 3: Store with WS reconciliation**

```typescript
// src/lib/stores/annotations.svelte.ts
import { annotations as annApi } from '$lib/api';
import type {
	AnnotationResponse,
	CreateAnnotationRequest,
	UpdateAnnotationRequest,
	AnnotationStatus
} from '$lib/types';

// Keyed by `${jobId}::${stageName}` so a single store handles every (job, stage) pair.
let byKey = $state<Record<string, AnnotationResponse[]>>({});

const k = (j: string, s: string) => `${j}::${s}`;

export async function load(jobId: string, stage: string): Promise<void> {
	const r = await annApi.list(jobId, stage);
	byKey = { ...byKey, [k(jobId, stage)]: r.items };
}

export function getList(jobId: string, stage: string): AnnotationResponse[] {
	return byKey[k(jobId, stage)] ?? [];
}

export function getOpen(jobId: string, stage: string): AnnotationResponse[] {
	return getList(jobId, stage).filter((a) => a.status === 'open');
}

export function getOpenForElement(
	jobId: string,
	stage: string,
	elementId: string
): AnnotationResponse[] {
	return getOpen(jobId, stage).filter((a) => a.target_element_id === elementId);
}

export async function create(
	jobId: string,
	stage: string,
	req: CreateAnnotationRequest
): Promise<AnnotationResponse> {
	const ann = await annApi.create(jobId, stage, req);
	applyEvent(jobId, stage, 'created', ann);
	return ann;
}

export async function update(
	jobId: string,
	stage: string,
	id: string,
	req: UpdateAnnotationRequest
): Promise<AnnotationResponse> {
	const ann = await annApi.update(jobId, stage, id, req);
	applyEvent(jobId, stage, 'updated', ann);
	return ann;
}

export async function dismiss(jobId: string, stage: string, id: string): Promise<void> {
	await annApi.dismiss(jobId, stage, id);
	// Optimistic local flip; canonical state arrives via WS too.
	const list = byKey[k(jobId, stage)];
	if (list) {
		byKey = {
			...byKey,
			[k(jobId, stage)]: list.map((a) => (a.id === id ? { ...a, status: 'dismissed' as const } : a))
		};
	}
}

// ---- WS event handlers ---------------------------------------------------
export function applyEvent(
	jobId: string,
	stage: string,
	evt: 'created' | 'updated' | 'dismissed' | 'applied',
	ann: AnnotationResponse
): void {
	const key = k(jobId, stage);
	const list = byKey[key] ?? [];
	if (evt === 'created') {
		if (list.some((a) => a.id === ann.id)) return;
		byKey = { ...byKey, [key]: [...list, ann] };
		return;
	}
	byKey = {
		...byKey,
		[key]: list.map((a) => (a.id === ann.id ? ann : a))
	};
}

export function invalidate(): void {
	byKey = {};
}
```

- [ ] **Step 4: Tests**

```typescript
// src/lib/stores/annotations.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from './annotations.svelte';
import { annotations as api } from '$lib/api';

describe('annotations store', () => {
	beforeEach(() => {
		store.invalidate();
		vi.restoreAllMocks();
	});

	it('load + getList + getOpen filter by status', async () => {
		vi.spyOn(api, 'list').mockResolvedValue({
			items: [ann({ id: '1', status: 'open' }), ann({ id: '2', status: 'applied' })]
		});
		await store.load('j', 's');
		expect(store.getList('j', 's')).toHaveLength(2);
		expect(store.getOpen('j', 's').map((a) => a.id)).toEqual(['1']);
	});

	it('applyEvent inserts on created and updates on updated', () => {
		store.applyEvent('j', 's', 'created', ann({ id: 'x', status: 'open' }));
		expect(store.getList('j', 's')).toHaveLength(1);
		store.applyEvent(
			'j',
			's',
			'applied',
			ann({ id: 'x', status: 'applied', applied_in_draft_id: 'd1' })
		);
		expect(store.getOpen('j', 's')).toHaveLength(0);
	});

	it('getOpenForElement filters by target_element_id', () => {
		store.applyEvent(
			'j',
			's',
			'created',
			ann({ id: '1', status: 'open', target_element_id: 'scene_1' })
		);
		store.applyEvent(
			'j',
			's',
			'created',
			ann({ id: '2', status: 'open', target_element_id: 'scene_2' })
		);
		expect(store.getOpenForElement('j', 's', 'scene_1').map((a) => a.id)).toEqual(['1']);
	});
});

function ann(overrides = {}) {
	return {
		id: '1',
		job_id: 'j',
		stage_name: 's',
		target_element_id: null,
		text: 'note',
		status: 'open' as const,
		applied_in_draft_id: null,
		created_at: '',
		updated_at: '',
		...overrides
	};
}
```

- [ ] **Step 5: Run + commit**

```bash
bun run test:run src/lib/stores/annotations.test.ts && bun run check
git add src/lib/types/annotations.ts src/lib/types/index.ts \
        src/lib/api/annotations.ts src/lib/api/index.ts \
        src/lib/stores/annotations.svelte.ts src/lib/stores/annotations.test.ts
git commit -m "feat(annotations): types + API + store with WS reconciliation"
```

---

### Task 2: WS hook — wire annotation events on the job channel

PR#4's `JobProgressState.onExtraEvent` fires before the existing switch, ideal for new event types.

**Files:**

- Modify: `src/lib/stores/job-progress/<wherever onExtraEvent lives>.ts`
- Modify: stage editor +page.svelte — pass `onExtraEvent` into JobProgressState

- [ ] **Step 1: Hook annotation events into the store**

In the stage editor `+page.svelte`:

```svelte
<script lang="ts">
	import * as annotationsStore from '$lib/stores/annotations.svelte';
	// ... existing
	const job = new JobProgressState({
		jobId: data.jobId,
		onExtraEvent(name, payload) {
			if (
				name === 'annotation_created' ||
				name === 'annotation_updated' ||
				name === 'annotation_dismissed' ||
				name === 'annotation_applied'
			) {
				const evt = name.replace('annotation_', '') as
					'created' | 'updated' | 'dismissed' | 'applied';
				annotationsStore.applyEvent(data.jobId, payload.stage_name, evt, payload);
			}
		}
	});
</script>
```

- [ ] **Step 2: Run check + commit**

```bash
bun run check
git add -u
git commit -m "feat(annotations): wire WS lifecycle events through onExtraEvent"
```

---

### Task 3: Annotation pin + badge on `ElementCard`

**Files:**

- Modify: `src/lib/components/studio/ElementCard.svelte`

- [ ] **Step 1: Add the pin button + count badge**

```svelte
<!-- In ElementCard.svelte; the component already has a [⋮] menu — add pin alongside. -->
<script lang="ts">
	import { MessageCircle } from 'lucide-svelte';
	// ... existing props add:
	interface Props {
		// ... existing
		openAnnotationCount?: number;
		onAddNote?: (elementId: string) => void;
		onOpenNotes?: (elementId: string) => void;
	}

	let {
		// ... existing
		openAnnotationCount = 0,
		onAddNote,
		onOpenNotes
	}: Props = $props();
</script>

<!-- Inside the row toolbar (existing right-aligned controls): -->
<button
	type="button"
	class="rounded p-1 text-text-muted hover:bg-surface-2 relative"
	aria-label="Notes"
	onclick={() => (openAnnotationCount > 0 ? onOpenNotes?.(element.id) : onAddNote?.(element.id))}
>
	<MessageCircle size={14} />
	{#if openAnnotationCount > 0}
		<span
			class="absolute -right-1 -top-1 rounded-full bg-warning px-1.5 text-[10px] font-bold text-warning-fg"
		>
			{openAnnotationCount}
		</span>
	{/if}
</button>
```

- [ ] **Step 2: Wire from the structured editors**

The stage's structured editor (Storyline / Shotlist / SlideDeck / Narrate) renders ElementCards; pass `openAnnotationCount={annotationsStore.getOpenForElement(jobId, stage, element.id).length}` and the two callbacks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/studio/ElementCard.svelte \
        src/routes/projects/[pid]/runs/[jobId]/stages/[stage]/+page.svelte
git commit -m "feat(annotations): pin + count badge on ElementCard"
```

---

### Task 4: `AnnotationItem` + `AnnotationsPanel`

The right-rail Notes tab. Lists annotations grouped by status (open / applied / dismissed), with checkboxes for the apply-N flow.

**Files:**

- Create: `src/lib/components/studio/AnnotationItem.svelte`
- Create: `src/lib/components/studio/AnnotationsPanel.svelte`

- [ ] **Step 1: AnnotationItem**

```svelte
<!-- src/lib/components/studio/AnnotationItem.svelte -->
<script lang="ts">
  import { Trash2, Edit2, Check, Save, X } from 'lucide-svelte';
  import type { AnnotationResponse } from '$lib/types';
  import { Badge, Input, Button } from '$lib/components/ui';

  interface Props {
    annotation: AnnotationResponse;
    selected?: boolean;
    onToggle?: () => void;
    onJumpToElement?: (id: string) => void;
    onSave?: (text: string) => Promise<void>;
    onDismiss?: () => Promise<void>;
  }

  let { annotation, selected = false, onToggle, onJumpToElement, onSave, onDismiss }: Props = $props();

  let editing = $state(false);
  let draft = $state(annotation.text);
  let busy = $state(false);

  async function save() {
    busy = true;
    try { await onSave?.(draft); editing = false; }
    finally { busy = false; }
  }
</script>

<li class="rounded-lg border border-border bg-surface p-3 text-sm">
  <div class="mb-1 flex items-center gap-2">
    {#if annotation.status === 'open' && onToggle}
      <input type="checkbox" checked={selected} onchange={onToggle} />
    {/if}
    <Badge variant={annotation.status === 'open' ? 'warning'
                  : annotation.status === 'applied' ? 'success'
                  : 'default'}>
      {annotation.status}
    </Badge>
    {#if annotation.target_element_id}
      <button class="text-xs text-link underline-offset-2 hover:underline"
              onclick={() => onJumpToElement?.(annotation.target_element_id!)}>
        {annotation.target_element_id}
      </button>
    {:else}
      <span class="text-xs text-text-muted">stage</span>
    {/if}
  </div>

  {#if editing}
    <Input value={draft} oninput={(v) => (draft = v)} />
    <div class="mt-2 flex gap-1">
      <Button size="sm" disabled={busy} onclick={save}><Save size={12} /> Save</Button>
      <Button size="sm" variant="ghost" onclick={() => { editing = false; draft = annotation.text; }}>
        <X size={12} />
      </Button>
    </div>
  {:else}
    <p class="text-text">{annotation.text}</p>
    {#if annotation.status === 'open'}
      <div class="mt-2 flex gap-1">
        <Button size="sm" variant="ghost" onclick={() => (editing = true)}>
          <Edit2 size={12} />
        </Button>
        <Button size="sm" variant="ghost" onclick={onDismiss}>
          <Trash2 size={12} />
        </Button>
      </div>
    {/if}
    {#if annotation.applied_in_draft_id}
      <p class="mt-1 text-xs text-text-muted">applied → draft {annotation.applied_in_draft_id.slice(0, 8)}</p>
    {/if}
  </div>
</li>
```

- [ ] **Step 2: AnnotationsPanel**

```svelte
<!-- src/lib/components/studio/AnnotationsPanel.svelte -->
<script lang="ts">
	import AnnotationItem from './AnnotationItem.svelte';
	import { Button, Input } from '$lib/components/ui';
	import { Plus } from 'lucide-svelte';
	import type { AnnotationResponse } from '$lib/types';

	interface Props {
		jobId: string;
		stage: string;
		items: AnnotationResponse[];
		selectedIds: Set<string>;
		onToggle?: (id: string) => void;
		onJumpToElement?: (id: string) => void;
		onAddStageNote?: (text: string) => Promise<void>;
		onSaveNote?: (id: string, text: string) => Promise<void>;
		onDismissNote?: (id: string) => Promise<void>;
	}

	let {
		items,
		selectedIds,
		onToggle,
		onJumpToElement,
		onAddStageNote,
		onSaveNote,
		onDismissNote
	}: Props = $props();

	let bucket = $state<'open' | 'applied' | 'dismissed'>('open');
	let filtered = $derived(
		items
			.filter((a) => a.status === bucket)
			.sort((a, b) => a.created_at.localeCompare(b.created_at))
	);

	let addDraft = $state('');
	let adding = $state(false);

	async function addStageNote() {
		if (!addDraft.trim()) return;
		adding = true;
		try {
			await onAddStageNote?.(addDraft.trim());
			addDraft = '';
		} finally {
			adding = false;
		}
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex gap-1 text-xs">
		{#each ['open', 'applied', 'dismissed'] as b (b)}
			<button
				class="rounded px-2 py-0.5 {bucket === b ? 'bg-primary text-primary-fg' : 'bg-surface-2'}"
				onclick={() => (bucket = b as 'open' | 'applied' | 'dismissed')}>{b}</button
			>
		{/each}
	</div>

	<ul class="space-y-2">
		{#each filtered as ann (ann.id)}
			<AnnotationItem
				annotation={ann}
				selected={selectedIds.has(ann.id)}
				onToggle={() => onToggle?.(ann.id)}
				{onJumpToElement}
				onSave={(t) => onSaveNote?.(ann.id, t) ?? Promise.resolve()}
				onDismiss={() => onDismissNote?.(ann.id) ?? Promise.resolve()}
			/>
		{/each}
		{#if filtered.length === 0}
			<p class="text-xs text-text-muted">No {bucket} notes.</p>
		{/if}
	</ul>

	{#if bucket === 'open'}
		<div class="rounded-lg border border-dashed border-border p-2">
			<Input value={addDraft} oninput={(v) => (addDraft = v)} placeholder="Stage-level note" />
			<Button size="sm" disabled={adding || !addDraft.trim()} onclick={addStageNote}>
				<Plus size={12} /> Add stage note
			</Button>
		</div>
	{/if}
</div>
```

- [ ] **Step 3: Smoke test**

```typescript
// src/lib/components/studio/AnnotationsPanel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import AnnotationsPanel from './AnnotationsPanel.svelte';

describe('AnnotationsPanel', () => {
	it('shows open by default and switches buckets', async () => {
		const { getByText, queryByText } = render(AnnotationsPanel, {
			props: {
				jobId: 'j',
				stage: 's',
				items: [
					{
						id: '1',
						status: 'open',
						text: 'OPEN!',
						target_element_id: null,
						job_id: 'j',
						stage_name: 's',
						applied_in_draft_id: null,
						created_at: '',
						updated_at: ''
					},
					{
						id: '2',
						status: 'applied',
						text: 'APPLIED!',
						target_element_id: null,
						job_id: 'j',
						stage_name: 's',
						applied_in_draft_id: 'd',
						created_at: '',
						updated_at: ''
					}
				] as never,
				selectedIds: new Set()
			}
		});
		expect(getByText('OPEN!')).toBeTruthy();
		expect(queryByText('APPLIED!')).toBeNull();
		await fireEvent.click(getByText('applied'));
		expect(getByText('APPLIED!')).toBeTruthy();
	});
});
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/studio/AnnotationItem.svelte \
        src/lib/components/studio/AnnotationsPanel.svelte \
        src/lib/components/studio/AnnotationsPanel.test.ts \
        src/lib/components/studio/index.ts
git commit -m "feat(annotations): rail panel + per-note item with edit/dismiss/select"
```

---

### Task 5: `StageRightRail` — Notes / Drafts / Verbatim tabs

**Files:**

- Create: `src/lib/components/studio/StageRightRail.svelte`
- Modify: stage editor `+page.svelte` — replace the current single-panel rail

- [ ] **Step 1: Component**

```svelte
<!-- src/lib/components/studio/StageRightRail.svelte -->
<script lang="ts">
	import AnnotationsPanel from './AnnotationsPanel.svelte';
	import DraftHistory from './DraftHistory.svelte';
	import VerbatimItemList from './VerbatimItemList.svelte';
	import type { AnnotationResponse, DraftResponse, VerbatimItemResponse } from '$lib/types';

	interface Props {
		jobId: string;
		stage: string;
		annotations: AnnotationResponse[];
		drafts: DraftResponse[];
		verbatim: VerbatimItemResponse[];
		selectedAnnotationIds: Set<string>;
		onToggleAnnotation?: (id: string) => void;
		onJumpToElement?: (id: string) => void;
		onAddStageNote?: (text: string) => Promise<void>;
		onSaveNote?: (id: string, text: string) => Promise<void>;
		onDismissNote?: (id: string) => Promise<void>;
		onViewDraft?: (id: string) => void;
		onAcceptDraft?: (id: string) => Promise<void>;
		onDiffDraft?: (id: string) => void;
	}

	let p: Props = $props();
	let tab = $state<'notes' | 'drafts' | 'verbatim'>('notes');
</script>

<aside class="w-80 border-l border-border bg-surface-2 p-3">
	<div class="mb-3 flex gap-1 text-xs">
		{#each ['notes', 'drafts', 'verbatim'] as t (t)}
			<button
				class="rounded px-2 py-1 {tab === t
					? 'bg-surface text-text font-semibold'
					: 'text-text-muted'}"
				onclick={() => (tab = t as 'notes' | 'drafts' | 'verbatim')}
			>
				{t}
			</button>
		{/each}
	</div>

	{#if tab === 'notes'}
		<AnnotationsPanel
			jobId={p.jobId}
			stage={p.stage}
			items={p.annotations}
			selectedIds={p.selectedAnnotationIds}
			onToggle={p.onToggleAnnotation}
			onJumpToElement={p.onJumpToElement}
			onAddStageNote={p.onAddStageNote}
			onSaveNote={p.onSaveNote}
			onDismissNote={p.onDismissNote}
		/>
	{:else if tab === 'drafts'}
		<DraftHistory
			drafts={p.drafts}
			onView={p.onViewDraft}
			onAccept={p.onAcceptDraft}
			onDiff={p.onDiffDraft}
		/>
	{:else}
		<VerbatimItemList items={p.verbatim} readOnly />
	{/if}
</aside>
```

- [ ] **Step 2: Wire in stage editor +page.svelte**

Replace the existing right-side panel (or `DraftHistory`-only column) with `<StageRightRail … />`. The left column stays the structured editor.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/studio/StageRightRail.svelte \
        src/routes/projects/[pid]/runs/[jobId]/stages/[stage]/+page.svelte \
        src/lib/components/studio/index.ts
git commit -m "feat(studio): right rail with Notes / Drafts / Verbatim tabs"
```

---

### Task 6: `ApplyNotesButton` + scope auto-derivation

**Files:**

- Create: `src/lib/components/studio/ApplyNotesButton.svelte`
- Create: `src/lib/components/studio/ApplyNotesPopover.svelte`
- Modify: stage editor `+page.svelte` — header gets the button; existing RegenerateDialog stays for ad-hoc regen with no notes

The "scope" decision rule:

| Selected open notes                          | Scope           | Submitted to                                   |
| -------------------------------------------- | --------------- | ---------------------------------------------- |
| All share same `target_element_id` X         | element         | `POST /stages/{stage}/elements/{X}/regenerate` |
| Multiple element targets OR any stage-pinned | stage           | `POST /stages/{stage}/regenerate`              |
| Empty                                        | (button hidden) | —                                              |

- [ ] **Step 1: Helper**

```typescript
// src/lib/utils/regen-scope.ts
import type { AnnotationResponse } from '$lib/types';

export type RegenScope =
	| { kind: 'element'; elementId: string; annotationIds: string[] }
	| { kind: 'stage'; annotationIds: string[] };

export function deriveScope(selected: AnnotationResponse[]): RegenScope | null {
	if (selected.length === 0) return null;
	const elementIds = new Set(selected.map((a) => a.target_element_id));
	if (elementIds.size === 1 && !elementIds.has(null)) {
		const eid = [...elementIds][0]!;
		return { kind: 'element', elementId: eid, annotationIds: selected.map((a) => a.id) };
	}
	return { kind: 'stage', annotationIds: selected.map((a) => a.id) };
}
```

```typescript
// src/lib/utils/regen-scope.test.ts
import { describe, it, expect } from 'vitest';
import { deriveScope } from './regen-scope';

const ann = (id: string, t: string | null) => ({
	id,
	target_element_id: t,
	status: 'open' as const,
	job_id: '',
	stage_name: '',
	text: '',
	applied_in_draft_id: null,
	created_at: '',
	updated_at: ''
});

describe('deriveScope', () => {
	it('returns null on empty', () => expect(deriveScope([])).toBeNull());
	it('element when all share target', () => {
		const r = deriveScope([ann('1', 'scene_3'), ann('2', 'scene_3')]);
		expect(r).toEqual({ kind: 'element', elementId: 'scene_3', annotationIds: ['1', '2'] });
	});
	it('stage on mixed targets', () => {
		const r = deriveScope([ann('1', 'scene_3'), ann('2', 'scene_4')]);
		expect(r?.kind).toBe('stage');
	});
	it('stage if any are stage-pinned', () => {
		const r = deriveScope([ann('1', 'scene_3'), ann('2', null)]);
		expect(r?.kind).toBe('stage');
	});
});
```

- [ ] **Step 2: Button + popover**

```svelte
<!-- src/lib/components/studio/ApplyNotesButton.svelte -->
<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { Sparkles } from 'lucide-svelte';
	import { deriveScope } from '$lib/utils/regen-scope';
	import type { AnnotationResponse } from '$lib/types';

	interface Props {
		selected: AnnotationResponse[];
		submitting?: boolean;
		onApply?: (scope: ReturnType<typeof deriveScope>) => Promise<void>;
	}

	let { selected, submitting = false, onApply }: Props = $props();
	let scope = $derived(deriveScope(selected));

	function label(): string {
		if (!scope) return 'Apply notes';
		return scope.kind === 'element'
			? `Apply ${scope.annotationIds.length} note${scope.annotationIds.length === 1 ? '' : 's'} · regenerate ${scope.elementId}`
			: `Apply ${scope.annotationIds.length} notes · regenerate whole stage`;
	}
</script>

<Button disabled={!scope || submitting} onclick={() => scope && onApply?.(scope)}>
	<Sparkles size={14} />
	{label()}
</Button>
```

- [ ] **Step 3: Wire in stage editor**

```svelte
<!-- src/routes/projects/[pid]/runs/[jobId]/stages/[stage]/+page.svelte -->
<script lang="ts">
	// ... existing
	import { ApplyNotesButton } from '$lib/components/studio';
	import * as annotationsStore from '$lib/stores/annotations.svelte';
	import * as regen from '$lib/api/regenerate';

	let selectedNoteIds = $state<Set<string>>(new Set());
	let regenerating = $state(false);

	function toggleNote(id: string) {
		const next = new Set(selectedNoteIds);
		next.has(id) ? next.delete(id) : next.add(id);
		selectedNoteIds = next;
	}
	let selectedNotes = $derived(
		annotationsStore.getList(data.jobId, data.stage).filter((a) => selectedNoteIds.has(a.id))
	);

	async function handleApply(scope: {
		kind: 'element' | 'stage';
		annotationIds: string[];
		elementId?: string;
	}) {
		regenerating = true;
		try {
			if (scope.kind === 'element') {
				await regen.regenerateElement(data.jobId, data.stage, scope.elementId!, {
					annotation_ids: scope.annotationIds,
					auto_advance: false
				});
			} else {
				await regen.regenerateStage(data.jobId, data.stage, {
					annotation_ids: scope.annotationIds,
					auto_advance: false
				});
			}
			selectedNoteIds = new Set();
		} finally {
			regenerating = false;
		}
	}
</script>

<header class="flex items-center justify-between">
	<h1>{data.stage}</h1>
	<ApplyNotesButton selected={selectedNotes} submitting={regenerating} onApply={handleApply} />
</header>
```

- [ ] **Step 4: Modify regenerate API client**

```typescript
// src/lib/api/regenerate.ts
import { api } from './client.js';
import type { DraftResponse } from '$lib/types';

export interface RegenerateBody {
	annotation_ids?: string[];
	auto_advance?: boolean;
}

export function regenerateStage(
	jobId: string,
	stage: string,
	body: RegenerateBody
): Promise<DraftResponse> {
	return api.post(`/pipeline/${jobId}/stages/${stage}/regenerate`, body);
}
export function regenerateElement(
	jobId: string,
	stage: string,
	elementId: string,
	body: RegenerateBody
): Promise<DraftResponse> {
	return api.post(`/pipeline/${jobId}/stages/${stage}/elements/${elementId}/regenerate`, body);
}
```

- [ ] **Step 5: Run + commit**

```bash
bun run test:run src/lib/utils/regen-scope.test.ts && bun run check
git add src/lib/components/studio/ApplyNotesButton.svelte \
        src/lib/utils/regen-scope.ts src/lib/utils/regen-scope.test.ts \
        src/lib/api/regenerate.ts \
        src/routes/projects/[pid]/runs/[jobId]/stages/[stage]/+page.svelte \
        src/lib/components/studio/index.ts
git commit -m "feat(annotations): apply-N-notes button with auto-derived scope"
```

---

### Task 7: Diff overlay between drafts

**Files:**

- Add: `bun add diff @types/diff` (also `npm install --package-lock-only` — see PR#4 lockfile gotcha)
- Create: `src/lib/utils/diff.ts`
- Create: `src/lib/components/studio/DiffOverlay.svelte`
- Create: `src/lib/components/studio/DiffElementCard.svelte`
- Modify: `DraftHistory.svelte` — add a [Diff vs accepted] button that opens the overlay

- [ ] **Step 1: Element-keyed diff helper**

```typescript
// src/lib/utils/diff.ts — element-level diff over stable IDs

import { diffWords } from 'diff';

export type ElementChange =
	| { kind: 'unchanged'; id: string; left: unknown; right: unknown }
	| { kind: 'added'; id: string; right: unknown }
	| { kind: 'removed'; id: string; left: unknown }
	| { kind: 'modified'; id: string; left: unknown; right: unknown };

interface IdentifiedElement {
	id: string;
	[k: string]: unknown;
}

export function diffByStableId(
	leftList: IdentifiedElement[],
	rightList: IdentifiedElement[]
): ElementChange[] {
	const leftById = new Map(leftList.map((e) => [e.id, e]));
	const rightById = new Map(rightList.map((e) => [e.id, e]));

	const changes: ElementChange[] = [];
	for (const r of rightList) {
		const l = leftById.get(r.id);
		if (!l) {
			changes.push({ kind: 'added', id: r.id, right: r });
		} else if (JSON.stringify(l) === JSON.stringify(r)) {
			changes.push({ kind: 'unchanged', id: r.id, left: l, right: r });
		} else {
			changes.push({ kind: 'modified', id: r.id, left: l, right: r });
		}
	}
	for (const l of leftList) {
		if (!rightById.has(l.id)) changes.push({ kind: 'removed', id: l.id, left: l });
	}
	return changes;
}

export function wordDiff(left: string, right: string) {
	return diffWords(left, right); // returns Array<{value, added?, removed?}>
}
```

- [ ] **Step 2: DiffElementCard renders one element with old/new**

```svelte
<!-- src/lib/components/studio/DiffElementCard.svelte -->
<script lang="ts">
	import { wordDiff } from '$lib/utils/diff';

	interface Props {
		change: import('$lib/utils/diff').ElementChange;
		/** field name to diff word-by-word (e.g. 'text', 'narration'). */
		textField?: string;
	}
	let { change, textField = 'text' }: Props = $props();

	// For modified: word-diff the textField if both sides are strings.
	let parts = $derived.by(() => {
		if (change.kind !== 'modified') return null;
		const l = (change.left as Record<string, unknown>)[textField];
		const r = (change.right as Record<string, unknown>)[textField];
		if (typeof l !== 'string' || typeof r !== 'string') return null;
		return wordDiff(l, r);
	});
</script>

<article
	class="rounded-lg border p-3
                 {change.kind === 'added'
		? 'border-success bg-success/5'
		: change.kind === 'removed'
			? 'border-error bg-error/5'
			: change.kind === 'modified'
				? 'border-warning bg-warning/5'
				: 'border-border'}"
>
	<header class="mb-2 flex items-center justify-between text-xs text-text-muted">
		<span>{change.id}</span>
		<span class="font-mono">{change.kind}</span>
	</header>

	{#if parts}
		<p>
			{#each parts as p}<span class:added={p.added} class:removed={p.removed}>{p.value}</span
				>{/each}
		</p>
	{:else if change.kind === 'modified'}
		<div class="grid grid-cols-2 gap-2 text-xs">
			<pre class="rounded bg-surface p-2">{JSON.stringify(change.left, null, 2)}</pre>
			<pre class="rounded bg-surface p-2">{JSON.stringify(change.right, null, 2)}</pre>
		</div>
	{:else if change.kind === 'unchanged'}
		<p class="text-xs text-text-muted">no change</p>
	{/if}
</article>

<style>
	.added {
		background: rgba(0, 200, 0, 0.15);
	}
	.removed {
		background: rgba(200, 0, 0, 0.15);
		text-decoration: line-through;
	}
</style>
```

- [ ] **Step 3: DiffOverlay**

```svelte
<!-- src/lib/components/studio/DiffOverlay.svelte -->
<script lang="ts">
	import DiffElementCard from './DiffElementCard.svelte';
	import { Button } from '$lib/components/ui';
	import { diffByStableId, type ElementChange } from '$lib/utils/diff';
	import { X } from 'lucide-svelte';

	interface Props {
		open: boolean;
		leftLabel: string;
		rightLabel: string;
		leftElements: { id: string; [k: string]: unknown }[];
		rightElements: { id: string; [k: string]: unknown }[];
		textField?: string;
		onClose?: () => void;
	}
	let {
		open = $bindable(),
		leftLabel,
		rightLabel,
		leftElements,
		rightElements,
		textField = 'text',
		onClose
	}: Props = $props();

	let changes = $derived<ElementChange[]>(open ? diffByStableId(leftElements, rightElements) : []);
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-stretch bg-black/50">
		<div class="m-auto h-[90vh] w-[90vw] overflow-auto rounded-xl bg-surface p-4">
			<header class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-semibold">{leftLabel} ↔ {rightLabel}</h2>
				<Button
					variant="ghost"
					onclick={() => {
						open = false;
						onClose?.();
					}}
				>
					<X size={14} />
				</Button>
			</header>
			<div class="space-y-2">
				{#each changes as ch (ch.id)}
					<DiffElementCard change={ch} {textField} />
				{/each}
			</div>
		</div>
	</div>
{/if}
```

- [ ] **Step 4: Wire from DraftHistory**

```svelte
<!-- DraftHistory.svelte — add the [Diff vs accepted] action per row -->
<Button size="sm" variant="ghost" onclick={() => onDiff?.(draft.draft_id)}>Diff</Button>
```

In the stage editor `+page.svelte`, hold the diff state and pull element lists from each draft's `content_json`:

```svelte
<script lang="ts">
	let diffOpen = $state(false);
	let diffLeftId = $state<string | null>(null);
	let diffRightId = $state<string | null>(null);

	function openDiff(otherDraftId: string) {
		diffLeftId = drafts.find((d) => d.is_accepted)?.draft_id ?? null;
		diffRightId = otherDraftId;
		diffOpen = true;
	}

	let elementsForStage = (json: unknown): { id: string; [k: string]: unknown }[] => {
		// Stage-specific extractor — storyline.chapters, shotlist.scenes, slide_deck.slides, narrate.lines.
		if (data.stage === 'storyline')
			return ((json as any)?.chapters ?? []).map((c: any) => ({ ...c, id: c.chapter_id }));
		if (data.stage === 'shotlist')
			return ((json as any)?.scenes ?? []).map((s: any) => ({ ...s, id: s.scene_id }));
		if (data.stage === 'slide_deck')
			return ((json as any)?.slides ?? []).map((s: any) => ({ ...s, id: s.slide_id }));
		if (data.stage === 'narrate')
			return ((json as any)?.lines ?? []).map((l: any) => ({
				...l,
				id: l.line_id,
				text: l.text ?? l.narration
			}));
		return [];
	};
</script>

<DiffOverlay
	bind:open={diffOpen}
	leftLabel={`accepted ${diffLeftId?.slice(0, 8)}`}
	rightLabel={`draft ${diffRightId?.slice(0, 8)}`}
	leftElements={elementsForStage(drafts.find((d) => d.draft_id === diffLeftId)?.content_json)}
	rightElements={elementsForStage(drafts.find((d) => d.draft_id === diffRightId)?.content_json)}
	textField={data.stage === 'narrate' ? 'text' : 'text'}
/>
```

- [ ] **Step 5: Sync the lockfile**

```bash
npm install --package-lock-only --no-audit --no-fund
```

- [ ] **Step 6: Run + commit**

```bash
bun run check && bun run test:run
git add package.json package-lock.json bun.lock \
        src/lib/utils/diff.ts \
        src/lib/components/studio/DiffElementCard.svelte \
        src/lib/components/studio/DiffOverlay.svelte \
        src/lib/components/studio/DraftHistory.svelte \
        src/routes/projects/[pid]/runs/[jobId]/stages/[stage]/+page.svelte \
        src/lib/components/studio/index.ts
git commit -m "feat(diff): side-by-side draft diff overlay with word-level inner diff"
```

---

### Task 8: Project-level annotations summary

A small badge on each Project card on the catalog showing total open notes across its deliverables' jobs.

**Files:**

- Modify: `src/lib/types/projects.ts` — add `open_annotations_count?: number` (BE returns it on the list endpoint)
- Modify: `src/routes/projects/+page.svelte` — render badge per row

(BE concern: aggregate count via a single GROUPED query on `annotations` JOIN `pipeline_jobs` JOIN `deliverables` ON `project_id`. If the BE doesn't ship this aggregate column, skip Task 8 — Plan B can ship without it.)

- [ ] **Step 1: Add the type field + render**

```typescript
// in ProjectResponse:
open_annotations_count?: number;
```

```svelte
<!-- /projects/+page.svelte row template -->
{#if project.open_annotations_count && project.open_annotations_count > 0}
	<Badge variant="warning">💬 {project.open_annotations_count}</Badge>
{/if}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types/projects.ts src/routes/projects/+page.svelte
git commit -m "feat(projects): open-annotations count badge on catalog"
```

---

## Final verification

```bash
bun run check && bun run test:run && bun run build
npm install --package-lock-only --no-audit --no-fund   # if any deps changed
```

All green. Manual smoke:

- Add a note pinned to scene_3, see it in rail → click checkbox → header shows "Apply 1 note · regenerate scene_3" → submit → new draft appears, note moves to applied bucket with applied_in_draft_id link.
- Add two notes on different scenes → header shows "Apply 2 notes · regenerate whole stage" → submit → whole-stage draft.
- DraftHistory → Diff → overlay highlights what changed, with word-diff inside narrate text.

Open PR titled `feat: studio v2 frontend annotations + apply-N-notes + diff`.

---

## Out of scope for this plan

- Per-render annotations on non-LLM stages (media / render / mux). Future plan.
- Multi-element regen (regenerate scenes 3 and 5 _separately_ in one click). Falls back to whole-stage today.
- Comparing arbitrary pairs of drafts — only "draft vs accepted" in v1.
- Cross-project annotation inbox.

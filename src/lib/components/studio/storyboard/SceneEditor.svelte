<script lang="ts">
	// Create/edit one storyboard scene. Mirrors the AssetEditor inline-form idiom
	// (Input from $lib/components/ui, shared textarea class): the form owns its
	// draft state, save routes to createScene (no scene) or updateScene (existing
	// scene.id) on the storyboard store, toasts the outcome, and calls onDone so
	// the parent can collapse the editor. All scene fields are optional, so Save
	// is never blocked on a required field. int_ext is a free-text field (the
	// generated schema types it as string | null, not an enum), conventionally
	// "INT" / "EXT".
	import { untrack } from 'svelte';
	import type {
		StoryboardSceneResponse,
		StoryboardSceneCreate,
		StoryboardSceneUpdate
	} from '$lib/types';
	import { Input } from '$lib/components/ui';
	import { createScene, updateScene } from '$lib/stores/storyboard.svelte.js';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte.js';

	interface Props {
		projectId: string;
		scene?: StoryboardSceneResponse;
		onDone: () => void;
	}

	let { projectId, scene, onDone }: Props = $props();

	// Seeded once from props (the component is re-mounted per add/edit, so the
	// initial-value capture is intentional); the form owns its draft state after.
	// untrack signals the seed-once intent and silences state_referenced_locally.
	let name = $state(untrack(() => scene?.name ?? ''));
	let intExt = $state(untrack(() => scene?.int_ext ?? ''));
	let location = $state(untrack(() => scene?.location ?? ''));
	let timeOfDay = $state(untrack(() => scene?.time_of_day ?? ''));
	let description = $state(untrack(() => scene?.description ?? ''));
	let saving = $state(false);

	const uid = $derived(scene?.id ?? 'new');

	const textareaClass =
		'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20';

	// Trim, then collapse empties to null so the BE stores nothing rather than "".
	function clean(v: string): string | null {
		const t = v.trim();
		return t === '' ? null : t;
	}

	async function save() {
		if (saving) return;
		saving = true;
		try {
			const fields = {
				name: clean(name),
				int_ext: clean(intExt),
				location: clean(location),
				time_of_day: clean(timeOfDay),
				description: clean(description)
			};
			if (scene) {
				const body: StoryboardSceneUpdate = fields;
				await updateScene(projectId, scene.id, body);
				toastSuccess('Scene updated', fields.name ?? undefined);
			} else {
				const body: StoryboardSceneCreate = fields;
				await createScene(projectId, body);
				toastSuccess('Scene created', fields.name ?? undefined);
			}
			onDone();
		} catch (e) {
			toastError(
				scene ? 'Failed to update scene' : 'Failed to create scene',
				e instanceof Error ? e.message : undefined
			);
		} finally {
			saving = false;
		}
	}

	function cancel() {
		onDone();
	}
</script>

<div
	class="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
	data-testid="scene-editor"
>
	<Input label="Name" name={`scene-name-${uid}`} disabled={saving} bind:value={name} />

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<Input
			label="INT/EXT"
			name={`scene-int-ext-${uid}`}
			placeholder="INT"
			disabled={saving}
			bind:value={intExt}
		/>
		<Input
			label="Location"
			name={`scene-location-${uid}`}
			disabled={saving}
			bind:value={location}
		/>
		<Input
			label="Time of day"
			name={`scene-time-of-day-${uid}`}
			disabled={saving}
			bind:value={timeOfDay}
		/>
	</div>

	<div class="flex flex-col gap-1.5">
		<label
			for={`scene-description-${uid}`}
			class="text-sm font-medium text-[var(--color-text-muted)]"
		>
			Description
		</label>
		<textarea
			id={`scene-description-${uid}`}
			name={`scene-description-${uid}`}
			rows="3"
			disabled={saving}
			class={textareaClass}
			placeholder="What happens in this scene."
			bind:value={description}></textarea>
	</div>

	<div class="flex items-center justify-end gap-2">
		<button
			type="button"
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
			disabled={saving}
			onclick={cancel}
			data-testid="scene-cancel"
		>
			Cancel
		</button>
		<button
			type="button"
			class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
			disabled={saving}
			onclick={save}
			data-testid="scene-save"
		>
			Save
		</button>
	</div>
</div>

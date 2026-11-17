<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { Button, Input } from '$lib/components/ui';
	import { Save } from '@lucide/svelte';
	import { ApiError } from '$lib/api';
	import { update as updateProject } from '$lib/stores/projects.svelte.js';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte.js';
	import type {
		BrandConfig,
		ProjectBrief,
		ProjectDetailResponse,
		ThemeConfig,
		UpdateProjectRequest,
		VoiceConfig
	} from '$lib/types';
	import { TYPE_BRIEF, type PickType } from '$lib/studio/project-request';
	import { isValidUrl } from '$lib/utils/validation';
	import BriefForm from '$lib/components/studio/BriefForm.svelte';
	import SyllabusEditor from '$lib/components/studio/SyllabusEditor.svelte';
	import BrandEditor from './brief/BrandEditor.svelte';
	import VoiceEditor from './brief/VoiceEditor.svelte';
	import ThemeEditor from './brief/ThemeEditor.svelte';

	let { project }: { project: ProjectDetailResponse } = $props();

	// ── Title (always editable, its own save) ────────────────────────────────
	// Detached edit buffer that resyncs from the prop, same contract as the
	// brief/brand/voice/theme buffers below. It cannot use `!titleDirty` as its
	// guard the way they do: `titleDirty` compares the buffer against the
	// CURRENT prop, so the moment the prop becomes a different project it reads
	// "dirty" and a `!dirty` guard would refuse to resync — exactly the case
	// that needs resyncing. `<BriefSection {project} />` is rendered unkeyed
	// (ProjectWorkspace.svelte) and same-route nav (course → lesson) swaps the
	// prop on the LIVE component, so without this the title input kept showing
	// the previous project's title, armed Save, and wrote it onto the new one.
	//
	// So we remember what we last synced FROM and compare against that:
	//   - project.id changed  → different document, its buffer must never
	//                           travel with the user; hard reset.
	//   - same id, prop title changed remotely → adopt only if the buffer still
	//     holds what we synced (i.e. the user has not typed).
	// Exact (untrimmed) comparison on purpose: typing a trailing space is an
	// edit, and must not be silently reverted mid-keystroke.
	let workingTitle = $state(untrack(() => project.title));
	let titleSyncedFrom = $state(untrack(() => ({ id: project.id, title: project.title })));
	let savingTitle = $state(false);
	const titleDirty = $derived(workingTitle.trim() !== project.title);
	const titleValid = $derived(workingTitle.trim().length > 0);

	// No feedback loop is possible: the ONLY tracked reads are `project.id` /
	// `project.title` (props, never written here); every read of the state this
	// effect writes happens inside `untrack`.
	$effect(() => {
		const id = project.id;
		const title = project.title;
		untrack(() => {
			const from = titleSyncedFrom;
			if (id === from.id && title === from.title) return;
			if (id !== from.id || workingTitle === from.title) workingTitle = title;
			titleSyncedFrom = { id, title };
		});
	});

	// ── Brief body (BriefForm / SyllabusEditor / lesson fields) ──────────────
	// Detached edit buffer; resync from the prop when the user hasn't edited
	// (mirrors SyllabusEditor's pattern). brief arrives as a reactive proxy —
	// $state.snapshot strips it to a plain object.
	let workingBrief = $state<ProjectBrief>(
		untrack(() => $state.snapshot(project.brief ?? {}) as ProjectBrief)
	);
	let savingBrief = $state(false);
	const briefDirty = $derived(JSON.stringify(workingBrief) !== JSON.stringify(project.brief ?? {}));

	$effect(() => {
		if (!briefDirty) workingBrief = $state.snapshot(project.brief ?? {}) as ProjectBrief;
	});

	const isCourse = $derived(project.type === 'course');
	const isLesson = $derived(project.type === 'lesson');

	// ── Source / Target URL (stored in the brief, saved by "Save brief") ─────
	// The wizard maps the creation URL to brief.source_url (promo) or
	// brief.target_url (website_review / app_review) per TYPE_BRIEF — we reuse
	// that single source of truth so editing can't drift from buildBrief().
	// Other types (generic/course/audiobook/lesson) take URLs via the
	// multi-source Sources step, so no single-URL field is shown.
	const urlSpec = $derived(TYPE_BRIEF[project.type as PickType]);
	const urlKey = $derived(
		urlSpec?.urlToTargetUrl ? 'target_url' : urlSpec?.usesSourceUrl ? 'source_url' : ''
	);
	const urlLabel = $derived(urlKey === 'target_url' ? 'Target URL' : 'Source URL');
	const urlHint = $derived(
		urlKey === 'target_url'
			? 'The site or app being reviewed.'
			: 'Optional — the live site to record as background footage and ground the script.'
	);

	// The creation wizard REFUSES to leave its Source step while a required target
	// URL is empty or malformed (create-wizard.svelte.ts:385 `sourceValid`), but
	// the workspace had no equivalent gate — the same required field could be
	// cleared here and saved, leaving e.g. a website_review whose next run fails
	// at capture with no URL to capture. Same rule, driven off the same single
	// source of truth (`TYPE_BRIEF.required`) so the two cannot drift.
	//
	// Only `urlToTargetUrl` types are affected. promo's `source_url` is genuinely
	// optional (usesSourceUrl, absent from `required`) and stays ungated.
	const urlRequired = $derived(!!urlKey && (urlSpec?.required ?? []).includes(urlKey));
	const urlValue = $derived(strField(urlKey).trim());
	const urlValid = $derived(!urlRequired || (urlValue.length > 0 && isValidUrl(urlValue)));
	const urlError = $derived(
		urlValid
			? undefined
			: urlValue.length === 0
				? `${urlLabel} is required`
				: 'Enter a valid URL (including https://).'
	);

	async function saveTitle() {
		if (!titleValid || !titleDirty) return;
		savingTitle = true;
		try {
			await updateProject(project.id, { title: workingTitle.trim() });
			toastSuccess('Title saved');
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Failed to save title';
			toastError('Save failed', detail);
		} finally {
			savingTitle = false;
		}
	}

	async function saveBrief(next?: ProjectBrief) {
		// Guard as well as disable: the button is the only caller today, but a
		// disabled attribute is a UI affordance, not an invariant.
		if (!urlValid) return;
		savingBrief = true;
		try {
			await updateProject(project.id, { brief: next ?? workingBrief });
			toastSuccess('Brief saved');
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : 'Failed to save brief';
			toastError('Save failed', detail);
		} finally {
			savingBrief = false;
		}
	}

	function setBriefField(key: string, value: string) {
		workingBrief = { ...workingBrief, [key]: value };
	}
	function strField(key: string): string {
		return typeof workingBrief[key] === 'string' ? (workingBrief[key] as string) : '';
	}

	// Lesson objective: the lesson script reads `learning_objective`
	// (orchestrator stages/lesson/script.py) and the wizard writes it. This
	// editor used to read/write `learning_outcome`, which nothing reads — so a
	// wizard-made lesson showed blank and edits were ignored. A legacy value is
	// still shown, and dropped on the first edit.
	const lessonObjective = $derived(
		typeof workingBrief.learning_objective === 'string'
			? workingBrief.learning_objective
			: strField('learning_outcome')
	);
	function setLessonObjective(value: string) {
		const { learning_outcome: _legacy, ...rest } = workingBrief;
		void _legacy;
		workingBrief = { ...rest, learning_objective: value };
	}

	// ── Brand / Voice / Theme — editable identity blobs ──────────────────────
	// Each is a detached buffer that resyncs from the prop while clean (mirrors
	// the brief buffer above). On save we send the WHOLE buffer so keys we don't
	// surface — e.g. the palette/fonts auto-extracted by the backend's
	// resolve_brand_context, or the dialogue `cast` map — round-trip untouched.
	let workingBrand = $state<BrandConfig>(
		untrack(() => $state.snapshot(project.brand ?? {}) as BrandConfig)
	);
	let workingVoice = $state<VoiceConfig>(
		untrack(() => $state.snapshot(project.voice ?? {}) as VoiceConfig)
	);
	let workingTheme = $state<ThemeConfig>(
		untrack(() => $state.snapshot(project.theme ?? {}) as ThemeConfig)
	);
	let savingBrand = $state(false);
	let savingVoice = $state(false);
	let savingTheme = $state(false);

	const brandDirty = $derived(JSON.stringify(workingBrand) !== JSON.stringify(project.brand ?? {}));
	const voiceDirty = $derived(JSON.stringify(workingVoice) !== JSON.stringify(project.voice ?? {}));
	const themeDirty = $derived(JSON.stringify(workingTheme) !== JSON.stringify(project.theme ?? {}));

	$effect(() => {
		if (!brandDirty) workingBrand = $state.snapshot(project.brand ?? {}) as BrandConfig;
	});
	$effect(() => {
		if (!voiceDirty) workingVoice = $state.snapshot(project.voice ?? {}) as VoiceConfig;
	});
	$effect(() => {
		if (!themeDirty) workingTheme = $state.snapshot(project.theme ?? {}) as ThemeConfig;
	});

	// ── Unsaved-edit guard ───────────────────────────────────────────────────
	// The workspace mounts ONE section at a time, so switching section (a
	// `?section=` navigation) unmounts this component and drops every buffer.
	// Ask before that happens instead of silently losing the edit.
	let syllabusDirty = $state(false);
	const hasUnsavedEdits = $derived(
		titleDirty || briefDirty || brandDirty || voiceDirty || themeDirty || syllabusDirty
	);
	beforeNavigate((nav) => {
		if (!hasUnsavedEdits) return;
		// A full-page unload: cancelling makes the browser show its own prompt.
		if (nav.type === 'leave') {
			nav.cancel();
			return;
		}
		if (!confirm('You have unsaved brief changes. Leave without saving them?')) nav.cancel();
	});

	function hasConfig(v: unknown): boolean {
		return !!v && typeof v === 'object' && Object.keys(v as object).length > 0;
	}

	async function saveAsset(
		label: string,
		patch: UpdateProjectRequest,
		setSaving: (b: boolean) => void
	) {
		setSaving(true);
		try {
			await updateProject(project.id, patch);
			toastSuccess(`${label} saved`);
		} catch (err) {
			const detail = err instanceof ApiError ? err.detail : `Failed to save ${label.toLowerCase()}`;
			toastError('Save failed', detail);
		} finally {
			setSaving(false);
		}
	}
</script>

<div class="space-y-6">
	<!-- Title -->
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-3"
	>
		<h2 class="text-base font-semibold text-[var(--color-text)]">Project title</h2>
		<Input
			name="project-title"
			value={workingTitle}
			oninput={(e) => (workingTitle = (e.currentTarget as HTMLInputElement).value)}
			error={titleValid ? undefined : 'Title is required'}
		/>
		<div class="flex justify-end">
			<Button
				variant="primary"
				size="sm"
				disabled={!titleDirty || !titleValid || savingTitle}
				loading={savingTitle}
				onclick={saveTitle}
			>
				<Save class="h-3.5 w-3.5" /> Save title
			</Button>
		</div>
	</section>

	<!-- Brief body -->
	{#if isCourse}
		<!-- SyllabusEditor owns its own buffer + Save (audience / outcome / outline). -->
		<SyllabusEditor
			brief={project.brief ?? {}}
			saving={savingBrief}
			onSave={saveBrief}
			onDirtyChange={(d) => (syllabusDirty = d)}
		/>
	{:else}
		<!-- `brief-fields` scopes "which fields does this type show" assertions to the
		     brief body. Without it, label queries also reach the Brand/Voice/Theme
		     <details> below, whose colour fields duplicate names like "Accent". -->
		<section
			class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 space-y-4"
			data-testid="brief-fields"
		>
			<h2 class="text-base font-semibold text-[var(--color-text)]">Brief</h2>
			{#if urlKey}
				<div class="space-y-1">
					<Input
						label={urlLabel}
						name="brief-url"
						type="url"
						required={urlRequired}
						error={urlError}
						placeholder="https://example.com"
						value={strField(urlKey)}
						oninput={(e) => setBriefField(urlKey, (e.currentTarget as HTMLInputElement).value)}
					/>
					<p class="text-xs text-[var(--color-text-muted)]">{urlHint}</p>
				</div>
			{/if}
			{#if isLesson}
				<!-- BriefForm has no `lesson` field set (PickType excludes lesson); render
				     the lesson-relevant fields inline. -->
				<div>
					<label
						for="lesson-objective"
						class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
					>
						Learning objective
					</label>
					<textarea
						id="lesson-objective"
						rows="2"
						placeholder="What should the learner be able to do after this lesson?"
						value={lessonObjective}
						oninput={(e) => setLessonObjective((e.currentTarget as HTMLTextAreaElement).value)}
						class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
					></textarea>
				</div>
				<div>
					<label
						for="lesson-audience"
						class="block text-sm font-medium text-[var(--color-text-muted)] mb-1.5"
					>
						Audience
					</label>
					<textarea
						id="lesson-audience"
						rows="2"
						placeholder="Who is this lesson for?"
						value={strField('audience')}
						oninput={(e) =>
							setBriefField('audience', (e.currentTarget as HTMLTextAreaElement).value)}
						class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
					></textarea>
				</div>
			{:else}
				<BriefForm type={project.type as PickType} bind:brief={workingBrief} />
			{/if}
			<div class="flex justify-end">
				<Button
					variant="primary"
					size="sm"
					disabled={!briefDirty || savingBrief || !urlValid}
					loading={savingBrief}
					onclick={() => saveBrief()}
				>
					<Save class="h-3.5 w-3.5" /> Save brief
				</Button>
			</div>
		</section>
	{/if}

	<!-- Brand / Voice / Theme — editable identity -->
	<section
		class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
	>
		<details class="group" data-testid="brand-group">
			<summary
				class="flex cursor-pointer items-center justify-between rounded-[var(--radius-md)] px-4 py-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)]"
			>
				Brand
				<span class="text-xs font-normal text-[var(--color-text-muted)]">
					{hasConfig(project.brand) ? 'Configured' : 'Default'}
				</span>
			</summary>
			<div class="space-y-4 px-4 pb-4 pt-1">
				<BrandEditor bind:value={workingBrand} />
				<div class="flex justify-end">
					<Button
						variant="primary"
						size="sm"
						disabled={!brandDirty || savingBrand}
						loading={savingBrand}
						onclick={() => saveAsset('Brand', { brand: workingBrand }, (b) => (savingBrand = b))}
					>
						<Save class="h-3.5 w-3.5" /> Save brand
					</Button>
				</div>
			</div>
		</details>

		<details class="group" data-testid="voice-group">
			<summary
				class="flex cursor-pointer items-center justify-between rounded-[var(--radius-md)] px-4 py-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)]"
			>
				Voice
				<span class="text-xs font-normal text-[var(--color-text-muted)]">
					{hasConfig(project.voice) ? 'Configured' : 'Default'}
				</span>
			</summary>
			<div class="space-y-4 px-4 pb-4 pt-1">
				<VoiceEditor bind:value={workingVoice} />
				<div class="flex justify-end">
					<Button
						variant="primary"
						size="sm"
						disabled={!voiceDirty || savingVoice}
						loading={savingVoice}
						onclick={() => saveAsset('Voice', { voice: workingVoice }, (b) => (savingVoice = b))}
					>
						<Save class="h-3.5 w-3.5" /> Save voice
					</Button>
				</div>
			</div>
		</details>

		<details class="group" data-testid="theme-group">
			<summary
				class="flex cursor-pointer items-center justify-between rounded-[var(--radius-md)] px-4 py-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)]"
			>
				Theme
				<span class="text-xs font-normal text-[var(--color-text-muted)]">
					{hasConfig(project.theme) ? 'Configured' : 'Default'}
				</span>
			</summary>
			<div class="space-y-4 px-4 pb-4 pt-1">
				<ThemeEditor bind:value={workingTheme} />
				<div class="flex justify-end">
					<Button
						variant="primary"
						size="sm"
						disabled={!themeDirty || savingTheme}
						loading={savingTheme}
						onclick={() => saveAsset('Theme', { theme: workingTheme }, (b) => (savingTheme = b))}
					>
						<Save class="h-3.5 w-3.5" /> Save theme
					</Button>
				</div>
			</div>
		</details>
	</section>
</div>

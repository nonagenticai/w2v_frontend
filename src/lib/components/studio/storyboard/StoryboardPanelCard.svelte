<script lang="ts">
	// One storyboard panel: the structured authoring fields, the approval trail,
	// the AI rewrite affordance, and (persisted rows only) the AI image control
	// via `PanelVisualPicker`. The rendered picture itself lives one level up, in
	// StoryboardBoard's card wrapper. Edits fire `onUpdate` with the changed field;
	// the parent board persists (section) or mutates the bound array (wizard).
	import type {
		StoryboardPanelDraft,
		ShotSize,
		CameraAngle,
		CameraMovement,
		TransitionOut,
		PanelEvent
	} from '$lib/types';
	import { Badge, Button, Input, Select } from '$lib/components/ui';
	import PanelVisualPicker from './PanelVisualPicker.svelte';
	import { storyboard as storyboardApi } from '$lib/api';
	import { approvePanel, unapprovePanel } from '$lib/stores/storyboard.svelte.js';
	import { toastSuccess } from '$lib/stores/toast.svelte.js';
	import { formatRelativeTime, shortId } from '$lib/utils/format';
	import { History } from '@lucide/svelte';

	interface Props {
		panel: StoryboardPanelDraft;
		/** Read-only spine label, e.g. `clip-3`. */
		shotLabel: string;
		onUpdate?: (patch: Partial<StoryboardPanelDraft>) => void;
		/** Approve/unapprove persist through the store directly; this notifies the
		 *  board so it can patch its locally-rendered row (the id-sequence is
		 *  unchanged, so the board's re-seed effect won't fire on its own). */
		onApproved?: (patch: Partial<StoryboardPanelDraft>) => void;
		/** Section-only: run an AI rewrite of this panel. Absent in wizard mode ⇒
		 *  the Rewrite affordance is hidden. */
		onRewrite?: (id: string, instruction: string, fields?: string[]) => void;
		/** Section-only: true while THIS panel has an in-flight store mutation. */
		isBusy?: (id: string) => boolean;
		disabled?: boolean;
	}

	let {
		panel,
		shotLabel,
		onUpdate,
		onApproved,
		onRewrite,
		isBusy,
		disabled = false
	}: Props = $props();

	// Per-panel rewrite instruction (section mode). Local to the card.
	let rewriteInstruction = $state('');
	const busy = $derived(panel.id != null && (isBusy?.(panel.id) ?? false));

	function handleRewrite(): void {
		const instruction = rewriteInstruction.trim();
		if (!instruction || panel.id == null) return;
		onRewrite?.(panel.id, instruction);
	}

	const SHOT_SIZES: ShotSize[] = [
		'EWS',
		'WS',
		'LS',
		'MLS',
		'MS',
		'MCU',
		'CU',
		'ECU',
		'establishing',
		'insert',
		'OTS',
		'POV',
		'two_shot'
	];
	const ANGLES: CameraAngle[] = ['eye_level', 'high', 'low', 'dutch', 'overhead', 'worm'];
	const MOVEMENTS: CameraMovement[] = [
		'static',
		'pan',
		'tilt',
		'dolly',
		'zoom',
		'crane',
		'handheld',
		'push_in',
		'pull_out'
	];
	const TRANSITIONS: TransitionOut[] = [
		'cut',
		'dissolve',
		'wipe',
		'fade_in',
		'fade_out',
		'match_cut'
	];

	// The approval trail + approve/unapprove verbs only exist for persisted rows
	// (a real project-scoped panel). Wizard-mode drafts have no `project_id` and
	// aren't server-side yet, so the whole approval cluster is hidden for them —
	// the same "section-only" gate the Rewrite affordance uses.
	const persisted = $derived(panel.id != null && panel.project_id != null);
	const isApproved = $derived(panel.status === 'approved');

	let submitting = $state(false);
	let showHistory = $state(false);
	let events = $state<PanelEvent[] | null>(null);
	let eventsLoading = $state(false);
	let eventsError = $state(false);

	async function handleApprove(): Promise<void> {
		if (panel.id == null || submitting) return;
		submitting = true;
		try {
			const row = await approvePanel(panel.id);
			if (row) {
				onApproved?.({
					status: row.status,
					approved_at: row.approved_at,
					approved_by: row.approved_by
				});
				toastSuccess('Panel approved');
				// A fresh approval adds an event — drop the cache so the next expand refetches.
				events = null;
			}
		} finally {
			submitting = false;
		}
	}

	async function handleUnapprove(): Promise<void> {
		if (panel.id == null || submitting) return;
		submitting = true;
		try {
			const row = await unapprovePanel(panel.id);
			if (row) {
				onApproved?.({
					status: row.status,
					approved_at: row.approved_at,
					approved_by: row.approved_by
				});
				toastSuccess('Panel approval removed');
				events = null;
			}
		} finally {
			submitting = false;
		}
	}

	async function toggleHistory(): Promise<void> {
		showHistory = !showHistory;
		// Lazy-load on first expand (or after an approve/unapprove invalidated it).
		if (showHistory && events === null && panel.id != null && !eventsLoading) {
			eventsLoading = true;
			eventsError = false;
			try {
				const res = await storyboardApi.listPanelEvents(panel.id);
				events = res.items;
			} catch {
				eventsError = true;
			} finally {
				eventsLoading = false;
			}
		}
	}

	function opts(values: string[], includeNone = true): Array<{ value: string; label: string }> {
		const mapped = values.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
		return includeNone ? [{ value: '', label: '—' }, ...mapped] : mapped;
	}

	// Unique id suffix so every label/control pair is distinct across cards.
	const uid = $derived(panel.id ?? panel.shot_key);

	const textareaClass =
		'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20';

	function onText(field: keyof StoryboardPanelDraft, e: Event) {
		const v = (e.target as HTMLTextAreaElement).value;
		onUpdate?.({ [field]: v === '' ? null : v } as Partial<StoryboardPanelDraft>);
	}
	function onSelect(field: keyof StoryboardPanelDraft, e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		onUpdate?.({ [field]: v === '' ? null : v } as Partial<StoryboardPanelDraft>);
	}
	function onNumber(e: Event) {
		const raw = (e.target as HTMLInputElement).value;
		onUpdate?.({ duration_seconds: raw === '' ? null : Number(raw) });
	}
	function onShotNumber(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		onUpdate?.({ shot_number: v === '' ? null : v });
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-2">
		<span
			class="text-xs font-medium tabular-nums text-[var(--color-text-muted)]"
			data-testid="panel-shot-key"
		>
			{shotLabel}
		</span>
		{#if persisted}
			<div class="flex items-center gap-2" data-testid="panel-approval">
				{#if isApproved}
					<Badge variant="success">
						{#if panel.approved_by}
							Approved by {shortId(panel.approved_by)} · {panel.approved_at
								? formatRelativeTime(panel.approved_at)
								: 'just now'}
						{:else}
							Approved · {panel.approved_at ? formatRelativeTime(panel.approved_at) : 'just now'}
						{/if}
					</Badge>
					<Button
						variant="secondary"
						size="sm"
						disabled={disabled || submitting}
						loading={submitting}
						onclick={handleUnapprove}
					>
						Unapprove
					</Button>
				{:else}
					<Button
						variant="primary"
						size="sm"
						disabled={disabled || submitting}
						loading={submitting}
						onclick={handleApprove}
					>
						Approve
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	{#if persisted}
		<div class="space-y-2">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
				aria-expanded={showHistory}
				aria-controls={`panel-history-${uid}`}
				onclick={toggleHistory}
				data-testid="panel-history-toggle"
			>
				<History class="h-3.5 w-3.5" />
				{showHistory ? 'Hide history' : 'History'}
			</button>
			{#if showHistory}
				<div
					id={`panel-history-${uid}`}
					class="space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
					data-testid="panel-history"
				>
					{#if eventsLoading}
						<p class="text-xs text-[var(--color-text-muted)]" role="status" aria-live="polite">
							Loading history…
						</p>
					{:else if eventsError}
						<p class="text-xs text-[var(--color-danger)]">Couldn't load history.</p>
					{:else if events && events.length > 0}
						{#each events as ev (ev.id)}
							<div class="text-xs text-[var(--color-text)]">
								<span class="font-medium">{ev.event_type.replace(/_/g, ' ')}</span>
								· rev {ev.revision} · {formatRelativeTime(ev.created_at)}
								{#if ev.note}
									<span class="text-[var(--color-text-muted)]"> — {ev.note}</span>
								{/if}
							</div>
						{/each}
					{:else}
						<p class="text-xs text-[var(--color-text-muted)]">No history yet.</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Image generation. Self-gates on a persisted row (it needs a project-scoped
	     server job), so it renders nothing in wizard mode. -->
	<PanelVisualPicker {panel} {disabled} />

	<div class="flex flex-col gap-1.5">
		<label for={`action-${uid}`} class="text-sm font-medium text-[var(--color-text-muted)]">
			Action
		</label>
		<textarea
			id={`action-${uid}`}
			name={`action-${uid}`}
			rows="2"
			{disabled}
			class={textareaClass}
			value={panel.action_description ?? ''}
			oninput={(e) => onText('action_description', e)}></textarea>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<label for={`dialogue-${uid}`} class="text-sm font-medium text-[var(--color-text-muted)]">
				Dialogue
			</label>
			<textarea
				id={`dialogue-${uid}`}
				name={`dialogue-${uid}`}
				rows="2"
				{disabled}
				class={textareaClass}
				value={panel.dialogue ?? ''}
				oninput={(e) => onText('dialogue', e)}></textarea>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for={`vo-${uid}`} class="text-sm font-medium text-[var(--color-text-muted)]">
				Voice-over
			</label>
			<textarea
				id={`vo-${uid}`}
				name={`vo-${uid}`}
				rows="2"
				{disabled}
				class={textareaClass}
				value={panel.vo_text ?? ''}
				oninput={(e) => onText('vo_text', e)}></textarea>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<Select
			label="Shot size"
			name={`shot_size-${uid}`}
			value={panel.shot_size ?? ''}
			options={opts(SHOT_SIZES)}
			placeholder=""
			{disabled}
			onchange={(e) => onSelect('shot_size', e)}
		/>
		<Select
			label="Angle"
			name={`angle-${uid}`}
			value={panel.angle ?? ''}
			options={opts(ANGLES)}
			placeholder=""
			{disabled}
			onchange={(e) => onSelect('angle', e)}
		/>
		<Select
			label="Movement"
			name={`movement-${uid}`}
			value={panel.movement ?? ''}
			options={opts(MOVEMENTS)}
			placeholder=""
			{disabled}
			onchange={(e) => onSelect('movement', e)}
		/>
		<Select
			label="Transition"
			name={`transition-${uid}`}
			value={panel.transition_out ?? ''}
			options={opts(TRANSITIONS)}
			placeholder=""
			{disabled}
			onchange={(e) => onSelect('transition_out', e)}
		/>
		<Input
			label="Duration (s)"
			name={`duration-${uid}`}
			type="number"
			min="0"
			step="0.1"
			{disabled}
			value={panel.duration_seconds != null ? String(panel.duration_seconds) : ''}
			oninput={onNumber}
		/>
		<Input
			label="Shot #"
			name={`shot_number-${uid}`}
			{disabled}
			value={panel.shot_number ?? ''}
			oninput={onShotNumber}
		/>
	</div>

	{#if onRewrite}
		<div class="flex items-end gap-2" data-testid="panel-rewrite">
			<Input
				label="Rewrite instruction"
				name={`rewrite-${uid}`}
				placeholder="e.g. make it a dramatic low-angle push-in"
				bind:value={rewriteInstruction}
				disabled={disabled || busy}
				class="flex-1"
			/>
			<button
				type="button"
				class="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-strong)] px-3 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
				disabled={disabled || busy || rewriteInstruction.trim() === ''}
				onclick={handleRewrite}
				data-testid="panel-rewrite-btn"
			>
				{busy ? 'Rewriting…' : 'Rewrite'}
			</button>
			{#if busy}
				<span class="sr-only" role="status" aria-live="polite">Rewriting panel…</span>
			{/if}
		</div>
	{/if}
</div>

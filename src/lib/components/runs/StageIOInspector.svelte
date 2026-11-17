<script lang="ts">
	import type { StageExecutionResponse, PipelineStatus, StageStatus } from '$lib/types';
	import type {
		RunStatus,
		StageOutputResponse,
		RunUsageTotal,
		RunUsageResponse
	} from '$lib/types/runs';
	import { usageAttribution } from '$lib/utils/cost';
	import JobStatusBadge from '$lib/components/jobs/JobStatusBadge.svelte';
	import { Skeleton } from '$lib/components/ui';
	import StageOutputView from './StageOutputView.svelte';
	import { stageLabel, stageOutputSummary, formatDurationSeconds } from '$lib/utils/stage-labels';
	import { canRerunFromStep } from '$lib/utils/run-actions';
	import {
		ChevronDown,
		AlertTriangle,
		CornerDownRight,
		ArrowUpRight,
		Play,
		Edit3
	} from '@lucide/svelte';

	// The per-stage I/O inspector — the heart of "trace which output came from
	// which input". For every stage the run executes (in order) it shows the
	// stage's INPUTS (the outputs of its upstream `depends_on` stages, deep-linked
	// within this list; the run config for root stages) and its OUTPUT (rendered
	// readably by StageOutputView, with model/tokens/cost). All data is already on
	// the loaded RunDetail + the blueprint depends_on map — no extra fetches.
	// Array/map inputs default to empty so a partial / failed-to-load run can't
	// crash the render — `outputs.map(...)` and `dependsOn.get(...)` must never
	// hit `undefined` ("Cannot read properties of undefined (reading 'get')").
	let {
		stages = [],
		outputs = [],
		config = {},
		usage,
		dependsOn = new Map(),
		lineageUnavailable = false,
		outputError,
		expandedStage = null,
		pipelineStatus = 'pending',
		ontoggle,
		onrerun,
		oneditor
	}: {
		stages?: StageExecutionResponse[];
		outputs?: StageOutputResponse[];
		config?: Record<string, unknown>;
		usage: RunUsageTotal | null | undefined;
		dependsOn?: Map<string, string[]>;
		/** The `dependsOn` map is empty because we FAILED to fetch the blueprint,
		 *  not because these stages are roots. Without this the panel states, as
		 *  fact, that every stage "starts from the run configuration" — a claim it
		 *  has no evidence for. */
		lineageUnavailable?: boolean;
		/** Why this stage's lazily-fetched output could NOT be loaded (any failure
		 *  that is not "not produced yet"), or null. Without it a 401/403/5xx is
		 *  indistinguishable from an empty output and the card lies. */
		outputError?: (stageName: string) => string | null;
		expandedStage?: string | null;
		pipelineStatus?: RunStatus | PipelineStatus;
		ontoggle?: (name: string) => void;
		onrerun?: (name: string) => void;
		oneditor?: (name: string) => void;
	} = $props();

	const outputByStage = $derived(
		new Map(
			outputs.map((o) => [o.stage_name, (o.output ?? null) as Record<string, unknown> | null])
		)
	);
	// A completed stage that soft-failed a downstream step is flagged degraded on
	// its StageOutputResponse; the synthetic `stages` list doesn't carry it, so
	// resolve it from `outputs` by stage name for the "completed with warnings" badge.
	const degradedByStage = $derived(
		new Map(outputs.map((o) => [o.stage_name, o.degraded ?? false]))
	);
	// A stage can carry SEVERAL usage rows (e.g. an LLM call on a tenant
	// connection + a platform TTS call), so group them — keying a Map by stage
	// name kept only the last row and dropped the rest's tokens/cost.
	const usageByStage = $derived(
		new Map(
			[...new Set((usage?.by_stage ?? []).map((u) => u.stage_name))].map(
				(name): [string, RunUsageResponse[]] => [
					name,
					(usage?.by_stage ?? []).filter((u) => u.stage_name === name)
				]
			)
		)
	);

	// Config slices that feed the root stages. Only the keys an operator authored
	// (brief / brand / voice / theme) — not the bookkeeping the snapshot also
	// carries (tenant_id, owner, …) — so the "Run inputs" block stays readable.
	const configInputs = $derived.by((): Record<string, unknown> => {
		const slice: Record<string, unknown> = {};
		for (const k of ['brief', 'brand', 'voice', 'theme']) {
			const v = config?.[k];
			if (v && typeof v === 'object' && Object.keys(v as object).length > 0) slice[k] = v;
		}
		return slice;
	});
	const hasConfigInputs = $derived(Object.keys(configInputs).length > 0);

	// Stages this run deliberately didn't run (opt-in / gated stages → 'skipped')
	// are split out of the main list and tucked behind a count, so e.g. a
	// critique-only website_review shows just "Website Critique" instead of ten
	// "Skipped"/"Cancelled" cards. They stay reachable on demand.
	const ranStages = $derived(stages.filter((s) => s.status !== 'skipped'));
	const skippedStages = $derived(stages.filter((s) => s.status === 'skipped'));
	const skippedSummary = $derived(
		`${skippedStages.length} ${skippedStages.length === 1 ? 'stage' : 'stages'} skipped (not requested)`
	);
	let showSkipped = $state(false);

	function badgeStatus(status: string): RunStatus | PipelineStatus | StageStatus {
		// Pass 'skipped' through — JobStatusBadge renders a real 'Skipped' state.
		// The old skipped→cancelled remap mislabeled deliberately-skipped stages
		// as "Cancelled".
		return status as RunStatus | PipelineStatus | StageStatus;
	}

	// 'cancelled' is re-runnable: the stage was terminalized without executing
	// (run hard-failed / was cancelled upstream), so re-running is exactly the
	// remedy the operator wants. It matches 'skipped', which is also
	// never-executed and already offered here. 'pending'/'running' stay excluded
	// — the run is still live and would race the scheduler.
	const RERUNNABLE_STAGE_STATUSES = new Set<string>([
		'completed',
		'failed',
		'skipped',
		'cancelled'
	]);

	// "Rerun from here" on ANY step of a run the pipeline is not executing — a
	// completed run included (George 2026-10-27: users must be able to rerun every
	// part of a project, even one that finished). The backend 409s a rerun off a
	// pending/running run, so the button is not offered there.
	function canRerun(s: StageExecutionResponse): boolean {
		return Boolean(
			onrerun && RERUNNABLE_STAGE_STATUSES.has(s.status) && canRerunFromStep(pipelineStatus)
		);
	}
	function canOpenEditor(s: StageExecutionResponse): boolean {
		return Boolean(oneditor && (s.status === 'completed' || s.status === 'failed'));
	}

	function usageMeta(name: string): string {
		const rows = usageByStage.get(name);
		if (!rows?.length) return '';
		const distinct = (xs: (string | null | undefined)[]): string[] => [
			...new Set(xs.filter((x): x is string => Boolean(x)))
		];
		const parts: string[] = [...distinct(rows.map((u) => u.model))];
		const tok = rows.reduce((n, u) => n + (u.input_tokens ?? 0) + (u.output_tokens ?? 0), 0);
		if (tok > 0) parts.push(`${tok.toLocaleString()} tok`);
		const cost = rows.reduce((n, u) => n + (u.cost_usd ?? 0), 0);
		if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
		// Which slot served it: a tenant provider connection (pinned version) or
		// the platform path.
		parts.push(...distinct(rows.map(usageAttribution)));
		return parts.join(' · ');
	}

	// Open a target stage and scroll it into view (lineage deep-link). Guarded so
	// it always opens (never toggles closed) the jumped-to stage.
	function jumpTo(name: string) {
		// A depends_on target may be a SKIPPED upstream stage, which lives in the
		// collapsed skipped section — expand it first or getElementById finds no
		// card and the scroll silently no-ops.
		if (skippedStages.some((s) => s.stage_name === name)) showSkipped = true;
		if (expandedStage !== name) ontoggle?.(name);
		// Scroll after the panel has had a tick to expand.
		requestAnimationFrame(() => {
			document
				.getElementById(`stage-${name}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}
</script>

{#snippet stageCard(s: StageExecutionResponse)}
	{@const name = s.stage_name}
	{@const expanded = expandedStage === name}
	{@const output = outputByStage.get(name) ?? null}
	{@const deps = dependsOn.get(name) ?? []}
	{@const meta = usageMeta(name)}
	<!-- e2e: data-testid + data-stage + data-status are the contract the
		     post-promote specs poll for per-stage completion. Keep them on the
		     outer wrapper through any rework. -->
	<div
		id={`stage-${name}`}
		data-testid="stage-card"
		data-stage={name}
		data-status={s.status}
		data-degraded={degradedByStage.get(name) ? 'true' : undefined}
		class="scroll-mt-4 rounded-[var(--radius-lg)] border bg-[var(--color-bg)] overflow-hidden {degradedByStage.get(
			name
		)
			? 'border-[var(--color-warning-border)] border-l-4'
			: 'border-[var(--color-border)]'}"
	>
		<button
			type="button"
			onclick={() => ontoggle?.(name)}
			aria-expanded={expanded}
			class="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--color-surface)]/40 transition-colors"
		>
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-medium text-[var(--color-text)] truncate">
					{stageLabel(name)}
				</span>
				<span class="block text-xs text-[var(--color-text-muted)] truncate">
					{stageOutputSummary(output)}{stageOutputSummary(output) && meta ? ' · ' : ''}{meta}
				</span>
			</span>
			<JobStatusBadge
				status={badgeStatus(s.status)}
				degraded={degradedByStage.get(s.stage_name) ?? false}
			/>
			{#if s.duration_seconds !== null}
				<span class="text-xs text-[var(--color-text-muted)] tabular-nums">
					{formatDurationSeconds(s.duration_seconds)}
				</span>
			{/if}
			<ChevronDown
				aria-hidden="true"
				class="h-4 w-4 text-[var(--color-text-muted)] transition-transform {expanded
					? 'rotate-180'
					: ''}"
			/>
		</button>

		{#if expanded}
			<div class="border-t border-[var(--color-border)] px-4 py-4 space-y-4">
				<!-- ── INPUTS ── -->
				<div class="space-y-2">
					<p class="text-kicker text-[var(--color-text-muted)]">Inputs</p>
					{#if deps.length}
						<ul class="space-y-1.5">
							{#each deps as dep (dep)}
								{@const depOut = outputByStage.get(dep) ?? null}
								<li
									class="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
								>
									<CornerDownRight class="h-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
									<span class="min-w-0 flex-1">
										<span class="text-sm text-[var(--color-text)]">{stageLabel(dep)}</span>
										<span class="text-xs text-[var(--color-text-muted)] ml-2">
											{depOut ? stageOutputSummary(depOut) : 'not produced yet'}
										</span>
									</span>
									<button
										type="button"
										onclick={() => jumpTo(dep)}
										class="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-strong)] shrink-0"
									>
										View <ArrowUpRight class="h-3.5 w-3.5" />
									</button>
								</li>
							{/each}
						</ul>
					{:else if lineageUnavailable}
						<p
							data-testid="stage-lineage-unavailable"
							class="text-xs text-[var(--color-warning-text)]"
						>
							Upstream stages are unknown — the blueprint could not be loaded. This stage may well
							have inputs.
						</p>
					{:else if hasConfigInputs}
						<div
							class="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
						>
							<p class="text-xs text-[var(--color-text-muted)] mb-2">
								Run inputs — the brief / brand / voice this stage starts from.
							</p>
							<StageOutputView output={configInputs} />
						</div>
					{:else}
						<p class="text-xs text-[var(--color-text-muted)]">
							No upstream stages — this stage starts from the run configuration.
						</p>
					{/if}
					<p class="text-[10px] text-[var(--color-text-muted)]">
						Inputs are the upstream stage outputs + run config. The raw LLM prompt isn't stored.
					</p>
				</div>

				<!-- ── OUTPUT ── -->
				<div class="space-y-2">
					<p class="text-kicker text-[var(--color-text-muted)]">Output</p>
					{#if s.status === 'failed' && s.error}
						<div
							class="flex gap-2 rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] p-3"
						>
							<AlertTriangle class="h-4 w-4 text-[var(--color-danger)] shrink-0 mt-0.5" />
							<p class="text-sm text-[var(--color-danger)] min-w-0 break-words">{s.error}</p>
						</div>
					{/if}
					{#if s.status === 'completed'}
						{@const loadError = output === null ? (outputError?.(name) ?? null) : null}
						{#if loadError}
							<!-- The output could not be FETCHED — say so. Falling through to
							     StageOutputView would render "No output recorded.", asserting
							     the stage produced nothing when we simply failed to read it. -->
							<p
								data-testid="stage-output-load-error"
								class="text-xs text-[var(--color-warning-text)]"
							>
								Output could not be loaded — {loadError}. It may still exist; reload to retry.
							</p>
						{:else}
							<StageOutputView {output} />
						{/if}
					{:else if s.status === 'running'}
						<!-- The stage is actively producing output; SSE carries status only,
						     so the output reveals on the next refetch. A skeleton makes the
						     in-flight work legible instead of a lone "Running…" that can read
						     as stalled on a long run. (Pending stays text — it hasn't started.) -->
						<div class="space-y-2" data-testid="stage-output-running">
							<p class="text-xs text-[var(--color-text-muted)]">Running…</p>
							<Skeleton variant="text" count={3} />
						</div>
					{:else if s.status === 'skipped'}
						<p class="text-xs text-[var(--color-text-muted)]">
							Skipped{s.error ? ` — ${s.error}` : ''}
						</p>
					{:else if s.status === 'cancelled'}
						<!-- The run ended (hard fail / user cancel) before this stage could
						     run, so the orchestrator terminalized it. It has no output, but
						     it DOES carry a reason on `error` — the old `:else` fallback
						     rendered "Not started yet." and dropped that reason entirely. -->
						<p class="text-xs text-[var(--color-text-muted)]" data-testid="stage-output-cancelled">
							Cancelled — this stage never ran{s.error ? `: ${s.error}` : ' because the run ended.'}
						</p>
					{:else if s.status !== 'failed'}
						<p class="text-xs text-[var(--color-text-muted)]">Not started yet.</p>
					{/if}
				</div>

				<!-- ── Actions ── -->
				{#if canOpenEditor(s) || canRerun(s)}
					<div class="pt-2 border-t border-[var(--color-border)] flex items-center gap-4 flex-wrap">
						{#if canOpenEditor(s)}
							<button
								type="button"
								onclick={() => oneditor?.(name)}
								class="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-strong)] transition-colors"
							>
								<Edit3 class="h-3.5 w-3.5" />
								{s.status === 'completed' ? 'Edit & rerun' : 'Open step'}
							</button>
						{/if}
						{#if canRerun(s)}
							<button
								type="button"
								onclick={() => onrerun?.(name)}
								class="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-strong)] transition-colors"
							>
								<Play class="h-3.5 w-3.5" /> Rerun from here
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<div class="space-y-2">
	{#each ranStages as s (s.stage_name)}
		{@render stageCard(s)}
	{/each}

	{#if skippedStages.length}
		<div data-testid="skipped-stages">
			<button
				type="button"
				onclick={() => (showSkipped = !showSkipped)}
				data-testid="skipped-stages-toggle"
				aria-expanded={showSkipped}
				class="w-full flex items-center gap-2 px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
			>
				<ChevronDown
					aria-hidden="true"
					class="h-3.5 w-3.5 transition-transform {showSkipped ? 'rotate-180' : ''}"
				/>
				{skippedSummary}
			</button>
			{#if showSkipped}
				<div class="space-y-2 mt-1" data-testid="skipped-stages-list">
					{#each skippedStages as s (s.stage_name)}
						{@render stageCard(s)}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

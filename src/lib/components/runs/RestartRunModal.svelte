<script lang="ts">
	// The Restart confirmation for a cancelled / failed run. People cancel a run to
	// fix something and run it again, so before they spend money on a new run this
	// shows, step by step, what the server will KEEP (finished work their change does
	// not affect) and what it will RUN AGAIN — and why. The list is the server's own
	// plan (`GET /runs/{id}/restart-plan`), the same one `POST /regenerate {}` acts on.
	//
	// A preview that fails to load never blocks the restart: the error is shown in
	// the server's words, with a retry, and the person may still confirm.
	import { Button, Dialog, Spinner } from '$lib/components/ui';
	import { Check, RotateCcw } from '@lucide/svelte';
	import { runs } from '$lib/api';
	import type { RestartPlanResponse } from '$lib/api/runs';
	import { stageLabel } from '$lib/utils/stage-labels';
	import {
		describeReason,
		inputLabel,
		restartPlanErrorMessage,
		summarizePlan
	} from '$lib/utils/restart-plan';

	// `title` / `intro` / `confirmLabel` let the Studio's "new version of a finished
	// run" use the SAME preview: it posts the identical `regenerate {}` body, so the
	// server plan is exactly what it will do.
	let {
		open = $bindable(false),
		runId,
		loading = false,
		onconfirm,
		fromStage = null,
		title = 'Restart this run?',
		intro = "Starts a new run of this project. Finished steps that your changes don't affect are kept, so you only pay for what runs again.",
		confirmLabel = 'Restart run'
	}: {
		open?: boolean;
		runId: string;
		loading?: boolean;
		onconfirm: () => void;
		/** "Rerun from here": preview `regenerate {from_stage}` instead of a bare one. */
		fromStage?: string | null;
		title?: string;
		intro?: string;
		confirmLabel?: string;
	} = $props();

	let plan = $state<RestartPlanResponse | null>(null);
	let planError = $state<string | null>(null);
	let planLoading = $state(false);
	let requestSeq = 0;

	async function loadPlan() {
		const seq = ++requestSeq;
		planLoading = true;
		planError = null;
		try {
			const next = fromStage
				? await runs.restartPlan(runId, fromStage)
				: await runs.restartPlan(runId);
			if (seq === requestSeq) plan = next;
		} catch (err) {
			if (seq === requestSeq) {
				plan = null;
				planError = restartPlanErrorMessage(err);
			}
		} finally {
			if (seq === requestSeq) planLoading = false;
		}
	}

	// Re-fetched every time the dialog opens: the plan follows the CURRENT project,
	// so an edit made since the last look must show up.
	$effect(() => {
		// Read fromStage here so choosing another step re-fetches its own plan.
		void fromStage;
		if (open) void loadPlan();
	});

	const summary = $derived(plan ? summarizePlan(plan) : null);
	const changed = $derived((plan?.changed_inputs ?? []).map(inputLabel));
</script>

<Dialog bind:open {title}>
	<div data-testid="restart-plan" class="flex flex-col gap-3 text-sm">
		<p class="text-[var(--color-text-muted)]">{intro}</p>

		{#if planLoading && !plan}
			<div
				class="flex items-center gap-2 text-[var(--color-text-muted)]"
				data-testid="restart-plan-loading"
			>
				<Spinner size="sm" /> Checking which steps can be kept…
			</div>
		{:else if planError}
			<div
				role="alert"
				data-testid="restart-plan-error"
				class="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-[var(--color-danger-text)]"
			>
				<p>We couldn't load the preview: {planError}</p>
				<p class="mt-1">You can still restart; every step's status is decided when it starts.</p>
				<Button variant="secondary" size="sm" class="mt-2" onclick={() => void loadPlan()}>
					Try again
				</Button>
			</div>
		{:else if summary && plan}
			<p class="font-medium text-[var(--color-text)]" data-testid="restart-plan-headline">
				{summary.headline}
			</p>
			{#if changed.length > 0}
				<p class="text-[var(--color-text-muted)]" data-testid="restart-plan-changed">
					Changed since this run started: {changed.join(', ')}.
				</p>
			{/if}
			<div class="max-h-[50vh] overflow-y-auto pr-1 flex flex-col gap-3">
				{#if summary.reused.length > 0}
					<section data-testid="restart-plan-reused">
						<h3
							class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-1"
						>
							Kept
						</h3>
						<ul class="flex flex-col gap-1.5">
							{#each summary.reused as stage (stage.stage_name)}
								<li class="flex gap-2">
									<Check
										class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]"
										aria-hidden="true"
									/>
									<span>
										<span class="font-medium">{stageLabel(stage.stage_name)}</span>
										<span class="text-[var(--color-text-muted)]">
											— {stage.reasons.map(describeReason).join(' ')}</span
										>
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				<section data-testid="restart-plan-rerun">
					<h3
						class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-1"
					>
						Runs again
					</h3>
					<ul class="flex flex-col gap-1.5">
						{#each summary.rerun as stage (stage.stage_name)}
							<li class="flex gap-2">
								<RotateCcw
									class="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
									aria-hidden="true"
								/>
								<span>
									<span class="font-medium">{stageLabel(stage.stage_name)}</span>
									{#if plan.mode === 'partial'}
										<span class="text-[var(--color-text-muted)]">
											— {stage.reasons.map(describeReason).join(' ')}</span
										>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				</section>
			</div>
		{/if}

		<div class="flex justify-end gap-2 pt-2">
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button
				variant="primary"
				{loading}
				disabled={planLoading && !plan && !planError}
				onclick={onconfirm}
			>
				<RotateCcw class="h-4 w-4" />
				{confirmLabel}
			</Button>
		</div>
	</div>
</Dialog>

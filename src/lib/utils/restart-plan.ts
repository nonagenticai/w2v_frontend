// How the Studio explains a Restart before the person confirms it.
//
// The orchestrator decides, per step, whether a Restart REUSES the step's finished
// result or RUNS IT AGAIN (`GET /runs/{id}/restart-plan`, orchestrator
// `services/runs/restart_plan.py`), and says why with a stable `code`. People cancel
// a run to fix something and run it again, so the confirmation must say what their
// change costs: which finished steps are kept, which run again, and why. Each code
// is worded here, with the step's own label and the setting's name — never the
// server's internal key names. An unknown code falls back to the server's message.

import { stageLabel } from '$lib/utils/stage-labels';
import { ApiError } from '$lib/api/client';
import type { RestartPlanReason, RestartPlanResponse, RestartPlanStage } from '$lib/api/runs';

/** People-facing names for the run inputs a step can depend on. */
const INPUT_LABELS: Record<string, string> = {
	brief: 'the brief',
	title: 'the project title',
	voice: 'the voice',
	brand: 'the brand',
	theme: 'the theme',
	deliverable: 'the video length or format',
	verbatim_items: 'the must-say lines',
	direction: 'the creative direction',
	music: 'the music',
	sound_effects: 'the sound settings',
	ai_image_gen: 'the AI image settings',
	ai_video_gen: 'the AI video settings',
	motion_graphics: 'the motion graphics settings',
	title_card: 'the title card',
	legal: 'the legal lines',
	resolution: 'the video quality',
	'live:video_sources': 'the uploaded footage',
	'live:uploaded_documents': 'the uploaded documents',
	'live:uploaded_manuscript': 'the uploaded manuscript',
	'live:course_children': 'the course lessons'
};

export function inputLabel(key: string): string {
	return INPUT_LABELS[key] ?? key.replace(/^live:/, '').replace(/_/g, ' ');
}

function listOf(keys: readonly string[]): string {
	const labels = keys.map(inputLabel);
	if (labels.length <= 1) return labels[0] ?? 'a setting';
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** One reason, in words. */
export function describeReason(reason: RestartPlanReason): string {
	const inputs = reason.inputs ?? [];
	const step = reason.stage ? `“${stageLabel(reason.stage)}”` : 'an earlier step';
	switch (reason.code) {
		case 'cancelled':
			return 'It was stopped partway when the run was cancelled, so it starts over.';
		case 'failed':
			return 'It failed last time.';
		case 'not_run':
			return 'It had not run yet.';
		case 'skipped':
			return 'It was skipped last time and is checked again.';
		case 'missing_output':
			return 'Its saved result is missing, so it runs again.';
		case 'input_changed':
			return `It uses ${listOf(inputs)}, which you changed.`;
		case 'inputs_unrecorded':
			return `You changed ${listOf(inputs)}. This step ran before we recorded what it uses, so it runs again to be safe.`;
		case 'reads_everything':
			return `It uses all of the project settings, and you changed ${listOf(inputs)}.`;
		case 'live_input_changed':
			return `It uses ${listOf(inputs.map((i) => `live:${i}`))}, which changed.`;
		case 'chosen':
			return 'You chose to rerun from this step.';
		case 'feedback':
			return 'It has feedback to apply.';
		case 'upstream_rerun':
			return `It builds on ${step}, which runs again.`;
		case 'upstream_edited':
			return `It builds on your edit to ${step}.`;
		case 'edit_replaced':
			return 'Your edits to this step will be replaced.';
		case 'unchanged':
			return 'Nothing it depends on changed.';
		case 'edit_kept':
			return 'Your edited version is kept.';
		case 'not_resumable':
			return 'This kind of project runs every step again on restart.';
		case 'nothing_changed':
			return 'Nothing changed since this run finished, so every step runs again for a fresh version.';
		case 'all_steps_finished':
			return 'Every step had finished and the run stopped after them, so every step runs again.';
		case 'nothing_reusable':
			return 'None of the finished steps can be kept, so every step runs again.';
		case 'not_plannable':
			return 'Every step runs again.';
		default:
			return reason.message;
	}
}

export interface RestartPlanSummary {
	/** Steps whose finished result is kept, in pipeline order. */
	reused: RestartPlanStage[];
	/** Steps that run again, in pipeline order. */
	rerun: RestartPlanStage[];
	/** One sentence for the top of the confirmation. */
	headline: string;
}

export function summarizePlan(plan: RestartPlanResponse): RestartPlanSummary {
	const reused = plan.stages.filter((s) => s.action === 'reuse');
	const rerun = plan.stages.filter((s) => s.action === 'rerun');
	if (plan.mode === 'full' || reused.length === 0) {
		const why = plan.full_reasons[0];
		return {
			reused: [],
			rerun: plan.stages,
			headline: why ? describeReason(why) : 'Every step runs again.'
		};
	}
	const kept =
		reused.length === 1 ? '1 finished step is kept' : `${reused.length} finished steps are kept`;
	const again = rerun.length === 1 ? '1 step runs again' : `${rerun.length} steps run again`;
	return { reused, rerun, headline: `${kept}; ${again}.` };
}

/** The server's own words for a refused preview (never a bare status line). */
export function restartPlanErrorMessage(err: unknown): string {
	if (err instanceof ApiError) {
		const body = err.body as { detail?: { message?: unknown } } | undefined;
		const message = body?.detail?.message;
		if (typeof message === 'string' && message) return message;
		if (err.detail) return err.detail;
		return `The server answered ${err.status}.`;
	}
	if (err instanceof Error && err.message) return err.message;
	return 'The preview could not be loaded.';
}

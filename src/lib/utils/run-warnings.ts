// "Completed with warnings" — WHICH warnings.
//
// The run badge reads the boolean `run.degraded`, and every stage response
// already carries the facts behind it (orchestrator `api/routes/runs/_shared.py`
// `_stage_response`):
//   • `degraded`           — the boolean, true for a `completed` stage whose
//                            output carries either channel below;
//   • `degradation_codes`  — the stable codes, de-duplicated;
//   • `output.degradations`— the explicit channel, `[{code, detail}]`;
//   • `output.notes`       — the legacy PROSE channel (still raises `degraded`).
// Nothing rendered any of them, so a run said "Completed with warnings" and
// showed none. This module turns those fields into a flat, renderable list.

import { stageLabel } from './stage-labels';

/** The subset of a stage response this module reads. */
export interface WarningSourceStage {
	stage_name: string;
	degraded?: boolean | null;
	degradation_codes?: string[] | null;
	output?: Record<string, unknown> | null;
}

export interface StageWarningItem {
	/** Stable degradation code, or null for a legacy prose note. */
	code: string | null;
	/** Human-readable detail. Never empty. */
	detail: string;
}

export interface StageWarnings {
	stageName: string;
	label: string;
	items: StageWarningItem[];
}

/** Short human titles for the orchestrator's known codes
 *  (`services/stages/shared/degradation.py`). Unknown codes fall back to the
 *  code itself, title-cased — a code from a newer pod must still render. */
const CODE_TITLES: Record<string, string> = {
	promo_html_design_failed: 'Designed visual unavailable',
	source_grounding_missing: 'Source content unavailable',
	site_page_text_thin: 'Too little page text',
	mastering_gate_failed: 'Mastering check failed',
	duration_out_of_tolerance: 'Length outside the ordered duration',
	captions_missing: 'Captions missing',
	sound_bed_missing: 'Music bed missing',
	slides_stubbed: 'Slides stubbed',
	audio_unnormalized: 'Audio loudness unverified',
	duration_not_ordered: 'No duration ordered',
	ordered_duration_infeasible: 'Ordered duration not reachable',
	speech_rate_unusable: 'Speech rate unmeasured',
	duration_unmeasured: 'Delivered length unmeasured',
	narration_estimate_off_target: 'Narration estimate off target',
	review_skipped: 'Final review skipped (analyzer unavailable)',
	promo_review_empty: 'Video not reviewed',
	site_capture_no_footage: 'No site footage recorded'
};

export function degradationCodeTitle(code: string): string {
	return (
		CODE_TITLES[code] ??
		code
			.split('_')
			.filter(Boolean)
			.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
			.join(' ')
	);
}

function nonEmptyString(v: unknown): string | null {
	return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Per-stage warnings for every stage that is degraded or carries a degradation.
 *
 * Order follows `stages`. Within a stage: explicit `degradations[]` entries
 * first (code + detail), then legacy `notes`, then any code named in
 * `degradation_codes` that had no entry (a trimmed/absent output) so a code is
 * never silently lost. A stage flagged `degraded` with nothing readable still
 * gets one generic item — the badge must never point at an empty panel.
 */
export function extractRunWarnings(stages: readonly WarningSourceStage[]): StageWarnings[] {
	const out: StageWarnings[] = [];
	for (const stage of stages) {
		const output = stage.output && typeof stage.output === 'object' ? stage.output : null;
		const items: StageWarningItem[] = [];
		const seenCodes = new Set<string>();
		const seenDetails = new Set<string>();
		const seenEntries = new Set<string>();
		const detailKey = (detail: string) =>
			detail
				.replace(new RegExp(`^${stage.stage_name}:\\s*`), '')
				.replace(/\s+/g, ' ')
				.trim();

		const entries = Array.isArray(output?.degradations) ? output.degradations : [];
		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;
			const rec = entry as Record<string, unknown>;
			const code = nonEmptyString(rec.code);
			const detail = nonEmptyString(rec.detail);
			if (!code && !detail) continue;
			if (code) seenCodes.add(code);
			const signature = `${code ?? ''}:${detail ? detailKey(detail) : ''}`;
			if (seenEntries.has(signature)) continue;
			seenEntries.add(signature);
			if (detail) {
				seenDetails.add(detailKey(detail));
				for (const part of detail.split(/;\s+/)) seenDetails.add(detailKey(part));
			}
			items.push({ code, detail: detail ?? degradationCodeTitle(code as string) });
		}

		const notes = Array.isArray(output?.notes) ? output.notes : [];
		for (const note of notes) {
			const detail = nonEmptyString(note);
			if (detail && !seenDetails.has(detailKey(detail))) {
				seenDetails.add(detailKey(detail));
				items.push({ code: null, detail });
			}
		}

		for (const code of stage.degradation_codes ?? []) {
			if (!nonEmptyString(code) || seenCodes.has(code)) continue;
			seenCodes.add(code);
			items.push({ code, detail: degradationCodeTitle(code) });
		}

		if (items.length === 0 && stage.degraded === true) {
			items.push({
				code: null,
				detail: 'This step finished with warnings but recorded no details.'
			});
		}

		if (items.length > 0) {
			out.push({ stageName: stage.stage_name, label: stageLabel(stage.stage_name), items });
		}
	}
	return out;
}

/**
 * Per-stage ADVISORIES — the non-degrading tier.
 *
 * `output.advisories` (orchestrator `services/stages/base.py` `StageOutput`) has
 * the same `{code, detail}` shape as `degradations` but deliberately does NOT
 * raise `degraded`: it records a fact worth knowing (e.g. duration conformance on
 * a stage that cannot act on it) without calling the stage broken. Rendering it
 * inside the warnings list would promote it to a warning, and dropping it hides
 * the only account of it — so it is extracted separately and shown as "Notes".
 */
export function extractRunAdvisories(stages: readonly WarningSourceStage[]): StageWarnings[] {
	const out: StageWarnings[] = [];
	for (const stage of stages) {
		const output = stage.output && typeof stage.output === 'object' ? stage.output : null;
		const entries = Array.isArray(output?.advisories) ? output.advisories : [];
		const items: StageWarningItem[] = [];
		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;
			const rec = entry as Record<string, unknown>;
			const code = nonEmptyString(rec.code);
			const detail = nonEmptyString(rec.detail);
			if (!code && !detail) continue;
			items.push({ code, detail: detail ?? degradationCodeTitle(code as string) });
		}
		if (items.length > 0) {
			out.push({ stageName: stage.stage_name, label: stageLabel(stage.stage_name), items });
		}
	}
	return out;
}

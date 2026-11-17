// Which audit a scorecard scan output is, and what its AI-analysis status says.
//
// New scan outputs (orchestrator feat/audit-templates, lane E) carry
// `project_type` — the type is IN THE DATA, so dispatch reads it. Older run
// outputs predate the field; for those only, the type is recovered from the
// breakdown array the scan emitted (groups → SEO, subsections → CRO,
// dimensions → scorecard). That fallback exists so historical runs still render;
// it is never consulted when `project_type` is present.

export const AUDIT_PROJECT_TYPES = ['seo_audit', 'cro_audit', 'marketing_scorecard'] as const;
export type AuditProjectType = (typeof AUDIT_PROJECT_TYPES)[number];

export function isAuditProjectType(v: unknown): v is AuditProjectType {
	return typeof v === 'string' && (AUDIT_PROJECT_TYPES as readonly string[]).includes(v);
}

export function auditProjectType(output: Record<string, unknown>): AuditProjectType {
	if (isAuditProjectType(output.project_type)) return output.project_type;
	// Legacy outputs (no project_type). `Array.isArray`, not `in`: a present-but-null
	// `subsections` must not mislabel a marketing scorecard as CRO.
	if (Array.isArray(output.groups)) return 'seo_audit';
	if (Array.isArray(output.subsections)) return 'cro_audit';
	return 'marketing_scorecard';
}

/** The `ai` block a scan output carries (mirrors orchestrator `AiStatusOut`). */
export interface AuditAiStatus {
	requested?: boolean;
	status?: string;
	reason?: string | null;
	layers?: { layer?: string; worker?: string; status?: string; reason?: string | null }[];
}

export type AiTone = 'neutral' | 'success' | 'warning' | 'danger';

/**
 * The one-line AI status the report states (read, never inferred). `null` when the
 * output has no `ai` block at all (a run older than the field) — no line is shown
 * rather than a guess.
 */
export function aiStatusLine(ai: AuditAiStatus | null | undefined): {
	status: string;
	text: string;
	tone: AiTone;
} | null {
	if (!ai || typeof ai !== 'object' || typeof ai.status !== 'string') return null;
	const reason = typeof ai.reason === 'string' && ai.reason.trim() ? ai.reason.trim() : null;
	switch (ai.status) {
		case 'not_requested':
			return { status: ai.status, text: 'AI analysis: not requested', tone: 'neutral' };
		case 'complete':
			return { status: ai.status, text: 'AI analysis: complete', tone: 'success' };
		case 'partial':
			return {
				status: ai.status,
				text: `AI analysis: partial${reason ? `: ${reason}` : ''}`,
				tone: 'warning'
			};
		case 'unavailable':
			return {
				status: ai.status,
				text: `AI analysis: unavailable${reason ? `: ${reason}` : ''}`,
				tone: 'danger'
			};
		default:
			// An unknown status is stated verbatim, never dressed up as success.
			return {
				status: ai.status,
				text: `AI analysis: ${ai.status.replace(/_/g, ' ')}${reason ? `: ${reason}` : ''}`,
				tone: 'warning'
			};
	}
}

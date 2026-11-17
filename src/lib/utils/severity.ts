// Map a finding/issue severity string to a Pill tone. Lifted out of
// StageOutputView + RunOutputPanel (where it was duplicated) so the new
// renderer library and the legacy views share one definition.

export type SeverityTone = 'danger' | 'warning' | 'neutral';

/** critical/high → danger, medium → warning, everything else (low/info/empty) → neutral. */
export function severityTone(sev: string | undefined | null): SeverityTone {
	const s = (sev ?? '').toLowerCase();
	if (s === 'critical' || s === 'high') return 'danger';
	if (s === 'medium') return 'warning';
	return 'neutral';
}

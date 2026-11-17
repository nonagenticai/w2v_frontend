// Map an A–F letter grade to a Pill tone. Shared by the SEO + CRO audit
// scorecards so the mapping can't drift between the two near-identical
// renderers (the AuthoredLine "single source of truth" lesson).

export type GradeTone = 'success' | 'warning' | 'danger';

/**
 * A-family -> success, B/C-family -> warning, everything else (D/E/F, empty) -> danger.
 *
 * Keys on the FIRST letter so suffixed grades (`A-`, `B+`, `C-`) map the same
 * as their base letter — the previous inline logic matched `A` with startsWith
 * but `B`/`C` with exact equality, so any `+`/`-` grade fell through to danger.
 */
export function gradeTone(grade: string | undefined | null): GradeTone {
	const c = grade?.[0]?.toUpperCase();
	if (c === 'A') return 'success';
	if (c === 'B' || c === 'C') return 'warning';
	return 'danger';
}

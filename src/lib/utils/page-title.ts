import { PROJECT_TYPE_LABELS, type ProjectType } from '$lib/types';

// Suffix every tab title carries (matches the other routes' `<title>`s).
export const APP_TITLE_SUFFIX = 'Studio';

/**
 * Tab title for a run/pipeline detail page: names the project and its workflow
 * type so several open runs are distinguishable in the tab strip, e.g.
 * `Acme launch · Demo video run - Studio`. Falls back to the generic
 * `Pipeline Detail` title when the project title is not (yet) known, and to the
 * raw type id for a type the label map does not cover.
 */
export function runPageTitle(
	projectTitle: string | null | undefined,
	projectType: string | null | undefined
): string {
	const title = projectTitle?.trim();
	if (!title) return `Pipeline Detail - ${APP_TITLE_SUFFIX}`;
	const type = projectType?.trim();
	const typeLabel = type ? (PROJECT_TYPE_LABELS[type as ProjectType] ?? type) : '';
	const kind = typeLabel ? `${typeLabel} run` : 'Run';
	return `${title} · ${kind} - ${APP_TITLE_SUFFIX}`;
}

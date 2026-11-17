/**
 * Where the New project wizard's "Back to X" link goes: back to Projects when the
 * user came from the project list (or a project), otherwise to the dashboard.
 */
export function wizardBackTarget(fromPath: string | null | undefined): {
	href: string;
	label: string;
} {
	if (fromPath && (fromPath === '/projects' || fromPath.startsWith('/projects/'))) {
		if (!fromPath.startsWith('/projects/new')) return { href: '/projects', label: 'projects' };
	}
	return { href: '/', label: 'dashboard' };
}

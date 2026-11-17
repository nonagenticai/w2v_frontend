import { error } from '@sveltejs/kit';
import { ApiError, blueprints } from '$lib/api';
import { loadOne } from '$lib/stores/projects.svelte.js';
import { settle } from '$lib/utils/load-errors';

export async function load({ params }) {
	try {
		const project = await loadOne(params.pid);
		// The blueprint's real stage names for this type — the home renders these
		// instead of a hard-coded list. Best-effort: it never blocks the page.
		//
		// It used to be `.catch(() => [])`, and an empty list is exactly what the
		// stage preview renders as "No course blueprint is published". So a 500 on
		// /api/blueprints published a confident, wrong fact about the project.
		// `blueprintsError` is the sibling key that lets the preview tell the two
		// apart; `blueprintStages` keeps its old shape for every other consumer.
		const { data: allBlueprints, error: blueprintsError } = await settle(blueprints.list(), []);
		const blueprintStages =
			allBlueprints.find((b) => b.project_type === project.type)?.stages.map((s) => s.name) ?? [];
		return { project, blueprintStages, blueprintsError };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, 'Project not found');
		}
		// 5xx / network errors bubble so the BE-down layout banner can render
		// (markBackendDown was called in the api client's caller chain).
		throw err;
	}
}

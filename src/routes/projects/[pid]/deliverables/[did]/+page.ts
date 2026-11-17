import { error } from '@sveltejs/kit';
import { ApiError } from '$lib/api/client.js';
import { loadOne } from '$lib/stores/projects.svelte.js';

export async function load({ params }) {
	let project;
	try {
		project = await loadOne(params.pid);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, 'Project not found');
		}
		throw err;
	}
	const deliverable = project.deliverables?.find((d) => d.id === params.did);
	if (!deliverable) {
		throw error(404, 'Deliverable not found');
	}
	return { project, deliverable };
}

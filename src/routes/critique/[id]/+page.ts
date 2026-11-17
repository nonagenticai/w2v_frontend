import { ApiError, critique } from '$lib/api';
import { error } from '@sveltejs/kit';

export async function load({ params }) {
	try {
		const run = await critique.get(params.id);
		return { run };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			error(404, 'Critique not found');
		}
		throw err;
	}
}

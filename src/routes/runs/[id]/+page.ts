import { error, redirect } from '@sveltejs/kit';
import { ApiError, runs } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch: _fetch }) => {
	try {
		const detail = await runs.get(params.id);
		throw redirect(307, `/projects/${detail.project_id}/runs/${params.id}/`);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, 'Run not found');
		}
		throw err;
	}
};

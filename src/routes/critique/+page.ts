import { ApiError, critique } from '$lib/api';
import type { CritiqueList } from '$lib/types';

export async function load({ url }) {
	const page = Number(url.searchParams.get('page') ?? '1');
	const status = url.searchParams.get('status') ?? undefined;

	// Single retry on 401 covers the documented Keycloak-init race
	// (sveltekit-page-load-races-keycloak-init): the loader can fire
	// before token-exchange completes even though +layout.ts awaits
	// ensureAuthReady. Other errors bubble to +error.svelte rather
	// than silently rendering an empty list.
	let critiqueList: CritiqueList;
	try {
		critiqueList = await critique.list(page, 20, status);
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) {
			await new Promise((r) => setTimeout(r, 200));
			critiqueList = await critique.list(page, 20, status);
		} else {
			throw err;
		}
	}

	return { critiqueList, currentPage: page, currentStatus: status ?? '' };
}

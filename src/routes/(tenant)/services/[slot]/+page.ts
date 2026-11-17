import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { isSlotId } from '$lib/services/slots.js';

// The route param IS the slot id. Unknown slots 404 here rather than rendering
// a page with no descriptor (the page falls back defensively, but a wrong URL
// should be a 404, not an empty test bench).
export const load: PageLoad = ({ params }) => {
	if (!isSlotId(params.slot)) throw error(404, 'Unknown service');
	return { slot: params.slot };
};

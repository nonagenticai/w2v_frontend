import { redirect } from '@sveltejs/kit';

// `/services` is a group of one-page-per-slot test benches, not a page of its
// own: land on the first slot so the nav entry always opens something.
export function load(): never {
	throw redirect(307, '/services/image');
}

import { redirect } from '@sveltejs/kit';

// Verbatim is now a section of the master-detail project workspace
// (?section=verbatim), not a standalone page. Permanent-ish 307 keeps any old
// bookmarks / in-product links working. The old +page.svelte is superseded and
// removed in the session-6 route cleanup.
export function load({ params }) {
	redirect(307, `/projects/${params.pid}?section=verbatim`);
}

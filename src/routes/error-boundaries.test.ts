import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards a STRUCTURAL invariant, not a behaviour: every route GROUP owns an
// error boundary.
//
// Why this is a test and not a review habit. SvelteKit walks UP the route tree
// for the nearest `+error.svelte`. A group with none does not fail loudly — it
// silently resolves to the ROOT boundary, which replaces the entire page with a
// status code and a "Go Home" button. So one thrown `load()` on, say,
// /provision blanked the whole administrative surface, including the screens an
// operator would use to work out what broke. That is exactly how one undefined
// chapter key blanked a whole run page (#367).
//
// Both `(tenant)` and `(platform)` shipped without one and nothing complained,
// because the fallback IS a rendered page. The failure mode is invisible in
// review, invisible in `svelte-check`, and invisible in E2E unless a spec
// happens to make that particular load throw. The invariant that actually
// matters is the shape of the route tree, so that is what is asserted.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = HERE; // src/routes/

const IGNORED_DIRS = new Set(['node_modules']);
const ROUTE_GROUP = /^\(.+\)$/;

/** Every directory under src/routes, as a path relative to src/routes. */
function routeDirs(dir: string, rel = ''): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
		const childRel = rel ? `${rel}/${entry.name}` : entry.name;
		out.push(childRel);
		out.push(...routeDirs(path.join(dir, entry.name), childRel));
	}
	return out;
}

const hasBoundary = (rel: string): boolean => existsSync(path.join(ROUTES, rel, '+error.svelte'));

// Leaf routes whose recovery differs from their parent's, so falling through to
// the parent boundary is a real loss of affordance. Listed explicitly because
// there is no way to derive "this screen needs its own recovery" from the tree.
const REQUIRED_LEAF_BOUNDARIES = ['projects/[pid]/runs/[id]/studio'];

describe('route error boundaries', () => {
	it('every route group has a +error.svelte', () => {
		const groups = routeDirs(ROUTES).filter((rel) => ROUTE_GROUP.test(path.basename(rel)));

		// Sanity: if this ever hits 0 the assertion below is vacuously green.
		expect(groups.length).toBeGreaterThan(0);

		const missing = groups.filter((rel) => !hasBoundary(rel));
		expect(
			missing,
			`route group(s) with no +error.svelte — a thrown load() here blanks the whole ` +
				`surface via the root boundary. Add src/routes/<group>/+error.svelte.`
		).toEqual([]);
	});

	it('every route needing its own recovery has a +error.svelte', () => {
		const missing = REQUIRED_LEAF_BOUNDARIES.filter((rel) => !hasBoundary(rel));
		expect(missing).toEqual([]);
	});

	// Ratchet: every boundary that exists today must keep existing. Deliberately a
	// SUPERSET check — adding a boundary is always welcome and must not red the
	// suite; deleting one must.
	it('never loses a boundary it already has', () => {
		const KNOWN = [
			'', // root fallback
			'(platform)',
			'(tenant)',
			'critique',
			'critique/[id]',
			'projects',
			'projects/[pid]',
			'projects/[pid]/runs/[id]',
			'projects/[pid]/runs/[id]/studio',
			'runs/[id]',
			'settings'
		];

		const missing = KNOWN.filter((rel) => !hasBoundary(rel));
		expect(missing, 'a +error.svelte that used to exist was removed').toEqual([]);
	});
});
